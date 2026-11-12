import {
  PAY_HANDOFF_GUARD,
  WORKSPACE_HANDOFF_GUARD,
  OUTGOING_HANDOFF_GUARD,
} from "./journal-sql";
import { syncTimeline } from "./timeline";
import { keyedAttemptId, assertPreparationRetry } from "./preparation-key";
import type { PreparationRequest } from "./preparation-key";
import { database } from "./store";
import type {
  WalletAttempt,
  WalletPreparation,
  PreparationKind,
} from "./execution";
export async function attemptsDb() {
  const db = await database();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS wallet_attempts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)",
    )
    .run();
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS wallet_hashes (hash TEXT PRIMARY KEY, attempt_id TEXT NOT NULL)",
    )
    .run();
  return db;
}
export async function createAttempt(
  sessionId: string,
  mandateVersion: number,
  preparation: WalletPreparation,
  kind: PreparationKind = "supply",
  key?: string,
) {
  const db = await attemptsDb();
  const attempt: WalletAttempt = {
    id: key ? await keyedAttemptId(sessionId, key) : crypto.randomUUID(),
    accountId: preparation.accountId,
    kind,
    amount: preparation.amount,
    mandateVersion,
    createdAt: new Date().toISOString(),
    expiresAt: preparation.expiresAt,
    state: "prepared",
    preparation,
    retainedSignedQuote:
      kind === "pay" && "retainedSignedQuote" in preparation
        ? preparation.retainedSignedQuote
        : undefined,
    hashes: [],
    message: "Prepared for review. Nothing submitted.",
    updatedAt: new Date().toISOString(),
  };
  syncTimeline(attempt);
  await db
    .prepare(
      "INSERT OR IGNORE INTO wallet_attempts (id,session_id,payload) VALUES (?,?,?)",
    )
    .bind(attempt.id, sessionId, JSON.stringify(attempt))
    .run();
  const persisted = (await readAttempt(sessionId, attempt.id)).attempt;
  assertPreparationRetry(persisted, {
    kind,
    accountId: preparation.accountId,
    mandateVersion,
    amount: preparation.amount,
  });
  return persisted;
}
export async function preparationRetry(
  sessionId: string,
  key: string,
  request: PreparationRequest,
) {
  const db = await attemptsDb();
  const id = await keyedAttemptId(sessionId, key);
  const row = await db
    .prepare("SELECT payload FROM wallet_attempts WHERE id=? AND session_id=?")
    .bind(id, sessionId)
    .first<{ payload: string }>();
  if (!row) return null;
  const attempt = JSON.parse(row.payload) as WalletAttempt;
  assertPreparationRetry(attempt, request);
  return attempt;
}
export async function readAttempt(sessionId: string, id: string) {
  const db = await attemptsDb();
  const row = await db
    .prepare("SELECT payload FROM wallet_attempts WHERE id=? AND session_id=?")
    .bind(id, sessionId)
    .first<{ payload: string }>();
  if (!row)
    throw new Error("Transaction request not found in this browser session.");
  return {
    attempt: JSON.parse(row.payload) as WalletAttempt,
    previous: row.payload,
  };
}
export async function saveAttempt(
  sessionId: string,
  attempt: WalletAttempt,
  previous: string,
  authorizationRevision?: number,
) {
  const db = await attemptsDb();
  attempt.updatedAt = new Date().toISOString();
  syncTimeline(attempt, JSON.parse(previous));
  const handoff =
    attempt.state === "awaiting_wallet" &&
    JSON.parse(previous).state === "prepared";
  if (handoff && authorizationRevision === undefined)
    throw new Error("Wallet handoff requires a workspace revision.");
  const payHandoff = handoff && attempt.kind === "pay";
  const outgoing = handoff && attempt.kind !== "withdraw";
  const r = await db
    .prepare(
      "UPDATE wallet_attempts SET payload=? WHERE id=? AND session_id=? AND payload=?" +
        (outgoing ? OUTGOING_HANDOFF_GUARD : "") +
        (payHandoff ? PAY_HANDOFF_GUARD : "") +
        (handoff ? WORKSPACE_HANDOFF_GUARD : ""),
    )
    .bind(
      JSON.stringify(attempt),
      attempt.id,
      sessionId,
      previous,
      ...(outgoing ? [sessionId, attempt.id, attempt.accountId] : []),
      ...(payHandoff
        ? [
            (attempt.preparation as import("./payments").PayPreparation)
              .paymentId,
            sessionId,
            attempt.id,
          ]
        : []),
      ...(handoff ? [sessionId, authorizationRevision] : []),
    )
    .run();
  if (r.meta.changes !== 1)
    throw new Error("Transaction request changed. Refresh its status.");
}
export async function listAttempts(sessionId: string) {
  const db = await attemptsDb();
  const rows = await db
    .prepare(
      "SELECT payload FROM wallet_attempts WHERE session_id=? ORDER BY rowid DESC LIMIT 40",
    )
    .bind(sessionId)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as WalletAttempt);
}

/** Active commitments must not disappear behind the recent-history UI page limit. */
export async function listActiveAttempts(sessionId: string) {
  const db = await attemptsDb();
  const rows = await db
    .prepare(
      "SELECT payload FROM wallet_attempts WHERE session_id=? AND json_extract(payload,'$.state') IN ('awaiting_wallet','submitted','unknown','partial')",
    )
    .bind(sessionId)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as WalletAttempt);
}
