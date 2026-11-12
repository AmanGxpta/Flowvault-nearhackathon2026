// Mandate store (owner: Stream C). D1, workspace-scoped (session_id = workspace row id, like action plans),
// compare-and-set on revision, append-only audit with deterministic ids.
import type { AgentMandate, MandateAuditEntry } from "./contracts";
import {
  MANDATE_TABLES, MANDATE_INSERT, MANDATE_CAS, MANDATE_GET, MANDATE_LIST, MANDATE_DUE,
  AUDIT_APPEND, AUDIT_LIST, KILL_SET, KILL_GET,
} from "./mandate-sql";

async function db() {
  const { database } = await import("./store");
  const d = await database();
  for (const sql of MANDATE_TABLES) await d.prepare(sql).run();
  return d;
}

export interface StoredMandate {
  mandate: AgentMandate;
  revision: number;
}

export async function mandateInsert(sessionId: string, m: AgentMandate) {
  const d = await db();
  await d.prepare(MANDATE_INSERT).bind(m.id, sessionId, JSON.stringify(m), m.state, m.schedule.nextRunAt, m.updatedAt).run();
  return { mandate: m, revision: 0 };
}
export async function mandateGet(sessionId: string, id: string): Promise<StoredMandate | null> {
  const d = await db();
  const row = await d.prepare(MANDATE_GET).bind(id, sessionId).first<{ payload: string; revision: number }>();
  return row ? { mandate: JSON.parse(row.payload) as AgentMandate, revision: Number(row.revision) } : null;
}
export async function mandateList(sessionId: string, limit = 50): Promise<StoredMandate[]> {
  const d = await db();
  const rows = await d.prepare(MANDATE_LIST).bind(sessionId, limit).all<{ payload: string; revision: number }>();
  return rows.results.map((r) => ({ mandate: JSON.parse(r.payload) as AgentMandate, revision: Number(r.revision) }));
}
/** Saves only if nobody else changed the mandate since `revision`; returns the new revision. */
export async function mandateSave(sessionId: string, m: AgentMandate, revision: number) {
  const d = await db();
  const r = await d.prepare(MANDATE_CAS).bind(JSON.stringify(m), m.state, m.schedule.nextRunAt, m.updatedAt, m.id, sessionId, revision).run();
  if (r.meta.changes !== 1) throw new Error("This mandate changed elsewhere (another tab or a scheduled run). Refresh and try again.");
  return revision + 1;
}
export async function mandatesDue(nowIso: string, limit = 50) {
  const d = await db();
  const rows = await d.prepare(MANDATE_DUE).bind(nowIso, limit).all<{ id: string; session_id: string; revision: number }>();
  return rows.results;
}

export async function auditAppend(sessionId: string, entries: MandateAuditEntry[]) {
  if (!entries.length) return;
  const d = await db();
  await d.batch(entries.map((e) => d.prepare(AUDIT_APPEND).bind(e.id, sessionId, e.mandateId, e.at, e.phase, JSON.stringify(e))));
}
export async function auditList(sessionId: string, mandateId: string, limit = 500): Promise<MandateAuditEntry[]> {
  const d = await db();
  const rows = await d.prepare(AUDIT_LIST).bind(sessionId, mandateId, limit).all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as MandateAuditEntry);
}

export async function killSwitch(sessionId: string): Promise<string | null> {
  const d = await db();
  const row = await d.prepare(KILL_GET).bind(sessionId).first<{ kill_switch_at: string | null }>();
  return row?.kill_switch_at ?? null;
}
export async function setKillSwitch(sessionId: string, on: boolean, at: string) {
  const d = await db();
  await d.prepare(KILL_SET).bind(sessionId, on ? at : null, at).run();
}
