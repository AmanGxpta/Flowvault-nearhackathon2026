import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRecurrences, nextDueDate, seriesOf, instanceDone } from "../lib/flowvault/recurrence.ts";
import { obligationCash } from "../lib/flowvault/obligations.ts";
import { seed } from "../lib/flowvault/seed.ts";
import type { Workspace } from "../lib/flowvault/types.ts";

const NOW = Date.parse("2026-11-12T10:00:00Z");
function ws(): Workspace {
  const w = seed(NOW);
  w.obligations = [
    { id: "rent", label: "Rent", recipient: "0x" + "22".repeat(20), destination: "bnb", token: "USDT", amount: "1000", dueDate: "2026-11-23", recurrence: "monthly", status: "pending" },
    { id: "gym", label: "Gym", recipient: "0x" + "33".repeat(20), destination: "base", token: "USDC", amount: "40", dueDate: "2026-11-10", recurrence: "none", status: "pending" },
  ];
  w.mandate.obligations = w.obligations;
  return w;
}

test("next due dates keep the anchor day and clamp short months", () => {
  assert.equal(nextDueDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(nextDueDate("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextDueDate("2026-12-15", "monthly"), "2027-01-15");
  assert.equal(nextDueDate("2028-02-29", "yearly"), "2029-02-28");
  assert.equal(nextDueDate("2026-11-30", "weekly"), "2026-12-07");
  assert.equal(nextDueDate("2026-11-30", "none"), null);
  assert.deepEqual(seriesOf("rent-r12"), { seriesId: "rent", occurrence: 12 });
  assert.deepEqual(seriesOf("rent"), { seriesId: "rent", occurrence: 1 });
  assert.equal(instanceDone({ status: "pending", dueDate: "2026-11-12" }, NOW), false, "the due day itself is not over");
});

test("nothing is generated while the current instance is pending and not yet due", () => {
  const w = ws();
  assert.deepEqual(advanceRecurrences(w, NOW), []);
  assert.equal(w.obligations.length, 2);
});

test("paying the current instance generates the next one once, keeping the series", () => {
  const w = ws();
  w.obligations[0].status = "paid";
  const g = advanceRecurrences(w, NOW);
  assert.equal(g.length, 1);
  assert.equal(g[0].obligation.id, "rent-r2");
  assert.equal(g[0].obligation.dueDate, "2026-12-23");
  assert.equal(g[0].obligation.status, "pending");
  assert.equal(g[0].because, "paid");
  assert.equal(g[0].seriesId, "rent");
  assert.deepEqual(advanceRecurrences(w, NOW), [], "idempotent: a second pass adds nothing");
  assert.equal(w.obligations.filter((o) => o.id === "rent-r2").length, 1);
  assert.equal(w.recurrenceLog?.["rent-r2"], "2026-12-23");
});

test("a passed unpaid instance stays pending (protected) and the next instance appears", () => {
  const w = ws();
  const g = advanceRecurrences(w, Date.parse("2026-11-24T00:00:01Z"));
  assert.deepEqual(g.map((x) => [x.obligation.id, x.because]), [["rent-r2", "date_passed"]]);
  assert.equal(w.obligations.find((o) => o.id === "rent")!.status, "pending");
  assert.equal(w.obligations.find((o) => o.id === "gym-r2"), undefined, "non-recurring payments never repeat");
});

test("a long absence catches up instance by instance, bounded", () => {
  const w = ws();
  w.obligations[0].status = "paid";
  const g = advanceRecurrences(w, Date.parse("2027-02-24T00:00:00Z"));
  assert.deepEqual(g.map((x) => x.obligation.dueDate), ["2026-12-23", "2027-01-23", "2027-02-23", "2027-03-23"]);
});

test("a deleted generated instance is never re-created; the series continues after its date", () => {
  const w = ws();
  w.obligations[0].status = "paid";
  advanceRecurrences(w, NOW);
  w.obligations = w.obligations.filter((o) => o.id !== "rent-r2");
  assert.deepEqual(advanceRecurrences(w, NOW), []);
  assert.equal(w.obligations.some((o) => o.id === "rent-r2"), false);
  const later = advanceRecurrences(w, Date.parse("2026-12-24T00:00:00Z"));
  assert.deepEqual(later.map((x) => [x.obligation.id, x.obligation.dueDate, x.because]), [["rent-r3", "2027-01-23", "skipped"]]);
});

test("ending the series: recurrence none on the latest instance stops generation", () => {
  const w = ws();
  w.obligations[0].status = "paid";
  w.obligations[0].recurrence = "none";
  assert.deepEqual(advanceRecurrences(w, NOW), []);
});

test("an edited instance keeps its series through its id", () => {
  const w = ws();
  w.obligations[0].status = "paid";
  advanceRecurrences(w, NOW);
  const r2 = w.obligations.find((o) => o.id === "rent-r2")!;
  Object.assign(r2, { amount: "1100", status: "paid" });
  const g = advanceRecurrences(w, NOW);
  assert.deepEqual(g.map((x) => [x.obligation.id, x.obligation.amount]), [["rent-r3", "1100"]]);
});

test("a new instance inside the horizon joins holdback through reserveFor and supersedes drafts", () => {
  const w = ws();
  w.obligations[0].token = "USDC";
  w.obligations[0].dueDate = "2026-11-12";
  w.mandate.horizon = 45;
  const version = w.mandate.version;
  w.obligations[0].status = "paid";
  const paidOnly = obligationCash(w.mandate, NOW);
  advanceRecurrences(w, NOW);
  const after = obligationCash(w.mandate, NOW);
  assert.ok(w.mandate.obligations!.some((o) => o.id === "rent-r2"));
  assert.equal(after - paidOnly, 1000_000000n, "the next rent is held back at its reserveFor amount");
  assert.equal(w.mandate.version, version + 1);
  assert.equal(w.mandate.cashDate, "2026-11-10", "the overdue unpaid payment is still the earliest protected one");
});
