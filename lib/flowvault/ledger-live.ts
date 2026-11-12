import { proven } from "./account-registry.ts";
// Engines E3: gathers the ledger's journal inputs for a session (read-only). Every row comes from a
// journal table written by verified flows: wallet_attempts, payment_plans and plan_ledger_outbox.
import { attemptsDb } from "./attempts.ts";
import { readLedgerOutbox } from "./plans-store.ts";
import { readPriceEvidence } from "./valuation-evidence.ts";
import { readLendingState } from "./lending-live.ts";
import { LENDING_USDC } from "./lending.ts";
import { innerToNative } from "./money.ts";
import { reservationFor } from "./valuation.ts";
import { buildLedger, buildStatement, demoLedger } from "./ledger.ts";
import type { LendingObservation, StatementObligation } from "./ledger.ts";
import type { WalletAttempt } from "./execution";
import type { PaymentPlan } from "./payments";
import type { Workspace } from "./types";

const MAX_ROWS = 2000;

async function rows<T>(sql: string, sessionId: string): Promise<T[]> {
  const db = await attemptsDb();
  try {
    const r = await db.prepare(sql).bind(sessionId, MAX_ROWS).all<{ payload: string }>();
    return r.results.map((x) => JSON.parse(x.payload) as T);
  } catch (e) {
    // A journal table that was never created holds no entries.
    if (/no such table/i.test(String(e))) return [];
    throw e;
  }
}

export async function lendingObservation(accountId: string): Promise<LendingObservation> {
  const capturedAt = new Date().toISOString();
  try {
    const st = await readLendingState(accountId);
    const usdc = st.assets[LENDING_USDC];
    const debt = st.borrowed[LENDING_USDC] ?? 0n;
    const supplied = (st.supplied[LENDING_USDC] ?? 0n) + (st.collateral[LENDING_USDC] ?? 0n);
    return {
      debtUsdcRaw: innerToNative(debt, usdc.extraDecimals, true).toString(),
      borrowApr: usdc.borrowApr ?? null,
      suppliedUsdcRaw: innerToNative(supplied, usdc.extraDecimals, false).toString(),
      supplyApr: usdc.supplyApr ?? null,
      capturedAt: st.capturedAt,
    };
  } catch (e) {
    return { debtUsdcRaw: null, borrowApr: null, suppliedUsdcRaw: null, supplyApr: null, capturedAt, error: (e as Error).message };
  }
}

/** The session's ledger: all journal rows for the workspace's account, deduplicated. */
export async function sessionLedger(sessionId: string, w: Workspace) {
  if (w.mode === "demo") return { source: "demo" as const, accountId: null, entries: demoLedger(), attempts: [] as WalletAttempt[], errors: [] as string[] };
  const errors: string[] = [];
  const [attempts, payments, outbox, prices] = await Promise.all([
    rows<WalletAttempt>("SELECT payload FROM wallet_attempts WHERE session_id=? ORDER BY rowid LIMIT ?", sessionId),
    rows<PaymentPlan>("SELECT payload FROM payment_plans WHERE session_id=? ORDER BY rowid LIMIT ?", sessionId),
    readLedgerOutbox(sessionId).catch((e) => {
      if (/no such table/i.test(String(e))) return [];
      throw e;
    }),
    readPriceEvidence().catch((e) => {
      errors.push("Price evidence unavailable; NEAR gas is not valued: " + (e as Error).message);
      return null;
    }),
  ]);
  const accountId = w.accountId ?? null;
  return {
    source: "live" as const,
    accountId,
    entries: buildLedger({ source: "live", accountId, accountIds: (w.accounts ?? []).filter(proven).map(a => a.address.toLowerCase()), attempts, payments, outbox, prices }),
    attempts,
    errors,
  };
}

/** Upcoming obligations with their conservative reservations (unavailable stays visible, never 0). */
export function statementObligations(w: Workspace, now = Date.now()): StatementObligation[] {
  return w.obligations
    .filter((o) => !["paid", "cancelled"].includes(o.status))
    .map((o) => {
      try {
        const r = reservationFor(w.mandate, o, now);
        return { id: o.id, dueDate: o.dueDate, token: o.token, amount: o.amount, reservedUsdcRaw: r.reserveUsdcRaw };
      } catch (e) {
        return { id: o.id, dueDate: o.dueDate, token: o.token, amount: o.amount, reservedUsdcRaw: null, unavailableReason: (e as Error).message };
      }
    });
}

export function period(url: URL, now = Date.now()) {
  const day = (v: string | null, fallback: number) => {
    if (v === null) return new Date(fallback).toISOString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + "T00:00:00Z"))) throw new Error("Use from/to dates as YYYY-MM-DD.");
    return new Date(v + "T00:00:00Z").toISOString();
  };
  const from = day(url.searchParams.get("from"), now - 30 * 86_400_000);
  // `to` is inclusive for the caller: the period ends at the start of the following day.
  const toParam = url.searchParams.get("to");
  const to = toParam === null ? new Date(now + 1).toISOString() : new Date(Date.parse(day(toParam, now)) + 86_400_000).toISOString();
  if (from >= to) throw new Error("The period start must be before its end.");
  return { from, to };
}

export async function sessionStatement(sessionId: string, w: Workspace, range: { from: string; to: string }, now = Date.now()) {
  const [ledger, lending] = await Promise.all([
    sessionLedger(sessionId, w),
    w.mode === "live" && w.accountId ? lendingObservation(w.accountId) : Promise.resolve(null),
  ]);
  const statement = buildStatement({
    source: ledger.source,
    accountId: ledger.accountId,
    entries: ledger.entries,
    attempts: ledger.attempts,
    from: range.from,
    to: range.to,
    lending,
    obligations: statementObligations(w, now),
    now,
  });
  statement.owed.reasons.push(...ledger.errors);
  return statement;
}
