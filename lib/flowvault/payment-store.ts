import { PAY_CANCEL_GUARD } from "./journal-sql";
import { attemptsDb } from "./attempts";
import { database } from "./store";
import type { PaymentPlan } from "./payments";
async function db() {
  const d = await database();
  await d
    .prepare(
      "CREATE TABLE IF NOT EXISTS payment_plans(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,obligation_id TEXT NOT NULL,payload TEXT NOT NULL)",
    )
    .run();
  await d
    .prepare(
      "CREATE TABLE IF NOT EXISTS destination_claims(proof_id TEXT PRIMARY KEY,payment_id TEXT NOT NULL)",
    )
    .run();
  await d
    .prepare(
      "CREATE TABLE IF NOT EXISTS payment_locks(session_id TEXT,obligation_id TEXT,payment_id TEXT,PRIMARY KEY(session_id,obligation_id))",
    )
    .run();
  return d;
}
export async function paymentGet(sessionId: string, id: string) {
  const d = await db();
  const r = await d
    .prepare("SELECT payload FROM payment_plans WHERE id=? AND session_id=?")
    .bind(id, sessionId)
    .first<{ payload: string }>();
  if (!r) throw new Error("Payment plan not found in this session.");
  return { plan: JSON.parse(r.payload) as PaymentPlan, previous: r.payload };
}
export async function paymentList(sessionId: string) {
  const d = await db();
  const r = await d
    .prepare(
      "SELECT payload FROM payment_plans WHERE session_id=? ORDER BY rowid DESC LIMIT 100",
    )
    .bind(sessionId)
    .all<{ payload: string }>();
  return r.results.map((x) => JSON.parse(x.payload) as PaymentPlan);
}
export async function paymentInsert(sessionId: string, p: PaymentPlan) {
  const d = await db();
  await d.batch([
    d
      .prepare(
        "INSERT OR IGNORE INTO payment_locks(session_id,obligation_id,payment_id) VALUES(?,?,?)",
      )
      .bind(sessionId, p.obligationId, p.id),
    d
      .prepare(
        "INSERT OR IGNORE INTO payment_plans(id,session_id,obligation_id,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_locks WHERE session_id=? AND obligation_id=? AND payment_id=?)",
      )
      .bind(
        p.id,
        sessionId,
        p.obligationId,
        JSON.stringify(p),
        sessionId,
        p.obligationId,
        p.id,
      ),
  ]);
  const lock = await d
    .prepare(
      "SELECT payment_id FROM payment_locks WHERE session_id=? AND obligation_id=?",
    )
    .bind(sessionId, p.obligationId)
    .first<{ payment_id: string }>();
  if (lock?.payment_id !== p.id)
    throw new Error(
      "An active payment already exists for this obligation. Recover or cancel it before replanning.",
    );
  return (await paymentGet(sessionId, p.id)).plan;
}
export async function releasePaymentLock(sessionId: string, p: PaymentPlan) {
  const d = await db();
  await d
    .prepare(
      "DELETE FROM payment_locks WHERE session_id=? AND obligation_id=? AND payment_id=?",
    )
    .bind(sessionId, p.obligationId, p.id)
    .run();
}
export async function paymentSave(
  sessionId: string,
  p: PaymentPlan,
  previous: string,
) {
  const d = await db();
  if (p.state === "cancelled") await attemptsDb();
  p.updatedAt = new Date().toISOString();
  const r = await d
    .prepare(
      "UPDATE payment_plans SET payload=? WHERE id=? AND session_id=? AND payload=?" +
        (p.state === "cancelled" ? PAY_CANCEL_GUARD : ""),
    )
    .bind(JSON.stringify(p), p.id, sessionId, previous)
    .run();
  if (r.meta.changes !== 1)
    throw new Error("Payment plan changed. Refresh before retrying.");
}
export async function claimDestination(paymentId: string, proof: any) {
  const d = await db();
  const key = JSON.stringify([
    proof.chain,
    proof.transactionHash.toLowerCase(),
    proof.logIndex,
  ]);
  await d
    .prepare(
      "INSERT OR IGNORE INTO destination_claims(proof_id,payment_id)VALUES(?,?)",
    )
    .bind(key, paymentId)
    .run();
  const row = await d
    .prepare("SELECT payment_id FROM destination_claims WHERE proof_id=?")
    .bind(key)
    .first<{ payment_id: string }>();
  if (row?.payment_id !== paymentId)
    throw new Error(
      "This destination transfer already belongs to a different payment.",
    );
}
