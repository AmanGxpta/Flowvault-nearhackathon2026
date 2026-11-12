import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLifecycleQuote,
  LINEAR_CONTRACT,
} from "../lib/flowvault/staking-lifecycle.ts";
import { verifyLinearReceipts } from "../lib/flowvault/staking-receipts.ts";
const N = 10n ** 24n,
  owner = "fixture.near";
function fixture(kind: "stake" | "unstake" | "withdraw_unstaked" = "stake") {
  const fn = {
    methodName:
      kind === "stake"
        ? "deposit_and_stake"
        : kind === "unstake"
          ? "unstake"
          : "withdraw_all",
    args: kind === "unstake" ? { amount: String(N) } : {},
    deposit: kind === "stake" ? N : 0n,
    gas: 100000000000000n,
  };
  const q = normalizeLifecycleQuote(
    kind,
    {
      amount: N,
      fee: 1n,
      upfront: 2n,
      reserve: N / 2n,
      maxStakeable: N,
      shares: N,
      price: N,
      withdrawsFirst: 0n,
      relocks: 0n,
      resetsTimer: false,
      unlock: { epoch: null, earliestEpoch: 104n },
      transactions: [
        { receiverId: LINEAR_CONTRACT, actions: [{ functionCall: fn }] },
      ],
    },
    String(N),
  );
  const event = {
    account_id: owner,
    ...(kind === "stake"
      ? { staked_amount: String(N), minted_stake_shares: String(N) }
      : kind === "unstake"
        ? {
            unstaked_amount: String(N),
            burnt_stake_shares: String(N),
            unstaked_available_epoch_height: 104,
          }
        : { amount: String(N) }),
  };
  const log = (standard: string, event: string, data: any) =>
    "EVENT_JSON:" +
    JSON.stringify({
      standard,
      version: standard === "linear" ? "1.0.1" : "1.0.0",
      event,
      data: [data],
    });
  const r: any = {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: {
      signer_id: owner,
      receiver_id: LINEAR_CONTRACT,
      actions: [
        {
          FunctionCall: {
            method_name: fn.methodName,
            args: btoa(JSON.stringify(fn.args)),
            gas: String(fn.gas),
            deposit: String(fn.deposit),
          },
        },
      ],
    },
    receipts_outcome: [
      {
        id: "protocol",
        outcome: {
          executor_id: LINEAR_CONTRACT,
          status: { SuccessValue: "" },
          logs: [
            log(
              "linear",
              kind === "stake"
                ? "stake"
                : kind === "unstake"
                  ? "unstake"
                  : "withdraw",
              event,
            ),
            ...(kind === "withdraw_unstaked"
              ? []
              : [
                  log("nep141", kind === "stake" ? "ft_mint" : "ft_burn", {
                    owner_id: owner,
                    amount: String(N),
                  }),
                ]),
          ],
        },
      },
      {
        id: "native",
        outcome: { executor_id: owner, status: { SuccessValue: "" }, logs: [] },
      },
    ],
  };
  const transfers = [
    {
      receipt_id: "native",
      predecessor_id: LINEAR_CONTRACT,
      receiver_id: owner,
      receipt: { Action: { actions: [{ Transfer: { deposit: String(N) } }] } },
    },
  ];
  return { q, r, transfers };
}
test("LiNEAR stake/unstake confirmations require finalized protocol and token effects", () => {
  for (const kind of ["stake", "unstake"] as const) {
    const { q, r } = fixture(kind);
    const proof = verifyLinearReceipts(r, q, owner);
    assert.equal(proof.state, "confirmed");
    assert.equal(proof.amountRaw, String(N));
    if (kind === "unstake") assert.equal(proof.unlockEpoch, "104");
    for (const mutate of [
      (x: any) => (x.final_execution_status = "EXECUTED"),
      (x: any) => x.receipts_outcome[0].outcome.logs.pop(),
      (x: any) => (x.receipts_outcome[0].outcome.executor_id = "evil.near"),
      (x: any) => (x.receipts_outcome[0].outcome.status = { Failure: {} }),
    ]) {
      const x = structuredClone(r);
      mutate(x);
      assert.notEqual(verifyLinearReceipts(x, q, owner).state, "confirmed");
    }
  }
});
test("LiNEAR withdrawal is not confirmed from a withdraw log without actual successful NEAR transfer receipt", () => {
  const { q, r, transfers } = fixture("withdraw_unstaked");
  assert.equal(verifyLinearReceipts(r, q, owner).state, "pending");
  assert.equal(verifyLinearReceipts(r, q, owner, transfers).state, "confirmed");
  for (const change of [
    { predecessor_id: "evil.near" },
    { receiver_id: "other.near" },
    { receipt_id: "unknown" },
    { receipt: { Action: { actions: [{ Transfer: { deposit: "1" } }] } } },
  ])
    assert.equal(
      verifyLinearReceipts(r, q, owner, [{ ...transfers[0], ...change }]).state,
      "pending",
    );
  r.receipts_outcome[1].outcome.status = { Failure: {} };
  assert.equal(verifyLinearReceipts(r, q, owner, transfers).state, "failed");
});
test("Staking proof rejects identity, payload, duplicate and malformed economic evidence", () => {
  const { q, r } = fixture();
  for (const mutate of [
    (x: any) => (x.transaction.signer_id = "other.near"),
    (x: any) => (x.transaction.actions[0].FunctionCall.deposit = "1"),
    (x: any) => (x.receipts_outcome[0].outcome.logs[0] = "EVENT_JSON:{bad"),
  ]) {
    const x = structuredClone(r);
    mutate(x);
    assert.throws(() => verifyLinearReceipts(x, q, owner));
  }
  r.receipts_outcome[0].outcome.logs.push(
    r.receipts_outcome[0].outcome.logs[0],
  );
  assert.equal(verifyLinearReceipts(r, q, owner).state, "pending");
});

test("shared journal verification dispatch cannot confirm a staking attempt without economic proof", async () => {
  const { verifyOutcome } = await import("../lib/flowvault/execution.ts");
  const { q, r } = fixture("stake");
  const attempt: any = {
    kind: "stake",
    accountId: owner,
    preparation: { kind: "stake", quote: q, transactions: q.transactions },
  };
  assert.equal(verifyOutcome(r, attempt).state, "confirmed");
  r.receipts_outcome[0].outcome.logs = [];
  assert.equal(verifyOutcome(r, attempt).state, "pending");
});
