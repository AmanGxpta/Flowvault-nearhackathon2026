import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "./fixtures/legacy-example.ts";
import {
  migrateWorkspace,
  holdback,
  editObligation,
  projectObligations,
} from "../lib/flowvault/obligations.ts";
const now = Date.parse("2026-11-12T12:00:00Z");
const o = (id: string, date: string, amount = "100") => ({
  id,
  label: id,
  recipient: "",
  destination: "base" as const,
  token: "USDC" as const,
  amount,
  dueDate: date,
  status: "pending" as const,
});
test("Migration persists the old cash need, never releases it outside horizon, supersedes drafts and is idempotent", () => {
  const old: any = seed();
  delete old.obligations;
  old.mandate.cashDate = "2027-01-01";
  old.mandate.horizon = 1;
  old.operations = [{ state: "draft" }];
  const m = migrateWorkspace(old, now);
  assert(m.changed);
  assert.equal(m.workspace.obligations[0].legacyProtected, true);
  assert.equal(holdback(m.workspace.mandate, now), 15000000000n);
  assert.equal(m.workspace.operations[0].state, "superseded");
  assert.equal(migrateWorkspace(m.workspace, now).changed, false);
});
test("Holdback sums pending/overdue obligations inside horizon, excludes paid/cancelled/far future", () => {
  const w = seed();
  w.mandate.horizon = 30;
  w.obligations = [
    o("a", "2026-11-11"),
    o("b", "2026-11-20"),
    o("c", "2027-02-01"),
    { ...o("d", "2026-11-15"), status: "paid" },
    { ...o("e", "2026-11-15"), status: "cancelled" },
  ];
  projectObligations(w, now);
  assert.equal(holdback(w.mandate, now), 10200000000n);
});
test("CRUD revises policy fingerprint, validates dates/amounts, prohibits client-paid state and protects processing entries", () => {
  let w = seed();
  const version = w.mandate.version;
  w = editObligation(w, "create", o("a", "2026-11-15"));
  assert.equal(w.mandate.version, version + 1);
  assert.throws(
    () => editObligation(w, "create", o("a", "2026-11-15")),
    /already exists/,
  );
  assert.throws(
    () => editObligation(w, "create", o("bad", "2026-02-31")),
    /valid due date/,
  );
  assert.throws(() =>
    editObligation(w, "create", { ...o("bad", "2026-11-15"), status: "paid" }),
  );
  w.obligations[0].status = "processing";
  assert.throws(
    () => editObligation(w, "delete", { id: w.obligations[0].id }),
    /cannot be edited/,
  );
  w = editObligation(w, "delete", { id: "a" });
  assert(!w.obligations.some((x) => x.id === "a"));
});
test("Unknown obligation FX refuses automatic holdback instead of treating it as zero", () => {
  const w = seed();
  w.obligations = [{ ...o("x", "2026-11-13"), token: "NEAR" }];
  projectObligations(w, now);
  assert.throws(() => holdback(w.mandate, now), /valuation unavailable/);
});

test("Date-only horizon includes its final UTC calendar day, not only the current hour", () => {
  const w = seed();
  w.mandate.horizon = 30;
  w.obligations = [o("last", "2026-12-12"), o("outside", "2026-12-13")];
  projectObligations(w, now);
  assert.equal(holdback(w.mandate, now), 10100000000n);
});
