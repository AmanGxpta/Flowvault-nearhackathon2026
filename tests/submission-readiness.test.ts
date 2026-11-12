import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

test("D1 deployment bootstrap is repeatable and preserves bigint budget strings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const schema = readFileSync(
      new URL("../db/migrations/0001_flowvault.sql", import.meta.url),
      "utf8",
    );
    db.exec(schema);
    db.exec(schema);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name)
      .sort();
    assert.deepEqual(tables, [
      "destination_claims",
      "payment_locks",
      "payment_plans",
      "policy_budgets",
      "policy_ledger",
      "wallet_attempts",
      "wallet_hashes",
      "workspaces",
    ]);
    const amount = "999999999999999999999999999999999999";
    db.prepare("INSERT INTO policy_budgets VALUES (?, ?, ?)").run(
      "budget",
      amount,
      "nonce",
    );
    assert.equal(
      db.prepare("SELECT total FROM policy_budgets").get()?.total,
      amount,
    );
    db.prepare("INSERT INTO payment_locks VALUES (?, ?, ?)").run(
      "session",
      "bill",
      "first",
    );
    assert.throws(() =>
      db
        .prepare("INSERT INTO payment_locks VALUES (?, ?, ?)")
        .run("session", "bill", "second"),
    );
  } finally {
    db.close();
  }
});
