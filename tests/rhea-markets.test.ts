import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRheaAction, rheaHealth, rheaPolicyAction, rheaPolicyEntries, verifyRheaReceipts, RHEA, WRAP, type RheaMarket, type RheaAccount, type RheaWallet } from "../lib/flowvault/rhea-markets.ts";
import { evaluatePolicy, defaultPolicy } from "../lib/flowvault/policy.ts";

const E12 = 10n ** 12n;
const mk = (o: Partial<RheaMarket> & Pick<RheaMarket, "tokenId" | "symbol" | "decimals">): RheaMarket => ({ extraDecimals: 0, volatilityRatio: 9500, canDeposit: true, canWithdraw: true, canCollateral: true, canBorrow: true, availableInner: 10n ** 40n, totalBorrowedInner: 0n, borrowedLimitInner: null, minBorrowedInner: 0n, priceE12: E12, stable: false, ...o });
const USDC = "usdc.near", ETH = "eth.bridge.near";
const markets = {
  [USDC]: mk({ tokenId: USDC, symbol: "USDC", decimals: 6, extraDecimals: 12, stable: true }),
  [WRAP]: mk({ tokenId: WRAP, symbol: "NEAR", decimals: 24, volatilityRatio: 7500, priceE12: 3n * E12 }),
  [ETH]: mk({ tokenId: ETH, symbol: "ETH", decimals: 18, volatilityRatio: 7500, priceE12: 2000n * E12 }),
};
const empty: RheaAccount = { registered: true, supplied: {}, collateral: {}, borrowed: {}, otherPositions: [] };
const wallet: RheaWallet = { tokenRaw: 10n ** 30n, nativeRaw: 10n * 10n ** 24n, tokenRegistered: true, tokenStorageMin: 1250000000000000000000n, wrapRegistered: true, wrapStorageMin: 1250000000000000000000n, rheaStorageMin: 10n ** 23n };
const near = (n: bigint) => n * 10n ** 24n;

test("supply of native NEAR wraps and deposits in one transaction to wrap.near", () => {
  const b = buildRheaAction({ kind: "supply", tokenId: WRAP, amountRaw: near(2n), accountId: "me.near", native: true }, markets, { ...empty, registered: false }, wallet);
  assert.deepEqual(b.transactions.map(t => t.receiverId + ":" + t.actions.map(a => a.params.methodName).join("+")), [RHEA + ":storage_deposit", WRAP + ":near_deposit+ft_transfer_call"]);
  assert.equal(b.transactions[1].actions[1].params.args.msg, "");
  assert.equal(b.nativeInRaw, near(2n));
});

test("withdraw needs supplied balance and Rhea liquidity, and unwraps when NEAR was asked for", () => {
  const acct = { ...empty, supplied: { [WRAP]: near(5n) } };
  const b = buildRheaAction({ kind: "withdraw", tokenId: WRAP, amountRaw: near(1n), accountId: "me.near", native: true }, markets, acct, wallet);
  assert.deepEqual(b.transactions.map(t => t.actions[0].params.methodName), ["execute_with_pyth", "near_withdraw"]);
  assert.throws(() => buildRheaAction({ kind: "withdraw", tokenId: WRAP, amountRaw: near(6n), accountId: "me.near", native: true }, markets, acct, wallet), /less NEAR supplied/);
  assert.throws(() => buildRheaAction({ kind: "withdraw", tokenId: WRAP, amountRaw: near(1n), accountId: "me.near", native: true }, { ...markets, [WRAP]: { ...markets[WRAP], availableInner: 1n } }, acct, wallet), /free to withdraw/);
});

test("borrow needs explicit new-debt approval and keeps stressed health above the minimum", () => {
  // 1 ETH collateral = $2000 × 0.75 = 1500 adjusted; stressed (30% drop) = 1050.
  const acct = { ...empty, collateral: { [ETH]: 10n ** 18n } };
  const req = { kind: "borrow" as const, tokenId: USDC, accountId: "me.near", native: false };
  assert.throws(() => buildRheaAction({ ...req, amountRaw: 100_000000n }, markets, acct, wallet), /NEW_DEBT_NEEDS_EXPLICIT_APPROVAL/);
  const ok = buildRheaAction({ ...req, amountRaw: 500_000000n, approveNewDebt: true }, markets, acct, wallet);
  assert.equal(ok.transactions[0].actions[0].params.methodName, "execute_with_pyth");
  assert.deepEqual(Object.keys((ok.transactions[0].actions[0].params.args.actions as Record<string, unknown>[])[0]), ["Borrow"]);
  // 700 USDC debt → adjusted 736.8; stressed health 1050/736.8 = 1.42 < 1.5.
  assert.throws(() => buildRheaAction({ ...req, amountRaw: 700_000000n, approveNewDebt: true }, markets, acct, wallet), /below your minimum/);
  // An unpriced collateral makes health unknown: fail closed.
  assert.throws(() => buildRheaAction({ ...req, amountRaw: 10_000000n, approveNewDebt: true }, { ...markets, [ETH]: { ...markets[ETH], priceE12: null } }, acct, wallet), /unknown/);
});

test("health uses Rhea's volatility ratios and stresses non-stable sides", () => {
  const h = rheaHealth(markets, { collateral: { [ETH]: 10n ** 18n }, borrowed: { [USDC]: 500_000000n * 10n ** 12n } });
  assert.equal(h.healthE6, 1500n * 1000000n * 95n / 50000n); // 1500 / (500/0.95)
  assert.ok(h.stressedE6! < h.healthE6!);
  assert.equal(rheaHealth(markets, { collateral: {}, borrowed: {} }).noDebt, true);
});

test("repay and collateral release stay within debt and health; supply keeps the USDC reserve", () => {
  const acct = { ...empty, collateral: { [ETH]: 10n ** 18n }, borrowed: { [USDC]: 100_000000n * 10n ** 12n } };
  assert.throws(() => buildRheaAction({ kind: "repay", tokenId: USDC, amountRaw: 200_000000n, accountId: "me.near", native: false }, markets, acct, wallet), /more than your USDC debt/);
  const r = buildRheaAction({ kind: "repay", tokenId: USDC, amountRaw: 100_000000n, accountId: "me.near", native: false }, markets, acct, wallet);
  assert.match(String(r.transactions[0].actions[0].params.args.msg), /"Repay"/);
  assert.throws(() => buildRheaAction({ kind: "collateral_release", tokenId: ETH, amountRaw: 9n * 10n ** 17n, accountId: "me.near", native: false }, markets, acct, wallet), /below your minimum/);
  assert.throws(() => buildRheaAction({ kind: "supply", tokenId: USDC, amountRaw: 10n, accountId: "me.near", native: false, keepRaw: 10n ** 30n }, markets, empty, wallet), /reserve/);
});

test("policy view names the exact Rhea methods and needs an explicit allow for new ones", () => {
  const b = buildRheaAction({ kind: "supply", tokenId: ETH, amountRaw: 10n ** 17n, accountId: "me.near", native: false }, markets, empty, wallet);
  const action = rheaPolicyAction("supply", "me.near", "ETH", b.usdE12, b.transactions, 10n ** 21n);
  assert.equal(action.amount, "200");
  const policy = defaultPolicy();
  assert.equal(evaluatePolicy(action, policy, []).allowed, false);
  for (const e of rheaPolicyEntries(b.transactions, "ETH")) { if (e.type === "venue") { if (!policy.venues.includes(e.venue)) policy.venues.push(e.venue); } else policy.methods.push({ receiver: e.receiver, method: e.method }); }
  assert.equal(evaluatePolicy(action, policy, []).allowed, true);
});

test("receipts confirm only with Rhea's own events for this account and token", () => {
  const ev = (event: string, token = ETH) => ({ outcome: { executor_id: RHEA, logs: ["EVENT_JSON:" + JSON.stringify({ standard: "burrow", event, data: [{ account_id: "me.near", token_id: token, amount: "100" }] })] } });
  const p = { kind: "borrow" as const, accountId: "me.near", tokenId: ETH, native: false, transactions: [] };
  assert.equal(verifyRheaReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [ev("borrow"), ev("withdraw_succeeded")] }], p)?.state, "confirmed");
  assert.equal(verifyRheaReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [ev("borrow"), ev("withdraw_failed")] }], p)?.state, "failed");
  assert.equal(verifyRheaReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [ev("borrow", USDC), ev("withdraw_succeeded", USDC)] }], p)?.state, "failed");
  assert.equal(verifyRheaReceipts([{ final_execution_status: "EXECUTED_OPTIMISTIC" }], p), null);
});
