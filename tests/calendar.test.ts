import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarRanking } from "../lib/flowvault/calendar.ts";
import { seed, demoMarket, demoPortfolio } from "./fixtures/legacy-example.ts";
const now = Date.now();
function m() {
  const w = seed();
  w.mandate.reserve = "1000";
  w.mandate.cashAmount = "0";
  w.mandate.obligations = [
    {
      id: "invoice",
      label: "Invoice",
      recipient: "",
      destination: "base",
      token: "USDC",
      amount: "1000",
      dueDate: new Date(now + 2 * 86400000).toISOString().slice(0, 10),
      status: "pending",
    },
  ];
  return w.mandate;
}
test("Date ranking excludes the high-rate vault and calculates net earnings after costs against liquid baseline", () => {
  const r = calendarRanking(
    m(),
    demoMarket(),
    demoPortfolio(),
    { "rhea-usdc": { entryCost: "0.1", exitCost: "0.1", liquidity: "100000" } },
    now,
  );
  assert(
    r.strategies
      .find((s) => s.id === "usdc-vault")!
      .reasons.includes("EXIT_MISSES_DUE_DATE"),
  );
  const row = r.strategies[0].dates[0];
  assert.equal(row.stayingLiquidEarnings, "0");
  assert(row.netEarnings !== null);
  assert.equal(row.entryCost, "0.1");
});
test("Unknown live exits/costs are named exclusions, not zero fees or guaranteed liquidity", () => {
  const p = demoPortfolio();
  p.source = "live";
  const s = demoMarket();
  s.source = "live";
  s.markets[0].exitDays = null;
  const r = calendarRanking(m(), s, p, {}, now);
  assert(r.strategies[0].reasons.includes("EXIT_WINDOW_UNKNOWN"));
  assert(r.strategies[0].reasons.includes("COSTS_UNVERIFIED"));
  assert.equal(r.chosen, null);
});
test("Cost-negative strategies lose to staying liquid; every obligation date is checked", () => {
  const mandate = m();
  mandate.obligations!.push({
    ...mandate.obligations![0],
    id: "overdue",
    dueDate: "2020-01-01",
  });
  const r = calendarRanking(
    mandate,
    demoMarket(),
    demoPortfolio(),
    { "rhea-usdc": { entryCost: "100", exitCost: "100", liquidity: "100000" } },
    now,
  );
  assert(
    r.strategies[0].dates.some((d) => d.exclusions.includes("DEADLINE_PASSED")),
  );
  assert(r.strategies[0].reasons.includes("NO_NET_ADVANTAGE_OVER_LIQUID"));
});

test("Exit lead time stops modeled earnings and stale portfolio cannot be ranked", () => {
  const mandate = m();
  mandate.obligations![0].dueDate = new Date(now + 10 * 86400000)
    .toISOString()
    .slice(0, 10);
  const market = demoMarket();
  market.markets[0].exitDays = 3;
  const p = demoPortfolio();
  let r = calendarRanking(mandate, market, p, {}, now);
  const d = r.strategies[0].dates[0];
  assert.equal(d.earningDays!, d.days - 3);
  p.capturedAt = new Date(0).toISOString();
  r = calendarRanking(mandate, market, p, {}, now);
  assert.equal(r.chosen, null);
  assert.ok(r.strategies[0].reasons.includes("STALE_PORTFOLIO"));
});

test("Invalid rate, exit, fees or distant dates are named exclusions instead of invented earnings", () => {
  const mandate = m();
  const market = demoMarket();
  market.markets[0].exitDays = -1;
  market.markets[0].apr = "unverified";
  let r = calendarRanking(
    mandate,
    market,
    demoPortfolio(),
    { "rhea-usdc": { entryCost: "unknown", exitCost: "0", liquidity: null } },
    now,
  );
  assert.equal(r.strategies[0].dates[0].netEarnings, null);
  for (const c of [
    "EXIT_WINDOW_UNKNOWN",
    "COSTS_UNVERIFIED",
    "RATE_OR_AVAILABILITY_UNVERIFIED",
  ])
    assert.ok(r.strategies[0].reasons.includes(c));
  mandate.obligations![0].dueDate = "2099-01-01";
  assert.ok(
    calendarRanking(
      mandate,
      demoMarket(),
      demoPortfolio(),
      {},
      now,
    ).strategies[0].reasons.includes("HORIZON_UNSUPPORTED"),
  );
});
