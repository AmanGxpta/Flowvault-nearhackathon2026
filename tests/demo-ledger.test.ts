import test from "node:test";
import assert from "node:assert/strict";
import { applyClaim, applyPerpClose, applyPerpOpen, applyRhea, applyStake, applyUnstake, borrowCapacity, freeMargin, MIN_HEALTH, rheaHealth, seedLedger, STRESS, UNSTAKE_DEMO_MS, USDC_ID, WNEAR_ID, type Markets } from "../lib/flowvault/demo-ledger.ts";

const M: Markets = {
  [WNEAR_ID]: { symbol: "wNEAR", decimals: 24, price: 3.2, vr: 0.75, supplyApr: 0.3, borrowApr: 2.5, liquidity: 1e6, stable: false },
  [USDC_ID]: { symbol: "USDC", decimals: 6, price: 1, vr: 0.95, supplyApr: 10.8, borrowApr: 16.6, liquidity: 1e6, stable: true },
};

test("supply and withdraw move between the wallet and Rhea; native NEAR keeps 0.5 for fees", () => {
  let l = applyRhea(seedLedger(), M, "supply", WNEAR_ID, 10);
  assert.equal(l.wallet[WNEAR_ID], 32);
  assert.equal(l.rhea[WNEAR_ID].supplied, 10);
  assert.throws(() => applyRhea(l, M, "supply", WNEAR_ID, 32), /31\.5 NEAR to use \(0\.5 NEAR stays for fees\)/);
  l = applyRhea(l, M, "withdraw", USDC_ID, 500);
  assert.equal(l.rhea[USDC_ID].supplied, 7000);
  assert.equal(l.wallet[USDC_ID], 504);
  assert.match(l.activity[0].text, /Withdrew 500 USDC on Rhea/);
});

test("borrowing needs collateral and stops at the stressed minimum health", () => {
  const s = seedLedger();
  assert.throws(() => applyRhea(s, M, "borrow", USDC_ID, 1), /Add collateral first/);
  const l = applyRhea(s, M, "collateral_add", WNEAR_ID, 40);
  // 40 NEAR × $3.2 × 0.7 stress × 0.75 vr ÷ 1.2 × 0.95 vr ≈ 53.2 USDC
  const cap = borrowCapacity(l, M, USDC_ID);
  assert.ok(Math.abs(cap - 40 * 3.2 * (1 - STRESS) * 0.75 / MIN_HEALTH * 0.95) < 1e-9);
  assert.throws(() => applyRhea(l, M, "borrow", USDC_ID, cap + 1), /You can borrow up to/);
  const b = applyRhea(l, M, "borrow", USDC_ID, 50);
  assert.equal(b.rhea[USDC_ID].borrowed, 50);
  assert.ok(rheaHealth(b, M, STRESS)! >= MIN_HEALTH);
  assert.ok(rheaHealth(b, M)! > rheaHealth(b, M, STRESS)!);
});

test("releasing collateral that the loan needs is refused; repaying frees it", () => {
  let l = applyRhea(applyRhea(seedLedger(), M, "collateral_add", WNEAR_ID, 40), M, "borrow", USDC_ID, 50);
  assert.throws(() => applyRhea(l, M, "collateral_release", WNEAR_ID, 20), /health below/);
  l = applyRhea(l, M, "repay", USDC_ID, 80);
  assert.equal(l.rhea[USDC_ID].borrowed, 0);
  assert.equal(l.wallet[USDC_ID], 4);
  l = applyRhea(l, M, "collateral_release", WNEAR_ID, 40);
  assert.equal(l.wallet[WNEAR_ID], 42);
  assert.equal(rheaHealth(l, M), null);
});

test("staking, unstaking and claiming after the wait", () => {
  const t0 = 1_000_000;
  let l = applyStake(seedLedger(), "linear", 20, 1.25, t0);
  assert.equal(l.staking.linear, 76);
  assert.equal(l.wallet[WNEAR_ID], 22);
  l = applyUnstake(l, "linear", 16, 1.25, t0);
  assert.equal(l.staking.unstaking[0].near, 20);
  assert.throws(() => applyClaim(l, t0 + 1000), /Nothing is ready/);
  l = applyClaim(l, t0 + UNSTAKE_DEMO_MS);
  assert.equal(l.wallet[WNEAR_ID], 42);
  assert.equal(l.staking.unstaking.length, 0);
});

test("perps: margin is notional over leverage, PnL lands in margin on close", () => {
  let l = applyPerpOpen(seedLedger(), { coin: "ETH", side: "long", notional: 1000, leverage: 5, price: 2000 });
  assert.equal(freeMargin(l), 1800);
  assert.throws(() => applyPerpOpen(l, { coin: "ETH", side: "short", notional: 100, leverage: 5, price: 2000 }), /Close your ETH long/);
  assert.throws(() => applyPerpOpen(l, { coin: "BTC", side: "long", notional: 10_000, leverage: 5, price: 90_000 }), /1,800 USDC is free/);
  l = applyPerpClose(l, "ETH", 2100);
  assert.equal(l.perps.margin, 2050);
  assert.equal(l.perps.positions.length, 0);
  assert.match(l.activity[0].text, /\+\$50/);
});
