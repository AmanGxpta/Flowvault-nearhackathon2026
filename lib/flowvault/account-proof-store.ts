// One-time ownership challenges (owner: Interface, multi-wallet A3). Stored in D1 per session, consumed on the
// first verification attempt (success or failure), expired after ten minutes.
import type { Challenge } from "./account-proof.ts";
import { rpc } from "./near.ts";

export const PROOF_TABLES = [
  `CREATE TABLE IF NOT EXISTS account_challenges (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
];

async function db() {
  const { database } = await import("./store");
  const d = await database();
  for (const sql of PROOF_TABLES) await d.prepare(sql).run();
  return d;
}

export async function saveChallenge(sessionId: string, c: Challenge) {
  const d = await db();
  await d.prepare("DELETE FROM account_challenges WHERE expires_at < ?").bind(new Date().toISOString()).run();
  await d.prepare("INSERT INTO account_challenges (id, session_id, payload, expires_at) VALUES (?, ?, ?, ?)").bind(c.id, sessionId, JSON.stringify(c), c.expiresAt).run();
}

/** Returns the challenge and deletes it: a challenge can be answered once. */
export async function takeChallenge(sessionId: string, id: string): Promise<Challenge> {
  const d = await db();
  const row = await d.prepare("SELECT payload FROM account_challenges WHERE id = ? AND session_id = ?").bind(id, sessionId).first<{ payload: string }>();
  if (!row) throw new Error("This sign-in request isn’t valid any more. Try connecting again.");
  await d.prepare("DELETE FROM account_challenges WHERE id = ?").bind(id).run();
  return JSON.parse(row.payload) as Challenge;
}

/** Permission of a public key on a NEAR account at a final block; null when the key isn't on the account. */
export async function nearKeyPermission(accountId: string, publicKey: string): Promise<"FullAccess" | "FunctionCall" | null> {
  try {
    const r = await rpc({ request_type: "view_access_key", account_id: accountId, public_key: publicKey });
    if (r?.permission === "FullAccess") return "FullAccess";
    return r?.permission?.FunctionCall ? "FunctionCall" : null;
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCESS_KEY|access key .* does not exist/i.test(String(e))) return null;
    throw new Error("NEAR key check unavailable: " + String(e));
  }
}
