import { test } from "node:test";
import assert from "node:assert/strict";
import {
  supplyHoldback,
  assertSignable,
  sameTransactions,
  verifyOutcome,
  summarizeOutcomes,
} from "../lib/flowvault/execution.ts";
import type { WalletAttempt } from "../lib/flowvault/execution.ts";
import { prepareSupply } from "../lib/flowvault/supply.ts";
function attempt(registered = true): WalletAttempt {
  const preparation = prepareSupply(
    {
      accountId: "example.near",
      mode: "Running",
      canDeposit: true,
      decimals: 6,
      walletUsdc: "1000000000",
      nativeAmount: "1000000000000000000000000",
      storageUsage: 1000,
      registered,
      registrationMinimum: "100000000000000000000000",
      reserve: "100",
    },
    "12.345678",
  );
  return {
    id: crypto.randomUUID(),
    kind: "supply",
    accountId: "example.near",
    amount: preparation.amount,
    mandateVersion: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: preparation.expiresAt,
    state: "prepared",
    preparation,
    hashes: [],
    message: "",
  };
}
function outcome(a: WalletAttempt, index = 0) {
  const expected = a.preparation.transactions[index];
  return {
    final_execution_status: "FINAL",
    transaction: {
      signer_id: a.accountId,
      receiver_id: expected.receiverId,
      actions: expected.actions.map((action) => ({
        FunctionCall: {
          method_name: action.params.methodName,
          args: btoa(JSON.stringify(action.params.args)),
          gas: action.params.gas,
          deposit: action.params.deposit,
        },
      })),
    },
    status: { SuccessValue: btoa(JSON.stringify("12345678")) },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
  };
}
test("Only fresh, matching live mandates can enter the wallet, exactly once", () => {
  const a = attempt();
  assert.doesNotThrow(() => assertSignable(a, a.accountId, "live", 4));
  assert.throws(() => assertSignable(a, "another.near", "live", 4), /account/);
  assert.throws(() => assertSignable(a, a.accountId, "demo", 4), /live/);
  assert.throws(() => assertSignable(a, a.accountId, "live", 5), /changed/);
  assert.throws(
    () => assertSignable(a, a.accountId, "live", 4, Date.parse(a.expiresAt)),
    /expired/,
  );
  assert.throws(
    () =>
      assertSignable(
        { ...a, state: "awaiting_wallet" },
        a.accountId,
        "live",
        4,
      ),
    /already/,
  );
});
test("Fresh registration changes require another review", () => {
  const a = attempt(),
    b = attempt(false);
  assert.equal(sameTransactions(a.preparation, a.preparation), true);
  assert.equal(sameTransactions(a.preparation, b.preparation), false);
});
test("A finalized exact supply counts as confirmed", () => {
  const a = attempt();
  const o = verifyOutcome(outcome(a), a);
  assert.equal(o.state, "confirmed");
  assert.equal(summarizeOutcomes(a, [o]).state, "confirmed");
});
test("Signer, receiver, amount, gas and yocto changes cannot be attributed to this request", () => {
  const a = attempt();
  for (const change of [
    (r: any) => (r.transaction.signer_id = "other.near"),
    (r: any) => (r.transaction.receiver_id = "other.near"),
    (r: any) =>
      (r.transaction.actions[0].FunctionCall.args = btoa(
        JSON.stringify({ amount: "1" }),
      )),
    (r: any) => (r.transaction.actions[0].FunctionCall.gas = "1"),
    (r: any) => (r.transaction.actions[0].FunctionCall.deposit = "100"),
  ]) {
    const r = outcome(a);
    change(r);
    assert.throws(() => verifyOutcome(r, a), /match/);
  }
});
test("Inclusion alone is pending even when SuccessValue is present", () => {
  const a = attempt();
  const r = outcome(a);
  r.final_execution_status = "EXECUTED_OPTIMISTIC";
  assert.equal(verifyOutcome(r, a).state, "pending");
});
test("A failed downstream receipt defeats a successful transaction", () => {
  const a = attempt();
  const r: any = outcome(a);
  r.receipts_outcome[0].outcome.status = { Failure: { ActionError: "failed" } };
  assert.equal(verifyOutcome(r, a).state, "failed");
});
test("Refunded and partially used supplies are never reported as successful", () => {
  const a = attempt();
  for (const amount of ["0", "12345677"]) {
    const r = outcome(a);
    r.status.SuccessValue = btoa(JSON.stringify(amount));
    assert.match(verifyOutcome(r, a).message, /refunded/);
    assert.equal(verifyOutcome(r, a).state, "failed");
  }
});
test("Unknown resolved token amount fails closed", () => {
  const a = attempt();
  const r = outcome(a);
  r.status.SuccessValue = "";
  assert.equal(verifyOutcome(r, a).state, "failed");
});
test("A successful registration alone is a partial request, not an investment", () => {
  const a = attempt(false);
  const reg = outcome(a, 0);
  reg.status.SuccessValue = "";
  const o = verifyOutcome(reg, a);
  assert.equal(o.state, "confirmed");
  assert.equal(summarizeOutcomes(a, [o]).state, "partial");
  assert.equal(
    summarizeOutcomes(a, [o, verifyOutcome(outcome(a, 1), a)]).state,
    "confirmed",
  );
});
test("Duplicate outcomes cannot stand in for missing transaction steps", () => {
  const a = attempt(false);
  const o = verifyOutcome(outcome(a, 0), a);
  assert.equal(summarizeOutcomes(a, [o, o]).state, "partial");
});

test("Missing receipt details cannot establish a successful supply", () => {
  const a = attempt();
  const r: any = outcome(a);
  delete r.receipts_outcome;
  assert.equal(verifyOutcome(r, a).state, "pending");
});

test("Manual supply protects both cash needs and the reserve, and requires an approved venue", () => {
  const m: any = {
    reserve: "100",
    cashAmount: "25.123456",
    approved: ["rhea-usdc"],
  };
  assert.equal(supplyHoldback(m), "125.123456");
  assert.throws(() => supplyHoldback({ ...m, approved: [] }), /Approve/);
});
