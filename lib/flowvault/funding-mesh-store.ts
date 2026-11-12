// Funding-leg journal (owner: Stream A). One durable record per prepared leg, written BEFORE any wallet handoff.
// Saves are compare-and-swap on the previous payload, so two tabs can never both advance the same leg, and a
// handoff is single-use (prepared → awaiting_wallet happens once).
import { database } from "./store";
import type { ExecutionNetwork } from "./contracts";
import type { LegQuote } from "./funding-mesh-quote";
import type { LegJournalState } from "./funding-mesh";

export const LEG_TABLE = "CREATE TABLE IF NOT EXISTS funding_legs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, plan_id TEXT NOT NULL, payload TEXT NOT NULL)";

/** The exact source-chain request the wallet is asked to approve. */
export type LegTransaction =
  | { kind: "evm"; chainId: string; from: string; to: string; value: string; data: string }
  | { kind: "solana"; from: string; mint: string; depositAddress: string; amountRaw: string; memo: string | null; createRecipientAta: boolean };

export interface LegRecord {
  /** "leg:<uuid>" — also the step's attemptId, so the plan executor watches it like a wallet attempt. */
  id: string;
  sessionId: string;
  planId: string;
  stepId: string;
  legId: string;
  accountId: string;
  network: Exclude<ExecutionNetwork, "near">;
  from: string;
  to: string;
  amountRaw: string;
  /** The reviewed minimum; a live quote below it is refused. */
  reviewedMinNetRaw: string;
  quote: LegQuote;
  tx: LegTransaction;
  state: LegJournalState;
  txHash: string | null;
  provider: string | null;
  deliveredRaw: string | null;
  refundedRaw: string | null;
  destinationHashes: string[];
  gasRaw: string | null;
  gasUsdcRaw: string | null;
  timeline: { at: string; state: LegJournalState; message: string }[];
  createdAt: string;
  updatedAt: string;
  /** Handoff refused after this (a few minutes before the 1Click deadline). */
  expiresAt: string;
}

async function db() {
  const d = await database();
  await d.prepare(LEG_TABLE).run();
  return d;
}

export async function legGet(sessionId: string, id: string): Promise<{ leg: LegRecord; previous: string } | null> {
  const row = await (await db()).prepare("SELECT payload FROM funding_legs WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string }>();
  return row ? { leg: JSON.parse(row.payload) as LegRecord, previous: row.payload } : null;
}

/** Inserts once; a retry with the same id returns the stored record unchanged (idempotent prepare). */
export async function legInsert(leg: LegRecord): Promise<LegRecord> {
  const d = await db();
  await d.prepare("INSERT OR IGNORE INTO funding_legs (id, session_id, plan_id, payload) VALUES (?,?,?,?)").bind(leg.id, leg.sessionId, leg.planId, JSON.stringify(leg)).run();
  const got = await legGet(leg.sessionId, leg.id);
  if (!got) throw new Error("The funding leg couldn't be saved. Nothing was sent.");
  return got.leg;
}

export function legNote(leg: LegRecord, state: LegJournalState, message: string, at = new Date().toISOString()) {
  const last = leg.timeline.at(-1);
  leg.state = state;
  leg.updatedAt = at;
  if (!last || last.state !== state || last.message !== message) leg.timeline.push({ at, state, message });
}

export async function legSave(leg: LegRecord, previous: string) {
  const r = await (await db()).prepare("UPDATE funding_legs SET payload=? WHERE id=? AND session_id=? AND payload=?").bind(JSON.stringify(leg), leg.id, leg.sessionId, previous).run();
  if (!r.meta?.changes) throw new Error("This funding leg changed in another tab. Reload and check its status.");
}

export async function legsForPlan(sessionId: string, planId: string): Promise<LegRecord[]> {
  const rows = await (await db()).prepare("SELECT payload FROM funding_legs WHERE session_id=? AND plan_id=? ORDER BY rowid").bind(sessionId, planId).all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as LegRecord);
}
