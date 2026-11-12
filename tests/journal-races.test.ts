import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  PAY_HANDOFF_GUARD,
  PAY_CANCEL_GUARD,
  WORKSPACE_HANDOFF_GUARD,
  OUTGOING_HANDOFF_GUARD,
} from "../lib/flowvault/journal-sql.ts";
function db() {
  const d = new DatabaseSync(":memory:");
  d.exec(
    "CREATE TABLE wallet_attempts(id TEXT PRIMARY KEY,session_id TEXT,payload TEXT); CREATE TABLE payment_plans(id TEXT PRIMARY KEY,session_id TEXT,payload TEXT);",
  );
  d.prepare("INSERT INTO wallet_attempts VALUES(?,?,?)").run(
    "attempt",
    "session",
    JSON.stringify({ state: "prepared" }),
  );
  d.prepare("INSERT INTO payment_plans VALUES(?,?,?)").run(
    "payment",
    "session",
    JSON.stringify({ state: "deposit-prepared", depositAttemptId: "attempt" }),
  );
  return d;
}
function handoff(
  d: DatabaseSync,
  id = "payment",
  session = "session",
  attempt = "attempt",
) {
  return d
    .prepare(
      "UPDATE wallet_attempts SET payload=? WHERE id=?" + PAY_HANDOFF_GUARD,
    )
    .run(
      JSON.stringify({ state: "awaiting_wallet" }),
      attempt,
      id,
      session,
      attempt,
    ).changes;
}
function cancel(d: DatabaseSync) {
  return d
    .prepare("UPDATE payment_plans SET payload=? WHERE id=?" + PAY_CANCEL_GUARD)
    .run(
      JSON.stringify({ state: "cancelled", depositAttemptId: "attempt" }),
      "payment",
    ).changes;
}
test("atomic cancellation wins before handoff and blocks subsequent signing authorization", () => {
  const d = db();
  assert.equal(cancel(d), 1);
  assert.equal(handoff(d), 0);
  d.close();
});
test("atomic handoff wins before cancellation and forces recovery", () => {
  const d = db();
  assert.equal(handoff(d), 1);
  assert.equal(cancel(d), 0);
  d.close();
});
test("handoff requires the stored payment/attempt/session association and an untouched deposit phase", () => {
  const d = db();
  for (const tuple of [
    ["other", "session", "attempt"],
    ["payment", "other", "attempt"],
    ["payment", "session", "other"],
  ])
    assert.equal(handoff(d, ...(tuple as [string, string, string])), 0);
  d.prepare("UPDATE payment_plans SET payload=?").run(
    JSON.stringify({ state: "processing", depositAttemptId: "attempt" }),
  );
  assert.equal(handoff(d), 0);
  d.close();
});

test("workspace revision fence is atomic with handoff even after budget reservation", () => {
  const d = db();
  d.exec(
    "CREATE TABLE workspaces(id TEXT PRIMARY KEY, revision INTEGER); INSERT INTO workspaces VALUES('session',2);",
  );
  const q = d.prepare(
    "UPDATE wallet_attempts SET payload=? WHERE id=?" + WORKSPACE_HANDOFF_GUARD,
  );
  assert.equal(q.run("{}", "attempt", "session", 1).changes, 0);
  assert.equal(q.run("{}", "attempt", "session", 2).changes, 1);
  d.close();
});
test("outgoing source operations serialize across supply and pay, including old unknown records", () => {
  const d = db();
  d.prepare("INSERT INTO wallet_attempts VALUES(?,?,?)").run(
    "old",
    "session",
    JSON.stringify({
      accountId: "owner.near",
      kind: "supply",
      state: "unknown",
    }),
  );
  const q = d.prepare(
    "UPDATE wallet_attempts SET payload=? WHERE id=?" + OUTGOING_HANDOFF_GUARD,
  );
  assert.equal(
    q.run("{}", "attempt", "session", "attempt", "owner.near").changes,
    0,
  );
  d.prepare("UPDATE wallet_attempts SET payload=? WHERE id='old'").run(
    JSON.stringify({
      accountId: "owner.near",
      kind: "supply",
      state: "confirmed",
    }),
  );
  assert.equal(
    q.run("{}", "attempt", "session", "attempt", "owner.near").changes,
    1,
  );
  d.close();
});
