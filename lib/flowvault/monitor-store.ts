// Persistent, deduplicated alerts (owner: Interface). D1 in the app; the reconcile rule is pure so it is
// tested on node:sqlite with the same SQL.
import type { Alert } from "./contracts.ts";
import { GROUP, type AlertGroup, type Candidate, type Proposal } from "./monitor.ts";
import { MONITOR_TABLES, ALERT_UPSERT, ALERT_RESOLVE, ALERT_DISMISS, ALERT_LIST, RUN_UPSERT } from "./monitor-sql.ts";

/** Alert contract plus local, additive display extras (never a redefinition of the contract fields). */
export type MonitorAlert = Alert & {
  figures?: Candidate["figures"];
  proposal?: Proposal;
  /** Why no plan could be proposed (engine refusal or timeout), shown instead of a response button. */
  proposalNote?: string;
  dismissedAt?: string;
};

/**
 * Pure reconcile. Every candidate is upserted (new, refreshed or reopened). An open alert whose group was
 * evaluated this run and whose condition no longer holds is resolved. Groups that were NOT evaluated (a
 * read failed or timed out) keep their alerts exactly as they were: we never resolve what we couldn't check.
 */
export function reconcile(
  existing: MonitorAlert[],
  found: Candidate[],
  evaluated: AlertGroup[],
  now: string,
  idFor: (dedupeKey: string) => string,
) {
  const byKey = new Map(existing.map((a) => [a.dedupeKey, a]));
  const keys = new Set(found.map((c) => c.dedupeKey));
  const upserts: MonitorAlert[] = found.map((c) => {
    const prior = byKey.get(c.dedupeKey);
    const reopened = !!prior?.resolvedAt;
    const sameResponse = prior && !reopened && JSON.stringify(prior.proposal ?? null) === JSON.stringify(c.proposal ?? null);
    return {
      id: prior?.id ?? idFor(c.dedupeKey),
      dedupeKey: c.dedupeKey,
      kind: c.kind,
      severity: c.severity,
      message: c.message,
      ...(c.obligationId ? { obligationId: c.obligationId } : {}),
      ...(c.planId ? { planId: c.planId } : {}),
      // A proposal survives refreshes while the response it answers is unchanged.
      ...(sameResponse && prior?.proposedPlanId ? { proposedPlanId: prior.proposedPlanId } : {}),
      ...(sameResponse && prior?.proposalNote ? { proposalNote: prior.proposalNote } : {}),
      ...(c.figures ? { figures: c.figures } : {}),
      ...(c.proposal ? { proposal: c.proposal } : {}),
      createdAt: prior && !reopened ? prior.createdAt : now,
      ...(prior?.dismissedAt && !reopened ? { dismissedAt: prior.dismissedAt } : {}),
    };
  });
  const resolves = existing
    .filter((a) => !a.resolvedAt && !keys.has(a.dedupeKey) && evaluated.includes(GROUP[a.kind]))
    .map((a) => ({ ...a, resolvedAt: now }));
  return { upserts, resolves };
}

async function db() {
  const { database } = await import("./store");
  const d = await database();
  for (const sql of MONITOR_TABLES) await d.prepare(sql).run();
  return d;
}

export async function listAlerts(sessionId: string, limit = 100): Promise<MonitorAlert[]> {
  const d = await db();
  const rows = await d.prepare(ALERT_LIST).bind(sessionId, limit).all<{ payload: string; resolved_at: string | null; dismissed_at: string | null }>();
  return rows.results.map((r) => ({
    ...(JSON.parse(r.payload) as MonitorAlert),
    ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
    ...(r.dismissed_at ? { dismissedAt: r.dismissed_at } : {}),
  }));
}

export async function saveAlerts(sessionId: string, r: ReturnType<typeof reconcile>) {
  const d = await db();
  const stmts = [
    ...r.upserts.map((a) => d.prepare(ALERT_UPSERT).bind(a.id, sessionId, a.dedupeKey, JSON.stringify(strip(a)), a.createdAt)),
    ...r.resolves.map((a) => d.prepare(ALERT_RESOLVE).bind(a.resolvedAt!, JSON.stringify(strip(a)), sessionId, a.dedupeKey)),
  ];
  if (stmts.length) await d.batch(stmts);
}

/** Row columns own resolution and dismissal; the payload carries the contract fields and display extras. */
function strip(a: MonitorAlert) {
  const rest = { ...a };
  delete rest.dismissedAt;
  delete rest.resolvedAt;
  return rest;
}

export async function updateAlert(sessionId: string, a: MonitorAlert) {
  const d = await db();
  await d.prepare("UPDATE alerts SET payload = ? WHERE session_id = ? AND id = ?").bind(JSON.stringify(strip(a)), sessionId, a.id).run();
}

export async function dismissAlert(sessionId: string, id: string) {
  const d = await db();
  const r = await d.prepare(ALERT_DISMISS).bind(new Date().toISOString(), sessionId, id).run();
  if (r.meta.changes !== 1) throw new Error("Alert not found or already dismissed.");
}

export interface RunSummary {
  checkedAt: string;
  trigger: "read" | "manual" | "cron";
  evaluated: AlertGroup[];
  skipped: { group: string; reason: string }[];
}
export async function lastRun(sessionId: string): Promise<RunSummary | null> {
  const d = await db();
  const row = await d.prepare("SELECT summary FROM monitor_runs WHERE session_id = ?").bind(sessionId).first<{ summary: string }>();
  return row ? (JSON.parse(row.summary) as RunSummary) : null;
}
export async function saveRun(sessionId: string, run: RunSummary) {
  const d = await db();
  await d.prepare(RUN_UPSERT).bind(sessionId, run.checkedAt, run.trigger, JSON.stringify(run)).run();
}
