import test from "node:test";
import assert from "node:assert/strict";
import {
  capitalView,
  reserveFor,
  attachReservations,
  valuePosition,
  usdcValue,
  UNAVAILABLE,
} from "../lib/flowvault/valuation.ts";
import { pythToE12, readValuationEvidence } from "../lib/flowvault/valuation-evidence.ts";
import type { PriceEvidence } from "../lib/flowvault/valuation-evidence.ts";
import { holdback, obligationCash } from "../lib/flowvault/obligations.ts";
import type { Obligation, Portfolio, Workspace } from "../lib/flowvault/types.ts";

const now = Date.parse("2026-11-12T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
// NEAR $3.50 ± 0.005, USDC $1.0000 ± 0.0001, USDT $1.0002 ± 0.0002 (12-decimal fixed point).
const prices = (over: Partial<PriceEvidence> = {}): PriceEvidence => ({
  source: "live",
  oracle: "aggregate-oracle.near",
  basis: "Rhea Pyth prices test block 1",
  blockHeight: 1,
  capturedAt: iso(now),
  freshUntil: iso(now + 120000),
  prices: {
    NEAR: { usdE12: "3500000000000", confE12: "5000000000", publishedAt: iso(now), priceIdentifier: "a".repeat(64) },
    USDC: { usdE12: "1000000000000", confE12: "100000000", publishedAt: iso(now), priceIdentifier: "b".repeat(64) },
    USDT: { usdE12: "1000200000000", confE12: "200000000", publishedAt: iso(now), priceIdentifier: "c".repeat(64) },
  },
  lstNearPerToken: { LiNEAR: "1430000000000000000000000", rNEAR: "1060000000000000000000000" },
  unavailable: [],
  ...over,
});
const usdt: Obligation = {
  id: "bnb-usdt",
  label: "Supplier",
  recipient: "0x1111111111111111111111111111111111111111",
  destination: "bnb",
  token: "USDT",
  amount: "1000",
  dueDate: "2026-11-20",
  status: "pending",
};
const workspace = (obligations: Obligation[], mode: "live" | "demo" = "live"): Workspace => ({
  mode,
  accountId: mode === "live" ? "owner.near" : null,
  obligations,
  operations: [],
  mandate: {
    source: mode,
    obligations,
    reserve: "100",
    cashAmount: "0",
    cashDate: "2026-11-20",
    destination: "near",
    horizon: 30,
    maxMoveCost: "5",
    approved: ["rhea-usdc"],
    borrowing: false,
    version: 1,
  },
});
const portfolio = (positions: Portfolio["positions"]): Portfolio => ({
  source: "live",
  accountId: "owner.near",
  capturedAt: iso(now),
  errors: [],
  positions,
});

test("Pyth prices convert to 12-decimal fixed point and reject odd shapes", () => {
  assert.deepEqual(pythToE12({ price: "351913096", conf: "501904", expo: -8 }), {
    usdE12: 3519130960000n,
    confE12: 5019040000n,
  });
  assert.throws(() => pythToE12({ price: "1.5", conf: "1", expo: -8 }));
  assert.throws(() => pythToE12({ price: "0", conf: "0", expo: -8 }));
});

test("NEAR is valued at the oracle lower bound; a NEAR liability at the upper bound", () => {
  const p = prices();
  // 10 NEAR × (3.50 − 0.005) / (1 + 0.0001) = 34.946505... USDC
  assert.equal(usdcValue(10n * 10n ** 24n, 24, "NEAR", p, "asset"), 34946505n);
  assert.equal(usdcValue(10n * 10n ** 24n, 24, "NEAR", p, "liability"), 35053506n);
});

test("LiNEAR resolves to underlying NEAR and is counted once", () => {
  const v = valuePosition(
    { id: "linear-shares", label: "LiNEAR", asset: "LiNEAR", amount: "10", kind: "staking", chain: "near" },
    "live",
    prices(),
    iso(now),
    now,
  );
  assert.equal(v.underlying?.quantityRaw, "14300000000000000000000000");
  assert.ok(v.countedVia?.startsWith("lst:linear-protocol.near"));
  const w = workspace([]);
  const c = capitalView(
    w,
    portfolio([
      { id: "usdc-wallet", label: "USDC", asset: "USDC", amount: "500", kind: "wallet", chain: "near" },
      { id: "linear-shares", label: "LiNEAR", asset: "LiNEAR", amount: "10", kind: "staking", chain: "near" },
      { id: "linear-wallet", label: "LiNEAR", asset: "LiNEAR", amount: "10", kind: "staking", chain: "near" },
    ]),
    { prices: prices(), quotes: [], errors: [] },
    { now },
  );
  assert.equal(c.valuations.filter((x) => x.kind === "observed" && x.asset === "LiNEAR").length, 1);
  assert.ok(c.excluded.some((x) => x.positionId === "linear-wallet"));
  assert.equal(c.netWorthUsdcRaw, (500_000000n + BigInt(v.usdcRaw!)).toString());
  assert.ok(BigInt(c.stressedNetWorthUsdcRaw!) < BigInt(c.netWorthUsdcRaw!));
});

test("1,000 USDT on BNB gets a conservative, rounded-up USDC reservation from price evidence", () => {
  const r = reserveFor(usdt, { source: "live", prices: prices(), now });
  assert.equal(r.unavailableReason, undefined);
  // 1000 × 1.0004 / 0.9999 = 1000.500050... rounded up in base units
  assert.equal(r.conversionUsdcRaw, "1000500051");
  assert.equal(r.costsUsdcRaw, "10005001"); // 100 bps allowance
  assert.equal(BigInt(r.reserveUsdcRaw) % 10000n, 0n);
  assert.ok(BigInt(r.reserveUsdcRaw) >= BigInt(r.conversionUsdcRaw) + BigInt(r.costsUsdcRaw) + 5_002500n);
  assert.equal(r.freshUntil, iso(now + 120000));
});

test("A fresh 1Click dry quote takes precedence; its slippage is a refundable buffer, not a fee", () => {
  const r = reserveFor(usdt, {
    source: "live",
    prices: prices(),
    quote: {
      obligationId: usdt.id,
      amountInRaw: "1003000000",
      minAmountInRaw: "1001000000",
      outputValueRaw: "1000200000",
      capturedAt: iso(now),
      validUntil: iso(now + 60000),
      basis: "1Click dry EXACT_OUTPUT quote to bnb USDT",
    },
    now,
  });
  assert.equal(r.conversionUsdcRaw, "1000200000");
  assert.equal(r.costsUsdcRaw, "800000");
  assert.ok(BigInt(r.bufferUsdcRaw) >= 2_000000n + 5_015000n);
  assert.match(r.basis, /1Click/);
});

test("Without evidence the obligation stays visible, is never zero and blocks automation", () => {
  for (const ctx of [
    { source: "live" as const, now },
    { source: "live" as const, prices: prices({ freshUntil: iso(now - 1) }), now },
  ]) {
    const r = reserveFor(usdt, ctx);
    assert.ok(r.unavailableReason);
    assert.equal(r.reserveUsdcRaw, UNAVAILABLE);
    assert.throws(() => BigInt(r.reserveUsdcRaw));
  }
  const w = workspace([usdt]);
  const c = capitalView(
    w,
    portfolio([{ id: "usdc-wallet", label: "USDC", asset: "USDC", amount: "5000", kind: "wallet", chain: "near" }]),
    { prices: null, quotes: [], errors: [] },
    { now },
  );
  assert.equal(c.holdbackUsdcRaw, null);
  assert.equal(c.surplusUsdcRaw, null);
  assert.equal(c.blocksAutomation, true);
  assert.equal(c.reservations.length, 1);
  assert.throws(() => holdback(w.mandate, now), /valuation unavailable/);
});

test("Attached evidence reservations feed the sync holdback; editing the obligation fences them", () => {
  const w = workspace([usdt]);
  attachReservations(w, { prices: prices(), quotes: [], errors: [] }, now);
  const r = w.mandate.evidenceReservations![0];
  assert.equal(obligationCash(w.mandate, now), BigInt(r.reserveUsdcRaw));
  assert.equal(holdback(w.mandate, now), 100_000000n + BigInt(r.reserveUsdcRaw));
  w.mandate.obligations = [{ ...usdt, amount: "2000" }];
  assert.throws(() => holdback(w.mandate, now), /valuation unavailable/);
  w.mandate.obligations = [usdt];
  assert.throws(() => holdback(w.mandate, now + 200000), /valuation unavailable/);
});

test("Spendable counts only USDC the owner's NEAR account can sign for; portfolio value stays separate", () => {
  const w = workspace([{ ...usdt, token: "USDC", destination: "base", id: "rent" }]);
  const p = portfolio([
    { id: "usdc-wallet", label: "USDC", asset: "USDC", amount: "2000", kind: "wallet", chain: "near" },
    { id: "base-usdc", label: "Base", asset: "USDC", amount: "700", kind: "wallet", chain: "base" },
    { id: "rhea-supplied-0", label: "Rhea", asset: "USDC", amount: "3000", kind: "supplied", chain: "near" },
    { id: "watch:x:usdc", label: "W", asset: "USDC", amount: "9000", kind: "wallet", chain: "near", ownership: "watched" },
    { id: "near-wallet", label: "NEAR", asset: "NEAR", amount: "10", kind: "wallet", chain: "near" },
  ]);
  const c = capitalView(w, p, { prices: prices(), quotes: [], errors: [] }, { now, committedRaw: 50_000000n });
  assert.equal(c.spendableNowUsdcRaw, "1950000000");
  assert.equal(c.holdbackUsdcRaw, "1100000000");
  assert.equal(c.surplusUsdcRaw, "850000000");
  assert.equal(c.netWorthUsdcRaw, (5700_000000n + 34_946505n).toString());
  assert.ok(c.excluded.some((x) => x.positionId === "base-usdc" && /cannot sign/.test(x.reason)));
  assert.ok(c.excluded.some((x) => x.positionId.startsWith("watch:")));
  // Unpriced NEAR: net worth unknown, spendable unaffected.
  const u = capitalView(w, p, { prices: null, quotes: [], errors: [] }, { now });
  assert.equal(u.netWorthUsdcRaw, null);
  assert.equal(u.spendableNowUsdcRaw, "2000000000");
});

test("Example workspaces never read live evidence and keep fictional USDT equivalence", async () => {
  const w = workspace([usdt], "demo");
  const e = await readValuationEvidence(w, { quotes: true }, {
    readPriceEvidence: async () => assert.fail("live read in example"),
    readConversionQuote: async () => assert.fail("live read in example"),
  });
  assert.equal(e.prices, null);
  assert.equal(holdback(w.mandate, now), 1100_000000n);
  assert.throws(() => capitalView(w, portfolio([]), e, { now }), /cannot be mixed/);
});
