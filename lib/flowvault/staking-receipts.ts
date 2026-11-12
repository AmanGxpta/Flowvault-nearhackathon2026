// Newly authored verifier against LiNEAR contract interface at 63cd09aabbc3c28ca39ca4266647c24315ae3975.
// stake.rs/internal.rs/events.rs were inspected; no contract implementation copied.
import { LINEAR_CONTRACT } from "./staking-lifecycle.ts";
import type { normalizeLifecycleQuote } from "./staking-lifecycle.ts";
export type LifecycleQuote = ReturnType<typeof normalizeLifecycleQuote>;
const integer = (n: unknown) => {
  if (typeof n !== "string" || !/^(0|[1-9]\d*)$/.test(n))
    throw new Error("Invalid staking receipt amount.");
  return BigInt(n);
};
const stable = (x: any): string =>
  JSON.stringify(
    x,
    typeof x === "object" && x !== null && !Array.isArray(x)
      ? Object.keys(x).sort()
      : undefined,
  );
/** Native claim needs actual Transfer receipt actions fetched by receipt ID, never an account balance delta. */
export function verifyLinearReceipts(
  result: any,
  quote: LifecycleQuote,
  accountId: string,
  transferReceipts: any[] = [],
) {
  const expected = quote.transactions[0],
    tx = result?.transaction;
  if (
    tx?.signer_id !== accountId ||
    tx.receiver_id !== LINEAR_CONTRACT ||
    tx.actions?.length !== 1
  )
    throw new Error("Staking transaction identity mismatch.");
  const f = tx.actions[0]?.FunctionCall,
    p = expected.actions[0].params;
  let args;
  try {
    args = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(f?.args), (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    throw new Error("Invalid staking transaction arguments.");
  }
  if (
    f.method_name !== p.methodName ||
    String(f.gas) !== p.gas ||
    String(f.deposit) !== p.deposit ||
    stable(args) !== stable(p.args)
  )
    throw new Error("Staking transaction differs from reviewed payload.");
  if (result.final_execution_status !== "FINAL")
    return { state: "pending" as const, reason: "WAITING_FINAL" };
  if (
    result.status?.Failure ||
    result.receipts_outcome?.some((r: any) => r.outcome?.status?.Failure)
  )
    return { state: "failed" as const, reason: "FINAL_RECEIPT_FAILED" };
  if (
    typeof result.status?.SuccessValue !== "string" ||
    !Array.isArray(result.receipts_outcome) ||
    !result.receipts_outcome.length ||
    result.receipts_outcome.some(
      (r: any) =>
        !r.outcome?.status ||
        (!("SuccessValue" in r.outcome.status) &&
          !("SuccessReceiptId" in r.outcome.status)),
    )
  )
    return { state: "pending" as const, reason: "RECEIPTS_INCOMPLETE" };
  const events: any[] = [];
  for (const r of result.receipts_outcome) {
    if (r.outcome.executor_id !== LINEAR_CONTRACT) continue;
    for (const line of r.outcome.logs ?? []) {
      if (typeof line !== "string" || !line.startsWith("EVENT_JSON:")) continue;
      let event;
      try {
        event = JSON.parse(line.slice(11));
      } catch {
        throw new Error("Malformed LiNEAR economic event.");
      }
      if (!Array.isArray(event.data))
        throw new Error("Malformed LiNEAR economic event data.");
      events.push(event);
    }
  }
  const name =
    quote.kind === "stake"
      ? "stake"
      : quote.kind === "unstake"
        ? "unstake"
        : "withdraw";
  const matching = events
    .filter(
      (e) =>
        e.standard === "linear" && e.version === "1.0.1" && e.event === name,
    )
    .flatMap((e) => e.data)
    .filter((d) => d.account_id === accountId);
  if (matching.length !== 1)
    return { state: "pending" as const, reason: "ECONOMIC_EVENT_NOT_UNIQUE" };
  const event = matching[0];
  if (quote.kind === "withdraw_unstaked") {
    if (integer(event.amount) !== BigInt(quote.nearAmountRaw))
      return { state: "pending" as const, reason: "CLAIM_AMOUNT_CHANGED" };
    const native = transferReceipts.filter(
      (r) =>
        r.predecessor_id === LINEAR_CONTRACT &&
        r.receiver_id === accountId &&
        result.receipts_outcome.some(
          (o: any) =>
            o.id === r.receipt_id &&
            o.outcome.executor_id === accountId &&
            typeof o.outcome.status?.SuccessValue === "string",
        ) &&
        r.receipt?.Action?.actions?.length === 1 &&
        r.receipt.Action.actions[0].Transfer?.deposit === quote.nearAmountRaw,
    );
    if (native.length !== 1)
      return {
        state: "pending" as const,
        reason: "NATIVE_TRANSFER_NOT_VERIFIED",
      };
    return {
      state: "confirmed" as const,
      asset: "NEAR",
      amountRaw: quote.nearAmountRaw,
      nearAmountRaw: quote.nearAmountRaw,
      receiptId: native[0].receipt_id,
    };
  }
  const shares = integer(
    quote.kind === "stake"
      ? event.minted_stake_shares
      : event.burnt_stake_shares,
  );
  const near = integer(
    quote.kind === "stake" ? event.staked_amount : event.unstaked_amount,
  );
  const tokenEvent = quote.kind === "stake" ? "ft_mint" : "ft_burn";
  const token = events
    .filter(
      (e) =>
        e.standard === "nep141" &&
        e.version === "1.0.0" &&
        e.event === tokenEvent,
    )
    .flatMap((e) => e.data)
    .filter((d) => d.owner_id === accountId && integer(d.amount) === shares);
  if (shares === 0n || near === 0n || token.length !== 1)
    return { state: "pending" as const, reason: "TOKEN_EFFECT_NOT_VERIFIED" };
  if (
    (quote.kind === "stake" &&
      (near > BigInt(quote.nearAmountRaw) ||
        shares < BigInt(quote.sharesRaw!))) ||
    (quote.kind === "unstake" &&
      (shares > BigInt(quote.sharesRaw!) || near < BigInt(quote.nearAmountRaw)))
  )
    return { state: "pending" as const, reason: "ECONOMIC_BOUNDS_CHANGED" };
  let unlockEpoch: string | undefined;
  if (quote.kind === "unstake") {
    const e = event.unstaked_available_epoch_height;
    if (typeof e !== "number" || !Number.isSafeInteger(e) || e < 0)
      throw new Error("Unstake unlock epoch is unverified.");
    unlockEpoch = String(e);
  }
  return {
    state: "confirmed" as const,
    asset: "LiNEAR",
    amountRaw: shares.toString(),
    nearAmountRaw: near.toString(),
    unlockEpoch,
  };
}
