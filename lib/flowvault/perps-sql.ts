// Perps persistence SQL (owner: Stream C). perp_links: one agent link per (workspace, master). perp_orders: the
// order journal; the client order id (cloid) is the primary key, so a retried request never places a second order.
export const PERP_TABLES = [
  `CREATE TABLE IF NOT EXISTS perp_links (
    session_id TEXT NOT NULL,
    master TEXT NOT NULL,
    payload TEXT NOT NULL,
    sealed_key TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, master)
  )`,
  `CREATE TABLE IF NOT EXISTS perp_orders (
    cloid TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    master TEXT NOT NULL,
    state TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS perp_orders_by ON perp_orders (session_id, master, created_at)`,
];
export const LINK_UPSERT = `INSERT INTO perp_links (session_id, master, payload, sealed_key, revision) VALUES (?, ?, ?, ?, 0)
  ON CONFLICT (session_id, master) DO UPDATE SET payload = excluded.payload, sealed_key = excluded.sealed_key, revision = perp_links.revision + 1
  WHERE perp_links.revision = ?`;
export const LINK_GET = `SELECT payload, sealed_key, revision FROM perp_links WHERE session_id = ? AND master = ?`;
export const LINK_LIST = `SELECT payload, revision FROM perp_links WHERE session_id = ?`;
/** Journal insert: a duplicate cloid inserts nothing (the caller then reads the existing row). */
export const ORDER_INSERT = `INSERT OR IGNORE INTO perp_orders (cloid, session_id, master, state, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
/** State moves only forward from the state the caller read (compare-and-set). */
export const ORDER_ADVANCE = `UPDATE perp_orders SET state = ?, payload = ? WHERE cloid = ? AND session_id = ? AND state = ?`;
export const ORDER_GET = `SELECT payload FROM perp_orders WHERE cloid = ? AND session_id = ?`;
export const ORDER_LIST = `SELECT payload FROM perp_orders WHERE session_id = ? AND master = ? ORDER BY created_at DESC LIMIT ?`;
export const ORDER_OPEN = `SELECT payload FROM perp_orders WHERE session_id = ? AND state IN ('prepared', 'submitted', 'unknown')`;
