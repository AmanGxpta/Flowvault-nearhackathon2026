/* eslint-disable @typescript-eslint/no-explicit-any -- untyped 1Click JSON */
// 1Click routes for funding legs (owner: Stream A). Pure request building and checking, no network access:
// every route is resolved from the live /v0/tokens catalog (asset id, chain, official contract or mint and
// decimals must all match) and every quote must echo exactly the request sent. Fails closed on any mismatch.
import type { ExecutionNetwork } from "./contracts.ts";
import { validEvm } from "./evm.ts";

export const ONECLICK = "https://1click.chaindefuser.com/v0";
/** Official USDC on each source network (Circle's contracts / mint), as the catalog must list it. */
export const OFFICIAL_USDC: Record<Exclude<ExecutionNetwork, "near">, { blockchain: string; contract: string }> = {
  ethereum: { blockchain: "eth", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  base: { blockchain: "base", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  arbitrum: { blockchain: "arb", contract: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  solana: { blockchain: "sol", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
};
/** Native USDC on NEAR (Circle), the asset every leg delivers. */
export const NEAR_USDC = { blockchain: "near", contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" };
/** Stable → same stable: 0.5% is the most a leg may lose to price movement; the minimum is stated before signing. */
export const LEG_SLIPPAGE_BPS = 50;
/** Time to send a prepared leg; 1Click refunds deposits that arrive after the deadline. */
export const LEG_DEADLINE_MS = 30 * 60_000;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface CatalogToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  contractAddress?: string;
}

/** The catalog entry for USDC on a network; throws unless id, chain, contract and decimals all agree. */
export function resolveUsdc(tokens: CatalogToken[], network: ExecutionNetwork): CatalogToken {
  if (!Array.isArray(tokens)) throw new Error("1Click returned no token catalog.");
  const want = network === "near" ? NEAR_USDC : OFFICIAL_USDC[network];
  const same = (a = "", b = "") => (network === "solana" ? a === b : a.toLowerCase() === b.toLowerCase());
  const t = tokens.find((x) => x?.blockchain === want.blockchain && x?.symbol === "USDC" && same(x.contractAddress, want.contract));
  if (!t) throw new Error(`1Click doesn't list official USDC on ${network} right now.`);
  if (t.decimals !== 6) throw new Error(`1Click lists USDC on ${network} with ${t.decimals} decimals; expected 6.`);
  if (typeof t.assetId !== "string" || !t.assetId.startsWith("nep141:")) throw new Error(`Unexpected 1Click asset id for USDC on ${network}.`);
  return t;
}

export interface LegRequest {
  network: Exclude<ExecutionNetwork, "near">;
  /** Proven source address (refunds go back here). */
  from: string;
  /** The plan's NEAR account. */
  to: string;
  amountRaw: string;
  originAsset: string;
  destinationAsset: string;
}

export function validSource(network: ExecutionNetwork, from: string) {
  return network === "solana" ? SOL.test(from) : network !== "near" && validEvm(from);
}

export function legRequestError(r: LegRequest): string | null {
  if (!validSource(r.network, r.from)) return "The source address doesn't match its network.";
  if (!NEAR_ACCOUNT.test(r.to)) return "The destination must be your NEAR account.";
  if (!/^\d+$/.test(r.amountRaw) || BigInt(r.amountRaw) <= 0n) return "Enter an amount above zero.";
  if (!r.originAsset.startsWith("nep141:") || !r.destinationAsset.startsWith("nep141:")) return "Unresolved 1Click route.";
  return null;
}

export function legQuoteBody(r: LegRequest, dry: boolean, now = Date.now()) {
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: LEG_SLIPPAGE_BPS,
    originAsset: r.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: r.destinationAsset,
    amount: r.amountRaw,
    recipient: r.to,
    recipientType: "DESTINATION_CHAIN",
    refundTo: r.from,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(now + (dry ? 180_000 : LEG_DEADLINE_MS)).toISOString(),
  };
}

export interface LegQuote {
  dry: boolean;
  network: LegRequest["network"];
  from: string;
  to: string;
  amountInRaw: string;
  amountOutRaw: string;
  minAmountOutRaw: string;
  seconds: number;
  depositAddress: string | null;
  /** Solana deposits may need a memo; EVM never. */
  depositMemo: string | null;
  deadline: string;
  capturedAt: string;
}

/** Checks a 1Click quote answers exactly the leg we asked for. */
export function checkLegQuote(r: LegRequest, sent: ReturnType<typeof legQuoteBody>, body: any): LegQuote {
  const q = body?.quote;
  const echo = body?.quoteRequest;
  if (!q || !echo) throw new Error(body?.message ? "1Click: " + body.message : "1Click returned no quote.");
  for (const k of ["dry", "swapType", "originAsset", "destinationAsset", "amount", "depositType", "recipientType", "refundType"] as const)
    if (echo[k] !== sent[k]) throw new Error("The quote doesn’t match the request (" + k + ").");
  if (String(echo.recipient) !== r.to) throw new Error("The quote pays a different NEAR account.");
  const refundSame = r.network === "solana" ? String(echo.refundTo) === r.from : String(echo.refundTo).toLowerCase() === r.from.toLowerCase();
  if (!refundSame) throw new Error("The quote refunds a different address.");
  if (String(q.amountIn) !== r.amountRaw) throw new Error("The quote takes a different USDC amount.");
  for (const k of ["amountOut", "minAmountOut"]) if (!/^\d+$/.test(String(q[k]))) throw new Error("The quote has no usable USDC amount.");
  const out = BigInt(q.amountOut), min = BigInt(q.minAmountOut);
  if (min <= 0n || min > out) throw new Error("Invalid quote bounds.");
  // Stable to the same stable: delivering more than was sent would mean a mispriced or wrong-asset quote.
  if (out > BigInt(r.amountRaw)) throw new Error("The quote delivers more USDC than it takes; refusing it.");
  const deposit = q.depositAddress ?? null;
  if (sent.dry ? deposit : !(typeof deposit === "string" && validSource(r.network, deposit)))
    throw new Error(sent.dry ? "A preview quote must not carry a deposit address." : "The quote has no valid deposit address for " + r.network + ".");
  return {
    dry: sent.dry,
    network: r.network,
    from: r.from,
    to: r.to,
    amountInRaw: r.amountRaw,
    amountOutRaw: out.toString(),
    minAmountOutRaw: min.toString(),
    seconds: Number(q.timeEstimate) || 0,
    depositAddress: deposit,
    depositMemo: typeof q.depositMemo === "string" && q.depositMemo ? q.depositMemo : null,
    deadline: String(echo.deadline ?? sent.deadline),
    capturedAt: String(body.timestamp ?? new Date().toISOString()),
  };
}

export type ProviderStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED" | "UNKNOWN";
export interface ProviderReport {
  status: ProviderStatus;
  deliveredRaw: string | null;
  refundedRaw: string | null;
  destinationHashes: string[];
  originHashes: string[];
}
/** Reads a /v0/status body defensively: unknown statuses stay UNKNOWN, amounts must be integers. */
export function readStatus(body: any): ProviderReport {
  const known = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"];
  const d = body?.swapDetails ?? {};
  const int = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null);
  const hashes = (v: unknown) => (Array.isArray(v) ? v.map((x: any) => (typeof x === "string" ? x : x?.hash)).filter((x: unknown): x is string => typeof x === "string" && x.length > 8) : []);
  return {
    status: known.includes(body?.status) ? body.status : "UNKNOWN",
    deliveredRaw: int(d.amountOut),
    refundedRaw: int(d.refundedAmount),
    destinationHashes: hashes(d.destinationChainTxHashes),
    originHashes: hashes(d.originChainTxHashes),
  };
}
