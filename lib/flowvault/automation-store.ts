// Automations storage (D1), per workspace row like the journals: the automations themselves and the events they
// write (briefs, alerts, proposals). `next_run_at` lets the cron pick due ones without reading every payload.
import { database } from "./store";
import type { Automation, AutomationEvent } from "./automations";

const TABLES = [
  "CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, enabled INTEGER NOT NULL, next_run_at INTEGER, payload TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS automation_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, automation_id TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL)",
];
async function db() { const d = await database(); for (const t of TABLES) await d.prepare(t).run(); return d; }

export async function automationList(sessionId: string) {
  const r = await (await db()).prepare("SELECT payload FROM automations WHERE session_id=? ORDER BY rowid").bind(sessionId).all<{ payload: string }>();
  return r.results.map((x) => JSON.parse(x.payload) as Automation);
}
export async function automationGet(sessionId: string, id: string) {
  const r = await (await db()).prepare("SELECT payload FROM automations WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string }>();
  return r ? (JSON.parse(r.payload) as Automation) : null;
}
export async function automationPut(sessionId: string, a: Automation) {
  await (await db()).prepare("INSERT INTO automations (id, session_id, enabled, next_run_at, payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, next_run_at=excluded.next_run_at, payload=excluded.payload WHERE automations.session_id=excluded.session_id")
    .bind(a.id, sessionId, a.enabled ? 1 : 0, a.nextRunAt ? Date.parse(a.nextRunAt) : null, JSON.stringify(a)).run();
  return a;
}
export async function automationDelete(sessionId: string, id: string) {
  await (await db()).prepare("DELETE FROM automations WHERE id=? AND session_id=?").bind(id, sessionId).run();
}
/** Due automations across all workspaces (cron). */
export async function automationsDue(now: number, limit = 50) {
  const r = await (await db()).prepare("SELECT session_id, payload FROM automations WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?").bind(now, limit).all<{ session_id: string; payload: string }>();
  return r.results.map((x) => ({ sessionId: x.session_id, automation: JSON.parse(x.payload) as Automation }));
}
export async function eventAdd(sessionId: string, e: AutomationEvent) {
  await (await db()).prepare("INSERT INTO automation_events (id, session_id, automation_id, created_at, status, payload) VALUES (?,?,?,?,?,?)").bind(e.id, sessionId, e.automationId, Date.parse(e.createdAt), e.status, JSON.stringify(e)).run();
  return e;
}
export async function eventList(sessionId: string, limit = 30) {
  const r = await (await db()).prepare("SELECT payload, status FROM automation_events WHERE session_id=? ORDER BY created_at DESC LIMIT ?").bind(sessionId, limit).all<{ payload: string; status: string }>();
  return r.results.map((x) => ({ ...(JSON.parse(x.payload) as AutomationEvent), status: x.status as AutomationEvent["status"] }));
}
export async function eventStatus(sessionId: string, id: string, status: AutomationEvent["status"]) {
  const d = await db();
  const row = await d.prepare("SELECT payload FROM automation_events WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string }>();
  if (!row) throw new Error("That item isn't here any more.");
  const e = { ...(JSON.parse(row.payload) as AutomationEvent), status };
  await d.prepare("UPDATE automation_events SET status=?, payload=? WHERE id=? AND session_id=?").bind(status, JSON.stringify(e), id, sessionId).run();
  return e;
}

/** Claims a due run: moves next_run_at forward only if nobody else has (compare-and-set), so overlapping cron runs
 * and app opens never run one automation twice. */
export async function automationClaim(sessionId: string, a: Automation, now: number) {
  const { nextRun } = await import("./automations");
  const was = a.nextRunAt ? Date.parse(a.nextRunAt) : null;
  if (was === null) return false;
  const r = await (await db()).prepare("UPDATE automations SET next_run_at=? WHERE id=? AND session_id=? AND next_run_at=?").bind(nextRun(a, now), a.id, sessionId, was).run();
  return (r.meta?.changes ?? 0) > 0;
}
