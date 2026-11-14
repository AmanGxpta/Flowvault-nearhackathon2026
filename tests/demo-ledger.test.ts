import test from "node:test";
import assert from "node:assert/strict";
import { applyClaim, applyPerpClose, applyPerpOpen, applyPerpReduce, applyRhea, applyStake, applyUnstake, borrowCapacity, freeMargin, MIN_HEALTH, rheaHealth, seedLedger, STRESS, UNSTAKE_DEMO_MS, USDC_ID, WNEAR_ID, type Markets } from "../lib/flowvault/demo-ledger.ts";

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
  // A short against the long reduces it and realizes the PnL on the closed part; a bigger one flips it.
  const reduced = applyPerpOpen(l, { coin: "ETH", side: "short", notional: 210, leverage: 5, price: 2100 });
  assert.equal(reduced.perps.positions[0].size, 0.4);
  assert.equal(reduced.perps.realized, 10);
  const flipped = applyPerpOpen(l, { coin: "ETH", side: "short", notional: 2100, leverage: 5, price: 2100 });
  assert.equal(flipped.perps.positions[0].side, "short");
  assert.equal(flipped.perps.positions[0].size, 0.5);
  assert.equal(flipped.perps.realized, 50);
  assert.equal(applyPerpReduce(l, "ETH", 0.5, 2000).perps.positions[0].size, 0.25);
  assert.throws(() => applyPerpOpen(l, { coin: "BTC", side: "long", notional: 10_000, leverage: 5, price: 90_000 }), /1,800 USDC is free/);
  l = applyPerpClose(l, "ETH", 2100);
  assert.equal(l.perps.margin, 2050);
  assert.equal(l.perps.positions.length, 0);
  assert.match(l.activity[0].text, /\+\$50/);
});

test("portfolio in Demo Mode: seed rows move by this session's changes, new positions appear, debt counts against", async () => {
  const { demoPortfolio } = await import("../lib/flowvault/demo-ledger.ts");
  const rows = [
    { id: "near-wallet", kind: "wallet", symbol: "NEAR", qty: 42, usd: 134.4 },
    { id: "cash", kind: "wallet", symbol: "USDC", qty: 14240, usd: 14240 },
    { id: "rhea", kind: "supplied", symbol: "USDC", qty: 7500, usd: 7500 },
  ];
  let l = applyRhea(seedLedger(), M, "collateral_add", WNEAR_ID, 30);
  l = applyRhea(l, M, "borrow", USDC_ID, 35);
  const r = demoPortfolio(rows, l, M);
  assert.equal(r.rows.find((x) => x.id === "near-wallet")!.qty, 12);
  assert.equal(r.rows.find((x) => x.id === "cash")!.qty, 14275);
  assert.equal(r.rows.find((x) => x.id === "demo:collateral:" + WNEAR_ID)!.usd, 96);
  assert.equal(r.rows.find((x) => x.id === "demo:debt:" + USDC_ID)!.usd, 35);
  // −30 NEAR wallet, +30 NEAR collateral, +35 USDC wallet, −35 USDC debt: net worth unchanged
  assert.ok(Math.abs(r.deltaUsd) < 1e-9);
  assert.equal(r.spendableDelta, 35);
});

test("vaults: deposit queues, settles into shares at the price, redeems after the notice and pays out USDC", async () => {
  const { applyVaultDeposit, applyVaultSettle, applyVaultRedeem, applyVaultClaim, applyVaultCancel, VAULT_NOTICE_DEMO_MS } = await import("../lib/flowvault/demo-ledger.ts");
  const t0 = 1_000_000, cid = "rhea-usdc.vaults.example";
  let l = applyRhea(seedLedger(), M, "withdraw", USDC_ID, 1000); // 1,004 USDC in the wallet
  l = applyVaultDeposit(l, cid, 1000, t0);
  assert.equal(l.wallet[USDC_ID], 4);
  assert.throws(() => applyVaultDeposit(l, cid, 10, t0), /4 USDC on your NEAR account/);
  l = applyVaultSettle(l, cid, 100, 1.25, t0);
  assert.equal(l.vaults![cid].shares, 800);
  l = applyVaultRedeem(l, cid, 400, 0, t0);
  assert.throws(() => applyVaultClaim(l, cid, 101, 1.25, t0 + 1000), /notice period/);
  l = applyVaultClaim(l, cid, 101, 1.25, t0 + VAULT_NOTICE_DEMO_MS);
  assert.equal(l.wallet[USDC_ID], 504);
  l = applyVaultCancel(applyVaultDeposit(l, cid, 4, t0), cid, 102, t0);
  assert.equal(l.wallet[USDC_ID], 504);
});

test("Aave: collateral within what the wallet holds, borrowing capped by stressed health, release refused when needed", async () => {
  const { applyAave, aaveCapacity, aaveHealth } = await import("../lib/flowvault/demo-ledger.ts");
  const weth = { id: "0xweth", symbol: "WETH", price: 2000 }, assets = [weth], key = "eth:0xabc";
  assert.throws(() => applyAave(seedLedger(), key, "collateral_add", weth, 2, assets, 1), /holds 1 ETH/);
  let l = applyAave(seedLedger(), key, "collateral_add", weth, 1, assets, 1);
  // min(2000 × 0.805, 2000 × 0.7 × 0.83 ÷ 1.2) = min(1610, 968.33)
  assert.ok(Math.abs(aaveCapacity(l.aave![key], assets) - 2000 * 0.7 * 0.83 / 1.2) < 1e-6);
  l = applyAave(l, key, "borrow", { id: "usdc", symbol: "USDC", price: 1 }, 900, assets, 0);
  assert.equal(l.aave![key].usdcWallet, 900);
  assert.ok(aaveHealth(l.aave![key], assets)! > 1.8);
  assert.throws(() => applyAave(l, key, "collateral_release", weth, 0.5, assets, 0), /health below/);
  l = applyAave(l, key, "repay", { id: "usdc", symbol: "USDC", price: 1 }, 1000, assets, 900);
  assert.equal(l.aave![key].debt, 0);
});

test("approved sales: quote within limits and holdings, then the sale delivers exactly the net USDC", async () => {
  const { applySalePermission, saleQuote, applySale } = await import("../lib/flowvault/demo-ledger.ts");
  const perm = { asset: WNEAR_ID, symbol: "wNEAR", maxQty: 20, maxValue: 100, slippageBps: 100, priority: "P2" };
  const l = applySalePermission(seedLedger(), perm);
  const q = saleQuote(l, perm, 3.2, 30);
  assert.ok(q.ok);
  assert.ok(q.ok && Math.abs(q.qty - 30 / 0.997 / (3.2 * 0.99)) < 1e-9);
  assert.equal(saleQuote(l, perm, 3.2, 200).ok, false);
  const after = applySale(l, perm, q.ok ? q.qty : 0, 30);
  assert.equal(after.wallet[USDC_ID], 34);
});
