// Action plans: pure state logic (owner: Interface). Imports the shared contracts; never redefines them.
// Plans orchestrate, journals execute: a step only links to an existing wallet attempt or payment plan.
// No D1, network or wallet access here so every rule below is unit-tested in tests/plans.test.ts.
import type {
  ActionPlan,
  FundingChoice,
  PlanObjective,
  PlanState,
  PlanStep,
  StepKind,
  StepState,
} from "./contracts.ts";
import type { ExecutionStep } from "./timeline.ts";
import type { Source, Chain } from "./types.ts";

export const PLAN_TTL_MS = 24 * 3600_000;
const TERMINAL: PlanState[] = ["completed", "failed", "superseded", "expired", "cancelled", "blocked"];
/** Steps whose wallet request already left FlowVault: only their journal may move them on. */
export const IN_FLIGHT: StepState[] = ["awaiting_wallet", "submitted", "unknown", "partial"];
const NOT_HANDED: StepState[] = ["pending", "ready", "prepared"];
/** Evidence-only steps keep running after a fence so money already in motion is still verified. */
const OBSERVE_ONLY: StepKind[] = ["verify_payout"];

export type PlanContext = ActionPlan["context"];

export function isTerminal(plan: Pick<ActionPlan, "state">) {
  return TERMINAL.includes(plan.state);
}
export function inFlight(plan: ActionPlan) {
  return plan.steps.filter((s) => IN_FLIGHT.includes(s.state));
}

/** Context read from the stored workspace; the plan is fenced on all three numbers. */
export function planContext(
  workspace: { mandate: { version: number }; policy?: { version?: number } },
  revision: number,
): PlanContext {
  return {
    workspaceRevision: revision,
    mandateVersion: workspace.mandate.version,
    policyVersion: workspace.policy?.version ?? 0,
  };
}

export function contextChanges(plan: ActionPlan, now: PlanContext): string[] {
  const c = plan.context;
  const out: string[] = [];
  if (c.mandateVersion !== now.mandateVersion)
    out.push(`CASH_PLAN_CHANGED: cash plan v${c.mandateVersion} → v${now.mandateVersion}`);
  if (c.policyVersion !== now.policyVersion)
    out.push(`POLICY_CHANGED: policy revision ${c.policyVersion} → ${now.policyVersion}`);
  if (c.workspaceRevision !== now.workspaceRevision)
    out.push(`WORKSPACE_CHANGED: workspace revision ${c.workspaceRevision} → ${now.workspaceRevision}`);
  return out;
}

function note(step: PlanStep, phase: string, status: string, message: string, evidence: unknown = null, at = Date.now()) {
  const last = step.timeline.at(-1);
  if (last && last.phase === phase && last.status === status && last.message === message) return;
  const entry: ExecutionStep = {
    id: `${step.id}:${step.timeline.length + 1}`,
    sequence: step.timeline.length + 1,
    at: new Date(at).toISOString(),
    phase,
    status,
    message,
    explorerLinks: [],
    fees: [],
    refund: null,
    evidence,
  };
  step.timeline.push(entry);
}
export { note as noteStep };

/**
 * Fencing. Any change to workspace revision, cash-plan (mandate) version or policy version supersedes every
 * step not yet handed to a wallet. Steps already in a wallet keep being reconciled from their journal.
 */
export function applyFence(plan: ActionPlan, now: PlanContext, at = Date.now()): string[] {
  if (isTerminal(plan) && plan.state !== "blocked") return [];
  const changes = contextChanges(plan, now);
  if (!changes.length) return [];
  for (const s of plan.steps)
    if (NOT_HANDED.includes(s.state) && !OBSERVE_ONLY.includes(s.kind)) {
      s.state = "skipped";
      note(s, "fence", "superseded", "Superseded before wallet handoff: " + changes.join("; "), null, at);
    }
  plan.blockedReasons = [...new Set([...plan.blockedReasons, ...changes])];
  plan.state = "superseded";
  plan.updatedAt = new Date(at).toISOString();
  return changes;
}

/** After the executor's own journal call changes the workspace revision (e.g. obligation → processing). */
export function rebase(plan: ActionPlan, now: PlanContext) {
  if (
    plan.context.mandateVersion === now.mandateVersion &&
    plan.context.policyVersion === now.policyVersion
  )
    plan.context = { ...plan.context, workspaceRevision: now.workspaceRevision };
}

/** Prepared steps past their expiry go back to ready (a new idempotency generation); stale plans expire. */
export function applyExpiry(plan: ActionPlan, at = Date.now()): boolean {
  let changed = false;
  for (const s of plan.steps)
    if (s.state === "prepared" && s.expiresAt && Date.parse(s.expiresAt) <= at) {
      note(s, "expiry", "expired", "Preparation expired before wallet handoff. Prepare again for fresh figures.", { attemptId: s.attemptId }, at);
      s.state = "ready";
      s.attemptId = undefined;
      s.expiresAt = undefined;
      changed = true;
    }
  if (!isTerminal(plan) && !inFlight(plan).length && !plan.steps.some((s) => s.state === "confirmed")) {
    const deadline = plan.request.deadline ? Date.parse(plan.request.deadline + "T23:59:59.999Z") : NaN;
    const stale = Date.parse(plan.createdAt) + PLAN_TTL_MS <= at;
    if ((Number.isFinite(deadline) && deadline <= at) || stale) {
      for (const s of plan.steps)
        if (NOT_HANDED.includes(s.state)) {
          s.state = "skipped";
          note(s, "expiry", "expired", stale ? "Plan expired after 24 hours without execution." : "Payment deadline passed.", null, at);
        }
      plan.state = "expired";
      plan.blockedReasons = [...new Set([...plan.blockedReasons, stale ? "PLAN_EXPIRED" : "DEADLINE_PASSED"])];
      changed = true;
    }
  }
  if (changed) plan.updatedAt = new Date(at).toISOString();
  return changed;
}

export function depsMet(plan: ActionPlan, step: PlanStep) {
  return step.dependsOn.every((d) => plan.steps.find((s) => s.id === d)?.state === "confirmed");
}

/** Recomputes readiness and the plan state from step states. Terminal states are sticky. */
export function settle(plan: ActionPlan, at = Date.now()): PlanState {
  for (const s of plan.steps) if (s.state === "pending" && depsMet(plan, s)) s.state = "ready";
  if (plan.state === "superseded" && plan.steps.some((s) => s.state === "confirmed") && !plan.steps.some((s) => IN_FLIGHT.includes(s.state) || (OBSERVE_ONLY.includes(s.kind) && s.state !== "skipped" && s.state !== "confirmed" && s.state !== "failed"))) {
    // Money moved before the fence: some effects are real, the rest was superseded.
    plan.state = "partial";
    plan.updatedAt = new Date(at).toISOString();
  }
  if (isTerminal(plan) || !plan.steps.length) return plan.state;
  const st = plan.steps.map((s) => s.state);
  const confirmed = st.filter((x) => x === "confirmed").length;
  let next: PlanState;
  // Skipped steps only come from a fence, cancel or expiry, so they never count as a completed result.
  if (st.every((x) => x === "confirmed")) next = "completed";
  else if (st.every((x) => x === "confirmed" || x === "skipped") && confirmed > 0) next = "partial";
  else if (st.includes("failed")) next = confirmed > 0 || st.some((x) => IN_FLIGHT.includes(x)) ? "partial" : "failed";
  else if (st.includes("unknown") || st.includes("partial")) next = "partial";
  else if (confirmed > 0 || st.some((x) => IN_FLIGHT.includes(x))) next = "executing";
  else next = "reviewed";
  if (next !== plan.state) {
    plan.state = next;
    plan.updatedAt = new Date(at).toISOString();
  }
  return next;
}

export type PrepareDecision = { kind: "existing"; step: PlanStep } | { kind: "prepare"; step: PlanStep };

/** Every guard that must hold before a step's adapter may create a journal record. */
export function assertPreparable(plan: ActionPlan, stepId: string, now: PlanContext, at = Date.now()): PrepareDecision {
  if (plan.state === "superseded") throw new Error("This plan was superseded by a change to your workspace, cash plan or policy. Ask again for a fresh plan.");
  if (isTerminal(plan)) throw new Error(`This plan is ${plan.state}; nothing more can be prepared.`);
  if (!plan.selectedChoiceId) throw new Error("Review the plan and choose an alternative before preparing a step.");
  const changes = contextChanges(plan, now);
  if (changes.length) throw new Error("Plan context changed: " + changes.join("; "));
  if (plan.source !== "live") throw new Error("Example plans are fictional. Nothing can be prepared or signed in the example workspace.");
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error("Step not found in this plan.");
  if (step.state === "prepared" && step.attemptId && (!step.expiresAt || Date.parse(step.expiresAt) > at))
    return { kind: "existing", step };
  if (IN_FLIGHT.includes(step.state) || step.state === "confirmed")
    throw new Error("This step already reached the wallet or finished. Check its status instead of preparing it again.");
  if (step.state === "pending" || !depsMet(plan, step)) throw new Error("Earlier steps in this plan must be confirmed first.");
  if (step.state !== "ready") throw new Error(`Step is ${step.state}; it cannot be prepared.`);
  const blockers = plan.approvals.filter((a) => a.stepId === step.id && !a.grantedAt);
  if (blockers.some((a) => a.kind === "new_debt")) throw new Error("This step creates new debt. Approve the new debt explicitly first.");
  return { kind: "prepare", step };
}

/** Idempotency generation: a re-prepare after expiry must use a new journal key, a retry must not. */
export function stepGeneration(step: PlanStep) {
  return step.timeline.filter((t) => t.phase === "expiry" && t.status === "expired").length;
}

/* ───────────── builders ───────────── */

export interface NewPlanInput {
  id: string;
  key: string;
  source: Source;
  accountId: string | null;
  objective: PlanObjective;
  createdBy: ActionPlan["createdBy"];
  request: ActionPlan["request"];
  context: PlanContext;
  alternatives: FundingChoice[];
  blockedReasons?: string[];
  effects?: Partial<ActionPlan["effects"]>;
  /** Engine's pick; the owner still reviews and selects. */
  recommendedChoiceId?: string;
}

export function newPlan(i: NewPlanInput, at = Date.now()): ActionPlan & { recommendedChoiceId?: string } {
  const now = new Date(at).toISOString();
  const blocked = i.blockedReasons ?? [];
  const anyEligible = i.alternatives.some((a) => a.eligible);
  return {
    id: i.id,
    key: i.key,
    source: i.source,
    accountId: i.accountId,
    objective: i.objective,
    createdBy: i.createdBy,
    request: i.request,
    context: i.context,
    alternatives: i.alternatives,
    steps: [],
    effects: {
      reserveAfterUsdcRaw: null,
      debtAfterUsdcRaw: null,
      costsUsdcRaw: null,
      exposure: [],
      ...i.effects,
    },
    approvals: [],
    blockedReasons: anyEligible ? blocked : [...new Set([...blocked, ...i.alternatives.flatMap((a) => a.reasons)])],
    state: !anyEligible || blocked.length ? "blocked" : "evaluated",
    ledgerEntryIds: [],
    createdAt: now,
    updatedAt: now,
    recommendedChoiceId: i.recommendedChoiceId,
  };
}

const SIGNED: StepKind[] = [
  "supply", "withdraw", "stake", "unstake", "withdraw_unstaked", "collateral_add",
  "borrow", "repay", "collateral_release", "pay_deposit",
];

export interface StepSpec {
  kind: StepKind;
  expected: PlanStep["expected"];
}

/** Owner review: selects one eligible alternative and expands it into a linear chain of steps. */
export function review(plan: ActionPlan, choiceId: string, specs: StepSpec[], at = Date.now()) {
  if (plan.state !== "evaluated" && plan.state !== "reviewed")
    throw new Error(`A ${plan.state} plan cannot be reviewed.`);
  if (plan.steps.some((s) => s.state !== "ready" && s.state !== "pending"))
    throw new Error("Steps are already prepared; cancel and ask again to change the choice.");
  const choice = plan.alternatives.find((a) => a.id === choiceId);
  if (!choice) throw new Error("Alternative not found.");
  if (!choice.eligible) throw new Error("That alternative is not eligible: " + choice.reasons.join(", "));
  plan.selectedChoiceId = choice.id;
  plan.steps = specs.map((spec, i) => {
    const id = `${plan.id.slice(0, 8)}-${i + 1}-${spec.kind}`;
    const signed = SIGNED.includes(spec.kind);
    const step: PlanStep = {
      id,
      planId: plan.id,
      kind: spec.kind,
      dependsOn: i === 0 ? [] : [`${plan.id.slice(0, 8)}-${i}-${specs[i - 1].kind}`],
      signer: signed ? plan.accountId : null,
      approval: signed ? "owner_wallet" : "none",
      state: i === 0 ? "ready" : "pending",
      expected: spec.expected,
      timeline: [],
    };
    note(step, "review", "planned", "Reviewed by the owner; nothing prepared yet.", null, at);
    return step;
  });
  plan.approvals = plan.steps
    .filter((s) => s.approval === "owner_wallet")
    .map((s) => ({
      stepId: s.id,
      kind: s.kind === "borrow" ? ("new_debt" as const) : s.kind === "stake" ? ("stake" as const) : ("spend" as const),
    }));
  plan.state = "reviewed";
  plan.updatedAt = new Date(at).toISOString();
  return plan;
}

export function cancel(plan: ActionPlan, at = Date.now()) {
  if (inFlight(plan).length)
    throw new Error("A step is already in your wallet. Track and verify it; it cannot be cancelled from FlowVault.");
  if (plan.state === "completed") throw new Error("Completed plans cannot be cancelled.");
  for (const s of plan.steps)
    if (NOT_HANDED.includes(s.state)) {
      s.state = "skipped";
      note(s, "cancel", "cancelled", "Cancelled by the owner before wallet handoff.", null, at);
    }
  plan.state = "cancelled";
  plan.updatedAt = new Date(at).toISOString();
  return plan;
}

/** The lock target: one active plan per obligation, per position, or per deploy-surplus intent. */
export function planTarget(objective: PlanObjective, request: ActionPlan["request"]) {
  if (request.obligationId) return "obligation:" + request.obligationId;
  if (request.positionId) return objective + ":" + request.positionId;
  return objective;
}

/** Same key, same request: the idempotent replay must describe the same intent. */
export function assertSameIntent(existing: ActionPlan, objective: PlanObjective, request: ActionPlan["request"], source: Source) {
  if (
    existing.objective !== objective ||
    existing.source !== source ||
    (existing.request.obligationId ?? null) !== (request.obligationId ?? null) ||
    (existing.request.amountRaw ?? null) !== (request.amountRaw ?? null)
  )
    throw new Error("Plan idempotency key was already used for a different request.");
}

export const STEP_LABEL: Record<StepKind, string> = {
  supply: "Supply to Rhea",
  withdraw: "Withdraw from Rhea",
  stake: "Stake",
  unstake: "Unstake",
  withdraw_unstaked: "Withdraw unstaked NEAR",
  collateral_add: "Add collateral",
  borrow: "Borrow",
  repay: "Repay",
  collateral_release: "Release collateral",
  pay_quote: "Get a live exact-output quote",
  pay_deposit: "Deposit to the 1Click address",
  verify_payout: "Verify the payout on the destination chain",
  wait_until: "Wait",
};

export type { Chain };
