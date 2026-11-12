// Stream A: StepAdapter for fund_transfer (one leg of a multi-source funding plan).
// prepare() writes the funding-leg journal record (live balance net of other plans' reservations, gas, NEAR
// USDC storage, a live 1Click quote no worse than the reviewed minimum, the exact source-chain transfer) before
// any wallet handoff. check() reconciles from the source chain's receipt and 1Click's delivery report only.
// The step's attemptId is the leg journal id ("leg:…"), so the executor watches it like any wallet attempt.
import type { ActionPlan, FundingLeg, LedgerEntry, PlanStep, StepAdapter, StepState } from "../contracts";
import type { LegJournalState } from "../funding-mesh";
import { legLedger } from "../funding-mesh";
import { accountReservations } from "../capabilities";
import { checkLeg, outcomeOf, prepareLeg } from "../funding-mesh-live";
import { planList } from "../plans-store";
import { readPriceEvidence } from "../valuation-evidence";
import { stepContext } from "../step-adapters";
import { stepGeneration } from "../plans";
import type { StoredPlan } from "../plans-service";

const STATE: Record<LegJournalState, StepState> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting_wallet",
  submitted: "submitted",
  confirmed: "confirmed",
  refunded: "failed",
  failed: "failed",
  unknown: "unknown",
};

export function legOf(plan: ActionPlan, step: PlanStep): FundingLeg {
  const leg = (plan as StoredPlan).funding?.legs.find((l) => l.id === step.expected.legId);
  if (!leg) throw new Error("This transfer step has no reviewed source. Cancel and ask again.");
  return leg;
}

export const fundingLegAdapter: StepAdapter = {
  kinds: ["fund_transfer"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    const leg = legOf(plan, step);
    const others = accountReservations((await planList(ctx.sessionId, 50)).map((r) => r.plan as StoredPlan), plan.id)
      .filter((r) => r.accountId === leg.accountId && r.network === leg.network && r.asset === leg.asset)
      .reduce((n, r) => n + BigInt(r.amountRaw), 0n);
    const rec = await prepareLeg({ sessionId: ctx.sessionId, workspace: ctx.workspace, plan, step, leg, generation: stepGeneration(step), otherHeldRaw: others });
    return { attemptId: rec.id, expiresAt: rec.expiresAt, state: STATE[rec.state] };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    if (!step.attemptId?.startsWith("leg:")) return { patch: {}, ledger: [] };
    const prices = await readPriceEvidence().catch(() => null);
    const rec = await checkLeg(ctx.sessionId, step.attemptId, prices);
    const leg = legOf(plan, step);
    const state = STATE[rec.state];
    const patch: Partial<PlanStep> = { state };
    if (rec.state === "confirmed")
      patch.actual = { amountRaw: rec.deliveredRaw ?? undefined, asset: "USDC", usdcRaw: rec.deliveredRaw ?? undefined, evidence: { txHash: rec.txHash, destinationHashes: rec.destinationHashes, provider: rec.provider } };
    const ledger: LedgerEntry[] = state === "confirmed" && step.state !== "confirmed" ? legLedger(outcomeOf(rec), leg, { legJournalId: rec.id, planId: plan.id, stepId: step.id, source: plan.source }) : [];
    return { patch, ledger, message: rec.timeline.at(-1)?.message } as { patch: Partial<PlanStep>; ledger: LedgerEntry[] };
  },
};
