// Mandate persistence SQL (owner: Stream C). Pure strings so the rules are tested on node:sqlite.
// mandates: one row per mandate, compare-and-set on revision (a scheduled run claims a mandate by bumping it).
// mandate_audit: append-only; ids are deterministic so a retried run never writes the same event twice.
// mandate_controls: the account-wide kill switch.
export const MANDATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS mandates (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    state TEXT NOT NULL,
    next_run_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mandates_due ON mandates (state, next_run_at)`,
  `CREATE TABLE IF NOT EXISTS mandate_audit (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    mandate_id TEXT NOT NULL,
    at TEXT NOT NULL,
    phase TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mandate_audit_by ON mandate_audit (session_id, mandate_id, at)`,
  `CREATE TABLE IF NOT EXISTS mandate_controls (
    session_id TEXT PRIMARY KEY,
    kill_switch_at TEXT,
    updated_at TEXT NOT NULL
  )`,
];
export const MANDATE_INSERT = `INSERT INTO mandates (id, session_id, payload, state, next_run_at, revision, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)`;
/** Compare-and-set: changes exactly one row only when the revision is unchanged. */
export const MANDATE_CAS = `UPDATE mandates SET payload = ?, state = ?, next_run_at = ?, updated_at = ?, revision = revision + 1
  WHERE id = ? AND session_id = ? AND revision = ?`;
export const MANDATE_GET = `SELECT payload, revision FROM mandates WHERE id = ? AND session_id = ?`;
export const MANDATE_LIST = `SELECT payload, revision FROM mandates WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?`;
export const MANDATE_DUE = `SELECT id, session_id, revision FROM mandates WHERE state = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`;
/** Append-only: a duplicate id is ignored, never overwritten. */
export const AUDIT_APPEND = `INSERT OR IGNORE INTO mandate_audit (id, session_id, mandate_id, at, phase, payload) VALUES (?, ?, ?, ?, ?, ?)`;
export const AUDIT_LIST = `SELECT payload FROM mandate_audit WHERE session_id = ? AND mandate_id = ? ORDER BY at, id LIMIT ?`;
export const KILL_SET = `INSERT INTO mandate_controls (session_id, kill_switch_at, updated_at) VALUES (?, ?, ?)
  ON CONFLICT (session_id) DO UPDATE SET kill_switch_at = excluded.kill_switch_at, updated_at = excluded.updated_at`;
export const KILL_GET = `SELECT kill_switch_at FROM mandate_controls WHERE session_id = ?`;
