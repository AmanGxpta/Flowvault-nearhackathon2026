import test from "node:test";
import assert from "node:assert/strict";
import {
  attemptLedger,
  paymentLedger,
  buildLedger,
  buildStatement,
  accruedInterest,
  ledgerCsv,
  demoLedger,
} from "../lib/flowvault/ledger.ts";
import type { LedgerEntry } from "../lib/flowvault/contracts.ts";

const T = "2026-11-10T10:00:00.000Z";
const NOW = Date.parse("2026-11-12T12:00:00Z");
const prices = {
  source: "live",
  oracle: "aggregate-oracle.near",
  basis: "test",
  blockHeight: 1,
  capturedAt: T,
  freshUntil: "2099-01-01T00:00:00Z",
  prices: {
    NEAR: { usdE12: "3500000000000", confE12: "0", publishedAt: T, priceIdentifier: "n" },
    USDC: { usdE12: "1000000000000", confE12: "0", publishedAt: T, priceIdentifier: "u" },
  },
  lstNearPerToken: {},
  unavailable: [],
} as any;

function attempt(over: Record<string, unknown>): any {
  return {
    id: "a1",
    accountId: "owner.near",
    kind: "supply",
    amount: "100",
    mandateVersion: 1,
    createdAt: T,
    expiresAt: T,
    state: "confirmed",
    preparation: {},
    hashes: ["h1"],
    message: "",
    updatedAt: T,
    timeline: [
      { id: "s", sequence: 1, at: T, phase: "receipt:h1", status: "confirmed", message: "", explorerLinks: [], fees: [{ unit: "yoctoNEAR", amount: "1000000000000000000000", verified: true }], refund: null, evidence: null },
    ],
    ...over,
  };
}
const lendingPrep = (kind: string, amountRaw: string, debtBefore?: string) => ({
  kind, accountId: "owner.near", asset: "USDC", tokenId: "usdc", amount: "x", amountRaw, decimals: 6, usdcValueRaw: amountRaw,
  request: { asset: "USDC", amountRaw, approveNewDebt: kind === "borrow" }, debtBeforeUsdcRaw: debtBefore,
});

test("supply is internal (net worth 0) and gas is a priced fee", () => {
  const e = attemptLedger(attempt({}), prices);
  const t = e.find((x) => x.kind === "internal_transfer")!;
  assert.equal(t.amountRaw, "100000000");
  assert.equal(t.netWorthEffectUsdcRaw, "0");
  assert.equal(t.attemptId, "a1");
  assert.deepEqual(t.txHashes, ["h1"]);
  const fee = e.find((x) => x.kind === "fee")!;
  assert.equal(fee.amountRaw, "1000000000000000000000"); // 0.001 NEAR
  assert.equal(fee.usdcRaw, "3500"); // $0.0035
  assert.equal(fee.netWorthEffectUsdcRaw, "-3500");
});

test("unknown attempts are unresolved and never counted; failed attempts book only gas", () => {
  const u = attemptLedger(attempt({ state: "unknown" }), prices);
  assert.equal(u[0].status, "unresolved");
  assert.equal(u[0].netWorthEffectUsdcRaw, null);
  const f = attemptLedger(attempt({ state: "failed" }), prices);
  assert.deepEqual(f.map((x) => x.kind), ["fee"]);
  assert.deepEqual(attemptLedger(attempt({ state: "prepared", hashes: [] }), prices), []);
  // Without prices the gas stays visible but unvalued.
  assert.equal(attemptLedger(attempt({}), null).find((x) => x.kind === "fee")!.usdcRaw, null);
});

test("borrow adds a matching liability, repay removes it; owed principal follows", () => {
  const attempts = [
    attempt({ id: "b1", kind: "borrow", amount: "500", preparation: lendingPrep("borrow", "500000000", "0"), timeline: [] }),
    attempt({ id: "r1", kind: "repay", amount: "200", preparation: lendingPrep("repay", "200000000"), timeline: [] }),
  ];
  const entries = buildLedger({ source: "live", accountId: "owner.near", attempts, payments: [], outbox: [], prices });
  const b = entries.find((e) => e.kind === "borrow")!;
  assert.equal(b.liabilityEffectUsdcRaw, "500000000");
  assert.equal(b.netWorthEffectUsdcRaw, "0");
  assert.equal(entries.find((e) => e.kind === "repay")!.liabilityEffectUsdcRaw, "-200000000");
  const s = buildStatement({ source: "live", accountId: "owner.near", entries, attempts, from: "2026-11-01T00:00:00.000Z", to: "2026-11-13T00:00:00.000Z", now: NOW });
  assert.equal(s.owed.journaledPrincipalUsdcRaw, "300000000");
  assert.equal(s.owed.borrowedInPeriod.usdcRaw, "500000000");
  assert.equal(s.capital.netWorthEffect.usdcRaw, "0");
});

test("a plan-outbox entry for the same effect only adds plan links (no double count)", () => {
  const outbox: LedgerEntry[] = [
    { id: "step1:internal_transfer", at: T, kind: "internal_transfer", asset: "USDC", chain: "near", amountRaw: "100000000", decimals: 6, usdcRaw: "100000000", netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: "0", realized: true, basis: "plan", status: "confirmed", planId: "p1", stepId: "step1", attemptId: "a1", positionId: "rhea-usdc", txHashes: ["h1"], source: "live" },
  ];
  const entries = buildLedger({ source: "live", accountId: "owner.near", attempts: [attempt({})], payments: [], outbox, prices });
  const moves = entries.filter((e) => e.kind === "internal_transfer");
  assert.equal(moves.length, 1);
  assert.equal(moves[0].planId, "p1");
  assert.equal(moves[0].stepId, "step1");
  // Another account's or another source's rows never enter.
  assert.equal(buildLedger({ source: "live", accountId: "other.near", attempts: [attempt({})], payments: [], outbox: [], prices }).length, 0);
  assert.equal(buildLedger({ source: "demo", accountId: null, attempts: [], payments: [], outbox, prices }).length, 0);
});

const payment = (over: Record<string, unknown>): any => ({
  id: "pay1", key: "k", source: "live", accountId: "owner.near", obligationId: "o1",
  obligationSnapshot: { id: "o1", token: "USDC", amount: "1000", destination: "base", dueDate: "2026-11-20" },
  state: "paid", createdAt: T, updatedAt: T, message: "", timeline: [], hashes: ["h2"], depositAttemptId: "d1",
  retainedSignedQuote: { quote: { amountIn: "1004000000" } },
  destinationProof: { amount: "1000000000", decimals: 6, transactionHash: "0xabc" },
  ...over,
});

test("a verified USDC payment books payment_out at the payout value and the route cost as a fee", () => {
  const deposit = attempt({ id: "d1", kind: "pay", amount: "1004.5", timeline: [] });
  const e = paymentLedger(payment({}), deposit);
  const out = e.find((x) => x.kind === "payment_out")!;
  assert.equal(out.netWorthEffectUsdcRaw, "-1000000000");
  assert.equal(out.attemptId, "d1");
  assert.ok(out.txHashes.includes("0xabc"));
  const fee = e.find((x) => x.kind === "fee")!;
  assert.equal(fee.amountRaw, "4500000"); // deposit actually sent minus the payout
  // In flight → pending, not counted; provider-reported refund → unresolved.
  const flight = paymentLedger(payment({ state: "processing", destinationProof: undefined }), deposit);
  assert.equal(flight[0].status, "pending");
  assert.equal(flight[0].netWorthEffectUsdcRaw, null);
  const refunded = paymentLedger(
    payment({ state: "refunded", destinationProof: undefined, timeline: [{ phase: "provider", refund: { reportedAmount: "1003000000", sourceProofVerified: false } }] }),
    deposit,
  );
  assert.equal(refunded.find((x) => x.kind === "refund")!.status, "unresolved");
});

test("statement: realized totals exclude pending, unresolved and forecasts; unpriced fees fail closed", () => {
  const deposit = attempt({ id: "d1", kind: "pay", amount: "1004.5" });
  const attempts = [attempt({}), deposit];
  const entries = buildLedger({ source: "live", accountId: "owner.near", attempts, payments: [payment({})], outbox: [], prices: null });
  const s = buildStatement({
    source: "live", accountId: "owner.near", entries, attempts, from: "2026-11-01T00:00:00.000Z", to: "2026-11-13T00:00:00.000Z", now: NOW,
    lending: { debtUsdcRaw: "0", borrowApr: "0.08", suppliedUsdcRaw: "1000000000", supplyApr: "0.0365", capturedAt: T },
  });
  assert.equal(s.capital.paymentsOut.usdcRaw, "1000000000");
  assert.equal(s.cost.fees.usdcRaw, null, "gas is unpriced, so the fee total is unavailable");
  assert.equal(s.cost.fees.pricedUsdcRaw, "4500000");
  assert.equal(s.cost.gasNearRaw, "2000000000000000000000");
  assert.equal(s.capital.netWorthEffect.usdcRaw, null);
  assert.equal(s.forecast.entries.length, 1);
  assert.equal(s.forecast.entries[0].realized, false);
  assert.equal(s.forecast.entries[0].amountRaw, "3000000"); // 1,000 × 3.65% × 30/365
  assert.equal(s.earned.yield.usdcRaw, "0");
  // Period filter.
  const later = buildStatement({ source: "live", accountId: "owner.near", entries, from: "2026-11-11T00:00:00.000Z", to: "2026-11-13T00:00:00.000Z", now: NOW });
  assert.equal(later.entries.length, 0);
});

test("accrued interest is booked only when the debt baseline is proven", () => {
  const borrow = attempt({ id: "b1", kind: "borrow", amount: "500", preparation: lendingPrep("borrow", "500000000", "0"), timeline: [] });
  const entries = buildLedger({ source: "live", accountId: "owner.near", attempts: [borrow], payments: [], outbox: [], prices });
  const obs = { debtUsdcRaw: "501250000", borrowApr: "0.08", suppliedUsdcRaw: "0", supplyApr: "0.03", capturedAt: T };
  const i = accruedInterest(entries, [borrow], obs, T)!;
  assert.equal(i.amountRaw, "1250000");
  assert.equal(i.realized, false);
  assert.equal(i.liabilityEffectUsdcRaw, "1250000");
  const unproven = attempt({ id: "b1", kind: "borrow", amount: "500", preparation: lendingPrep("borrow", "500000000", "100000000"), timeline: [] });
  assert.equal(accruedInterest(entries, [unproven], obs, T), null);
});

test("CSV export: one row per entry, quoted, decimals restored, formulas neutralised", () => {
  const e = attemptLedger(attempt({}), prices);
  e[0].basis = '=HYPERLINK("x")';
  const csv = ledgerCsv(e);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 1 + e.length);
  assert.ok(lines[0].startsWith("at,kind,status,realized"));
  assert.ok(lines[1].includes('"100"'));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(lines[2].includes('"-0.0035"'), "negative numbers are not treated as formulas");
});

test("example workspace ledger is fictional and never mixes with live", () => {
  const entries = demoLedger(NOW);
  assert.ok(entries.every((e) => e.source === "demo" && e.basis.startsWith("Fictional")));
  const s = buildStatement({ source: "demo", accountId: null, entries, from: "2026-10-01T00:00:00.000Z", to: "2026-11-13T00:00:00.000Z", now: NOW });
  assert.equal(s.fictional, true);
  assert.equal(s.earned.yield.usdcRaw, "6420000");
  assert.equal(s.capital.netWorthEffect.usdcRaw, String(6420000 - 1500000000 - 1840000));
  assert.deepEqual(s.forecast.entries, []);
});
