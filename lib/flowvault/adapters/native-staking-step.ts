// Engines P2: StepAdapter for native validator staking (native_stake, native_unstake, native_withdraw).
// prepare() creates the wallet_attempts journal record through /api/staking/native (validator evaluation,
// policy, on-chain policy status, fencing, idempotency) before any wallet handoff; check() reconciles only
// from the journal's finalized-receipt verification. One pool per step, named in step.expected.venue.
import type { ActionPlan, LedgerEntry, PlanStep, StepAdapter, StepState } from "../contracts";
import type { WalletAttempt } from "../execution";
import type { NativeStakingPreparation } from "../staking-native";
import { readAttempt } from "../attempts";
import { decimal } from "../money";
import { journalCall, stepContext, stepKey } from "../step-adapters";
import { attemptLedger } from "../ledger";

const STATE: Record<WalletAttempt["state"], StepState> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting_wallet",
  submitted: "submitted",
  confirmed: "confirmed",
  failed: "failed",
  partial: "partial",
  unknown: "unknown",
};

/** A stake locks NEAR for at least ~4 epochs, so it is prepared only with a granted stake approval. */
export function stakeApproved(plan: ActionPlan, step: PlanStep) {
  return plan.approvals.some((a) => a.stepId === step.id && a.kind === "stake" && !!a.grantedAt);
}

/** Journal-derived ledger entries for one finished native step, linked to the plan and step. */
export async function nativeLedger(plan: ActionPlan, step: PlanStep, a: WalletAttempt): Promise<LedgerEntry[]> {
  const { readPriceEvidence } = await import("../valuation-evidence");
  const prices = await readPriceEvidence().catch(() => null);
  return attemptLedger(a, prices, plan.source).map((e) => ({ ...e, planId: plan.id, stepId: step.id }));
}

export const nativeStakingAdapter: StepAdapter = {
  kinds: ["native_stake", "native_unstake", "native_withdraw"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    if (plan.source !== "live" || plan.accountId !== ctx.workspace.accountId) throw new Error("Native staking step source or signer changed.");
    const pool = step.expected.venue;
    if (!pool) throw new Error("The native staking step has no reviewed validator pool.");
    if (!step.expected.amountRaw || (step.expected.asset && step.expected.asset !== "NEAR"))
      throw new Error("The native staking step needs the reviewed raw NEAR amount.");
    if (step.kind === "native_stake" && !stakeApproved(plan, step))
      throw new Error("STAKE_NEEDS_EXPLICIT_APPROVAL: approve this stake before it is prepared.");
    const prep = await journalCall(ctx, "native", "/api/staking/native", {
      kind: step.kind,
      pool,
      amount: decimal(BigInt(step.expected.amountRaw), 24),
      key: await stepKey(plan, step),
      approveStake: step.kind === "native_stake",
    });
    return { attemptId: prep.attemptId, expiresAt: prep.expiresAt, state: "prepared" };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    if (!step.attemptId) return { patch: {}, ledger: [] };
    let { attempt } = await readAttempt(ctx.sessionId, step.attemptId);
    if (["submitted", "unknown", "partial"].includes(attempt.state) && attempt.hashes.length)
      attempt = (await journalCall<{ attempt: WalletAttempt }>(ctx, "transactions", "/api/transactions", { id: attempt.id, action: "check" })).attempt;
    const state = STATE[attempt.state];
    const p = attempt.preparation as NativeStakingPreparation;
    const patch: Partial<PlanStep> = { state };
    if (state === "confirmed")
      patch.actual = { amountRaw: p.amountRaw, asset: "NEAR", usdcRaw: p.usdcValueRaw, evidence: attempt.verificationEvidence ?? attempt.hashes };
    const finished = state === "confirmed" || state === "failed";
    return { patch, ledger: finished && step.state !== state ? await nativeLedger(plan, step, attempt) : [] };
  },
};
