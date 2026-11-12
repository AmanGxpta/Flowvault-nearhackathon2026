// Durable action-plan store (owner: Interface). D1, session-scoped, idempotent and compare-and-swap.
import { database } from "./store";
import { keyedAttemptId } from "./preparation-key";
import { PLAN_TABLES, PLAN_LOCK, PLAN_INSERT, PLAN_SAVE, PLAN_UNLOCK, LEDGER_OUTBOX } from "./plans-sql";
import { isTerminal, planTarget } from "./plans";
import type { ActionPlan, LedgerEntry } from "./contracts";

async function db() {
  const d = await database();
  for (const sql of PLAN_TABLES) await d.prepare(sql).run();
  return d;
}

export function planIdFor(sessionId: string, key: string) {
  return keyedAttemptId(sessionId, "plan:" + key);
}

export async function planGet(sessionId: string, id: string) {
  const d = await db();
  const row = await d
    .prepare("SELECT payload FROM action_plans WHERE id = ? AND session_id = ?")
    .bind(id, sessionId)
    .first<{ payload: string }>();
  if (!row) return null;
  return { plan: JSON.parse(row.payload) as ActionPlan, previous: row.payload };
}

export async function planList(sessionId: string, limit = 30) {
  const d = await db();
  const rows = await d
    .prepare("SELECT payload FROM action_plans WHERE session_id = ? ORDER BY rowid DESC LIMIT ?")
    .bind(sessionId, limit)
    .all<{ payload: string }>();
  return rows.results.map((r) => ({ plan: JSON.parse(r.payload) as ActionPlan, previous: r.payload }));
}

/** Inserts under the target lock. A stale lock held by a finished plan is released and retried once. */
export async function planInsert(sessionId: string, plan: ActionPlan) {
  const d = await db();
  const target = planTarget(plan.objective, plan.request);
  for (let attempt = 0; attempt < 2; attempt++) {
    await d.batch([
      d.prepare(PLAN_LOCK).bind(sessionId, target, plan.id),
      d.prepare(PLAN_INSERT).bind(plan.id, sessionId, plan.key, JSON.stringify(plan), sessionId, target, plan.id),
    ]);
    const lock = await d
      .prepare("SELECT plan_id FROM plan_locks WHERE session_id = ? AND target = ?")
      .bind(sessionId, target)
      .first<{ plan_id: string }>();
    if (lock?.plan_id === plan.id) return (await planGet(sessionId, plan.id))!.plan;
    const holder = lock ? await planGet(sessionId, lock.plan_id) : null;
    if (holder && !isTerminal(holder.plan))
      throw Object.assign(
        new Error("An active plan already exists for this request. Continue or cancel it first."),
        { activePlanId: holder.plan.id },
      );
    if (lock) await d.prepare(PLAN_UNLOCK).bind(sessionId, target, lock.plan_id).run();
  }
  throw new Error("Plan lock changed concurrently. Try again.");
}

export async function planSave(sessionId: string, plan: ActionPlan, previous: string) {
  const d = await db();
  const payload = JSON.stringify(plan);
  if (payload === previous) return payload;
  const r = await d.prepare(PLAN_SAVE).bind(payload, plan.id, sessionId, previous).run();
  if (r.meta.changes !== 1) throw new Error("This plan changed in another tab. Refresh it before continuing.");
  if (isTerminal(plan))
    await d.prepare(PLAN_UNLOCK).bind(sessionId, planTarget(plan.objective, plan.request), plan.id).run();
  return payload;
}

export async function ledgerOutbox(sessionId: string, planId: string, entries: LedgerEntry[]) {
  if (!entries.length) return;
  const d = await db();
  await d.batch(entries.map((e) => d.prepare(LEDGER_OUTBOX).bind(e.id, sessionId, planId, JSON.stringify(e))));
}

export async function readLedgerOutbox(sessionId: string) {
  const d = await db();
  const rows = await d
    .prepare("SELECT payload FROM plan_ledger_outbox WHERE session_id = ? ORDER BY rowid")
    .bind(sessionId)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as LedgerEntry);
}
