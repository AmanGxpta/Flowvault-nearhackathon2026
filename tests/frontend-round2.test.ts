import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, demoPortfolio, demoMarket } from "../lib/flowvault/seed.ts";
import { compareObligation } from "../lib/flowvault/payment-comparison.ts";
import { exampleCashQuote } from "../lib/flowvault/example-quote.ts";
import { compareCash } from "../lib/flowvault/planner.ts";
import { otherObligationHoldback } from "../lib/flowvault/payments.ts";
import {
  stakingRateVerdict,
  stakingValidators,
} from "../lib/flowvault/staking-options.ts";

test("example LST policies explicitly permit borrowing; protected ETH remains hold only", () => {
  const w = seed();
  for (const name of ["LiNEAR", "rNEAR"])
    assert.ok(
      w.policy?.assetRows
        ?.find((r) => r.asset === name)
        ?.uses.includes("borrow"),
    );
  assert.deepEqual(w.policy?.assetRows?.find((r) => r.asset === "ETH")?.uses, [
    "hold",
  ]);
});
test("obligation comparison selects identity and agrees with equal-net quote cash holdback", () => {
  const now = Date.parse("2026-11-12T12:00:00Z"),
    w = seed(now),
    p = demoPortfolio(now),
    m = demoMarket(now),
    o = w.obligations.find((o) => o.id === "rent-aman")!;
  const c = compareObligation(
    o.id,
    { workspace: w, portfolio: p, market: m, ledger: [], creditCapacity: null },
    now,
  );
  const q = exampleCashQuote(o.amount, o.destination, now);
  const cash = compareCash(
    o.amount,
    11,
    q,
    m,
    p,
    w.mandate,
    now,
    otherObligationHoldback(w, o, now),
  );
  assert.equal(c.obligationId, o.id);
  assert.equal(c.sources.idleAvailable, "3690");
  assert.equal(cash.cashAvailable, c.sources.idleAvailable);
  assert.equal(c.quote.maxInput, cash.fundingUpper);
  assert.equal(c.executionSupported, true);
  assert.equal(c.signable, false);
  assert.throws(
    () =>
      compareObligation(
        "missing",
        {
          workspace: w,
          portfolio: p,
          market: m,
          ledger: [],
          creditCapacity: null,
        },
        now,
      ),
    /not found/,
  );
  o.status = "paid";
  assert.throws(
    () =>
      compareObligation(
        o.id,
        {
          workspace: w,
          portfolio: p,
          market: m,
          ledger: [],
          creditCapacity: null,
        },
        now,
      ),
    /not payable/,
  );
});
test("unknown, NaN and negative staking APR fail eligibility while known rates preserve other checks", () => {
  for (const apr of [null, NaN, -1]) {
    const r = stakingRateVerdict(apr, true, false);
    assert.equal(r.eligible, false);
    assert.ok(r.refusals.includes("RATE_UNVERIFIED"));
  }
  assert.equal(stakingRateVerdict(8, true, false).eligible, true);
  assert.equal(stakingRateVerdict(8, true, true).eligible, false);
  assert.equal(stakingRateVerdict(8, false, false).eligible, false);
});
test("example validators do not invent live verified pool identities", async () => {
  const r = await stakingValidators(seed());
  assert.equal(r.fictional, true);
  assert.deepEqual(r.validators, []);
  assert.equal(r.signable, false);
});

test("a missing NEAR source wallet is unknown in an equal-net quote rather than zero", () => {
  const w = seed(),
    p = demoPortfolio(),
    m = demoMarket();
  p.sections = [
    {
      id: "near-usdc",
      status: "unavailable",
      capturedAt: p.capturedAt,
      reasons: ["RPC failed"],
      positionIds: [],
      affects: ["cashNow", "netWorth"],
    },
  ];
  p.positions = p.positions.filter((x) => x.id !== "usdc-wallet");
  const c = compareCash(
    "1",
    11,
    exampleCashQuote("1", "base"),
    m,
    p,
    w.mandate,
  );
  assert.equal(c.cashAvailable, null);
  assert.equal(c.capitalNeeded, null);
  assert.equal(c.supplyCarry, null);
  assert.ok(c.blockers.some((x) => x.includes("wallet USDC is unavailable")));
});
