// Funding mesh ↔ action plans (owner: Stream A). Adds multi-source alternatives to plans that need USDC in the
// NEAR account (pay a dated payment, free up cash), and freezes the chosen sources onto the plan at review so
// review and execution use exactly the sources that were explained. plans-service.ts calls these two functions.
import type { ActionPlan, FundingChoice, MultiSourceFunding, PlanStep, StepKind } from "./contracts";
import type { Workspace, Portfolio } from "./types";
import { workspacePortfolio } from "./portfolio-service";
import { planList } from "./plans-store";
import { readPriceEvidence } from "./valuation-evidence";
import { accountReservations, executionCapabilities } from "./capabilities";
import { evaluateMesh, gasObservations } from "./funding-mesh-live";
import { meshChoice, wireLegSteps } from "./funding-mesh";
import { NETWORK_NAME } from "./capabilities";
import { decimal } from "./money";

export interface MeshPlanExtras {
  /** Per offered multi-source alternative, the sources and why (before review). */
  fundingOptions?: Record<string, MultiSourceFunding>;
  /** The reviewed sources: frozen at review, used by every fund_transfer step. */
  funding?: MultiSourceFunding;
}

/** Everything the capability builder needs, read once. */
export async function capabilitySnapshot(s: { id: string; workspace: Workspace }, portfolio?: Portfolio) {
  const w = s.workspace;
  const [p, plans] = await Promise.all([portfolio ? Promise.resolve(portfolio) : workspacePortfolio(w).then((r) => r.portfolio as Portfolio), planList(s.id, 50).catch(() => [])]);
  const reservations = accountReservations(plans.map((r) => r.plan as ActionPlan & MeshPlanExtras));
  const networks = (w.accounts ?? []).flatMap((a) => a.networks) as Parameters<typeof gasObservations>[0];
  const gas = await gasObservations(networks);
  const capabilities = executionCapabilities({ accounts: w.accounts ?? [], positions: p.positions, sections: p.sections, reservations, gas, source: w.mode === "demo" ? "demo" : "live" });
  return { capabilities, reservations, portfolio: p };
}

/**
 * Multi-source alternatives for a plan needing `requiredRaw` USDC in the NEAR account, which has `idleRaw` free.
 * Live workspaces only (the example workspace's accounts are fictional and can't sign). A failed read becomes a
 * named reason on a blocked alternative, never a guessed figure.
 */
export async function meshAlternatives(
  s: { id: string; workspace: Workspace },
  i: { requiredRaw: bigint; idleRaw: bigint; settleSteps: StepKind[]; common: string[] },
): Promise<{ choices: FundingChoice[]; options: Record<string, MultiSourceFunding>; figures: { label: string; value: string | null; engine: string }[] }> {
  const w = s.workspace;
  if (w.mode !== "live" || !w.accountId || i.requiredRaw <= i.idleRaw) return { choices: [], options: {}, figures: [] };
  const blocked = (reason: string): FundingChoice => ({
    id: "mesh:other-accounts", kind: "multi_source", eligible: false, reasons: [reason], amountUsdcRaw: "0", costsUsdcRaw: null,
    foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps: [],
  });
  try {
    const [{ capabilities }, prices] = await Promise.all([capabilitySnapshot(s), readPriceEvidence().catch(() => null)]);
    const ev = await evaluateMesh({ to: w.accountId, requiredRaw: i.requiredRaw, idleRaw: i.idleRaw, capabilities, prices });
    if (ev.reasons.length) return { choices: [blocked(ev.reasons[0])], options: {}, figures: [] };
    const choices = ev.offered.map((id) => meshChoice(ev.sets.find((x) => x.choiceId === id)!, i.settleSteps, i.common));
    if (!choices.length) {
      const best = ev.sets.find((x) => x.mode === "mixed") ?? ev.sets[0];
      return { choices: [blocked(best?.reasons[0] ?? "NO_OTHER_ACCOUNTS: no other account can cover it")], options: {}, figures: [] };
    }
    const need = i.requiredRaw - i.idleRaw;
    return {
      choices,
      options: ev.funding,
      figures: [{ label: "Needed from your other accounts (USDC)", value: decimal(need), engine: "fundingMesh" }],
    };
  } catch (e) {
    return { choices: [blocked("READ_FAILED: " + (e instanceof Error ? e.message : String(e)))], options: {}, figures: [] };
  }
}

/**
 * Review of a multi-source choice: freezes its sources onto the plan, builds the steps with `build` (the normal
 * review), then wires the legs (independent, each signed by its own source wallet; the settle steps wait for all).
 */
export function reviewMesh<P extends ActionPlan & MeshPlanExtras>(plan: P, choiceId: string, build: () => P): P {
  const f = plan.fundingOptions?.[choiceId];
  if (!f) throw new Error("These sources are no longer on the plan. Ask again for fresh figures.");
  plan.funding = f;
  build();
  wireLegSteps(plan.steps as PlanStep[], f);
  const moving = f.legs.filter((l) => l.operation === "oneclick_deposit");
  plan.effects = {
    ...plan.effects,
    costsUsdcRaw: plan.effects.costsUsdcRaw === null || f.costsUsdcRaw === null ? null : (BigInt(plan.effects.costsUsdcRaw) + BigInt(f.costsUsdcRaw)).toString(),
    exposure: [
      ...plan.effects.exposure,
      ...moving.map((l) => ({ asset: `USDC · ${NETWORK_NAME[l.network]} ${l.address.slice(0, 6)}…${l.address.slice(-4)}`, deltaRaw: "-" + l.amountRaw, decimals: 6 })),
      { asset: "USDC arriving in your NEAR account (at least)", deltaRaw: moving.reduce((n, l) => n + BigInt(l.minNetRaw), 0n).toString(), decimals: 6 },
    ],
  };
  return plan;
}
