// Supply flows persist per workspace row, like staking flows and the journals they point to, so they follow the
// account and can be reopened from any browser signed in to it.
import { database } from "./store";
import type { SupplyFlow } from "./supply-flow";

const TABLE = "CREATE TABLE IF NOT EXISTS supply_flows (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL)";
async function db() { const d = await database(); await d.prepare(TABLE).run(); return d; }
export async function supplyFlowList(sessionId: string, limit = 20) {
  const r = await (await db()).prepare("SELECT payload FROM supply_flows WHERE session_id=? ORDER BY updated_at DESC LIMIT ?").bind(sessionId, limit).all<{ payload: string }>();
  return r.results.map((x) => JSON.parse(x.payload) as SupplyFlow);
}
export async function supplyFlowGet(sessionId: string, id: string) {
  const r = await (await db()).prepare("SELECT payload FROM supply_flows WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string }>();
  return r ? (JSON.parse(r.payload) as SupplyFlow) : null;
}
export async function supplyFlowPut(sessionId: string, f: SupplyFlow) {
  f.updatedAt = new Date().toISOString();
  await (await db()).prepare("INSERT INTO supply_flows (id, session_id, updated_at, payload) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at WHERE supply_flows.session_id=excluded.session_id").bind(f.id, sessionId, Date.now(), JSON.stringify(f)).run();
  return f;
}
