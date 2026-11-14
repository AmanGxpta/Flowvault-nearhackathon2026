// Watchlists (D1), one row per workspace: a signed-in account's workspace is the same on every device, so the list
// follows the account. Each change reads the stored list, applies one operation and writes it back.
import { database } from "./store";
import { applyWatchOp, cleanWatchlist, emptyWatchlist, type Watchlist, type WatchOp } from "./watchlist";

const TABLE = "CREATE TABLE IF NOT EXISTS watchlists (workspace_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, payload TEXT NOT NULL)";
async function db() { const d = await database(); await d.prepare(TABLE).run(); return d; }

export async function watchlistGet(workspaceId: string): Promise<{ watchlist: Watchlist; updatedAt: number | null }> {
  const r = await (await db()).prepare("SELECT payload, updated_at FROM watchlists WHERE workspace_id=?").bind(workspaceId).first<{ payload: string; updated_at: number }>();
  return r ? { watchlist: cleanWatchlist(JSON.parse(r.payload)), updatedAt: r.updated_at } : { watchlist: emptyWatchlist(), updatedAt: null };
}
export async function watchlistApply(workspaceId: string, op: WatchOp) {
  const { watchlist } = await watchlistGet(workspaceId);
  const next = applyWatchOp(watchlist, op), at = Date.now();
  await (await db()).prepare("INSERT INTO watchlists (workspace_id, updated_at, payload) VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload")
    .bind(workspaceId, at, JSON.stringify(next)).run();
  return { watchlist: next, updatedAt: at };
}
