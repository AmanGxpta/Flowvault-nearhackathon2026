import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAction } from "../lib/flowvault/action.ts";
import { innerToNative, decimal, units } from "../lib/flowvault/money.ts";
import { allocationPlan } from "../lib/flowvault/planner.ts";
import { seed, demoMarket, demoPortfolio } from "./fixtures/legacy-example.ts";
import type {
  Portfolio,
  Position,
  MarketSnapshot,
} from "../lib/flowvault/types.ts";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const live = (positions: Position[], errors: string[] = []): Portfolio => ({
  accountId: "owner.near",
  source: "live",
  capturedAt: new Date(NOW).toISOString(),
  positions,
  errors,
});
const wallet = (amount: string): Position => ({
  id: "usdc-wallet",
  label: "Wallet USDC",
  asset: "USDC",
  amount,
  kind: "wallet",
});
const rhea = (
  amount: string,
  kind: Position["kind"] = "supplied",
): Position => ({
  id: `rhea-${kind}`,
  label: "Rhea",
  asset: "USDC",
  amount,
  kind,
});
const liveMarket = (): MarketSnapshot => ({
  ...demoMarket(),
  source: "live",
  markets: demoMarket().markets.map((m) =>
    m.id === "rhea-usdc" ? { ...m, exitDays: null } : m,
  ),
});
const mandate = () => ({
  ...seed().mandate,
  reserve: "10000",
  cashAmount: "5000",
  cashDate: "2026-11-13",
});

test("Example workspace recommends withdrawing the reserve shortfall from Rhea", () => {
  const a = nextAction(mandate(), demoMarket(), demoPortfolio(), NOW);
  assert.equal(a.kind, "withdraw");
  if (a.kind !== "withdraw") return;
  assert.equal(a.amount, "3000"); // 12,000 wallet vs 15,000 reserve + cash need
  assert.equal(a.shortfall, "3000");
  assert.match(a.title, /before Nov 13/);
});

test("A withdrawal never exceeds the Rhea supply and states the residual shortfall", () => {
  const a = nextAction(
    mandate(),
    liveMarket(),
    live([wallet("1000"), rhea("2500")]),
    NOW,
  );
  assert.equal(a.kind, "withdraw");
  if (a.kind !== "withdraw") return;
  assert.equal(a.amount, "2500");
  assert.equal(a.shortfall, "14000");
  assert.ok(a.caveats.some((c) => c.includes("11,500 USDC is still missing")));
});

test("A shortfall with nothing in Rhea recommends no transaction", () => {
  const a = nextAction(mandate(), liveMarket(), live([wallet("1000")]), NOW);
  assert.equal(a.kind, "none");
});

test("Surplus goes to an approved Rhea, keeping reserve plus cash need, with the liquidity caveat", () => {
  const a = nextAction(
    mandate(),
    liveMarket(),
    live([wallet("49227.67")]),
    NOW,
  );
  assert.equal(a.kind, "supply");
  if (a.kind !== "supply") return;
  assert.equal(a.amount, "34227.67");
  assert.ok(a.caveats.some((c) => /timing is unverified/.test(c)));
});

test("Surplus without Rhea approval asks for a plan change, not a supply", () => {
  const m = { ...mandate(), approved: ["usdc-vault"] };
  assert.equal(
    nextAction(m, liveMarket(), live([wallet("20000")]), NOW).kind,
    "plan",
  );
});

test("Unverified rate or availability blocks a supply recommendation", () => {
  const market = liveMarket();
  market.markets = market.markets.map((m) =>
    m.id === "rhea-usdc" ? { ...m, apr: null } : m,
  );
  assert.equal(
    nextAction(mandate(), market, live([wallet("20000")]), NOW).kind,
    "none",
  );
});

test("Dust surplus and exact coverage mean nothing to do", () => {
  assert.equal(
    nextAction(mandate(), liveMarket(), live([wallet("15000.5")]), NOW).kind,
    "none",
  );
  assert.equal(
    nextAction(mandate(), liveMarket(), live([wallet("15000")]), NOW).kind,
    "none",
  );
});

test("Collateral or debt routes to Rhea management instead of a move", () => {
  assert.equal(
    nextAction(
      mandate(),
      liveMarket(),
      live([wallet("1000"), rhea("5", "debt")]),
      NOW,
    ).kind,
    "manage",
  );
  assert.equal(
    nextAction(
      mandate(),
      liveMarket(),
      live([wallet("90000"), rhea("5", "collateral")]),
      NOW,
    ).kind,
    "manage",
  );
});

test("Failed balance reads never become a recommendation", () => {
  assert.equal(
    nextAction(
      mandate(),
      liveMarket(),
      live([], ["Account reads failed."]),
      NOW,
    ).kind,
    "none",
  );
});

test("Lending inner units convert to native USDC: assets round down, debt rounds up", () => {
  const inner = 100_123_456_789_012_345_678n; // 6 + 12 decimals
  assert.equal(decimal(innerToNative(inner, 12)), "100.123456");
  assert.equal(decimal(innerToNative(inner, 12, true)), "100.123457");
  assert.equal(
    innerToNative(100_000_000_000_000_000_000n, 12, true),
    100_000_000n,
  );
  assert.throws(() => innerToNative(1n, -1));
});

test("Converted Rhea balances are accepted by the planner (no >6-decimal amounts)", () => {
  const amount = decimal(innerToNative(100_123_456_789_012_345_678n, 12));
  const plan = allocationPlan(
    mandate(),
    liveMarket(),
    live([wallet("1"), rhea(amount)]),
    NOW,
  );
  assert.equal(units(plan.total), units("101.123456"));
});

test("Recommendation text groups thousands exactly; prefill amounts stay raw", () => {
  const a = nextAction(
    mandate(),
    liveMarket(),
    live([wallet("49227.67258")]),
    NOW,
  );
  assert.equal(a.kind, "supply");
  if (a.kind !== "supply") return;
  assert.equal(a.amount, "34227.67258");
  assert.equal(a.title, "Supply 34,227.67258 surplus USDC to Rhea");
});

test("Partial/stale balances and foreign-chain cash cannot establish a NEAR move", () => {
  assert.equal(
    nextAction(
      mandate(),
      liveMarket(),
      live([wallet("20000")], ["Health unavailable"]),
      NOW,
    ).kind,
    "none",
  );
  const stale = live([wallet("20000")]);
  stale.capturedAt = new Date(0).toISOString();
  assert.equal(nextAction(mandate(), liveMarket(), stale, NOW).kind, "none");
  const elsewhere = { ...wallet("20000"), chain: "base" as const };
  assert.equal(
    nextAction(mandate(), liveMarket(), live([elsewhere]), NOW).kind,
    "none",
  );
});
