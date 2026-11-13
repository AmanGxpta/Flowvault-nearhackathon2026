import type { StepAdapter, PlanStep, StepState } from "../contracts";
import type { WalletAttempt } from "../execution";
import { readAttempt } from "../attempts";
import { stepContext, journalCall, stepKey } from "../step-adapters";
import { readActionValuation } from "../valuation-evidence";
import { stakingLedger, stakingFeeRaw } from "../staking-ledger";
const STATE: Record<WalletAttempt["state"], StepState> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting_wallet",
  submitted: "submitted",
  confirmed: "confirmed",
  failed: "failed",
  partial: "partial",
  unknown: "unknown",
};
export const stakingStepAdapter: StepAdapter = {
  kinds: ["stake", "unstake", "withdraw_unstaked"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    if (plan.source !== "live" || plan.accountId !== ctx.workspace.accountId)
      throw new Error("LiNEAR step source or signer changed.");
    const venue = plan.request.venue === "lst.rhealab.near" ? "rnear" : "linear";
    const asset = step.kind === "unstake" ? (venue === "rnear" ? "rNEAR" : "LiNEAR") : "NEAR";
    if (
      !step.expected.amountRaw ||
      (step.expected.asset && step.expected.asset !== asset)
    )
      throw new Error(
        "LiNEAR step needs the reviewed raw " + asset + " amount.",
      );
    const p = await journalCall(ctx, "staking", "/api/staking/actions", {
      kind: step.kind,
      venue,
      amountRaw: step.expected.amountRaw,
      key: await stepKey(plan, step),
    });
    return {
      attemptId: p.attemptId,
      expiresAt: p.expiresAt,
      state: "prepared",
    };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    if (!step.attemptId) return { patch: {}, ledger: [] };
    let { attempt } = await readAttempt(ctx.sessionId, step.attemptId);
    if (
      ["submitted", "unknown", "partial", "awaiting_wallet"].includes(
        attempt.state,
      ) &&
      attempt.hashes.length
    )
      attempt = (
        await journalCall<{ attempt: WalletAttempt }>(
          ctx,
          "transactions",
          "/api/transactions",
          { id: attempt.id, action: "check" },
        )
      ).attempt;
    const patch: Partial<PlanStep> = { state: STATE[attempt.state] };
    if (attempt.state === "confirmed") {
      stakingLedger(plan, step, attempt); // verifies one economic proof before exposing actual quantities
      const effect: any = (attempt.verificationEvidence ?? []).find(
        (e: any) =>
          e.verifiedState === "confirmed" &&
          e.stakingEffect?.state === "confirmed" &&
          attempt.hashes.includes(e.hash),
      );
      const p =
        attempt.preparation as import("../staking-execution").StakingPreparation;
      patch.actual = {
        amountRaw:
          attempt.kind === "stake"
            ? effect.stakingEffect.amountRaw
            : effect.stakingEffect.nearAmountRaw,
        asset: attempt.kind === "stake" ? (p.quote.protocol === "rnear" ? "rNEAR" : "LiNEAR") : "NEAR",
        usdcRaw: p.usdcValueRaw,
        evidence: attempt.verificationEvidence,
      };
    }
    if (
      step.state === "confirmed" ||
      !["confirmed", "failed"].includes(attempt.state)
    )
      return { patch, ledger: [] };
    const fee = stakingFeeRaw(attempt),
      value =
        fee !== null && fee > 0n
          ? await readActionValuation(fee, "NEAR")
          : undefined;
    return { patch, ledger: stakingLedger(plan, step, attempt, value) };
  },
};
