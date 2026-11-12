// Action plans (owner: Interface). Plans orchestrate; existing journals prepare, sign-gate and verify.
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { planGet, planIdFor, planInsert, planList, planSave } from "@/lib/flowvault/plans-store";
import { applyExpiry, applyFence, assertSameIntent, isTerminal, planContext, settle } from "@/lib/flowvault/plans";
import { evaluatePlan } from "@/lib/flowvault/plans-service";
import { registeredKinds } from "@/lib/flowvault/step-adapters";

export async function GET(r: Request) {
  try {
    const s = await session(r);
    const active = new URL(r.url).searchParams.get("active") === "1";
    const ctx = planContext(s.workspace, s.revision);
    const plans = [];
    for (const { plan, previous } of await planList(s.id)) {
      // Reads apply only clock and fence rules; journal reconciliation happens on GET /api/plans/:id.
      applyExpiry(plan);
      applyFence(plan, ctx);
      settle(plan);
      try {
        await planSave(s.id, plan, previous);
      } catch {
        /* Another tab advanced it; the next read shows that version. */
      }
      if (!active || !isTerminal(plan) || plan.steps.some((x) => ["awaiting_wallet", "submitted", "unknown", "partial"].includes(x.state)))
        plans.push(plan);
    }
    return json({ source: s.workspace.mode, fictional: s.workspace.mode === "demo", plans, adapters: registeredKinds(), context: ctx }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const createSchema = z
  .object({
    key: z.string().uuid(),
    objective: z.enum(["deploy_surplus", "pay_obligation", "borrow", "repay", "respond_to_change", "access_cash"]),
    obligationId: z.string().min(1).max(100).optional(),
    amountRaw: z.string().regex(/^[1-9]\d{0,30}$/).optional(),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    label: z.string().max(100).optional(),
    text: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = createSchema.parse(await r.json());
    const s = await session(r);
    const id = await planIdFor(s.id, b.key);
    const existing = await planGet(s.id, id);
    if (existing) {
      assertSameIntent(existing.plan, b.objective, { ...existing.plan.request, obligationId: b.obligationId, ...(b.amountRaw ? { amountRaw: b.amountRaw } : {}) }, s.workspace.mode);
      return json({ plan: existing.plan, replay: true }, s.cookie);
    }
    const plan = await evaluatePlan(s, id, { ...b, createdBy: "user" });
    const current = await session(r);
    if (current.revision !== s.revision) throw new Error("Workspace changed while the plan was evaluated. Try again.");
    try {
      return json({ plan: await planInsert(s.id, plan) }, s.cookie);
    } catch (e) {
      const activePlanId = (e as { activePlanId?: string }).activePlanId;
      if (activePlanId) return json({ error: (e as Error).message, activePlanId }, s.cookie, 409);
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
