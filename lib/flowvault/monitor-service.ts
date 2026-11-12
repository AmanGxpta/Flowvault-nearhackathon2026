// Monitoring service (owner: Interface). Gathers the SAME engine outputs the screens use (capitalView via
// the valuation inputs, the Rhea credit capacity, plans and journals), runs the deterministic conditions in
// monitor.ts, persists deduplicated alerts and, where possible, proposes a plan (createdBy "monitor").
// A proposal is an evaluated plan only: it never reviews, approves, prepares or signs anything.
import type { ActionPlan } from "./contracts";
import type { Workspace } from "./types";
import { detect, GROUP, type CapitalInput, type CreditInput, type MonitorInput } from "./monitor";
import { reconcile, listAlerts, saveAlerts, updateAlert, lastRun, saveRun, type MonitorAlert, type RunSummary } from "./monitor-store";
import { keyedAttemptId } from "./preparation-key";
import { workspacePortfolio } from "./portfolio-service";
import { readValuationEvidence } from "./valuation-evidence";
import { capitalView, usdcInFlightRaw } from "./valuation";
import { listActiveAttempts } from "./attempts";
import { lendingPreview } from "./lending-live";
import { demoMarket } from "./seed";
import { liveMarket } from "./near";
import { planGet, planIdFor, planInsert, planList } from "./plans-store";
import { applyExpiry, applyFence, isTerminal, planContext, settle } from "./plans";
import { evaluatePlan } from "./plans-service";

export interface MonitorSession {
  id: string;
  workspace: Workspace;
  revision: number;
}

const READ_MS = 20_000;
const PROPOSE_MS = 30_000;
/** A workspace read re-runs the monitor at most this often; "check now" and cron always run. */
export const READ_THROTTLE_MS = 60_000;
const MAX_PROPOSALS = 3;
const EXIT_MARKET: Record<string, string> = { LiNEAR: "linear", rNEAR: "rnear", NEAR: "native" };

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function gatherCapital(s: MonitorSession) {
  const w = s.workspace;
  const [{ portfolio }, evidence, active] = await Promise.all([
    workspacePortfolio(w),
    readValuationEvidence(w, { quotes: false }),
    w.mode === "demo" ? Promise.resolve([]) : listActiveAttempts(s.id),
  ]);
  const stressBps = Object.fromEntries((w.policy?.creditRows ?? []).map((x) => [x.assetId, x.drawdownBps]));
  const view = capitalView(w, portfolio, evidence, { committedRaw: usdcInFlightRaw(active, portfolio.accountId), stressBps });
  return { view, portfolio };
}

async function gatherCredit(w: Workspace): Promise<CreditInput | undefined> {
  if (w.mode !== "live" || !w.accountId) return undefined; // the example has no supported debt
  const { capacity } = await lendingPreview(w.accountId, w.policy);
  const debt = (capacity as { healthDetail?: { debtUsdcRaw?: string } }).healthDetail?.debtUsdcRaw ?? "0";
  if (BigInt(debt) === 0n) return undefined;
  return { debtUsdcRaw: debt, health: capacity.health ?? null, stressedHealth: capacity.stressedHealth ?? null, minHealth: capacity.minHealth };
}

export async function monitorInput(s: MonitorSession, now = Date.now()) {
  const w = s.workspace;
  const skipped: RunSummary["skipped"] = [];
  const [cap, market, credit, stored] = await Promise.allSettled([
    within(gatherCapital(s), READ_MS, "Capital read"),
    within(w.mode === "demo" ? Promise.resolve(demoMarket()) : liveMarket(), READ_MS, "Market read"),
    within(gatherCredit(w), READ_MS, "Rhea credit read"),
    planList(s.id),
  ]);
  if (cap.status === "rejected") skipped.push({ group: "capital", reason: msg(cap.reason) });
  if (credit.status === "rejected") skipped.push({ group: "credit", reason: msg(credit.reason) });
  if (stored.status === "rejected") skipped.push({ group: "plans", reason: msg(stored.reason) });
  const ctx = planContext(w, s.revision);
  const plans: ActionPlan[] | null =
    stored.status === "fulfilled"
      ? stored.value.map(({ plan }) => {
          // Same clock and fence rules a plan read applies; the monitor never writes plans it only reads.
          applyExpiry(plan, now);
          applyFence(plan, ctx, now);
          settle(plan, now);
          return plan;
        })
      : null;
  const capital: CapitalInput | null = cap.status === "fulfilled" ? cap.value.view : null;
  const positions = cap.status === "fulfilled" ? cap.value.portfolio.positions : null;
  const exitDays: Record<string, number | null> = {};
  for (const p of positions ?? []) {
    if (p.kind !== "staking") continue;
    const m = market.status === "fulfilled" ? market.value.markets.find((x) => x.id === EXIT_MARKET[p.asset]) : undefined;
    exitDays[p.id] = m?.exitDays ?? null;
  }
  const input: MonitorInput = {
    now,
    source: w.mode,
    obligations: w.obligations,
    leadDays: w.mandate.leadDays ?? 3,
    horizonDays: w.mandate.horizon,
    capital,
    positions,
    exitDays,
    credit: credit.status === "fulfilled" ? credit.value : null,
    plans,
  };
  return { input, skipped, plans };
}

/** Proposes a plan for each open alert that has a response and none yet. Never more than a few per run. */
async function propose(s: MonitorSession, alerts: MonitorAlert[], plans: ActionPlan[] | null, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  let made = 0;
  for (const a of alerts) {
    if (!a.proposal || a.planId || a.dismissedAt || a.resolvedAt) continue;
    if (a.proposedPlanId) {
      const current = plans?.find((p) => p.id === a.proposedPlanId);
      if (!current || !isTerminal(current)) continue;
    }
    const key = `monitor:${a.dedupeKey}:${a.proposal.amountRaw ?? ""}:${day}`;
    const id = await planIdFor(s.id, key);
    if (id === a.proposedPlanId) continue; // today's proposal already ended; a fresh one comes tomorrow
    if (made >= MAX_PROPOSALS) break;
    made++;
    try {
      const existing = await planGet(s.id, id);
      if (existing) {
        a.proposedPlanId = existing.plan.id;
      } else {
        const plan = await within(
          evaluatePlan(s, id, {
            objective: a.proposal.objective,
            key,
            obligationId: a.proposal.obligationId,
            amountRaw: a.proposal.amountRaw,
            deadline: a.proposal.deadline,
            title: a.proposal.title,
            figures: a.figures,
            createdBy: "monitor",
          }),
          PROPOSE_MS,
          "Proposal",
        );
        a.proposedPlanId = (await planInsert(s.id, plan)).id;
      }
      delete a.proposalNote;
    } catch (e) {
      const active = (e as { activePlanId?: string }).activePlanId;
      if (active) a.planId = active; // an active plan already answers this: link it instead of competing
      else a.proposalNote = "No plan proposed: " + msg(e);
    }
    await updateAlert(s.id, a);
  }
}

export async function runMonitor(s: MonitorSession, trigger: RunSummary["trigger"], now = Date.now()) {
  if (trigger === "read") {
    const last = await lastRun(s.id);
    if (last && now - Date.parse(last.checkedAt) < READ_THROTTLE_MS) return { run: last, alerts: await listAlerts(s.id), ran: false };
  }
  const { input, skipped, plans } = await monitorInput(s, now);
  const found = detect(input);
  const existing = await listAlerts(s.id, 500);
  const at = new Date(now).toISOString();
  const ids = new Map<string, string>();
  for (const c of found.candidates) {
    const prior = existing.find((a) => a.dedupeKey === c.dedupeKey);
    ids.set(c.dedupeKey, prior?.id ?? (await keyedAttemptId(s.id, "alert:" + c.dedupeKey)));
  }
  const r = reconcile(existing, found.candidates, found.evaluated, at, (k) => ids.get(k)!);
  // A payment that was removed (or is no longer pending) takes its alerts with it, even when a balance read
  // failed this run: there is nothing left to warn about.
  const live = new Set((s.workspace.obligations ?? []).filter((o) => o.status === "pending" || o.status === "processing").map((o) => o.id));
  for (const a of existing)
    if (!a.resolvedAt && a.obligationId && !live.has(a.obligationId) && !r.resolves.some((x) => x.id === a.id) && !r.upserts.some((x) => x.dedupeKey === a.dedupeKey))
      r.resolves.push({ ...a, resolvedAt: at });
  await saveAlerts(s.id, r);
  await propose(s, r.upserts, plans, now);
  const run: RunSummary = { checkedAt: at, trigger, evaluated: found.evaluated, skipped };
  await saveRun(s.id, run);
  return { run, alerts: await listAlerts(s.id), ran: true };
}

/** Alerts a screen should show: open and not dismissed, most severe first. */
export function openAlerts(all: MonitorAlert[]) {
  const rank = { urgent: 0, warn: 1, info: 2 } as const;
  return all
    .filter((a) => !a.resolvedAt && !a.dismissedAt)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.createdAt.localeCompare(b.createdAt));
}

export { GROUP };
