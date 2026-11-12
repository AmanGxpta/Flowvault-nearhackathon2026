import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStakeQuote,
  stakingFit,
  unsignedStake,
} from "../lib/flowvault/staking-options.ts";
import { seed, personalSeed } from "../lib/flowvault/seed.ts";
import { units } from "../lib/flowvault/money.ts";
const quote = () => ({
  amount: units("1", 24),
  fee: 1n,
  upfront: 2n,
  reserve: units("0.5", 24),
  maxStakeable: units("2", 24),
  transactions: [
    {
      receiverId: "pool.poolv1.near",
      actions: [
        {
          functionCall: {
            methodName: "deposit_and_stake",
            args: {},
            gas: 50000000000000n,
            deposit: units("1", 24),
          },
        },
      ],
    },
  ],
});
test("staking payload remains an unsigned SDK quote with exact native units and gas/exit reserve", () => {
  const r = normalizeStakeQuote(quote(), "pool.poolv1.near", "1");
  assert.equal(r.amountRaw, units("1", 24).toString());
  assert.equal(r.exitReserveNear, "0.5");
  assert.equal(
    r.unsignedTransactions[0].actions[0].functionCall.deposit,
    units("1", 24).toString(),
  );
  for (const mutate of [
    (q: any) => (q.reserve = 0n),
    (q: any) => (q.amount = 2n),
    (q: any) => (q.transactions[0].receiverId = "evil.near"),
    (q: any) =>
      (q.transactions[0].actions[0].functionCall.methodName = "transfer"),
    (q: any) => (q.transactions[0].actions[0].functionCall.deposit = 1n),
    (q: any) => (q.fee = undefined),
  ]) {
    const q = quote();
    mutate(q);
    assert.throws(() => normalizeStakeQuote(q, "pool.poolv1.near", "1"));
  }
});
test("staking timing includes saved lead days and never guarantees liquidity from an estimate", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const w = seed(now);
  assert.equal(stakingFit(w, 6.9 * 3600000, now).fits, false);
  w.obligations = w.obligations.map((o) => ({ ...o, dueDate: "2026-12-25" }));
  assert.equal(stakingFit(w, 6.9 * 3600000, now).fits, null);
  assert.equal(stakingFit(w, 6.9 * 3600000, now).guaranteed, false);
});
test("example staking stays non-signable, and live unsigned quotes require identity, asset/venue/method permission", async () => {
  assert.equal((await unsignedStake(seed(), "native", "1")).signable, false);
  let w = personalSeed();
  await assert.rejects(unsignedStake(w, "native", "1"), /live NEAR account/);
  w.accountId = "owner.near";
  await assert.rejects(unsignedStake(w, "linear", "1"), /VENUE_NOT_ALLOWED/);
  w.policy!.venues.push("linear-protocol.near");
  w.policy!.assetRows = [{ asset: "NEAR", priority: "P2", uses: ["hold"] }];
  await assert.rejects(
    unsignedStake(w, "linear", "1"),
    /ASSET_USE_NOT_ALLOWED/,
  );
  w.policy!.assetRows[0].uses.push("stake");
  await assert.rejects(unsignedStake(w, "linear", "1"), /METHOD_NOT_ALLOWED/);
});

test("bigint details in SDK warnings survive JSON response serialization without precision loss", () => {
  const q = {
    ...quote(),
    warnings: [{ code: "fixture", details: { amount: 9007199254740993n } }],
  };
  const out = normalizeStakeQuote(q, "pool.poolv1.near", "1");
  assert.equal(out.warnings[0].details.amount, "9007199254740993");
  assert.doesNotThrow(() => JSON.stringify(out));
});
