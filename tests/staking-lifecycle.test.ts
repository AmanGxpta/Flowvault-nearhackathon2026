import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLifecycleQuote,
  linearExitObservation,
  LINEAR_CONTRACT,
} from "../lib/flowvault/staking-lifecycle.ts";
const N = 10n ** 24n;
function quote(kind: "stake" | "unstake" | "withdraw_unstaked"): any {
  return {
    amount: N,
    fee: N / 100n,
    upfront: N / 50n,
    reserve: N / 2n,
    maxStakeable: 2n * N,
    shares: N,
    price: N,
    withdrawsFirst: 0n,
    relocks: 0n,
    resetsTimer: false,
    unlock: { epoch: null, earliestEpoch: 104n, latestEpoch: null },
    transactions: [
      {
        receiverId: LINEAR_CONTRACT,
        actions: [
          {
            functionCall: {
              methodName:
                kind === "stake"
                  ? "deposit_and_stake"
                  : kind === "unstake"
                    ? "unstake"
                    : "withdraw_all",
              args: kind === "unstake" ? { amount: N.toString() } : {},
              deposit: kind === "stake" ? N : 0n,
              gas: 100000000000000n,
            },
          },
        ],
      },
    ],
  };
}
test("LiNEAR lifecycle quotes preserve raw units and validate exact method payload without signing", () => {
  for (const kind of ["stake", "unstake", "withdraw_unstaked"] as const) {
    const q = normalizeLifecycleQuote(kind, quote(kind), N.toString());
    assert.equal(q.kind, kind);
    assert.equal(q.signable, false);
    assert.equal(q.preparesWalletAttempt, false);
    assert.equal(q.transactions[0].receiverId, LINEAR_CONTRACT);
    assert.equal(q.nearAmountRaw, N.toString());
    assert.equal(q.instant.supported, false);
  }
});
test("LiNEAR entry guards amount, shares, exit gas reserve and protocol max stakeable", () => {
  for (const change of [
    { amount: 2n * N },
    { shares: 0n },
    { price: 0n },
    { reserve: N / 10n },
    { maxStakeable: N / 2n },
    { fee: "1" },
  ])
    assert.throws(() =>
      normalizeLifecycleQuote(
        "stake",
        { ...quote("stake"), ...change },
        N.toString(),
      ),
    );
});
test("LiNEAR delayed exit never silently withdraws first, resets an existing timer, or relocks funds", () => {
  for (const change of [
    { withdrawsFirst: 1n },
    { resetsTimer: true },
    { relocks: 1n },
    { shares: N + 1n },
  ])
    assert.throws(() =>
      normalizeLifecycleQuote(
        "unstake",
        { ...quote("unstake"), ...change },
        N.toString(),
      ),
    );
  const q = quote("unstake");
  q.transactions[0].actions[0].functionCall.methodName = "unstake_all";
  q.transactions[0].actions[0].functionCall.args = {};
  assert.equal(
    normalizeLifecycleQuote("unstake", q, N.toString()).transactions[0]
      .actions[0].params.methodName,
    "unstake_all",
  );
  assert.throws(
    () =>
      normalizeLifecycleQuote(
        "withdraw_unstaked",
        quote("withdraw_unstaked"),
        (2n * N).toString(),
      ),
    /Claim amount/,
  );
});
test("LiNEAR quotes reject wrong receiver, action bundling, injected args, deposits or gas", () => {
  for (const mutate of [
    (q: any) => (q.transactions[0].receiverId = "evil.near"),
    (q: any) => q.transactions[0].actions.push(q.transactions[0].actions[0]),
    (q: any) =>
      (q.transactions[0].actions[0].functionCall.args = {
        receiver: "evil.near",
      }),
    (q: any) => (q.transactions[0].actions[0].functionCall.deposit = 1n),
    (q: any) =>
      (q.transactions[0].actions[0].functionCall.gas = 301000000000000n),
  ]) {
    const q = quote("unstake");
    mutate(q);
    assert.throws(() => normalizeLifecycleQuote("unstake", q, N.toString()));
  }
});
function observation(epoch = 100n, liquidity = 10n * N) {
  return linearExitObservation(
    "fixture.near",
    {
      shares: 2n * N,
      unstaked: N,
      unlockEpoch: 104n,
      canWithdraw: epoch >= 104n,
    },
    {
      contract: LINEAR_CONTRACT,
      price: (3n * N) / 2n,
      codeHashKnown: true,
      paused: false,
      liquidity,
      kept: N,
    },
    { height: epoch },
    "2026-11-12T12:00:00Z",
  );
}
test("LiNEAR shares resolve underlying exposure once; epoch wait never becomes guaranteed availability", () => {
  const o = observation();
  assert.equal(o.underlying.quantityRaw, (3n * N).toString());
  assert.equal(o.positions[0].valuation, null);
  assert.equal(o.pendingExit?.epochsRemaining, "4");
  assert.equal(o.pendingExit?.availableAt, null);
  assert.equal(o.pendingExit?.claimable, false);
  assert.equal(o.pendingExit?.reason, "EPOCH_WAIT");
  const unlocked = observation(104n);
  assert.equal(unlocked.pendingExit?.availableAt, "2026-11-12T12:00:00Z");
  assert.equal(unlocked.pendingExit?.claimable, true);
  const waiting = observation(104n, N);
  assert.equal(waiting.pendingExit?.availableAt, null);
  assert.equal(waiting.pendingExit?.reason, "LIQUIDITY_OR_PAUSE");
});
