import test from "node:test";
import assert from "node:assert/strict";
import {
  borrowCapacity,
  borrowFundingChoice,
  health,
  prepareLending,
  verifyLendingOutcome,
  COLLATERAL_FAMILY,
  LENDING_USDC,
  RHEA,
} from "../lib/flowvault/lending.ts";
import type { LendingState, RheaAsset } from "../lib/flowvault/lending.ts";
import { evaluatePolicy, defaultPolicy, preparationAction } from "../lib/flowvault/policy.ts";
import type { Policy } from "../lib/flowvault/policy.ts";

const now = Date.parse("2026-11-12T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const LINEAR = COLLATERAL_FAMILY.LiNEAR;
const E24 = 10n ** 24n;
const asset = (tokenId: string, o: Partial<RheaAsset>): RheaAsset => ({
  tokenId,
  decimals: 24,
  extraDecimals: 0,
  volatilityRatio: 7000,
  canDeposit: true,
  canWithdraw: true,
  canUseAsCollateral: true,
  canBorrow: true,
  suppliedInner: 0n,
  reservedInner: 0n,
  borrowedInner: 0n,
  borrowedLimitInner: null,
  minBorrowedInner: 0n,
  borrowApr: "0.05",
  ...o,
});
// NEAR $3.50 exactly (no confidence band) so the maths is easy to follow; LiNEAR = 1.4 NEAR.
const state = (o: Partial<LendingState> = {}): LendingState => ({
  source: "live",
  accountId: "owner.near",
  capturedAt: iso(now),
  blockHeight: 1,
  contractMode: "Running",
  pythMode: true,
  registered: true,
  registrationMinimum: 100000000000000000000000n,
  tokenRegistered: { [LENDING_USDC]: true, [LINEAR]: true, [COLLATERAL_FAMILY.rNEAR]: true },
  tokenStorageMinimum: { [LENDING_USDC]: 1250000000000000000000n, [LINEAR]: 1250000000000000000000n, [COLLATERAL_FAMILY.rNEAR]: 1250000000000000000000n },
  nativeAvailableYocto: 5n * E24,
  assets: {
    [LENDING_USDC]: asset(LENDING_USDC, {
      decimals: 6,
      extraDecimals: 12,
      volatilityRatio: 9500,
      suppliedInner: 1_000_000n * 10n ** 18n,
      borrowedInner: 400_000n * 10n ** 18n,
      borrowedLimitInner: 900_000n * 10n ** 18n,
      minBorrowedInner: 10n ** 9n,
    }),
    [LINEAR]: asset(LINEAR, {}),
    [COLLATERAL_FAMILY.rNEAR]: asset(COLLATERAL_FAMILY.rNEAR, {}),
  },
  supplied: {},
  collateral: { [LINEAR]: 1000n * E24 },
  borrowed: {},
  otherPositions: [],
  wallet: { [LENDING_USDC]: 3000_000000n, [LINEAR]: 200n * E24, [COLLATERAL_FAMILY.rNEAR]: 0n },
  prices: {
    source: "live",
    oracle: "aggregate-oracle.near",
    basis: "test prices",
    blockHeight: 1,
    capturedAt: iso(now),
    freshUntil: iso(now + 120000),
    prices: {
      NEAR: { usdE12: "3500000000000", confE12: "0", publishedAt: iso(now), priceIdentifier: "a".repeat(64) },
      USDC: { usdE12: "1000000000000", confE12: "0", publishedAt: iso(now), priceIdentifier: "b".repeat(64) },
    },
    lstNearPerToken: { LiNEAR: "1400000000000000000000000", rNEAR: "1000000000000000000000000" },
    unavailable: [],
  },
  ...o,
});
const policy = (o: Partial<Policy> = {}): Policy => ({
  ...defaultPolicy("5"),
  creditRows: [
    {
      assetId: "LiNEAR",
      collateralId: "owner.near:rhea:LiNEAR",
      value: null,
      drawdownBps: 3000,
      ltvCapBps: 5000,
      liquidationThresholdBps: null,
      protocolLtvBps: null,
      minHealth: "1.5",
      priority: "P1",
      permissions: ["pledge", "borrow"],
      eligible: true,
    },
  ],
  ...o,
});

test("Rhea health uses volatility ratios: collateral × ratio over debt ÷ ratio", () => {
  // 1000 LiNEAR = 1400 NEAR = 4900 USDC; adjusted 3430. 1000 USDC debt adjusted 1052.631579.
  const h = health(state({ borrowed: { [LENDING_USDC]: 1000n * 10n ** 18n } }));
  assert.equal(h.collateralUsdcRaw, "4900000000");
  assert.equal(h.adjustedCollateralUsdcRaw, "3430000000");
  assert.equal(h.adjustedDebtUsdcRaw, "1052631579");
  assert.equal(h.healthE6, 3258499n); // floored
  assert.ok(h.stressedHealthE6! < h.healthE6!);
  assert.equal(health(state()).noDebt, true);
});

test("Capacity binds on the tightest of policy LTV, stressed health, protocol and liquidity, minus debt", () => {
  const cap = borrowCapacity(state(), policy(), now);
  // stressed 3430 USDC value × 50 % LTV = 1715; stressed health: 3430×0.7×0.95/1.5 = 1520.633333
  assert.equal(cap.bindingConstraint, "stressed_health");
  assert.equal(cap.capacityUsdcRaw, "1520633333");
  const withDebt = borrowCapacity(state({ borrowed: { [LENDING_USDC]: 500n * 10n ** 18n } }), policy(), now);
  assert.equal(withDebt.capacityUsdcRaw, "1020633333");
  // Liquidity and protocol limits bind when the market is drained.
  const drained = state();
  drained.assets[LENDING_USDC].borrowedInner = 999_900n * 10n ** 18n;
  drained.assets[LENDING_USDC].borrowedLimitInner = 10_000_000n * 10n ** 18n;
  assert.equal(borrowCapacity(drained, policy(), now).bindingConstraint, "liquidity");
  assert.equal(borrowCapacity(drained, policy(), now).capacityUsdcRaw, "100000000");
  // Per-action cap.
  assert.equal(borrowCapacity(state(), policy({ perActionCap: "250" }), now).capacityUsdcRaw, "250000000");
});

test("Protected, unpermitted or unpriced collateral gives no capacity; unknown debt blocks", () => {
  assert.equal(borrowCapacity(state(), policy({ protectedAssets: ["LiNEAR"] }), now).capacityUsdcRaw, "0");
  assert.equal(borrowCapacity(state(), policy({ creditRows: [] }), now).capacityUsdcRaw, "0");
  const unknown = borrowCapacity(state({ borrowed: { "weird.near": 5n } }), policy(), now);
  assert.equal(unknown.capacityUsdcRaw, null);
  assert.equal(borrowCapacity(state({ prices: null }), policy(), now).capacityUsdcRaw, null);
  assert.equal(borrowCapacity(state({ otherPositions: ["shadow_x"] }), policy(), now).capacityUsdcRaw, null);
  assert.equal(borrowCapacity(state({ capturedAt: iso(now - 600000) }), policy(), now).capacityUsdcRaw, null);
});

test("Borrow needs explicit new-debt approval and builds execute_with_pyth Borrow + Withdraw", () => {
  const st = state();
  assert.throws(() => prepareLending(st, policy(), { kind: "borrow", asset: "USDC", amountRaw: 100_000000n }, now), /NEW_DEBT_NEEDS_EXPLICIT_APPROVAL/);
  assert.throws(
    () => prepareLending(st, policy(), { kind: "borrow", asset: "USDC", amountRaw: 2000_000000n, approveNewDebt: true }, now),
    /exceeds verified capacity/,
  );
  const p = prepareLending(st, policy(), { kind: "borrow", asset: "USDC", amountRaw: 100_000000n, approveNewDebt: true }, now);
  assert.equal(p.transactions.length, 1);
  assert.equal(p.transactions[0].receiverId, RHEA);
  assert.deepEqual(p.transactions[0].actions[0].params, {
    methodName: "execute_with_pyth",
    args: {
      actions: [
        { Borrow: { token_id: LENDING_USDC, amount: "100000000000000000000" } },
        { Withdraw: { token_id: LENDING_USDC, max_amount: "100000000000000000000" } },
      ],
    },
    gas: "300000000000000",
    deposit: "1",
  });
  assert.equal(p.newDebt, true);
  assert.equal(p.policyAction.kind, "borrow");
  // Default policy does not allow execute_with_pyth: the owner must approve the method first.
  const v = evaluatePolicy(preparationAction(p as never, "borrow"), policy(), [], now);
  assert.ok(v.violations.some((x) => x.code === "METHOD_NOT_ALLOWED"));
  const allowed = policy({ methods: [...defaultPolicy().methods, { receiver: RHEA, method: "execute_with_pyth" }] });
  assert.equal(evaluatePolicy(preparationAction(p as never, "borrow"), allowed, [], now).allowed, true);
});

test("Collateral add uses the LST's ft_transfer_call with IncreaseCollateral and is valued in USDC for caps", () => {
  const p = prepareLending(state(), policy(), { kind: "collateral_add", asset: "LiNEAR", amountRaw: 10n * E24 }, now);
  const a = p.transactions[0].actions[0].params;
  assert.equal(p.transactions[0].receiverId, LINEAR);
  assert.equal(a.methodName, "ft_transfer_call");
  assert.deepEqual(JSON.parse(String(a.args.msg)), {
    Execute: { actions: [{ IncreaseCollateral: { token_id: LINEAR, max_amount: (10n * E24).toString() } }] },
  });
  assert.equal(p.usdcValueRaw, "49000000"); // 10 LiNEAR × 1.4 × $3.50
  assert.equal(p.policyAction.amount, "49");
  assert.equal(p.policyAction.kind, "pledge");
  assert.throws(() => prepareLending(state(), policy({ protectedAssets: ["LiNEAR"] }), { kind: "collateral_add", asset: "LiNEAR", amountRaw: E24 }, now), /PROTECTED_ASSET/);
  assert.throws(() => prepareLending(state(), policy(), { kind: "collateral_add", asset: "LiNEAR", amountRaw: 500n * E24 }, now), /below the requested/);
  const fresh = prepareLending(state({ registered: false }), policy(), { kind: "collateral_add", asset: "LiNEAR", amountRaw: E24 }, now);
  assert.equal(fresh.transactions[0].actions[0].params.methodName, "storage_deposit");
});

test("Release refuses to breach minimum stressed health; repay never spends the holdback", () => {
  const indebted = state({ borrowed: { [LENDING_USDC]: 1000n * 10n ** 18n } });
  assert.throws(
    () => prepareLending(indebted, policy(), { kind: "collateral_release", asset: "LiNEAR", amountRaw: 600n * E24 }, now),
    /below your minimum/,
  );
  const r = prepareLending(indebted, policy(), { kind: "collateral_release", asset: "LiNEAR", amountRaw: 100n * E24 }, now);
  assert.deepEqual(Object.keys((r.transactions[0].actions[0].params.args as any).actions[0]), ["DecreaseCollateral"]);
  assert.throws(
    () => prepareLending(indebted, policy(), { kind: "repay", asset: "USDC", amountRaw: 500_000000n, holdbackRaw: 2600_000000n }, now),
    /reserved for your reserve/,
  );
  assert.throws(() => prepareLending(indebted, policy(), { kind: "repay", asset: "USDC", amountRaw: 500_000000n }, now), /Holdback is unknown/);
  const repay = prepareLending(indebted, policy(), { kind: "repay", asset: "USDC", amountRaw: 500_000000n, holdbackRaw: 1000_000000n }, now);
  assert.equal(JSON.parse(String(repay.transactions[0].actions[0].params.args.msg)).Execute.actions[0].Repay.max_amount, "500000000000000000000");
  assert.throws(() => prepareLending(state(), policy(), { kind: "repay", asset: "USDC", amountRaw: 1n, holdbackRaw: 0n }, now), /no USDC debt/);
});

const ev = (executor: string, standard: string, event: string, data: object[]) => ({
  outcome: {
    executor_id: executor,
    status: { SuccessValue: "" },
    logs: ["EVENT_JSON:" + JSON.stringify({ standard, version: "1.0.0", event, data })],
  },
});
test("Borrow is confirmed only with Rhea's borrow + withdraw_succeeded events and the exact USDC payout", () => {
  const p = prepareLending(state(), policy(), { kind: "borrow", asset: "USDC", amountRaw: 100_000000n, approveNewDebt: true }, now);
  const inner = "100000000000000000000";
  const d = { account_id: "owner.near", token_id: LENDING_USDC, amount: inner };
  const result = (transfer: string, extra: ReturnType<typeof ev>[] = []) => ({
    status: { SuccessValue: "" },
    receipts_outcome: [
      ev(RHEA, "burrow", "borrow", [{ ...d, position: "REGULAR" }]),
      ev(LENDING_USDC, "nep141", "ft_transfer", [{ old_owner_id: RHEA, new_owner_id: "owner.near", amount: transfer }]),
      ev(RHEA, "burrow", "withdraw_succeeded", [d]),
      ...extra,
    ],
  });
  const ok = verifyLendingOutcome(result("100000000"), p, 0);
  assert.equal(ok.state, "confirmed");
  assert.equal(ok.effect?.paidOutRaw, "100000000");
  assert.equal(verifyLendingOutcome(result("99000000"), p, 0).state, "failed");
  assert.equal(verifyLendingOutcome(result("100000000", [ev(RHEA, "burrow", "withdraw_failed", [d])]), p, 0).state, "failed");
  const noEvent = { status: { SuccessValue: "" }, receipts_outcome: [result("100000000").receipts_outcome[1]] };
  assert.equal(verifyLendingOutcome(noEvent, p, 0).state, "failed");
  const incomplete = result("100000000");
  (incomplete.receipts_outcome[0].outcome as any).status = {};
  assert.equal(verifyLendingOutcome(incomplete, p, 0).state, "pending");
});

test("Collateral add needs the resolved transfer amount and a matching increase_collateral event", () => {
  const p = prepareLending(state(), policy(), { kind: "collateral_add", asset: "LiNEAR", amountRaw: 10n * E24 }, now);
  const amount = (10n * E24).toString();
  const r = (used: string, evAmount: string) => ({
    status: { SuccessValue: btoa(JSON.stringify(used)) },
    receipts_outcome: [ev(RHEA, "burrow", "increase_collateral", [{ account_id: "owner.near", token_id: LINEAR, amount: evAmount }])],
  });
  assert.equal(verifyLendingOutcome(r(amount, amount), p, 0).state, "confirmed");
  assert.equal(verifyLendingOutcome(r("0", amount), p, 0).state, "failed");
  assert.equal(verifyLendingOutcome(r(amount, "1"), p, 0).state, "failed");
});

test("Borrowing is a payment funding choice with interest to the due date, never eligible without approval", () => {
  const cap = borrowCapacity(state(), policy(), now);
  const c = borrowFundingChoice(cap, 1000_000000n, "2026-12-12", false, now);
  assert.equal(c.kind, "borrow");
  assert.equal(c.eligible, false);
  assert.ok(c.reasons.includes("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL"));
  assert.equal(c.interestUsdcRaw, "4246575"); // 1000 × 5 % × 31/365
  const ok = borrowFundingChoice(cap, 1000_000000n, "2026-12-12", true, now);
  assert.equal(ok.eligible, true);
  assert.equal(borrowFundingChoice(cap, 5000_000000n, "2026-12-12", true, now).eligible, false);
});
