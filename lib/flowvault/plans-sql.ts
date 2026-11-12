// SQL for the action-plan store (owner: Interface). Plain strings so tests run them on node:sqlite.
export const PLAN_TABLES = [
  "CREATE TABLE IF NOT EXISTS action_plans (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, plan_key TEXT NOT NULL, payload TEXT NOT NULL)",
  /** One active plan per target (obligation, position, or deploy-surplus intent) per session. */
  "CREATE TABLE IF NOT EXISTS plan_locks (session_id TEXT NOT NULL, target TEXT NOT NULL, plan_id TEXT NOT NULL, PRIMARY KEY (session_id, target))",
  /** Confirmed effects waiting for the Engines ledger (E3) to import them. Never inferred from UI state. */
  "CREATE TABLE IF NOT EXISTS plan_ledger_outbox (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, plan_id TEXT NOT NULL, payload TEXT NOT NULL)",
];
export const PLAN_LOCK =
  "INSERT OR IGNORE INTO plan_locks (session_id, target, plan_id) VALUES (?, ?, ?)";
/** Insert only while this plan holds the lock: a second concurrent create for the same target inserts nothing. */
export const PLAN_INSERT =
  "INSERT OR IGNORE INTO action_plans (id, session_id, plan_key, payload) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM plan_locks WHERE session_id = ? AND target = ? AND plan_id = ?)";
/** Compare-and-swap on the exact previous payload: two tabs can never both advance the same plan. */
export const PLAN_SAVE =
  "UPDATE action_plans SET payload = ? WHERE id = ? AND session_id = ? AND payload = ?";
export const PLAN_UNLOCK =
  "DELETE FROM plan_locks WHERE session_id = ? AND target = ? AND plan_id = ?";
export const LEDGER_OUTBOX =
  "INSERT OR IGNORE INTO plan_ledger_outbox (id, session_id, plan_id, payload) VALUES (?, ?, ?, ?)";
