import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  prepareWithdraw,
  availableLiquidity,
  WITHDRAW_RHEA as RHEA,
  WITHDRAW_USDC as USDC,
} from "../lib/flowvault/withdraw.ts";
import type { WithdrawState } from "../lib/flowvault/withdraw.ts";
import { withdrawStateFromEvidence } from "../lib/flowvault/withdraw-evidence.ts";
import {
  assertSignable,
  sameTransactions,
  verifyOutcome,
  summarizeOutcomes,
} from "../lib/flowvault/execution.ts";
import type { WalletAttempt } from "../lib/flowvault/execution.ts";
import {
  keyedAttemptId,
  assertPreparationRetry,
  requestIdentity,
} from "../lib/flowvault/preparation-key.ts";
function state(): WithdrawState {
  return {
    accountId: "example.near",
    mode: "Running",
    canWithdraw: true,
    decimals: 6,
    extraDecimals: 12,
    suppliedUsdc: "100000000000000000000",
    availableLiquidity: "1000000000000000000000",
    collateral: [],
    borrowed: [],
    usdcRegistered: true,
    nativeAmount: "1000000000000000000000000",
    storageUsage: 1000,
    isLocked: false,
  };
}
function attempt(): WalletAttempt {
  const preparation = prepareWithdraw(state(), "12.345678");
  return {
    id: crypto.randomUUID(),
    accountId: "example.near",
    kind: "withdraw",
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
function receipt(name = "final-success.json"): any {
  const r = JSON.parse(
    readFileSync(
      new URL("./fixtures/withdraw/" + name, import.meta.url),
      "utf8",
    ),
  );
  const p = attempt().preparation;
  r.transaction.actions = p.transactions[0].actions.map((a) => ({
    FunctionCall: {
      method_name: a.params.methodName,
      args: btoa(JSON.stringify(a.params.args)),
      gas: a.params.gas,
      deposit: a.params.deposit,
    },
  }));
  return r;
}
function transfer(r: any, mutate: (e: any) => void) {
  const o = r.receipts_outcome[1].outcome;
  const e = JSON.parse(o.logs[0].slice(11));
  mutate(e);
  o.logs[0] = "EVENT_JSON:" + JSON.stringify(e);
}
function asset() {
  return {
    token_id: USDC,
    supplied: { balance: "100000000000000000000" },
    borrowed: { balance: "10000000000000000000" },
    reserved: "2000000000000000000",
    prot_fee: "1000000000000000000",
    margin_debt: { balance: "3000000000000000000" },
    margin_pending_debt: "4000000000000000000",
    config: { can_withdraw: true, extra_decimals: 12 },
  };
}
function evidence(): any {
  return {
    accountId: "example.near",
    native: { amount: state().nativeAmount, storage_usage: 1000 },
    account: {
      account_id: "example.near",
      supplied: [{ token_id: USDC, balance: state().suppliedUsdc }],
      positions: { REGULAR_POSITION: { collateral: [], borrowed: [] } },
      is_locked: false,
    },
    assets: [asset()],
    metadata: { decimals: 6 },
    config: { contract_mode: "Running" },
    storage: { total: "1250000000000000000000", available: "0" },
    tokenCash: "1000000000",
  };
}
test("Withdrawal encodes max_amount in inner units, exactly one execute/yocto/250-Tgas action", () => {
  const p = prepareWithdraw(state(), "12.345678");
  assert.equal(p.kind, "withdraw");
  assert.equal(p.amountNative, "12345678");
  assert.equal(p.amountInner, "12345678000000000000");
  assert.equal(p.transactions.length, 1);
  assert.deepEqual(p.transactions[0], {
    receiverId: RHEA,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "execute",
          args: {
            actions: [
              {
                Withdraw: {
                  token_id: USDC,
                  max_amount: "12345678000000000000",
                },
              },
            ],
          },
          deposit: "1",
          gas: "250000000000000",
        },
      },
    ],
  });
  assert.equal(p.collateral, false);
  assert(Date.parse(p.expiresAt) > Date.now());
});
test("Known zero extra decimals is supported without accidental rescaling", () =>
  assert.equal(
    prepareWithdraw({ ...state(), extraDecimals: 0 }, "1").amountInner,
    "1000000",
  ));
for (const [name, change, error] of [
  ["paused market", { mode: "Paused" }, /Running/],
  ["withdraw disabled", { canWithdraw: false }, /not enabled/],
  ["wrong token precision", { decimals: 18 }, /precision/],
  ["missing extra decimals", { extraDecimals: null }, /extra_decimals/],
  ["undefined extra decimals", { extraDecimals: undefined }, /extra_decimals/],
  ["negative extra decimals", { extraDecimals: -1 }, /extra_decimals/],
  ["fractional extra decimals", { extraDecimals: 1.5 }, /extra_decimals/],
  ["excessive extra decimals", { extraDecimals: 33 }, /extra_decimals/],
  ["insufficient supplied USDC", { suppliedUsdc: "1" }, /Supplied USDC/],
  [
    "insufficient protocol liquidity",
    { availableLiquidity: "1" },
    /available liquidity/,
  ],
  [
    "collateral on any asset",
    { collateral: [{ token_id: "wrap.near", balance: "1" }] },
    /health is unverified/,
  ],
  [
    "debt on any asset",
    { borrowed: [{ token_id: "wrap.near", balance: "1" }] },
    /health is unverified/,
  ],
  ["missing health data", { collateral: undefined }, /health is unverified/],
  [
    "no token storage registration",
    { usdcRegistered: false },
    /storage registration/,
  ],
  ["locked Rhea account", { isLocked: true }, /locked/],
  [
    "insufficient NEAR gas",
    { nativeAmount: "1000000000000000000000" },
    /Insufficient spendable NEAR/,
  ],
  [
    "storage-locked NEAR",
    { storageUsage: 100000 },
    /Insufficient spendable NEAR/,
  ],
  ["invalid storage usage", { storageUsage: NaN }, /storage usage/],
  [
    "unknown supplied balance",
    { suppliedUsdc: undefined },
    /unavailable or invalid/,
  ],
  [
    "unknown liquidity",
    { availableLiquidity: undefined },
    /unavailable or invalid/,
  ],
  ["invalid signer", { accountId: "invalid!" }, /valid NEAR/],
] as const)
  test("Withdrawal refuses " + name, () =>
    assert.throws(
      () => prepareWithdraw({ ...state(), ...change } as WithdrawState, "1"),
      error,
    ),
  );
test("Withdrawal rejects zero, exponent, negative and excess token precision", () => {
  for (const value of ["0", "1e6", "-1", "0.0000001"])
    assert.throws(() => prepareWithdraw(state(), value));
});
test("Withdrawal checks inner-unit U128 overflow", () =>
  assert.throws(
    () => prepareWithdraw({ ...state(), extraDecimals: 32 }, "100"),
    /protocol precision/,
  ));
test("Gas budget includes exact attached yocto after storage reserve", () => {
  const n =
    BigInt(state().storageUsage) * 10n ** 19n + 250000000000000000000000n;
  assert.throws(
    () => prepareWithdraw({ ...state(), nativeAmount: n.toString() }, "1"),
    /gas/,
  );
  assert.doesNotThrow(() =>
    prepareWithdraw({ ...state(), nativeAmount: (n + 1n).toString() }, "1"),
  );
});
test("Protocol liquidity includes reserve/fee and subtracts borrowed, margin and pending debt", () =>
  assert.equal(availableLiquidity(asset()), 86000000000000000000n));
test("Liquidity cannot default missing margin fields to zero", () => {
  assert.throws(
    () =>
      availableLiquidity({ ...asset(), margin_pending_debt: undefined } as any),
    /unavailable/,
  );
  assert.throws(
    () =>
      availableLiquidity({
        ...asset(),
        borrowed: { balance: "999999999999999999999" },
      }),
    /invalid/,
  );
});
test("Evidence caps lending liquidity by actual native-token cash", () => {
  const e = evidence();
  e.tokenCash = "5000000";
  assert.equal(
    withdrawStateFromEvidence(e).availableLiquidity,
    "5000000000000000000",
  );
  assert.throws(
    () => prepareWithdraw(withdrawStateFromEvidence(e), "6"),
    /liquidity/,
  );
});
test("Collateral/debt in non-regular positions is refused", () => {
  for (const field of ["collateral", "borrowed"]) {
    const e = evidence();
    e.account.positions.lp = { collateral: [], borrowed: [] };
    e.account.positions.lp[field] = [{ token_id: "wrap.near", balance: "1" }];
    assert.throws(
      () => prepareWithdraw(withdrawStateFromEvidence(e), "1"),
      /health is unverified/,
    );
  }
});
test("Unknown all-position evidence and wrong returned account fail closed", () => {
  let e = evidence();
  delete e.account.positions;
  assert.throws(() => withdrawStateFromEvidence(e), /health is unverified/);
  e = evidence();
  e.account.account_id = "other.near";
  assert.throws(() => withdrawStateFromEvidence(e), /different account/);
});
test("A null lending account has no supplied balance; null or malformed USDC storage is refused", () => {
  let e = evidence();
  e.account = null;
  assert.throws(
    () => prepareWithdraw(withdrawStateFromEvidence(e), "1"),
    /Supplied USDC/,
  );
  for (const storage of [null, {}, { total: "0", available: "0" }]) {
    e = evidence();
    e.storage = storage;
    assert.throws(
      () => prepareWithdraw(withdrawStateFromEvidence(e), "1"),
      /storage registration/,
    );
  }
});
test("Missing live extra decimals, margin liquidity or token cash never substitutes zeros", () => {
  for (const edit of [
    (e: any) => delete e.assets[0].config.extra_decimals,
    (e: any) => delete e.assets[0].margin_debt,
    (e: any) => (e.tokenCash = undefined),
  ]) {
    const e = evidence();
    edit(e);
    assert.throws(() => withdrawStateFromEvidence(e));
  }
});
test("Withdraw keeps account, mandate, mode, expiry and one-time handoff fences", () => {
  const a = attempt();
  assert.doesNotThrow(() => assertSignable(a, a.accountId, "live", 4));
  for (const args of [
    ["other.near", "live", 4],
    [a.accountId, "demo", 4],
    [a.accountId, "live", 5],
  ] as const)
    assert.throws(() => assertSignable(a, args[0], args[1], args[2]));
  assert.throws(
    () => assertSignable(a, a.accountId, "live", 4, Date.parse(a.expiresAt)),
    /expired/,
  );
  assert.throws(
    () =>
      assertSignable({ ...a, expiresAt: "not-a-date" }, a.accountId, "live", 4),
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
  assert.equal(
    sameTransactions(
      a.preparation,
      prepareWithdraw({ ...state(), extraDecimals: 11 }, a.amount),
    ),
    false,
  );
});
test("Idempotency canonicalizes amount but fences account, mandate, kind and amount changes", async () => {
  const a = { ...attempt(), amount: "12" };
  assertPreparationRetry(a, { ...a, amount: "12.0" });
  assert.equal(
    requestIdentity(a),
    requestIdentity({ ...a, amount: "12.000000" }),
  );
  for (const change of [
    { accountId: "other.near" },
    { mandateVersion: 5 },
    { kind: "supply" as const },
    { amount: "13" },
  ])
    assert.throws(
      () => assertPreparationRetry(a, { ...a, ...change }),
      /key was already used/,
    );
});
test("Idempotency IDs are stable within a session and isolated across sessions/keys", async () => {
  const key = crypto.randomUUID();
  const id = await keyedAttemptId("session-a", key);
  assert.equal(id, await keyedAttemptId("session-a", key));
  assert.notEqual(id, await keyedAttemptId("session-b", key));
  assert.notEqual(id, await keyedAttemptId("session-a", crypto.randomUUID()));
  assert.match(id, /^[a-f0-9-]{36}$/);
});
test("FINAL successful receipts plus exact token transfer establish withdrawal success", () => {
  const a = attempt();
  const o = verifyOutcome(receipt(), a);
  assert.equal(o.state, "confirmed");
  assert.equal(summarizeOutcomes(a, [o]).state, "confirmed");
  assert.match(summarizeOutcomes(a, [o]).message, /withdrawal/);
});
test("Withdrawal inclusion or missing receipt data stays pending", () => {
  const a = attempt();
  const r = receipt();
  r.final_execution_status = "EXECUTED_OPTIMISTIC";
  assert.equal(verifyOutcome(r, a).state, "pending");
  r.final_execution_status = "FINAL";
  delete r.receipts_outcome;
  assert.equal(verifyOutcome(r, a).state, "pending");
});
test("Withdrawal transaction and downstream receipt failures override transfer logs", () => {
  for (const change of [
    (r: any) => (r.status = { Failure: { ActionError: "failed" } }),
    (r: any) =>
      (r.receipts_outcome[2].outcome.status = {
        Failure: { ActionError: "failed" },
      }),
  ]) {
    const r = receipt();
    change(r);
    assert.equal(verifyOutcome(r, attempt()).state, "failed");
  }
});
test("Burrow withdraw_failed/refund defeats successful execute and even a matching transfer", () => {
  const r = receipt("final-refund.json");
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
  assert.match(verifyOutcome(r, attempt()).message, /withdraw_failed/);
  const successful = receipt();
  successful.receipts_outcome.push(...r.receipts_outcome);
  assert.equal(verifyOutcome(successful, attempt()).state, "failed");
});
test("Started/succeeded Burrow logs without the actual USDC transfer do not prove payout", () => {
  const r = receipt();
  r.receipts_outcome.splice(1, 1);
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
});
for (const [name, change] of [
  [
    "wrong token executor",
    (r: any) => (r.receipts_outcome[1].outcome.executor_id = "spoof.near"),
  ],
  [
    "wrong sender",
    (r: any) => transfer(r, (e) => (e.data[0].old_owner_id = "other.near")),
  ],
  [
    "wrong recipient",
    (r: any) => transfer(r, (e) => (e.data[0].new_owner_id = "other.near")),
  ],
  [
    "inner units in native token event",
    (r: any) => transfer(r, (e) => (e.data[0].amount = "12345678000000000000")),
  ],
  [
    "one-unit short payout",
    (r: any) => transfer(r, (e) => (e.data[0].amount = "12345677")),
  ],
  [
    "numeric amount",
    (r: any) => transfer(r, (e) => (e.data[0].amount = 12345678)),
  ],
  ["wrong standard", (r: any) => transfer(r, (e) => (e.standard = "burrow"))],
  [
    "wrong event version",
    (r: any) => transfer(r, (e) => (e.version = "0.0.0")),
  ],
  [
    "duplicate payout event",
    (r: any) => r.receipts_outcome.push(structuredClone(r.receipts_outcome[1])),
  ],
  [
    "malformed payout log",
    (r: any) => (r.receipts_outcome[1].outcome.logs = ["EVENT_JSON:{"]),
  ],
] as const)
  test("Withdrawal rejects " + name, () => {
    const r = receipt();
    change(r);
    assert.equal(verifyOutcome(r, attempt()).state, "failed");
  });
test("A reverse USDC refund transfer is not a confirmed exit", () => {
  const r = receipt();
  const back = structuredClone(r.receipts_outcome[1]);
  const e = JSON.parse(back.outcome.logs[0].slice(11));
  [e.data[0].old_owner_id, e.data[0].new_owner_id] = [
    e.data[0].new_owner_id,
    e.data[0].old_owner_id,
  ];
  back.outcome.logs[0] = "EVENT_JSON:" + JSON.stringify(e);
  r.receipts_outcome.push(back);
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
});
test("False callback value and incomplete receipt statuses fail closed", () => {
  const r = receipt();
  r.status.SuccessValue = btoa("false");
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
  const unknown = receipt();
  delete unknown.receipts_outcome[1].outcome.status;
  assert.equal(verifyOutcome(unknown, attempt()).state, "pending");
});
test("Signer/receiver/args/attached yocto/gas mismatch cannot be attributed", () => {
  for (const change of [
    (r: any) => (r.transaction.signer_id = "other.near"),
    (r: any) => (r.transaction.receiver_id = USDC),
    (r: any) => (r.transaction.actions[0].FunctionCall.args = btoa("{}")),
    (r: any) => (r.transaction.actions[0].FunctionCall.deposit = "0"),
    (r: any) => (r.transaction.actions[0].FunctionCall.gas = "1"),
  ]) {
    const r = receipt();
    change(r);
    assert.throws(() => verifyOutcome(r, attempt()), /match/);
  }
});

test("Incomplete receipt cannot hide a later explicit refund", () => {
  const r = receipt();
  delete r.receipts_outcome[1].outcome.status;
  r.receipts_outcome.push(...receipt("final-refund.json").receipts_outcome);
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
});
test("Malformed token event entries cannot masquerade as payouts", () => {
  const r = receipt();
  transfer(r, (e) => (e.data = [null]));
  assert.equal(verifyOutcome(r, attempt()).state, "failed");
});
test("Withdraw summary rejects duplicate or foreign step proofs and preserves pending/failure", () => {
  const a = attempt();
  const o = verifyOutcome(receipt(), a);
  assert.equal(summarizeOutcomes(a, [o, o]).state, "failed");
  assert.equal(summarizeOutcomes(a, [{ ...o, index: 7 }]).state, "failed");
  assert.equal(
    summarizeOutcomes(a, [{ ...o, state: "pending" }]).state,
    "submitted",
  );
  assert.equal(
    summarizeOutcomes(a, [{ ...o, state: "failed" }]).state,
    "failed",
  );
  assert.equal(summarizeOutcomes(a, []).state, "submitted");
});
