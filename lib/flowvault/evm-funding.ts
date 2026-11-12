/* eslint-disable @typescript-eslint/no-explicit-any -- untyped 1Click JSON */
// Fund NEAR from USDC you hold on Ethereum, Base or Arbitrum, through NEAR Intents (1Click).
//
// FlowVault never signs. It asks 1Click for a quote from your proven EVM address to your signed-in NEAR
// account, then hands MetaMask one ERC-20 transfer of exactly the quoted USDC to the quote's deposit address.
// 1Click delivers wNEAR to your NEAR account (or refunds the USDC to your EVM address). Unwrapping wNEAR into
// NEAR is a second, separate NEAR transaction you sign. Every check here fails closed.
import { EVM_CHAINS, evmRpc, hexQuantity, validEvm } from "./evm.ts";
import { decimal } from "./money.ts";

export const FUND_CHAINS = ["eth", "base", "arb"] as const;
export type FundChain = (typeof FUND_CHAINS)[number];
export const FUND_ASSETS: Record<FundChain, string> = {
  eth: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  base: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  arb: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
};
export const WNEAR_ASSET = "nep141:wrap.near";
export const CHAIN_NAME: Record<FundChain, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum" };
const ONECLICK = "https://1click.chaindefuser.com/v0";
/** 1% slippage: wNEAR is priced live, so the minimum you receive is stated before you send. */
export const FUND_SLIPPAGE_BPS = 100;
/** Time to send the deposit after preparing it; 1Click refunds deposits that arrive after the deadline. */
export const FUND_DEADLINE_MS = 30 * 60_000;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export interface FundRequest {
  chain: FundChain;
  /** Proven EVM address the USDC leaves from; refunds go back here. */
  from: string;
  /** Signed-in NEAR account that receives wNEAR. */
  to: string;
  /** USDC base units (6 decimals). */
  amountRaw: string;
}

export function fundRequestError(r: FundRequest): string | null {
  if (!FUND_CHAINS.includes(r.chain)) return "Choose Ethereum, Base or Arbitrum.";
  if (!validEvm(r.from)) return "The source must be an Ethereum address.";
  if (!NEAR_ACCOUNT.test(r.to)) return "The destination must be your NEAR account.";
  if (!/^\d+$/.test(r.amountRaw) || BigInt(r.amountRaw) <= 0n) return "Enter an amount above zero.";
  return null;
}

export function quoteBody(r: FundRequest, dry: boolean, now = Date.now()) {
  return {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: FUND_SLIPPAGE_BPS,
    originAsset: FUND_ASSETS[r.chain],
    depositType: "ORIGIN_CHAIN",
    destinationAsset: WNEAR_ASSET,
    amount: r.amountRaw,
    recipient: r.to,
    recipientType: "DESTINATION_CHAIN",
    refundTo: r.from,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(now + (dry ? 180_000 : FUND_DEADLINE_MS)).toISOString(),
  };
}

export interface FundQuote {
  dry: boolean;
  chain: FundChain;
  from: string;
  to: string;
  amountIn: string;
  amountInRaw: string;
  /** Estimated and minimum NEAR (24 decimals) delivered as wNEAR. */
  nearOut: string;
  nearOutRaw: string;
  minNearOut: string;
  minNearOutRaw: string;
  usdOut: string | null;
  seconds: number;
  depositAddress: string | null;
  deadline: string;
  capturedAt: string;
}

/** Check a 1Click quote answers exactly the request we sent. Throws on any mismatch. */
export function checkQuote(r: FundRequest, sent: ReturnType<typeof quoteBody>, body: any): FundQuote {
  const q = body?.quote;
  const echo = body?.quoteRequest;
  if (!q || !echo) throw new Error(body?.message ? "1Click: " + body.message : "1Click returned no quote.");
  for (const k of ["dry", "swapType", "originAsset", "destinationAsset", "amount", "depositType", "recipientType", "refundType"] as const)
    if (echo[k] !== sent[k]) throw new Error("The quote doesn’t match the request (" + k + ").");
  if (String(echo.recipient) !== r.to) throw new Error("The quote pays a different NEAR account.");
  if (String(echo.refundTo).toLowerCase() !== r.from.toLowerCase()) throw new Error("The quote refunds a different address.");
  if (String(q.amountIn) !== r.amountRaw) throw new Error("The quote takes a different USDC amount.");
  if (!/^\d+$/.test(String(q.amountOut)) || !/^\d+$/.test(String(q.minAmountOut)) || BigInt(q.minAmountOut) <= 0n)
    throw new Error("The quote has no usable NEAR amount.");
  if (BigInt(q.minAmountOut) > BigInt(q.amountOut)) throw new Error("Invalid quote bounds.");
  const deposit = q.depositAddress ?? null;
  if (sent.dry ? deposit : !(typeof deposit === "string" && validEvm(deposit)))
    throw new Error(sent.dry ? "A preview quote must not carry a deposit address." : "The quote has no valid deposit address.");
  return {
    dry: sent.dry,
    chain: r.chain,
    from: r.from,
    to: r.to,
    amountIn: decimal(BigInt(r.amountRaw), 6),
    amountInRaw: r.amountRaw,
    nearOut: decimal(BigInt(q.amountOut), 24),
    nearOutRaw: String(q.amountOut),
    minNearOut: decimal(BigInt(q.minAmountOut), 24),
    minNearOutRaw: String(q.minAmountOut),
    usdOut: q.amountOutUsd != null ? String(q.amountOutUsd) : null,
    seconds: Number(q.timeEstimate) || 0,
    depositAddress: deposit,
    deadline: String(echo.deadline ?? sent.deadline),
    capturedAt: String(body.timestamp ?? new Date().toISOString()),
  };
}

export async function fundQuote(r: FundRequest, dry: boolean): Promise<FundQuote> {
  const err = fundRequestError(r);
  if (err) throw new Error(err);
  const sent = quoteBody(r, dry);
  const res = await fetch(ONECLICK + "/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sent),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("1Click returned an unreadable quote (HTTP " + res.status + ").");
  }
  if (!res.ok) throw new Error("1Click: " + (body?.message ?? "HTTP " + res.status));
  return checkQuote(r, sent, body);
}

/** The single EVM transaction MetaMask is asked to sign: transfer(depositAddress, amount) on the USDC contract. */
export function transferTx(chain: FundChain, from: string, depositAddress: string, amountRaw: string) {
  if (!validEvm(from) || !validEvm(depositAddress)) throw new Error("Invalid transfer addresses.");
  const amount = BigInt(amountRaw);
  if (amount <= 0n) throw new Error("Invalid transfer amount.");
  const c = EVM_CHAINS[chain];
  return {
    chainId: "0x" + c.chainId.toString(16),
    from,
    to: c.usdc,
    value: "0x0",
    data: "0xa9059cbb" + depositAddress.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0"),
  };
}

/** Latest USDC balance (base units) of an address on a funding chain. */
export async function usdcBalance(chain: FundChain, address: string): Promise<bigint> {
  const c = EVM_CHAINS[chain];
  if (hexQuantity(await evmRpc(chain, "eth_chainId", [])) !== c.chainId) throw new Error("EVM RPC returned the wrong chain.");
  return hexQuantity(await evmRpc(chain, "eth_call", [{ to: c.usdc, data: "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0") }, "latest"]));
}

export type FundStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";
export async function fundStatus(depositAddress: string): Promise<{ status: FundStatus | "UNKNOWN"; nearOutRaw: string | null; detail: unknown }> {
  if (!validEvm(depositAddress)) throw new Error("Invalid deposit address.");
  const res = await fetch(ONECLICK + "/status?depositAddress=" + depositAddress, { signal: AbortSignal.timeout(10_000) });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error("1Click status unavailable (HTTP " + res.status + ").");
  const status = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"].includes(body.status) ? body.status : "UNKNOWN";
  const out = body.swapDetails?.amountOut;
  return { status, nearOutRaw: typeof out === "string" && /^\d+$/.test(out) ? out : null, detail: body.swapDetails ?? null };
}

/** Tell 1Click about the deposit transaction so it picks it up sooner. Optional; failures are ignored. */
export async function submitDeposit(depositAddress: string, txHash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Invalid transaction hash.");
  await fetch(ONECLICK + "/deposit/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash, depositAddress }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** wrap.near storage_deposit (registration only) so 1Click can deliver wNEAR; `deposit` is wrap.near's minimum. */
export function registerTransaction(accountId: string, depositRaw: string) {
  if (!NEAR_ACCOUNT.test(accountId) || !/^\d+$/.test(depositRaw) || BigInt(depositRaw) <= 0n || BigInt(depositRaw) > 10n ** 22n)
    throw new Error("Invalid wNEAR registration.");
  return {
    receiverId: "wrap.near",
    actions: [{ type: "FunctionCall" as const, params: { methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, gas: "30000000000000", deposit: depositRaw } }],
  };
}

/** wrap.near near_withdraw: turns wNEAR back into NEAR in the same account. 1 yoctoNEAR is the required deposit. */
export function unwrapTransaction(amountRaw: string) {
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) throw new Error("Nothing to unwrap.");
  return {
    receiverId: "wrap.near",
    actions: [{ type: "FunctionCall" as const, params: { methodName: "near_withdraw", args: { amount: amountRaw }, gas: "10000000000000", deposit: "1" } }],
  };
}
