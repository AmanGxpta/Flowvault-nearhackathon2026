// USDC gas, live side (owner: Stream A): live reads (gas price, ETH price, USDC permit domain + nonce, receipts) and
// the gas-op journal (table gas_ops). One op = one reviewed USDC transfer whose network fee is paid in USDC through
// Circle Paymaster. The op's token is the only credential the wallet's paymaster call carries (no cookies there).
import { database } from "./store";
import { EVM_CHAINS, evmRpc, hexQuantity } from "./evm";
import { readPriceEvidence } from "./valuation-evidence";
import { usdcValue } from "./valuation";
import { ledgerOutbox } from "./plans-store";
import type { LedgerEntry } from "./contracts";
import { CIRCLE, USDC, permitTypedData, reconcileReceipt, usdcGasQuote, type GasNetwork, type PermitFields, type UsdcGasQuote } from "./gas-abstraction";

const CODE: Record<GasNetwork, "eth" | "base" | "arb"> = { ethereum: "eth", base: "base", arbitrum: "arb" };
export const OP_TTL_MS = 30 * 60_000;

export interface GasOp {
  id: string;
  token: string;
  sessionId: string;
  network: GasNetwork;
  owner: string;
  depositAddress: string;
  amountRaw: string;
  quote: UsdcGasQuote;
  permit: PermitFields & { signature: string | null };
  state: "quoted" | "permitted" | "sponsored" | "submitted" | "confirmed" | "failed";
  callsId: string | null;
  txHash: string | null;
  chargedUsdcRaw: string | null;
  principalExact: boolean | null;
  createdAt: string;
  expiresAt: string;
}

async function table() {
  const db = await database();
  await db.prepare("CREATE TABLE IF NOT EXISTS gas_ops (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)").run();
  return db;
}
export async function opGet(id: string, sessionId?: string): Promise<{ op: GasOp; previous: string } | null> {
  const db = await table();
  const row = sessionId
    ? await db.prepare("SELECT payload FROM gas_ops WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string }>()
    : await db.prepare("SELECT payload FROM gas_ops WHERE id=?").bind(id).first<{ payload: string }>();
  return row ? { op: JSON.parse(row.payload) as GasOp, previous: row.payload } : null;
}
export async function opInsert(op: GasOp) {
  await (await table()).prepare("INSERT INTO gas_ops (id, session_id, payload) VALUES (?,?,?)").bind(op.id, op.sessionId, JSON.stringify(op)).run();
}
export async function opSave(op: GasOp, previous: string) {
  const r = await (await table()).prepare("UPDATE gas_ops SET payload=? WHERE id=? AND payload=?").bind(JSON.stringify(op), op.id, previous).run();
  if (!r.meta?.changes) throw new Error("This fee payment changed in another tab. Check its status.");
}

/* ───────────── live reads ───────────── */

const call = (n: GasNetwork, data: string) => evmRpc(CODE[n], "eth_call", [{ to: USDC[n], data }, "latest"]) as Promise<string>;
function abiString(h: string) {
  const b = h.slice(2);
  const len = Number(BigInt("0x" + b.slice(64, 128)));
  const bytes = b.slice(128, 128 + len * 2).match(/../g) ?? [];
  return new TextDecoder().decode(Uint8Array.from(bytes, (x) => parseInt(x, 16)));
}

/** Bounded quote for one transfer, or a reason it isn't offered. */
export async function liveQuote(network: GasNetwork, principalRaw: bigint): Promise<{ quote: UsdcGasQuote | null; reason?: string }> {
  if (hexQuantity(await evmRpc(CODE[network], "eth_chainId", [])) !== EVM_CHAINS[CODE[network]].chainId) throw new Error("EVM RPC returned the wrong chain.");
  const [gasPrice, prices] = await Promise.all([evmRpc(CODE[network], "eth_gasPrice", []).then(hexQuantity), readPriceEvidence()]);
  let usdcPerEth: bigint;
  try {
    usdcPerEth = usdcValue(10n ** 18n, 18, "ETH", prices, "liability");
  } catch (e) {
    return { quote: null, reason: "ETH_PRICE_UNAVAILABLE: " + (e as Error).message };
  }
  const quote = usdcGasQuote({ network, principalRaw, gasPriceWei: gasPrice, usdcPerEthRaw: usdcPerEth });
  return quote ? { quote } : { quote: null, reason: "FEE_ABOVE_CAP: gas is too expensive right now to bound the USDC charge; pay it in ETH" };
}

export async function usdcBalanceOf(network: GasNetwork, owner: string) {
  return hexQuantity(await call(network, "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0")));
}

/** Permit fields read live from the USDC contract: EIP-712 name/version and the owner's current nonce. */
export async function permitFields(network: GasNetwork, owner: string, valueRaw: string): Promise<PermitFields> {
  const [name, version, nonce] = await Promise.all([call(network, "0x06fdde03").then(abiString), call(network, "0x54fd4d50").then(abiString), call(network, "0x7ecebe00" + owner.slice(2).toLowerCase().padStart(64, "0")).then(hexQuantity)]);
  if (name !== "USD Coin" || version !== "2") throw new Error(`Unexpected USDC permit domain on ${network} (${name} v${version}).`);
  // v0.8 is deployed on every network FlowVault reads (and is the version 7702 accounts use).
  return { network, tokenName: name, tokenVersion: version, owner: owner.toLowerCase(), spender: CIRCLE[network][0].paymaster, valueRaw, nonce: nonce.toString() };
}
export { permitTypedData };

/** Reconciles a submitted op from its finalized receipt and books the actual USDC fee once. */
export async function reconcileOp(op: GasOp): Promise<GasOp> {
  if (!op.txHash || op.state === "confirmed" || op.state === "failed") return op;
  const r = await evmRpc(CODE[op.network], "eth_getTransactionReceipt", [op.txHash]);
  if (!r) return op;
  const fin = await evmRpc(CODE[op.network], "eth_getBlockByNumber", ["finalized", false]).catch(() => null);
  if (!fin?.number || hexQuantity(fin.number) < hexQuantity(r.blockNumber)) return op;
  const rec = reconcileReceipt({ network: op.network, owner: op.owner, paymaster: op.permit.spender, depositAddress: op.depositAddress, amountRaw: op.amountRaw, logs: r.logs ?? [] });
  op.chargedUsdcRaw = rec.chargedUsdcRaw.toString();
  op.principalExact = rec.principalExact;
  op.state = r.status === "0x1" && rec.principalExact ? "confirmed" : "failed";
  if (rec.chargedUsdcRaw > 0n) {
    const fee: LedgerEntry = {
      id: `gas:${op.id}:fee:USDC`, at: new Date().toISOString(), kind: "fee", asset: "USDC", chain: CODE[op.network], amountRaw: op.chargedUsdcRaw, decimals: 6,
      usdcRaw: op.chargedUsdcRaw, netWorthEffectUsdcRaw: "-" + op.chargedUsdcRaw, liabilityEffectUsdcRaw: "0", realized: true, status: "confirmed",
      attemptId: "gas:" + op.id, txHashes: [op.txHash], source: "live",
      basis: `Network fee paid in USDC through Circle Paymaster (incl. Circle's 10%), from the finalized receipt: USDC to the paymaster minus refunds${op.state === "failed" ? "; the transfer itself did not complete" : ""}`,
    };
    await ledgerOutbox(op.sessionId, "gas:" + op.id, [fee]);
  }
  return op;
}
