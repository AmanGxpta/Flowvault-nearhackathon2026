// In-app trading of any DexScreener token through LI.FI (same-chain DEX aggregation and cross-chain routes on
// EVM chains and Solana). Pure: chain mapping, quote validation (it must echo exactly what was asked), the exact
// approval, the policy view and the delivery status mapping. FlowVault never signs or holds funds.
import { decimal } from "./money.ts";
import type { PolicyAction } from "./policy.ts";
import type { PolicyEntry } from "./plans-policy.ts";

export const LIFI_VENUE = "lifi";
export const SOLANA_ID = 1151111081099710;
export const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
export const SOL_NATIVE = "11111111111111111111111111111111";
const APPROVE = "0x095ea7b3";

/** DexScreener chain ids → LI.FI chain ids. Anything not listed can't be traded in-app yet. */
export const DS_CHAINS: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161, solana: SOLANA_ID, robinhood: 4663, elysium: 99901, hyperevm: 999,
  polygon: 137, avalanche: 43114, optimism: 10, monad: 143, sonic: 146, unichain: 130, ink: 57073, abstract: 2741,
  linea: 59144, mantle: 5000, berachain: 80094, scroll: 534352, zksync: 324, seiv2: 1329, cronos: 25, celo: 42220,
  worldchain: 480, apechain: 33139, soneium: 1868, plasma: 9745, katana: 747474, megaeth: 4326, xlayer: 196,
  gnosischain: 100, metis: 1088, mode: 34443, fraxtal: 252, ronin: 2020, flare: 14, kaia: 8217, morph: 2818,
  hemi: 43111, etherlink: 42793, rootstock: 30, fuse: 122, lens: 232, swellchain: 1923, taiko: 167000, blast: 81457,
};
export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const isSolAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
export const addressOk = (chainId: number, a: string) => chainId === SOLANA_ID ? isSolAddress(a) : isEvmAddress(a);
const same = (chainId: number, a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && (chainId === SOLANA_ID ? a === b : a.toLowerCase() === b.toLowerCase());
const isRaw = (x: unknown): x is string => typeof x === "string" && /^\d{1,80}$/.test(x);

export interface TradeSide { chainId: number; address: string; symbol: string; decimals: number; priceUsd: string | null }
export interface TradeRequest { fromChain: number; toChain: number; fromToken: string; toToken: string; fromAmount: string; fromAddress: string; toAddress: string; slippage: number }
export interface LifiQuote {
  id: string; tool: string; from: TradeSide; to: TradeSide; outputRaw: string; minOutRaw: string; durationSec: number | null;
  approvalAddress: string | null; fromUsd: string | null; toUsd: string | null; feesUsd: { name: string; usd: string; included: boolean }[]; gasUsd: string | null;
  evmTx: { chainId: number; from: string; to: string; value: string; data: string; gasLimit: string | null } | null;
  solanaTx: string | null;
}

/** A LI.FI quote must echo the pair, chains, amount and both addresses, carry bounded amounts and a transaction
 * from the owner on the origin chain. */
export function readLifiQuote(body: unknown, sent: TradeRequest): LifiQuote {
  const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const a = b?.action, e = b?.estimate, t = b?.transactionRequest;
  if (!a || !e || !t) throw new Error(typeof b?.message === "string" ? b.message : "LI.FI returned no usable route.");
  if (a.fromChainId !== sent.fromChain || a.toChainId !== sent.toChain || !same(sent.fromChain, a.fromToken?.address, sent.fromToken) || !same(sent.toChain, a.toToken?.address, sent.toToken)
    || a.fromAmount !== sent.fromAmount || !same(sent.fromChain, a.fromAddress, sent.fromAddress) || !same(sent.toChain, a.toAddress, sent.toAddress))
    throw new Error("The route does not match the requested pair, amount or addresses.");
  if (!isRaw(e.toAmount) || !isRaw(e.toAmountMin) || BigInt(e.toAmountMin) <= 0n || BigInt(e.toAmountMin) > BigInt(e.toAmount)) throw new Error("LI.FI returned invalid amounts.");
  const side = (x: Record<string, unknown>, chainId: number): TradeSide => {
    if (!Number.isInteger(x?.decimals) || (x.decimals as number) < 0 || (x.decimals as number) > 36 || typeof x.symbol !== "string") throw new Error("Token decimals are unverified.");
    const p = typeof x.priceUSD === "string" && /^\d+(\.\d+)?(e-?\d+)?$/i.test(x.priceUSD) && Number(x.priceUSD) > 0 ? x.priceUSD : null;
    return { chainId, address: String(x.address), symbol: x.symbol.slice(0, 24), decimals: x.decimals as number, priceUsd: p };
  };
  let evmTx: LifiQuote["evmTx"] = null, solanaTx: string | null = null;
  if (sent.fromChain === SOLANA_ID) {
    if (typeof t.data !== "string" || !/^[A-Za-z0-9+/=]{100,20000}$/.test(t.data)) throw new Error("LI.FI returned no Solana transaction.");
    solanaTx = t.data;
  } else {
    if (Number(t.chainId) !== sent.fromChain || !same(sent.fromChain, t.from, sent.fromAddress) || !isEvmAddress(String(t.to)) || !/^0x[0-9a-fA-F]*$/.test(String(t.data)) || String(t.data).length < 10)
      throw new Error("LI.FI's transaction doesn't match the reviewed chain and wallet.");
    const value = /^0x[0-9a-fA-F]+$/.test(String(t.value)) ? BigInt(t.value) : 0n;
    if (sent.fromToken === EVM_NATIVE ? value !== BigInt(sent.fromAmount) : value !== 0n) throw new Error("LI.FI's transaction sends a different amount than reviewed.");
    evmTx = { chainId: sent.fromChain, from: sent.fromAddress, to: String(t.to), value: "0x" + value.toString(16), data: String(t.data), gasLimit: /^0x[0-9a-fA-F]+$/.test(String(t.gasLimit)) ? String(t.gasLimit) : null };
  }
  const usd = (v: unknown) => typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? v : null;
  const gas = (e.gasCosts ?? []).reduce((n: number, g: { amountUSD?: string }) => n + (Number(g.amountUSD) || 0), 0);
  return {
    id: String(b.id ?? ""), tool: String(b.tool ?? e.tool ?? "LI.FI").slice(0, 40), from: side(a.fromToken, sent.fromChain), to: side(a.toToken, sent.toChain),
    outputRaw: e.toAmount, minOutRaw: e.toAmountMin, durationSec: Number.isFinite(e.executionDuration) ? Number(e.executionDuration) : null,
    approvalAddress: typeof e.approvalAddress === "string" && isEvmAddress(e.approvalAddress) ? e.approvalAddress : null,
    fromUsd: usd(e.fromAmountUSD), toUsd: usd(e.toAmountUSD), gasUsd: gas > 0 ? gas.toFixed(4) : null,
    feesUsd: (e.feeCosts ?? []).slice(0, 6).map((f: { name?: string; amountUSD?: string; included?: boolean }) => ({ name: String(f.name ?? "Fee").slice(0, 40), usd: usd(f.amountUSD) ?? "0", included: f.included !== false })),
    evmTx, solanaTx,
  };
}

const word = (hex: string) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
/** Exact-amount ERC-20 approval of the LI.FI router (never unlimited). */
export function approveTx(chainId: number, owner: string, token: string, spender: string, amountRaw: bigint) {
  if (!isEvmAddress(token) || !isEvmAddress(spender)) throw new Error("Invalid approval.");
  return { chainId, from: owner, to: token, value: "0x0", data: APPROVE + word(spender) + amountRaw.toString(16).padStart(64, "0"), gasLimit: null };
}

/** Policy view: a trade sells its input asset at the LI.FI venue; delivery goes to the owner's own wallet. */
export function tradePolicyAction(p: { accountId: string; recipient: string; from: TradeSide; fromUsd: string | null; minOutUsd: string | null; gasUsd: string | null; receivers: { receiver: string; method: string }[] }): PolicyAction {
  const u6 = (v: string | null) => { if (v === null) return null; const [w, f = ""] = v.split("."); return BigInt(w) * 1000000n + BigInt(f.slice(0, 6).padEnd(6, "0")); };
  const input = u6(p.fromUsd), out = u6(p.minOutUsd), gas = u6(p.gasUsd);
  const moving = input !== null && out !== null ? (input > out ? input - out : 0n) + (gas ?? 0n) : null;
  return {
    kind: "swap", asset: p.from.symbol, amount: input !== null && input > 0n ? decimal(input) : "0.000001", recipient: p.accountId, venue: LIFI_VENUE,
    movingCost: moving === null ? null : decimal(moving), gasNear: "0", source: "live", accountId: p.accountId, methods: p.receivers,
  };
}
export function tradePolicyEntries(receivers: { receiver: string; method: string }[], chainName: string): PolicyEntry[] {
  return [{ type: "venue", venue: LIFI_VENUE, label: "Venue LI.FI (DEX and cross-chain routes)" },
    ...receivers.map(r => ({ type: "method" as const, receiver: r.receiver, method: r.method, label: `${r.method === "lifi-route" ? "LI.FI router" : r.method} on ${r.receiver.length > 20 ? r.receiver.slice(0, 8) + "…" + r.receiver.slice(-4) : r.receiver} (${chainName})` }))];
}
/** What the policy allowlists, keyed by chain: the LI.FI router once (any route through it; each quote is still
 * checked to echo the request) and each token approved for it. */
export function tradeReceivers(fromChain: number, evm: { to: string; data: string }[] | null, solana: boolean) {
  if (solana) return [{ receiver: "solana:" + fromChain, method: "lifi-route" }];
  const out: { receiver: string; method: string }[] = [];
  for (const t of evm ?? []) {
    const m = t.data.slice(0, 10).toLowerCase() === APPROVE ? { receiver: fromChain + ":" + t.to.toLowerCase(), method: "approve" } : { receiver: fromChain + ":" + t.to.toLowerCase(), method: "lifi-route" };
    if (!out.some(x => x.receiver === m.receiver && x.method === m.method)) out.push(m);
  }
  return out;
}

/** LI.FI /v1/status → journal state. Delivery is DONE/COMPLETED; PARTIAL delivered another token; REFUNDED and
 * FAILED returned or kept the input. */
export function readLifiStatus(body: unknown) {
  const b = body as { status?: string; substatus?: string; substatusMessage?: string; receiving?: { amount?: string; token?: { symbol?: string; decimals?: number }; txHash?: string } };
  const recv = b?.receiving;
  const amount = isRaw(recv?.amount) ? recv!.amount! : null;
  if (b?.status === "DONE" && b.substatus === "COMPLETED") return { state: "confirmed" as const, receivedRaw: amount, destinationHash: recv?.txHash ?? null, note: b.substatusMessage ?? "" };
  if (b?.status === "DONE" && b.substatus === "PARTIAL") return { state: "partial" as const, receivedRaw: amount, destinationHash: recv?.txHash ?? null, note: `Delivered ${recv?.token?.symbol ?? "another token"} instead of the reviewed token.` };
  if (b?.status === "DONE" && b.substatus === "REFUNDED") return { state: "failed" as const, receivedRaw: null, destinationHash: recv?.txHash ?? null, note: "The route was refunded to your wallet." };
  if (b?.status === "FAILED") return { state: "failed" as const, receivedRaw: null, destinationHash: null, note: b.substatusMessage ?? "LI.FI reports the route failed." };
  return null;
}
