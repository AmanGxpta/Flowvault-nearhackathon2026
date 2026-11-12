// Engines E2: StepAdapter for Rhea credit steps (collateral_add, borrow, repay, collateral_release).
// prepare() creates the wallet_attempts journal record through /api/lending (policy, fencing, idempotency)
// before any wallet handoff; check() reconciles only from the journal's finalized-receipt verification.
import type { ActionPlan, LedgerEntry, PlanStep, StepAdapter, StepState } from "./contracts";
import type { WalletAttempt } from "./execution";
import type { LendingPreparation } from "./lending";
import { readAttempt } from "./attempts";
import { decimal } from "./money";
import { journalCall, stepContext, stepKey } from "./step-adapters";

const STATE: Record<WalletAttempt["state"], StepState> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting_wallet",
  submitted: "submitted",
  confirmed: "confirmed",
  failed: "failed",
  partial: "partial",
  unknown: "unknown",
};

/** New debt is prepared only when the plan holds a granted new_debt approval for this step. */
export function newDebtApproved(plan: ActionPlan, step: PlanStep) {
  return plan.approvals.some((a) => a.stepId === step.id && a.kind === "new_debt" && !!a.grantedAt);
}

/** Ledger entries for one confirmed lending step. Collateral moves are internal; a borrow adds a
 * matching liability; a repay removes liability. Net worth never moves on principal. */
export function lendingLedger(plan: ActionPlan, step: PlanStep, a: WalletAttempt): LedgerEntry[] {
  const p = a.preparation as LendingPreparation;
  const usdc = p.asset === "USDC" ? p.amountRaw : p.usdcValueRaw;
  const base = {
    at: new Date().toISOString(),
    asset: p.asset,
    chain: "near" as const,
    amountRaw: p.amountRaw,
    decimals: p.decimals,
    usdcRaw: usdc,
    netWorthEffectUsdcRaw: "0",
    realized: true,
    status: "confirmed" as const,
    planId: plan.id,
    stepId: step.id,
    attemptId: a.id,
    positionId: "rhea:" + p.tokenId,
    txHashes: a.hashes,
    source: plan.source,
  };
  const id = (k: string) => `${step.id}:${k}`;
  if (p.kind === "borrow")
    return [{ ...base, id: id("borrow"), kind: "borrow", liabilityEffectUsdcRaw: p.amountRaw, basis: "Rhea borrow + USDC payout verified from finalized receipts" }];
  if (p.kind === "repay")
    return [{ ...base, id: id("repay"), kind: "repay", liabilityEffectUsdcRaw: "-" + p.amountRaw, basis: "Rhea repay event verified from finalized receipts; any excess stays supplied" }];
  return [
    {
      ...base,
      id: id(p.kind),
      kind: "internal_transfer",
      liabilityEffectUsdcRaw: "0",
      basis: p.kind === "collateral_add" ? "Rhea increase_collateral verified from finalized receipts" : "Rhea decrease_collateral and payout verified from finalized receipts",
    },
  ];
}

export const rheaCreditAdapter: StepAdapter = {
  kinds: ["collateral_add", "borrow", "repay", "collateral_release"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    const asset = step.expected.asset ?? (step.kind === "borrow" || step.kind === "repay" ? "USDC" : undefined);
    if (!asset || !step.expected.amountRaw) throw new Error("The credit step has no reviewed asset and amount.");
    if (step.kind === "borrow" && !newDebtApproved(plan, step))
      throw new Error("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL: approve this borrow before it is prepared.");
    const prep = await journalCall(ctx, "lending", "/api/lending", {
      kind: step.kind,
      asset,
      amount: decimal(BigInt(step.expected.amountRaw), asset === "USDC" ? 6 : 24),
      key: await stepKey(plan, step),
      approveNewDebt: step.kind === "borrow",
    });
    return { attemptId: prep.attemptId, expiresAt: prep.expiresAt, state: "prepared" };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    if (!step.attemptId) return { patch: {}, ledger: [] };
    let { attempt } = await readAttempt(ctx.sessionId, step.attemptId);
    if (attempt.state === "submitted" && attempt.hashes.length)
      attempt = (
        await journalCall<{ attempt: WalletAttempt }>(ctx, "transactions", "/api/transactions", { id: attempt.id, action: "check" })
      ).attempt;
    const state = STATE[attempt.state];
    const p = attempt.preparation as LendingPreparation;
    const patch: Partial<PlanStep> = { state };
    if (state === "confirmed")
      patch.actual = {
        amountRaw: p.amountRaw,
        asset: p.asset,
        usdcRaw: p.asset === "USDC" ? p.amountRaw : p.usdcValueRaw,
        evidence: attempt.verificationEvidence ?? attempt.hashes,
      };
    return { patch, ledger: state === "confirmed" && step.state !== "confirmed" ? lendingLedger(plan, step, attempt) : [] };
  },
};
