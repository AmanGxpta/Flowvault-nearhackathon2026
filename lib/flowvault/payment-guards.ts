import { movingCost, assertFreshValuation } from "./payout-valuation.ts";
import { units } from "./money.ts";
import { obligationIdentity } from "./payments.ts";
import type { PaymentPlan, PayPreparation } from "./payments.ts";
import type { Workspace } from "./types.ts";
export function assertPaymentContext(p: PaymentPlan, w: Workspace) {
  if (["cancelled", "paid"].includes(p.state))
    throw new Error("Payment plan is already terminal.");
  const o = w.obligations.find((x) => x.id === p.obligationId);
  if (
    w.mode !== "live" ||
    w.accountId !== p.accountId ||
    w.mandate.version !== p.mandateVersion ||
    !o ||
    obligationIdentity(o) !== p.obligationIdentity
  )
    throw new Error(
      "Payment account, source, obligation or plan changed. Replan before signing.",
    );
  if (["paid", "cancelled"].includes(o.status))
    throw new Error("Obligation is already paid or cancelled.");
  return o;
}

export function assertDepositBinding(
  prep: PayPreparation,
  expected: PayPreparation,
  maxMoveCost: string,
) {
  if (
    prep.accountId !== expected.accountId ||
    prep.recipient !== expected.recipient ||
    prep.destination !== expected.destination ||
    prep.amount !== expected.amount ||
    prep.netAmount !== expected.netAmount ||
    prep.destinationToken !== expected.destinationToken ||
    prep.outputValueUsdc !== expected.outputValueUsdc ||
    JSON.stringify(prep.valuation) !== JSON.stringify(expected.valuation) ||
    prep.depositAddress !== expected.depositAddress ||
    prep.depositCutoff !== expected.depositCutoff ||
    JSON.stringify(prep.transactions) !==
      JSON.stringify(expected.transactions) ||
    JSON.stringify(prep.retainedSignedQuote) !==
      JSON.stringify(expected.retainedSignedQuote)
  )
    throw new Error("Payment preparation does not match the retained plan.");
  if (prep.destinationToken === "USDT") assertFreshValuation(prep.valuation);
  if (
    units(movingCost(prep.amount, prep.outputValueUsdc ?? prep.netAmount)) >
    units(maxMoveCost)
  )
    throw new Error("Payment moving cost exceeds the mandate limit.");
}
export function assertDepositFunds(
  walletRaw: string,
  native: { amount: string; storage_usage: number },
  amount: string,
  protectedRaw: bigint,
) {
  if (BigInt(walletRaw) < units(amount) + protectedRaw)
    throw new Error(
      "Source wallet cannot fund this quote while preserving the reserve, other obligations and pending payments.",
    );
  if (!Number.isSafeInteger(native.storage_usage) || native.storage_usage < 0)
    throw new Error("Native storage usage is unverified.");
  const spendable =
    BigInt(native.amount) - BigInt(native.storage_usage) * 10n ** 19n;
  if (spendable < 250000000000000000000001n)
    throw new Error("Insufficient spendable NEAR for payment gas.");
}
