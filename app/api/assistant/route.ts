import { workspaceLedger } from "@/lib/flowvault/policy-context";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { assistantIntent } from "@/lib/flowvault/assistant-provider";
import { planGet, planIdFor, planInsert } from "@/lib/flowvault/plans-store";
import { evaluatePlan } from "@/lib/flowvault/plans-service";
import type { PlanObjective } from "@/lib/flowvault/contracts";
import { evaluateAssistant } from "@/lib/flowvault/assistant";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { demoMarket } from "@/lib/flowvault/seed";
import { liveMarket } from "@/lib/flowvault/near";
import { portfolioCredit } from "@/lib/flowvault/credit-live";
import { readLedger } from "@/lib/flowvault/policy-store";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" ? binding : process.env[name];
}
const STAGES = [
  { id: "understand", label: "Understand", by: "NEAR AI Cloud or the built-in parser (intent fields only)" },
  { id: "evaluate", label: "Evaluate alternatives", by: "FlowVault engines" },
  { id: "review", label: "Review", by: "You, in FlowVault" },
  { id: "authorize", label: "Authorize", by: "Your policy, checked again at preparation and wallet handoff" },
  { id: "sign", label: "Sign", by: "You, in your wallet" },
  { id: "confirm", label: "Confirm the economic result", by: "Finalized on-chain evidence" },
];

const OBJECTIVE: Partial<Record<string, PlanObjective>> = {
  allocate_surplus: "deploy_surplus",
  pay: "pay_obligation",
  borrow: "borrow",
  repay: "repay",
  respond_to_change: "respond_to_change",
};

async function savePlan(
  s: Awaited<ReturnType<typeof session>>,
  key: string,
  question: string,
  result: ReturnType<typeof evaluateAssistant>,
) {
  const objective = OBJECTIVE[result.proposal.kind];
  if (!objective) return null;
  const obligationId = (result.evaluation as { obligationId?: string | null }).obligationId ?? undefined;
  if (objective === "pay_obligation" && !obligationId)
    return { plan: null, note: "No single calendar payment matches, so no plan was saved. Add it in Calendar or name it exactly." };
  const id = await planIdFor(s.id, key);
  const existing = await planGet(s.id, id);
  if (existing) return { plan: existing.plan, note: "Same question key: showing the plan saved earlier." };
  const plan = await evaluatePlan(s, id, {
    objective,
    key,
    obligationId: objective === "respond_to_change" ? undefined : obligationId,
    label: result.proposal.recipientLabel ?? undefined,
    text: question,
    createdBy: "assistant",
  });
  try {
    return { plan: await planInsert(s.id, plan), note: null };
  } catch (e) {
    const activePlanId = (e as { activePlanId?: string }).activePlanId;
    if (!activePlanId) throw e;
    const active = await planGet(s.id, activePlanId);
    return { plan: active?.plan ?? null, note: "You already have an active plan for this. Continue or cancel it before asking for a new one." };
  }
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = z
      .object({
        question: z.string().trim().min(1).max(2000),
        useModel: z.boolean().default(true),
        /** Idempotency key for the plan this question saves; the same key returns the same plan. */
        planKey: z.string().uuid().optional(),
      })
      .strict()
      .parse(await r.json());
    const s = await session(r);
    const evidence = await withCapitalEvidence(s.workspace);
    const now = Date.now();
    // NEAR AI Cloud (NEARAI_API_KEY) when configured, else the deterministic parser.
    const intent = await assistantIntent(
      b.question,
      b.useModel ? { key: setting("NEARAI_API_KEY"), baseUrl: setting("NEARAI_BASE_URL"), model: setting("NEARAI_MODEL") } : {},
      now,
    );
    const [{ portfolio }, market, ledger] = await Promise.all([
      workspacePortfolio(s.workspace),
      s.workspace.mode === "demo" ? demoMarket(now) : liveMarket(),
      readLedger(s.id),
    ]);
    let creditCapacity: string | null = null;
    try {
      creditCapacity = (await portfolioCredit(portfolio, s.workspace.policy))
        .capacity;
    } catch {
      /* Explicit unknown, never zero. */
    }
    const current = await session(r);
    if (
      current.workspace.mode !== s.workspace.mode ||
      current.workspace.accountId !== s.workspace.accountId ||
      current.workspace.mandate.version !== s.workspace.mandate.version
    )
      throw new Error(
        "Assistant workspace changed. Ask again using the current plan.",
      );
    const result = evaluateAssistant(
      intent.proposal,
      {
        workspace: s.workspace,
        portfolio,
        market,
        ledger: workspaceLedger(s.workspace, ledger),
        creditCapacity,
        evidence,
      },
      now,
    );
    // Stage 2 of 6: the engines' evaluation is saved as an ActionPlan. Model prose never authorizes; the
    // plan still needs the owner's review, policy authorization, a wallet signature and verified results.
    const saved = b.planKey ? await savePlan(s, b.planKey, b.question, result) : null;
    return json(
      {
        ...result,
        plan: saved?.plan ?? null,
        planNote: saved?.note ?? null,
        stages: STAGES,
        provider: intent.provider,
        dataSent: intent.dataSent,
        warning: intent.warning,
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
