import test from "node:test";
import assert from "node:assert/strict";
import { buildBrief, isStableAsset, type BriefInput } from "../lib/flowvault/brief.ts";

const USDC = "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NOW = Date.parse("2026-11-14T12:00:00Z");
const base = (over: Partial<BriefInput> = {}): BriefInput => ({
  rows: [
    { asset: "ETH", kind: "wallet", usd: 1200, catalogId: "eth:eth", network: "eth", amount: 0.4 },
    { asset: "USDC", kind: "wallet", usd: 300, catalogId: USDC, network: "near", amount: 300 },
    { asset: "USDC", kind: "wallet", usd: 200, catalogId: "base:usdc", network: "base", amount: 200 },
    { asset: "USDT", kind: "debt", usd: 50, catalogId: null, network: "eth", amount: 50 },
  ],
  totalUsd: 1650, unvalued: 0,
  limits: { spendableNow: "500.00", surplus: "120.00", reserve: "300.00" },
  rates: [{ tokenId: USDC.slice(5), symbol: "USDC", supplyApy: 8.5 }],
  obligations: [],
  now: NOW,
  ...over,
});

test("the brief opens on the portfolio, adding one asset across chains and leaving debt out of the largest", () => {
  const items = buildBrief(base());
  assert.equal(items[0].label, "Portfolio");
  assert.match(items[0].text, /≈ \$1,650/);
  assert.match(items[0].text, /ETH \$1,200, USDC \$500\.00/);
  assert.doesNotMatch(items[0].text, /USDT/);
  assert.deepEqual(items[0].action?.to, { kind: "view", screen: "portfolio" });
});

test("cash shows spendable and surplus, and is left out when limits weren't read", () => {
  assert.match(buildBrief(base()).find((i) => i.label === "Cash")!.text, /Spendable now \$500\.00; .* \$120\.00/);
  assert.equal(buildBrief(base({ limits: null })).some((i) => i.label === "Cash"), false);
});

test("payments: overdue is its own warning line, the next 7 days lists what's due, and later ones are left out", () => {
  const items = buildBrief(base({ obligations: [
    { label: "Rent", amount: "900", token: "USDC", dueDate: "2026-11-12", status: "pending" },
    { label: "Payroll", amount: "2,000", token: "USDC", dueDate: "2026-11-18", status: "pending" },
    { label: "Later", amount: "10", token: "USDC", dueDate: "2026-12-30", status: "pending" },
    { label: "Paid", amount: "5", token: "USDC", dueDate: "2026-11-15", status: "paid" },
  ] }));
  const overdue = items.find((i) => i.label === "Overdue")!, soon = items.find((i) => i.label === "Next 7 days")!;
  assert.equal(overdue.tone, "warn");
  assert.match(overdue.text, /900 USDC to Rent/);
  assert.match(soon.text, /2,000 USDC to Payroll/);
  assert.doesNotMatch(soon.text, /Later|Paid/);
  assert.deepEqual(soon.action?.to, { kind: "view", screen: "scheduled" });
});

test("a payment due today is not overdue", () => {
  const items = buildBrief(base({ obligations: [{ label: "Today", amount: "1", token: "USDC", dueDate: "2026-11-14", status: "pending" }] }));
  assert.equal(items.some((i) => i.label === "Overdue"), false);
  assert.match(items.find((i) => i.label === "Next 7 days")!.text, /Today/);
});

test("with no payments due it says so, and with payments unread (chat) it says nothing about them", () => {
  assert.equal(buildBrief(base()).find((i) => i.label === "Next 7 days")!.text, "No payments due.");
  const chat = buildBrief(base({ obligations: null }));
  assert.equal(chat.some((i) => i.label === "Next 7 days" || i.label === "Overdue"), false);
});

test("idle stablecoins with a supply rate become a line with an action that opens the supply flow", () => {
  const idle = buildBrief(base()).find((i) => i.label === "Idle money");
  assert.ok(idle, "expected an idle money line");
  assert.equal(idle!.tone, "good");
  assert.ok(idle!.action && ["supply", "swap"].includes(idle!.action.to.kind));
});

test("stablecoin detection", () => {
  for (const s of ["USDC", "usdt", "USDC.e", "DAI", "PYUSD"]) assert.equal(isStableAsset(s), true, s);
  for (const s of ["ETH", "NEAR", "USDCX", "stETH"]) assert.equal(isStableAsset(s), false, s);
});
