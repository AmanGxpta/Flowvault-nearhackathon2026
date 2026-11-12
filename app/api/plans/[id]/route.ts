// One action plan: review, prepare a step, reconcile, cancel (owner: Interface).
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { planGet, planSave, ledgerOutbox } from "@/lib/flowvault/plans-store";
import { applyExpiry, applyFence, cancel, planContext, rebase, settle } from "@/lib/flowvault/plans";
import { reviewChoice, type StoredPlan } from "@/lib/flowvault/plans-service";
import { executeCheck, executePrepare, grantApproval } from "@/lib/flowvault/step-adapters";
import { readAttempt } from "@/lib/flowvault/attempts";
import { legPreparation } from "@/lib/flowvault/funding-mesh-live";

function idOf(r: Request) {
  return decodeURIComponent(new URL(r.url).pathname.split("/").filter(Boolean).at(-1)!);
}

async function load(r: Request) {
  const s = await session(r);
  const found = await planGet(s.id, idOf(r));
  if (!found) throw new Error("Plan not found in this browser session.");
  const plan = found.plan as StoredPlan;
  applyExpiry(plan);
  applyFence(plan, planContext(s.workspace, s.revision));
  settle(plan);
  return { s, plan, previous: found.previous };
}

async function reconcile(r: Request, s: Awaited<ReturnType<typeof session>>, plan: StoredPlan) {
  const { ledger } = await executeCheck(plan, { request: r, sessionId: s.id, workspace: s.workspace, revision: s.revision });
  const after = await session(r);
  rebase(plan, planContext(after.workspace, after.revision));
  return ledger;
}

export async function GET(r: Request) {
  try {
    const { s, plan, previous } = await load(r);
    let ledger: Awaited<ReturnType<typeof reconcile>> = [];
    let warning: string | undefined;
    try {
      ledger = await reconcile(r, s, plan);
    } catch (e) {
      warning = "Status check failed: " + (e instanceof Error ? e.message : "unknown error") + ". Nothing changed.";
    }
    await planSave(s.id, plan, previous);
    await ledgerOutbox(s.id, plan.id, ledger);
    return json({ plan, warning }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), choiceId: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("prepare"), stepId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal("approve"), stepId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal("handoff"), stepId: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = actionSchema.parse(await r.json());
    const { s, plan, previous } = await load(r);
    let ledger: Awaited<ReturnType<typeof reconcile>> = [];
    let preparation: unknown;
    if (b.action === "review") reviewChoice(plan, b.choiceId);
    else if (b.action === "cancel") cancel(plan);
    else if (b.action === "approve") {
      // Explicit owner approval of new debt or of a stake (locks NEAR) for one step; the wallet still signs separately.
      const a = plan.approvals.find((x) => x.stepId === b.stepId && (x.kind === "new_debt" || x.kind === "stake"));
      if (!a) throw new Error("This step has no new-debt or stake approval to grant.");
      grantApproval(plan, b.stepId);
    } else if (b.action === "handoff") grantApproval(plan, b.stepId);
    else if (b.action === "check") ledger = await reconcile(r, s, plan);
    else {
      const ctx = { request: r, sessionId: s.id, workspace: s.workspace, revision: s.revision };
      ledger = (await executePrepare(plan, b.stepId, ctx, planContext(s.workspace, s.revision))).ledger;
      const after = await session(r);
      rebase(plan, planContext(after.workspace, after.revision));
      const step = plan.steps.find((x) => x.id === b.stepId);
      if (step?.attemptId?.startsWith("leg:") && step.state === "prepared") preparation = await legPreparation(s.id, step.attemptId, plan.accountId); // Stream A: funding leg
      else if (step?.attemptId && step.state === "prepared") {
        const { attempt } = await readAttempt(s.id, step.attemptId);
        preparation = { ...attempt.preparation, kind: attempt.kind, attemptId: attempt.id };
      }
    }
    settle(plan);
    await planSave(s.id, plan, previous);
    await ledgerOutbox(s.id, plan.id, ledger);
    return json({ plan, preparation }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
