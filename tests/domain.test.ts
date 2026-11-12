import { test } from "node:test";
import assert from "node:assert/strict";
import { units, decimal, carry } from "../lib/flowvault/money.ts";
import {
  allocationPlan,
  compareCash,
  transition,
} from "../lib/flowvault/planner.ts";
import { seed, demoMarket, demoPortfolio } from "./fixtures/legacy-example.ts";
import type { CashQuote, Operation } from "../lib/flowvault/types.ts";
const quote = (): CashQuote => ({
  source: "demo",
  capturedAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 180000).toISOString(),
  amountOut: "5000",
  minInput: "5001",
  maxInput: "5026",
  buffer: "25",
  destination: "arb",
  seconds: 30,
});
function compare(q = quote()) {
  return compareCash(
    "5000",
    30,
    q,
    demoMarket(),
    demoPortfolio(),
    seed().mandate,
  );
}
test("Protocol precision preserves large 24-decimal values", () => {
  const n = units("1234567890123.123456789012345678901234", 24);
  assert.equal(decimal(n, 24), "1234567890123.123456789012345678901234");
});
test("Reject exponent, negatives, NaN and silent decimal truncation", () => {
  for (const x of ["1e9", "-1", "NaN", "Infinity", "1.1234567"])
    assert.throws(() => units(x));
});
test("Interest arithmetic uses integer principal, with zero APR remaining zero", () => {
  assert.equal(carry(units("1000"), "0", 30), 0n);
  assert.equal(decimal(carry(units("1000"), "0.1", 365)), "100");
});
test("Higher-rate vault cannot bypass an approaching cash need", () => {
  const s = seed();
  const p = allocationPlan(s.mandate, demoMarket(), demoPortfolio());
  assert.equal(p.chosen, "rhea-usdc");
  assert(
    p.candidates
      .find((x) => x.id === "usdc-vault")
      ?.reasons.some((r) => r.includes("cash date")),
  );
});
test("Later cash date permits the example vault, still without execution", () => {
  const m = seed().mandate;
  m.cashDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const p = allocationPlan(m, demoMarket(), demoPortfolio());
  assert.equal(p.chosen, "usdc-vault");
  assert.equal(p.executable, false);
});
test("NEAR staking is excluded from USDC allocation even if approved", () => {
  const m = seed().mandate;
  m.approved = ["linear"];
  const p = allocationPlan(m, demoMarket(), demoPortfolio());
  assert.equal(p.chosen, null);
  assert(
    p.candidates
      .find((x) => x.id === "linear")
      ?.reasons.some((r) => r.includes("NEAR exposure")),
  );
});
test("Reserve plus cash needs cannot manufacture a negative investment balance", () => {
  const m = seed().mandate;
  m.reserve = "100000";
  const p = allocationPlan(m, demoMarket(), demoPortfolio());
  assert.equal(p.deployable, "0");
  assert.equal(p.deficit, "57000");
});
test("Collateral-restricted balances are not treated as withdrawable cash", () => {
  const p = demoPortfolio();
  p.positions = [
    {
      id: "collateral",
      label: "Restricted",
      asset: "USDC",
      amount: "99999",
      kind: "collateral",
    },
  ];
  const c = compareCash("5000", 30, quote(), demoMarket(), p, seed().mandate);
  assert(c.blockers.some((r) => r.includes("unpledged")));
});
test("Comparison must deliver the same net amount", () => {
  assert.throws(() => compare({ ...quote(), amountOut: "4999" }), /net payout/);
});
test("Funding buffer stays separate from routing shortfall", () => {
  const c = compare();
  assert.equal(c.buffer, "25");
  assert.equal(c.routingShortfall, "1");
});
test("Available cash is used without violating reserve floor", () => {
  const c = compare();
  assert.equal(c.cashAvailable, "2000");
  assert.equal(c.capitalNeeded, "3026");
  assert.equal(c.preferred, "Use cash + withdraw");
});
test("Enough unreserved cash avoids an unnecessary loan", () => {
  const p = demoPortfolio();
  p.positions[0].amount = "20000";
  const c = compareCash("5000", 30, quote(), demoMarket(), p, seed().mandate);
  assert.equal(c.preferred, "Use available cash");
  assert.equal(c.borrowCarry, "0");
});
test("Live and example evidence cannot be mixed", () => {
  assert.throws(
    () => compare({ ...quote(), source: "live" }),
    /cannot be mixed/,
  );
});
test("Expired quote forces refresh; no execution is exposed", () => {
  const c = compare({ ...quote(), validUntil: new Date(0).toISOString() });
  assert(c.blockers.some((r) => r.includes("expired")));
  assert.equal(c.executable, false);
});
test("Move-cost limit evaluates shortfall, not the refundable buffer", () => {
  const m = seed().mandate;
  m.maxMoveCost = "2";
  const c = compareCash("5000", 30, quote(), demoMarket(), demoPortfolio(), m);
  assert(!c.blockers.some((r) => r.includes("move-cost")));
  m.maxMoveCost = "0.5";
  assert(
    compareCash(
      "5000",
      30,
      quote(),
      demoMarket(),
      demoPortfolio(),
      m,
    ).blockers.some((r) => r.includes("move-cost")),
  );
});
test("Borrow approval preference is not credit authorization", () => {
  const c = compare();
  assert(c.borrowBlockers.some((r) => r.includes("does not allow")));
  assert(c.borrowBlockers.some((r) => r.includes("repayment source")));
});
const operation = (): Operation => ({
  id: "test",
  title: "Test",
  kind: "cash-request",
  source: "demo",
  state: "draft",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 180000).toISOString(),
  mandateVersion: 1,
  payloadHash: "abc",
  payload: {},
});
test("Changed mandate fences old draft review", () =>
  assert.throws(() => transition(operation(), "reviewed", 2), /plan changed/));
test("Expired draft cannot be reviewed", () =>
  assert.throws(
    () =>
      transition(
        { ...operation(), expiresAt: new Date(0).toISOString() },
        "reviewed",
        1,
      ),
    /expired/,
  ));
test("Review cannot become a broadcast or finalized transaction", () => {
  const reviewed = transition(operation(), "reviewed", 1);
  assert.equal(reviewed.state, "reviewed");
  assert.throws(() => transition(reviewed, "reviewed", 1), /transition/);
});
