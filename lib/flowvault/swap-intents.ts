// In-app cross-chain swaps through NEAR Intents (1Click). Pure: validates a live (non-dry) quote, builds the one
// deposit the owner signs in the wallet that holds the token, the policy view of it, and the origin-receipt check.
// Delivery is then reported by 1Click and recorded only from its status; FlowVault never signs or holds funds.
import { decimal } from "./money.ts";
import type { PolicyAction } from "./policy.ts";
import type { PolicyEntry } from "./plans-policy.ts";
import type { SwapTx } from "./swap-exec.ts";

export const INTENTS_VENUE = "1click";
export const EVM_CHAIN_IDS: Record<string, string> = { eth: "0x1", base: "0x2105", arb: "0xa4b1" };
export const INTENTS_ORIGINS = ["near", "eth", "base", "arb"];
const TGAS = 10n ** 12n;
const ERC20_TRANSFER = "0xa9059cbb";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface IntentsSide { network: string; contract: string; symbol: string; decimals: number; assetId: string }
export interface EvmDepositTx { chainId: string; from: string; to: string; value: string; data: string }
export interface IntentsPreparation {
  kind: "swap"; route: "intents"; accountId: string; amount: string; amountRaw: string; expiresAt: string;
  from: IntentsSide; to: IntentsSide; recipient: string; depositAddress: string; depositMemo: string | null;
  outputRaw: string; minOutRaw: string; slippageBps: number; eta: number | null; quoteDeadline: string;
  inputUsd: string | null; minOutUsd: string | null; capturedAt: string; venue: "NEAR Intents";
  transactions: SwapTx[]; evmTx: EvmDepositTx | null; policyAction: PolicyAction; quote: unknown; walletAskedAt?: string; nonceAtAsk?: string;
  result?: { status: string; deliveredRaw: string | null; delivered: string | null; refundedRaw: string | null; originHashes: string[]; destinationHashes: string[] };
}

const isRaw = (x: unknown): x is string => typeof x === "string" && /^\d{1,80}$/.test(x);
const word = (hex: string) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** A live 1Click quote must echo exactly what was asked and carry a deposit address and bounded amounts. */
export function readIntentsQuote(body: unknown, sent: Record<string, unknown>) {
  const b = body as { quote?: Record<string, unknown>; quoteRequest?: Record<string, unknown> };
  const q = b?.quote, e = b?.quoteRequest;
  if (!q || !e) throw new Error("NEAR Intents returned no usable quote.");
  for (const k of ["dry", "swapType", "originAsset", "destinationAsset", "amount", "depositType", "recipientType", "refundType", "recipient", "refundTo", "slippageTolerance"])
    if (e[k] !== sent[k]) throw new Error("The quote does not match the requested pair, amount or addresses.");
  if (typeof q.depositAddress !== "string" || !/^[A-Za-z0-9._-]{20,100}$/.test(q.depositAddress)) throw new Error("NEAR Intents returned no deposit address.");
  if (q.amountIn !== sent.amount || !isRaw(q.amountOut) || !isRaw(q.minAmountOut)) throw new Error("NEAR Intents returned invalid amounts.");
  const out = BigInt(q.amountOut), min = BigInt(q.minAmountOut);
  if (min <= 0n || out < min) throw new Error("NEAR Intents returned an invalid minimum.");
  const deadline = typeof q.deadline === "string" && Number.isFinite(Date.parse(q.deadline)) ? q.deadline : null;
  if (!deadline) throw new Error("NEAR Intents returned no deposit deadline.");
  return {
    depositAddress: q.depositAddress, depositMemo: typeof q.depositMemo === "string" ? q.depositMemo : null,
    outputRaw: out.toString(), minOutRaw: min.toString(), deadline,
    eta: typeof q.timeEstimate === "number" && Number.isFinite(q.timeEstimate) ? q.timeEstimate : null,
  };
}

/** The single deposit the owner signs. NEAR: (wrap NEAR, then) ft_transfer to the deposit address. EVM: a native
 * transfer or an ERC-20 transfer to the deposit address, from the wallet that holds the token. */
export function intentsDeposit(from: IntentsSide, sender: string, depositAddress: string, amountRaw: string, memo: string | null): { transactions: SwapTx[]; evmTx: EvmDepositTx | null } {
  if (BigInt(amountRaw) <= 0n) throw new Error("Enter an amount above zero.");
  if (from.network === "near") {
    const call = (methodName: string, args: Record<string, unknown>, tgas: bigint, deposit: bigint) => ({ type: "FunctionCall" as const, params: { methodName, args, gas: (tgas * TGAS).toString(), deposit: deposit.toString() } });
    const token = from.contract === "native" ? "wrap.near" : from.contract;
    const txs: SwapTx[] = [];
    if (from.contract === "native") txs.push({ receiverId: "wrap.near", actions: [call("near_deposit", {}, 10n, BigInt(amountRaw))] });
    txs.push({ receiverId: token, actions: [call("ft_transfer", { receiver_id: depositAddress, amount: amountRaw, ...(memo ? { memo } : {}) }, 30n, 1n)] });
    return { transactions: txs, evmTx: null };
  }
  const chainId = EVM_CHAIN_IDS[from.network];
  if (!chainId) throw new Error("In-app NEAR Intents deposits cover NEAR, Ethereum, Base and Arbitrum.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(sender) || !/^0x[0-9a-fA-F]{40}$/.test(depositAddress)) throw new Error("Invalid EVM address for the deposit.");
  if (from.contract === "native") return { transactions: [], evmTx: { chainId, from: sender, to: depositAddress, value: "0x" + BigInt(amountRaw).toString(16), data: "0x" } };
  if (!/^0x[0-9a-fA-F]{40}$/.test(from.contract)) throw new Error("Invalid token contract.");
  return { transactions: [], evmTx: { chainId, from: sender, to: from.contract, value: "0x0", data: ERC20_TRANSFER + word(depositAddress) + BigInt(amountRaw).toString(16).padStart(64, "0") } };
}

/** Policy view: the swap sells its input asset at the 1Click venue; the destination is the owner's own wallet. */
export function intentsPolicyAction(p: Pick<IntentsPreparation, "accountId" | "from" | "inputUsd" | "minOutUsd" | "transactions" | "evmTx">, gasUsd6: bigint | null, gasNearRaw: bigint): PolicyAction {
  const usd6 = (v: string) => { const [w, f = ""] = v.split("."); return BigInt(w) * 1000000n + BigInt(f.slice(0, 6).padEnd(6, "0")); };
  const input = p.inputUsd !== null ? usd6(p.inputUsd) : null, out = p.minOutUsd !== null ? usd6(p.minOutUsd) : null;
  const moving = input !== null && out !== null && gasUsd6 !== null ? (input > out ? input - out : 0n) + gasUsd6 : null;
  const chain = (p.from.network === "near" ? "near" : p.from.network) as PolicyAction["chain"];
  return {
    kind: "swap", chain, asset: p.from.symbol, amount: input !== null && input > 0n ? decimal(input) : "0.000001", recipient: p.accountId,
    venue: INTENTS_VENUE, movingCost: moving === null ? null : decimal(moving), gasNear: decimal(gasNearRaw, 24), source: "live", accountId: p.accountId,
    methods: intentsMethods(p),
  };
}
function intentsMethods(p: Pick<IntentsPreparation, "transactions" | "evmTx" | "from">) {
  if (p.evmTx) return [{ receiver: p.from.contract === "native" ? "native:" + p.from.network : p.from.contract.toLowerCase(), method: p.from.contract === "native" ? "transfer" : ERC20_TRANSFER }];
  return p.transactions.flatMap(tx => tx.actions.map(a => ({ receiver: tx.receiverId, method: a.params.methodName })));
}
export function intentsPolicyEntries(p: Pick<IntentsPreparation, "transactions" | "evmTx" | "from">): PolicyEntry[] {
  return [{ type: "venue", venue: INTENTS_VENUE, label: "Venue 1click (NEAR Intents swaps)" },
    ...intentsMethods(p).map(m => ({ type: "method" as const, receiver: m.receiver, method: m.method, label: `${m.method === ERC20_TRANSFER ? "transfer" : m.method} of ${p.from.symbol} on ${p.from.network} (deposit for a NEAR Intents swap)` }))];
}

/** Origin proof on an EVM chain: a successful transaction from the owner that moved exactly the reviewed amount to
 * the deposit address (native value or one ERC-20 Transfer log). */
export function verifyEvmDeposit(tx: Record<string, any>, receipt: Record<string, any>, p: Pick<IntentsPreparation, "evmTx" | "from" | "depositAddress" | "amountRaw" | "accountId">) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p.evmTx || !tx || !receipt) return null;
  if (String(tx.from).toLowerCase() !== p.accountId.toLowerCase()) throw new Error("The transaction was sent from another wallet.");
  if (receipt.status !== "0x1") return { state: "failed" as const };
  if (p.from.contract === "native") {
    const ok = String(tx.to).toLowerCase() === p.depositAddress.toLowerCase() && BigInt(tx.value) === BigInt(p.amountRaw);
    return ok ? { state: "deposited" as const } : (() => { throw new Error("The transaction does not match the reviewed deposit."); })();
  }
  const hits = (receipt.logs ?? []).filter((l: Record<string, any>) => !l.removed && String(l.address).toLowerCase() === p.from.contract.toLowerCase() && String(l.topics?.[0]).toLowerCase() === TRANSFER_TOPIC // eslint-disable-line @typescript-eslint/no-explicit-any
    && String(l.topics?.[1]).toLowerCase() === "0x" + word(p.accountId) && String(l.topics?.[2]).toLowerCase() === "0x" + word(p.depositAddress) && BigInt(l.data) === BigInt(p.amountRaw));
  if (hits.length !== 1) throw new Error("The transaction does not move the reviewed amount to the deposit address.");
  return { state: "deposited" as const };
}
/** Origin proof on NEAR: final, and an ft_transfer of exactly the reviewed amount from the owner to the deposit. */
export function verifyNearDeposit(results: unknown[], p: Pick<IntentsPreparation, "from" | "depositAddress" | "amountRaw" | "accountId">) {
  const token = p.from.contract === "native" ? "wrap.near" : p.from.contract;
  let moved = 0n;
  for (const raw of results) {
    const r = raw as { final_execution_status?: string; status?: Record<string, unknown>; receipts_outcome?: { outcome?: { executor_id?: string; logs?: unknown[] } }[] };
    if (!r || r.final_execution_status !== "FINAL") return null;
    if (r.status && "Failure" in r.status) return { state: "failed" as const };
    for (const x of r.receipts_outcome ?? []) {
      if (x.outcome?.executor_id !== token) continue;
      for (const l of x.outcome.logs ?? []) {
        if (typeof l !== "string" || !l.startsWith("EVENT_JSON:")) continue;
        try {
          const e = JSON.parse(l.slice(11)) as { standard?: string; event?: string; data?: { old_owner_id?: string; new_owner_id?: string; amount?: string }[] };
          if (e.standard === "nep141" && e.event === "ft_transfer") for (const d of e.data ?? []) if (d.old_owner_id === p.accountId && d.new_owner_id === p.depositAddress && isRaw(d.amount)) moved += BigInt(d.amount);
        } catch { /* not an event */ }
      }
    }
  }
  if (moved !== BigInt(p.amountRaw)) throw new Error("The transactions do not move the reviewed amount to the deposit address.");
  return { state: "deposited" as const };
}
