// In-app NEAR token swaps through the Ref (Rhea) exchange, owner-signed in the owner's wallet.
// Pure: builds the exact reviewed transactions, the policy action they are checked against and the receipt
// verification. Live reads (quote, balances, storage, prices) are in swap-journal.ts. Amounts stay bigint.
import { decimal } from "./money.ts";
import type { PolicyAction } from "./policy.ts";
import type { PolicyEntry } from "./plans-policy.ts";

export const REF_EXCHANGE = "v2.ref-finance.near";
export const WRAP_NEAR = "wrap.near";
/** Attached gas per call (Tgas) and the worst-case price per Tgas used for the fee bound (yoctoNEAR). */
const TGAS = 10n ** 12n;
const GAS_PRICE_BOUND = 2n * 10n ** 8n; // yocto per gas: twice the 0.1 Ggas/NEAR protocol minimum
const ACCOUNT = /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/;

export interface SwapSide { contract: string; symbol: string; decimals: number }
export interface RefRoutePool { pool_id?: unknown; token_in?: unknown; token_out?: unknown; amount_in?: unknown; min_amount_out?: unknown }
export interface RefRoute { pools?: RefRoutePool[]; amount_in?: unknown }
export interface RefAction { pool_id: number; token_in: string; token_out: string; amount_in?: string; min_amount_out: string }
type Call = { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } };
export interface SwapTx { receiverId: string; actions: Call[] }

export interface SwapPreparation {
  kind: "swap"; accountId: string; amount: string; amountRaw: string; expiresAt: string;
  from: SwapSide; to: SwapSide; tokenIn: string; tokenOut: string;
  outputRaw: string; minOutRaw: string; slippageBps: number;
  /** USD values (6 decimals) used for caps and the cost limit; null when a price is unverified (policy blocks). */
  inputUsd: string | null; minOutUsd: string | null; gasNearBound: string;
  transactions: SwapTx[]; policyAction: PolicyAction; venue: "Rhea / Ref"; capturedAt: string;
  unwrapNote?: string;
  result?: { receivedRaw: string; received: string; refundedRaw: string | null; hashes: string[] };
}

const isRaw = (x: unknown): x is string => typeof x === "string" && /^\d{1,80}$/.test(x);

/** Smart-router routes → Ref swap actions. Every route must start at the input and end at the output, and the
 * route inputs must add up to exactly the amount the owner reviewed. Intermediate hops carry no minimum; each
 * route's last hop carries its minimum, so the total minimum is the sum of those. */
export function refActions(routes: RefRoute[], tokenIn: string, tokenOut: string, amountRaw: string) {
  if (!Array.isArray(routes) || !routes.length || routes.length > 6) throw new Error("No usable Ref route.");
  const actions: RefAction[] = []; let total = 0n, minimum = 0n;
  for (const route of routes) {
    const pools = route.pools;
    if (!Array.isArray(pools) || !pools.length || pools.length > 4) throw new Error("Ref returned an unusable path.");
    if (pools[0].token_in !== tokenIn || pools.at(-1)!.token_out !== tokenOut) throw new Error("Ref returned a different pair.");
    const routeIn = isRaw(pools[0].amount_in) ? pools[0].amount_in : isRaw(route.amount_in) ? route.amount_in : routes.length === 1 ? amountRaw : null;
    if (!routeIn || BigInt(routeIn) <= 0n) throw new Error("Ref route input unavailable.");
    total += BigInt(routeIn);
    pools.forEach((p, i) => {
      const id = Number(p.pool_id);
      if (!Number.isSafeInteger(id) || id < 0 || typeof p.token_in !== "string" || typeof p.token_out !== "string" || !ACCOUNT.test(p.token_in) || !ACCOUNT.test(p.token_out)) throw new Error("Ref returned an invalid pool.");
      if (i > 0 && p.token_in !== pools[i - 1].token_out) throw new Error("Ref returned a disconnected path.");
      const last = i === pools.length - 1;
      if (last && (!isRaw(p.min_amount_out) || BigInt(p.min_amount_out) <= 0n)) throw new Error("Ref minimum received unavailable.");
      if (last) minimum += BigInt(p.min_amount_out as string);
      actions.push({ pool_id: id, token_in: p.token_in, token_out: p.token_out, ...(i === 0 ? { amount_in: routeIn } : {}), min_amount_out: last ? (p.min_amount_out as string) : "0" });
    });
  }
  if (total !== BigInt(amountRaw)) throw new Error("Ref route inputs do not add up to the reviewed amount.");
  return { actions, minOutRaw: minimum.toString() };
}

const call = (methodName: string, args: Record<string, unknown>, tgas: bigint, deposit: bigint): Call =>
  ({ type: "FunctionCall", params: { methodName, args, gas: (tgas * TGAS).toString(), deposit: deposit.toString() } });

/** The exact transactions the owner signs, in order: wrap NEAR (if paying in NEAR), register the output token
 * (only if the account is not registered), the Ref swap itself, and unwrap (if receiving NEAR). */
export function buildSwapTransactions(p: {
  accountId: string; from: SwapSide; to: SwapSide; amountRaw: string; actions: RefAction[]; minOutRaw: string;
  wrapStorageRaw: string | null; outStorageRaw: string | null; refStorageRaw?: string | null;
}): SwapTx[] {
  const nativeIn = p.from.contract === "native", nativeOut = p.to.contract === "native";
  const tokenIn = nativeIn ? WRAP_NEAR : p.from.contract, tokenOut = nativeOut ? WRAP_NEAR : p.to.contract;
  if (tokenIn === tokenOut) throw new Error("Wrapping and unwrapping NEAR is not a swap.");
  const txs: SwapTx[] = [];
  // Ref keeps per-account storage even for instant swaps; register once if the account has none.
  if (p.refStorageRaw) txs.push({ receiverId: REF_EXCHANGE, actions: [call("storage_deposit", { account_id: p.accountId, registration_only: true }, 30n, BigInt(p.refStorageRaw))] });
  const wrapActions: Call[] = [];
  if (p.wrapStorageRaw) wrapActions.push(call("storage_deposit", { account_id: p.accountId, registration_only: true }, 10n, BigInt(p.wrapStorageRaw)));
  if (nativeIn) wrapActions.push(call("near_deposit", {}, 10n, BigInt(p.amountRaw)));
  if (wrapActions.length) txs.push({ receiverId: WRAP_NEAR, actions: wrapActions });
  if (p.outStorageRaw && tokenOut !== WRAP_NEAR) txs.push({ receiverId: tokenOut, actions: [call("storage_deposit", { account_id: p.accountId, registration_only: true }, 10n, BigInt(p.outStorageRaw))] });
  // Receiving NEAR: Ref unwraps the whole output itself (skip_unwrap_near: false), so it arrives as native NEAR.
  txs.push({ receiverId: tokenIn, actions: [call("ft_transfer_call", { receiver_id: REF_EXCHANGE, amount: p.amountRaw, msg: JSON.stringify({ force: 0, actions: p.actions, ...(nativeOut ? { skip_unwrap_near: false } : {}) }) }, 250n, 1n)] });
  return txs;
}

/** Worst-case NEAR spend outside the swap amount: storage deposits plus attached gas at a bounded gas price. */
export function nearFeeBound(txs: SwapTx[], nativeInRaw: bigint) {
  let n = 0n;
  for (const tx of txs) for (const a of tx.actions) {
    n += BigInt(a.params.gas) * GAS_PRICE_BOUND;
    if (a.params.methodName === "storage_deposit") n += BigInt(a.params.deposit);
    else if (a.params.methodName !== "near_deposit") n += BigInt(a.params.deposit);
  }
  return { feeRaw: n, totalNativeRaw: n + nativeInRaw };
}

/** Policy view of a swap: it sells the input asset at the Ref exchange, value measured in USD at verified prices. */
export function swapPolicyAction(p: Pick<SwapPreparation, "accountId" | "from" | "tokenIn" | "tokenOut" | "inputUsd" | "minOutUsd" | "transactions">, gasNearRaw: bigint, gasUsdRaw: bigint | null): PolicyAction {
  const input = p.inputUsd !== null ? usd6(p.inputUsd) : null, out = p.minOutUsd !== null ? usd6(p.minOutUsd) : null;
  const moving = input !== null && out !== null && gasUsdRaw !== null ? (input > out ? input - out : 0n) + gasUsdRaw : null;
  return {
    kind: "swap", chain: "near", asset: p.from.symbol, amount: input !== null && input > 0n ? decimal(input) : "0.000001",
    recipient: p.accountId, venue: REF_EXCHANGE, movingCost: moving === null ? null : decimal(moving), gasNear: decimal(gasNearRaw, 24),
    source: "live", accountId: p.accountId,
    methods: p.transactions.flatMap(tx => tx.actions.map(a => ({ receiver: tx.receiverId, method: a.params.methodName, ...(a.params.methodName === "ft_transfer_call" ? { nestedReceiver: REF_EXCHANGE } : {}) }))),
  };
}
function usd6(v: string) { const [w, f = ""] = v.split("."); return BigInt(w) * 1000000n + BigInt(f.slice(0, 6).padEnd(6, "0")); }

/** Exactly the entries an "Allow in Policy" confirmation adds for this swap: the Ref venue and each method. */
export function swapPolicyEntries(p: Pick<SwapPreparation, "transactions">): PolicyEntry[] {
  const seen = new Set<string>(), out: PolicyEntry[] = [{ type: "venue", venue: REF_EXCHANGE, label: "Venue " + REF_EXCHANGE + " (Rhea / Ref swaps)" }];
  for (const tx of p.transactions) for (const a of tx.actions) {
    const k = tx.receiverId + "#" + a.params.methodName; if (seen.has(k)) continue; seen.add(k);
    const what = a.params.methodName === "ft_transfer_call" ? "send the reviewed amount to Ref for this swap" : a.params.methodName === "near_deposit" ? "wrap NEAR for the swap" : "register the account to hold the token";
    out.push({ type: "method", receiver: tx.receiverId, method: a.params.methodName, label: `${a.params.methodName} on ${tx.receiverId} (${what})` });
  }
  return out;
}

/** Verify finalized swap receipts: the input reached Ref and the output reached the owner. Returns null while
 * any transaction is not final. Output below the reviewed minimum is never reported as a completed swap. */
export function verifySwapReceipts(results: unknown[], p: Pick<SwapPreparation, "accountId" | "tokenIn" | "tokenOut" | "amountRaw" | "minOutRaw" | "to">) {
  let sent = 0n, received = 0n, refunded = 0n, failed = false;
  const nativeOut = p.to.contract === "native";
  for (const raw of results) {
    const r = raw as { final_execution_status?: string; status?: Record<string, unknown>; receipts_outcome?: { id: string; outcome?: { executor_id?: string; logs?: unknown[]; status?: Record<string, unknown> } }[];
      receipts?: { predecessor_id?: string; receiver_id?: string; receipt?: { Action?: { actions?: unknown[] } } }[] };
    if (!r || r.final_execution_status !== "FINAL") return null;
    if (r.status && "Failure" in r.status) failed = true;
    // Native NEAR delivered by Ref after its own unwrap: Transfer actions from the exchange to the owner.
    if (nativeOut) for (const x of r.receipts ?? []) {
      if (x.predecessor_id !== REF_EXCHANGE || x.receiver_id !== p.accountId) continue;
      for (const act of x.receipt?.Action?.actions ?? []) {
        const t = (act as { Transfer?: { deposit?: unknown } })?.Transfer;
        if (t && isRaw(t.deposit)) received += BigInt(t.deposit);
      }
    }
    for (const x of r.receipts_outcome ?? []) {
      for (const l of x.outcome?.logs ?? []) {
        if (typeof l !== "string" || !l.startsWith("EVENT_JSON:")) continue;
        let e: { standard?: string; event?: string; data?: { old_owner_id?: string; new_owner_id?: string; amount?: string }[] };
        try { e = JSON.parse(l.slice(11)); } catch { continue; }
        if (e.standard !== "nep141" || e.event !== "ft_transfer" || !Array.isArray(e.data)) continue;
        for (const d of e.data) {
          if (!isRaw(d?.amount)) continue;
          if (x.outcome?.executor_id === p.tokenIn && d.old_owner_id === p.accountId && d.new_owner_id === REF_EXCHANGE) sent += BigInt(d.amount);
          if (x.outcome?.executor_id === p.tokenIn && d.old_owner_id === REF_EXCHANGE && d.new_owner_id === p.accountId) refunded += BigInt(d.amount);
          if (x.outcome?.executor_id === p.tokenOut && d.old_owner_id === REF_EXCHANGE && d.new_owner_id === p.accountId) received += BigInt(d.amount);
        }
      }
    }
  }
  const state: "confirmed" | "failed" | "partial" = received >= BigInt(p.minOutRaw) && received > 0n ? "confirmed" : received === 0n && (failed || refunded > 0n) ? "failed" : "partial";
  return { state, sentRaw: sent.toString(), receivedRaw: received.toString(), received: decimal(received, p.to.contract === "native" ? 24 : p.to.decimals), refundedRaw: refunded > 0n ? refunded.toString() : null };
}
