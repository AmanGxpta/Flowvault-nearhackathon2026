import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { detect, coverage, usd, type MonitorInput, type CapitalInput } from "../lib/flowvault/monitor.ts";
import { reconcile, type MonitorAlert } from "../lib/flowvault/monitor-store.ts";
import { MONITOR_TABLES, ALERT_UPSERT, ALERT_RESOLVE, ALERT_DISMISS } from "../lib/flowvault/monitor-sql.ts";
import { reserveFor } from "../lib/flowvault/valuation.ts";
import type { ActionPlan, Reservation } from "../lib/flowvault/contracts.ts";
import type { Obligation, Position } from "../lib/flowvault/types.ts";

const NOW = Date.parse("2026-11-12T10:00:00Z");
const ob = (id: string, dueDate: string, amount = "1000", extra: Partial<Obligation> = {}): Obligation => ({
  id, label: id, recipient: "r", destination: "near", token: "USDC", amount, dueDate, status: "pending", recurrence: "none", ...extra,
});
const res = (o: Obligation): Reservation => reserveFor(o, { source: "live", now: NOW });
const M = 1_000000n;
function capital(spendable: bigint, obligations: Obligation[], floor = 0n, values: Record<string, bigint> = {}): CapitalInput {
  const reservations = obligations.map(res);
  const holdback = reservations.reduce((n, r) => n + BigInt(r.reserveUsdcRaw), floor);
  return {
    spendableNowUsdcRaw: spendable.toString(), holdbackUsdcRaw: holdback.toString(), reserveUsdcRaw: floor.toString(), reservations,
    valuations: Object.entries(values).map(([positionId, v]) => ({ positionId, kind: "observed" as const, asset: "USDC", quantityRaw: v.toString(), decimals: 6, usdcRaw: v.toString(), source: "live" as const, basis: "test", capturedAt: "", freshUntil: null })),
    blocksAutomation: false, reasons: [],
  };
}
const pos = (id: string, kind: Position["kind"], asset = "USDC", extra: Partial<Position> = {}): Position => ({ id, label: id, asset, amount: "0", kind, ownership: "owner", ...extra });
function input(over: Partial<MonitorInput>): MonitorInput {
  return { now: NOW, source: "live", obligations: [], leadDays: 3, horizonDays: 30, capital: null, positions: [], exitDays: {}, credit: undefined, plans: [], ...over };
}
const kinds = (r: ReturnType<typeof detect>) => r.candidates.map((c) => c.dedupeKey);

test("preparation window: inside mandate.leadDays, urgent on the day or overdue, none outside", () => {
  const r = detect(input({ obligations: [ob("rent", "2026-11-14"), ob("later", "2026-11-20"), ob("today", "2026-11-12"), ob("late", "2026-11-10"), ob("done", "2026-11-13", "1", { status: "paid" })] }));
  assert.deepEqual(kinds(r).filter((k) => k.startsWith("obligation_window")).sort(), [
    "obligation_window:late:2026-11-10", "obligation_window:rent:2026-11-14", "obligation_window:today:2026-11-12",
  ]);
  const by = Object.fromEntries(r.candidates.map((c) => [c.obligationId, c]));
  assert.equal(by.rent.severity, "warn");
  assert.equal(by.today.severity, "urgent");
  assert.match(by.late.message, /still unpaid/);
  assert.deepEqual(by.rent.proposal, { objective: "pay_obligation", obligationId: "rent" });
});

test("an active plan for the payment is linked instead of proposing another", () => {
  const plan = { id: "p1", state: "reviewed", request: { obligationId: "rent" }, steps: [], updatedAt: new Date(NOW).toISOString(), objective: "pay_obligation" } as unknown as ActionPlan;
  const c = detect(input({ obligations: [ob("rent", "2026-11-14")], plans: [plan] })).candidates[0];
  assert.equal(c.planId, "p1");
  assert.equal(c.proposal, undefined);
});

test("spendable below the required reserve proposes a Rhea withdrawal sized by capitalView, by the day before", () => {
  const obligations = [ob("rent", "2026-11-23", "1000"), ob("payroll", "2026-12-01", "6000")];
  const c = capital(5000n * M, obligations, 500n * M, { rhea: 7500n * M });
  const rows = coverage({ obligations, now: NOW, horizonDays: 30 }, c);
  assert.deepEqual(rows.map((x) => x.covered), [true, false]);
  const r = detect(input({ obligations, capital: c, positions: [pos("rhea", "supplied")] }));
  const a = r.candidates.find((x) => x.kind === "reserve_shortfall")!;
  assert.equal(a.dedupeKey, "reserve_shortfall:payroll");
  assert.equal(a.obligationId, "payroll");
  assert.equal(a.proposal!.objective, "access_cash");
  assert.equal(a.proposal!.amountRaw, (2500n * M).toString(), "7,500 holdback - 5,000 spendable");
  assert.equal(a.proposal!.deadline, "2026-11-30");
  assert.match(a.proposal!.title!, /^Begin withdrawing 2,500\.00 USDC from Rhea by Nov 30; spendable after: 7,500\.00/);
  assert.deepEqual(r.evaluated.sort(), ["capital", "dates", "plans"]);
});

test("unvalued holdback warns and blocks; no capital read leaves capital alerts unevaluated", () => {
  const c = { ...capital(1n, []), holdbackUsdcRaw: null, reasons: ["rent: no USDT/USDC quote"] };
  assert.deepEqual(kinds(detect(input({ capital: c }))), ["reserve_shortfall:unvalued"]);
  const skipped = detect(input({ capital: null }));
  assert.ok(!skipped.evaluated.includes("capital"));
  assert.deepEqual(skipped.skipped, ["capital"]);
});

test("a pending exit landing after an uncovered payment threatens it; a covered payment is not threatened", () => {
  const obligations = [ob("rent", "2026-11-14", "3000")];
  const unstaking = pos("unstaking", "staking", "NEAR", { availableAt: "2026-11-16T00:00:00Z", label: "Unstaking NEAR", amount: "800" });
  const short = detect(input({ obligations, capital: capital(1000n * M, obligations, 0n, { unstaking: 2500n * M }), positions: [unstaking] }));
  const t = short.candidates.find((x) => x.kind === "exit_threatens_payment")!;
  assert.equal(t.severity, "urgent");
  assert.match(t.message, /Unstaking NEAR would only be available around Nov 16, after rent on Nov 14/);
  const covered = detect(input({ obligations, capital: capital(4000n * M, obligations), positions: [unstaking] }));
  assert.equal(covered.candidates.some((x) => x.kind === "exit_threatens_payment"), false);
});

test("a staked position needed for a payment warns when its latest exit start enters the window", () => {
  const obligations = [ob("payroll", "2026-11-22", "6000")];
  const staked = pos("staked", "staking", "NEAR", { label: "Staked NEAR", amount: "1900" });
  const r = detect(input({ obligations, capital: capital(1000n * M, obligations), positions: [staked], exitDays: { staked: 4 } }));
  const t = r.candidates.find((x) => x.kind === "exit_threatens_payment")!;
  assert.match(t.message, /4-day exit must begin by Nov 15/);
  assert.equal(t.proposal!.objective, "access_cash");
  assert.equal(t.proposal!.amountRaw, (5000n * M).toString());
});

test("debt near the owner's health threshold; stressed health below the minimum proposes a repay plan", () => {
  const near = detect(input({ credit: { debtUsdcRaw: "50000000", health: "1.80", stressedHealth: "1.40", minHealth: "1.50" } }));
  const d = near.candidates.find((x) => x.kind === "debt_risk")!;
  assert.equal(d.severity, "warn");
  assert.match(d.message, /stress drawdown your Rhea health would be 1\.40, below your minimum of 1\.50/);
  assert.deepEqual(d.proposal, { objective: "repay" });
  const safe = detect(input({ credit: { debtUsdcRaw: "50000000", health: "3.00", stressedHealth: "2.20", minHealth: "1.50" } }));
  assert.equal(safe.candidates.length, 0);
  assert.ok(safe.evaluated.includes("credit"));
  assert.ok(!detect(input({ credit: null })).evaluated.includes("credit"));
});

test("operations needing attention: unconfirmed step, stale wallet request, failed plan", () => {
  const at = new Date(NOW - 20 * 60_000).toISOString();
  const plan = (id: string, state: string, steps: string[]) =>
    ({ id, state, objective: "pay_obligation", request: {}, updatedAt: at, steps: steps.map((s, i) => ({ id: id + i, state: s })) }) as unknown as ActionPlan;
  const r = detect(input({ plans: [plan("a", "partial", ["confirmed", "unknown"]), plan("b", "executing", ["awaiting_wallet"]), plan("c", "failed", ["failed"]), plan("d", "completed", ["confirmed"])] }));
  assert.deepEqual(kinds(r), ["operation_attention:a:a1:unconfirmed", "operation_attention:b:b0:wallet", "operation_attention:c:failed"]);
  assert.equal(r.candidates[0].severity, "urgent");
});

test("recurrence: a generated next instance inside the horizon is announced once per instance", () => {
  const r = detect(input({ obligations: [ob("rent-r2", "2026-12-10", "1000", { recurrence: "monthly", label: "Rent" }), ob("rent-r3", "2027-03-10", "1000", { recurrence: "monthly" })] }));
  assert.deepEqual(kinds(r), ["recurrence_due:rent-r2"]);
  assert.match(r.candidates[0].message, /Rent repeats monthly: the next 1,000 USDC on Dec 10 is scheduled and counted in your holdback/);
});

test("reconcile: dedupe, refresh, resolve only evaluated groups, reopen; SQL keeps one row per key", () => {
  const d = new DatabaseSync(":memory:");
  for (const sql of MONITOR_TABLES) d.exec(sql);
  const id = (k: string) => "id-" + k;
  const window = { dedupeKey: "obligation_window:rent:2026-11-14", kind: "obligation_window" as const, severity: "warn" as const, message: "due Nov 14" };
  const short = { dedupeKey: "reserve_shortfall:payroll", kind: "reserve_shortfall" as const, severity: "warn" as const, message: "short 10" };
  const persist = (r: ReturnType<typeof reconcile>) => {
    for (const a of r.upserts) d.prepare(ALERT_UPSERT).run(a.id, "s", a.dedupeKey, JSON.stringify(a), a.createdAt);
    for (const a of r.resolves) d.prepare(ALERT_RESOLVE).run(a.resolvedAt!, JSON.stringify(a), "s", a.dedupeKey);
  };
  const read = (): MonitorAlert[] =>
    d.prepare("SELECT payload, resolved_at, dismissed_at FROM alerts WHERE session_id = 's'").all().map((r) => ({
      ...JSON.parse(r.payload as string), ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}), ...(r.dismissed_at ? { dismissedAt: r.dismissed_at } : {}),
    }));
  persist(reconcile([], [window, short], ["dates", "capital"], "t1", id));
  persist(reconcile(read(), [window, short], ["dates", "capital"], "t2", id));
  assert.equal(read().length, 2, "deduplicated");
  assert.equal(read().find((a) => a.kind === "obligation_window")!.createdAt, "t1");
  // Capital read failed: the shortfall can't be checked, so it stays open even though it wasn't found.
  persist(reconcile(read(), [window], ["dates"], "t3", id));
  assert.equal(read().find((a) => a.kind === "reserve_shortfall")!.resolvedAt, undefined);
  persist(reconcile(read(), [window], ["dates", "capital"], "t4", id));
  assert.equal(read().find((a) => a.kind === "reserve_shortfall")!.resolvedAt, "t4");
  d.prepare(ALERT_DISMISS).run("t5", "s", "id-obligation_window:rent:2026-11-14");
  persist(reconcile(read(), [window, { ...short, message: "short 20" }], ["dates", "capital"], "t6", id));
  const after = read();
  assert.equal(after.find((a) => a.kind === "obligation_window")!.dismissedAt, "t5", "dismissal holds while the condition holds");
  const reopened = after.find((a) => a.kind === "reserve_shortfall")!;
  assert.equal(reopened.resolvedAt, undefined);
  assert.equal(reopened.createdAt, "t6");
  assert.equal(reopened.message, "short 20");
});

test("usd formats 6-decimal raw values for messages", () => {
  assert.equal(usd(1234_560000n), "1,234.56");
  assert.equal(usd("999"), "0.00");
  assert.equal(usd(-2_500000n), "-2.50");
});

test("an empty staking position never raises an exit-timing alert", () => {
  const obligations = [ob("rent", "2026-11-13", "5000")];
  const empty = pos("linear-shares", "staking", "LiNEAR", { label: "LiNEAR", amount: "0" });
  const r = detect(input({ obligations, capital: capital(0n, obligations), positions: [empty] }));
  assert.equal(r.candidates.some((x) => x.kind === "exit_threatens_payment"), false);
});
