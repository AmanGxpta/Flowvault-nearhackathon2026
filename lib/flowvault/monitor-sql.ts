// Alert persistence SQL (owner: Interface). One row per (session, dedupe key): a condition that holds
// again later reopens the same alert instead of creating a duplicate.
export const MONITOR_TABLES = [
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    dismissed_at TEXT,
    UNIQUE (session_id, dedupe_key)
  )`,
  `CREATE TABLE IF NOT EXISTS monitor_runs (
    session_id TEXT PRIMARY KEY,
    checked_at TEXT NOT NULL,
    trigger TEXT NOT NULL,
    summary TEXT NOT NULL
  )`,
];
/** Insert, or refresh the open alert's text; a resolved alert that holds again reopens (and un-dismisses). */
export const ALERT_UPSERT = `INSERT INTO alerts (id, session_id, dedupe_key, payload, created_at, resolved_at, dismissed_at)
  VALUES (?, ?, ?, ?, ?, NULL, NULL)
  ON CONFLICT (session_id, dedupe_key) DO UPDATE SET
    payload = excluded.payload,
    dismissed_at = CASE WHEN alerts.resolved_at IS NULL THEN alerts.dismissed_at ELSE NULL END,
    resolved_at = NULL`;
export const ALERT_RESOLVE = `UPDATE alerts SET resolved_at = ?, payload = ? WHERE session_id = ? AND dedupe_key = ? AND resolved_at IS NULL`;
export const ALERT_DISMISS = `UPDATE alerts SET dismissed_at = ? WHERE session_id = ? AND id = ? AND dismissed_at IS NULL`;
export const ALERT_LIST = `SELECT payload, resolved_at, dismissed_at FROM alerts WHERE session_id = ? ORDER BY created_at DESC, id LIMIT ?`;
export const RUN_UPSERT = `INSERT INTO monitor_runs (session_id, checked_at, trigger, summary) VALUES (?, ?, ?, ?)
  ON CONFLICT (session_id) DO UPDATE SET checked_at = excluded.checked_at, trigger = excluded.trigger, summary = excluded.summary`;
