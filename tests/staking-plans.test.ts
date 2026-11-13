// Engines: staking in action plans. Steps are sized in raw NEAR / LiNEAR (never USDC), bound to their venue,
// native stakes need an explicit stake approval, and every staking position exits through its own steps.
import test from "node:test";
import assert from "node:assert/strict";
import { nearForUsdc, sizeStake, stakeAlternatives, exitSteps, STAKE_NEAR_RESERVE } from "../lib/flowvault/staking-plans.ts";
import { usdcValue } from "../lib/flowvault/valuation.ts";
import { newPlan, assertPreparable, review } from "../lib/flowvault/plans.ts";
import { stakingReviewSpecs } from "../lib/flowvault/staking-plans.ts";
const reviewChoice = (plan: any, id: string) => review(plan, id, stakingReviewSpecs(plan, id)!);
import { defaultPolicy } from "../lib/flowvault/policy.ts";
import { planPolicySteps, missingEntries, withEntries } from "../lib/flowvault/plans-policy.ts";
import { evaluateValidator, REFERENCE_POOL_CODE } from "../lib/flowvault/staking-native.ts";

const NEAR = 10n ** 24n;
const POOL = "astro-stakers.poolv1.near";
const prices: any = {
  source: "live", oracle: "o", basis: "test", blockHeight: 1, capturedAt: "", freshUntil: "2099-01-01T00:00:00Z",
  prices: {
    NEAR: { usdE12: "3500000000000", confE12: "10000000000", publishedAt: "", priceIdentifier: "n" },
    USDC: { usdE12: "1000000000000", confE12: "0", publishedAt: "", priceIdentifier: "u" },
  },
  lstNearPerToken: { LiNEAR: "1430900000000000000000000" },
  unavailable: [],
};
const w: any = { mode: "live", accountId: "owner.near", mandate: { version: 1, maxMoveCost: "5" }, policy: undefined };

test("NEAR sizing: conservative value never exceeds surplus; idle NEAR keeps the gas/exit reserve", () => {
  const n = nearForUsdc(100_000_000n, prices); // 100 USDC
  assert.ok(usdcValue(n, 24, "NEAR", prices, "asset") <= 100_000_000n);
  assert.ok(usdcValue(n + NEAR / 1000n, 24, "NEAR", prices, "asset") > 99_000_000n, "not wastefully small");
  const bySurplus = sizeStake({ walletRaw: 1000n * NEAR, surplusUsdcRaw: "35000000", prices });
  assert.deepEqual(bySurplus.reasons, []);
  assert.ok(bySurplus.usdcRaw <= 34_000_000n, "keeps the 1 USDC fee allowance");
  const byWallet = sizeStake({ walletRaw: 5n * NEAR, surplusUsdcRaw: "1000000000", prices });
  assert.equal(byWallet.amountRaw, 5n * NEAR - STAKE_NEAR_RESERVE);
  const over = sizeStake({ requestedRaw: 10n * NEAR, walletRaw: 5n * NEAR, surplusUsdcRaw: "1000000", prices });
  assert.ok(over.reasons.includes("NOT_ENOUGH_IDLE_NEAR") && over.reasons.includes("EXCEEDS_VERIFIED_SURPLUS"));
  assert.ok(sizeStake({ walletRaw: NEAR / 2n, surplusUsdcRaw: "1000000000", prices }).reasons.includes("NO_IDLE_NEAR"));
  assert.ok(sizeStake({ walletRaw: 5n * NEAR, surplusUsdcRaw: null, prices }).reasons.includes("SURPLUS_UNAVAILABLE"));
  assert.deepEqual(sizeStake({ walletRaw: 5n * NEAR, surplusUsdcRaw: "1", prices: null }).reasons, ["NEAR_VALUATION_UNAVAILABLE"]);
});

const validator = (over: Record<string, unknown> = {}) =>
  evaluateValidator({
    poolId: POOL, capturedAt: "", whitelisted: true, codeHash: REFERENCE_POOL_CODE[0], epochHeight: 1,
    current: { stake: "1", slashed: false, producedBlocks: 100, expectedBlocks: 100, producedChunks: 100, expectedChunks: 100 },
    inNextEpoch: true, fee: { numerator: 1, denominator: 100 }, paused: false, ownerId: "x", totalStaked: "1",
    account: { staked: "0", unstaked: "0", canWithdraw: true }, errors: [], ...over,
  } as any);

test("stake alternatives: default-deny policy blocks both; allowing exactly the entries makes them eligible", () => {
  const sizing = sizeStake({ walletRaw: 20n * NEAR, surplusUsdcRaw: "100000000", prices });
  const args = { w, ledger: [], sizing, validator: validator(), pool: POOL, linearExitDays: 3, adapterReasons: () => [] };
  const denied = stakeAlternatives({ ...args, policy: defaultPolicy("5") });
  assert.deepEqual(denied.alternatives.map((a) => a.id), ["linear", "native:" + POOL]);
  assert.ok(denied.alternatives.every((a) => !a.eligible));
  let policy: any = defaultPolicy("5");
  policy = withEntries(policy, missingEntries(policy, [{ kind: "stake", strategy: "linear" }, { kind: "native_stake", pool: POOL }]));
  const allowed = stakeAlternatives({ ...args, policy });
  assert.ok(allowed.alternatives.every((a) => a.eligible), JSON.stringify(allowed.alternatives.map((a) => a.reasons)));
  const native = allowed.staking["native:" + POOL];
  assert.equal(native.venue, POOL);
  assert.equal(native.steps[0].kind, "native_stake");
  assert.equal(native.steps[0].asset, "NEAR");
  assert.equal(native.steps[0].amountRaw, sizing.amountRaw.toString());
  const bad = stakeAlternatives({ ...args, policy, validator: validator({ paused: true }) });
  assert.ok(bad.alternatives.find((a) => a.id === "native:" + POOL)!.reasons.some((r) => r.startsWith("VALIDATOR_NOT_ELIGIBLE")));
});

const pos = (id: string, amount: string, asset = "NEAR", availableAt: string | null = null): any => ({ id, label: id, asset, amount, kind: "staking", chain: "near", availableAt });

test("exits: each staking position maps to the steps that actually exit it, in its own units", () => {
  const n = exitSteps(pos("native-stake-" + POOL, "10"), prices)!;
  assert.deepEqual(n.kinds, ["native_unstake", "wait_until", "native_withdraw"]);
  assert.equal(n.venue, POOL);
  assert.equal(n.steps[0].amountRaw, (10n * NEAR).toString());
  assert.ok(Number.isFinite(Date.parse(n.steps[1].note!)));
  assert.deepEqual(exitSteps(pos("native-unstaking-" + POOL, "2", "NEAR", "2026-11-12T00:00:00Z"), prices)!.kinds, ["native_withdraw"]);
  assert.deepEqual(exitSteps(pos("native-unstaking-" + POOL, "2"), prices)!.kinds, ["wait_until", "native_withdraw"]);
  const l = exitSteps(pos("linear-shares", "10", "LiNEAR"), prices)!;
  assert.deepEqual(l.kinds, ["unstake", "wait_until", "withdraw_unstaked"]);
  assert.equal(l.steps[0].asset, "LiNEAR");
  assert.equal(l.steps[2].amountRaw, "14309000000000000000000000"); // 10 LiNEAR × 1.4309 NEAR
  assert.ok(exitSteps(pos("native-stake-" + POOL, "1"), prices, 2n * NEAR)!.reasons.includes("EXCEEDS_POSITION"));
  const rnear = exitSteps(pos("rnear-shares", "1", "rNEAR"), {...prices,lstNearPerToken:{...prices.lstNearPerToken,rNEAR:"1060000000000000000000000"}})!;
  assert.equal(rnear.venue,"lst.rhealab.near");
  assert.deepEqual(rnear.kinds,["unstake","wait_until","withdraw_unstaked"]);
  assert.equal(rnear.steps[0].asset,"rNEAR");
  assert.equal(rnear.steps[2].amountRaw,"1060000000000000000000000");
  assert.ok(exitSteps(pos("rnear-shares","1","rNEAR"),prices)!.reasons.length > 0,"Missing rNEAR valuation must block an exit quote");
});

function plannedStake() {
  const sizing = sizeStake({ walletRaw: 20n * NEAR, surplusUsdcRaw: "100000000", prices });
  let policy: any = defaultPolicy("5");
  policy = withEntries(policy, missingEntries(policy, [{ kind: "native_stake", pool: POOL }]));
  const { alternatives, staking } = stakeAlternatives({ w, policy, ledger: [], sizing, validator: validator(), pool: POOL, linearExitDays: 3, adapterReasons: () => [] });
  const plan: any = newPlan({
    id: "p-1234567890", key: "k", source: "live", accountId: "owner.near", objective: "stake", createdBy: "user",
    request: { amountRaw: sizing.amountRaw.toString(), asset: "NEAR", venue: POOL }, context: { workspaceRevision: 1, mandateVersion: 1, policyVersion: 1 } as any,
    alternatives,
  });
  plan.staking = staking;
  return { plan, sizing };
}

test("review: staking steps carry raw NEAR and the venue (not USDC), and a native stake needs explicit approval", () => {
  const { plan, sizing } = plannedStake();
  reviewChoice(plan, "native:" + POOL);
  const [step] = plan.steps;
  assert.equal(step.kind, "native_stake");
  assert.deepEqual({ amountRaw: step.expected.amountRaw, asset: step.expected.asset, venue: step.expected.venue }, { amountRaw: sizing.amountRaw.toString(), asset: "NEAR", venue: POOL });
  assert.equal(step.approval, "owner_wallet");
  assert.deepEqual(plan.approvals.map((a: any) => a.kind), ["stake"]);
  assert.throws(() => assertPreparable(plan, step.id, plan.context), /Approve the stake explicitly/);
  plan.approvals[0].grantedAt = new Date().toISOString();
  assert.equal(assertPreparable(plan, step.id, plan.context).kind, "prepare");
  // Policy entries for the chosen native alternative name the pool.
  assert.deepEqual(planPolicySteps(plan), [{ kind: "native_stake", pool: POOL }]);
});

test("review refuses a staking alternative without NEAR sizing (the old USDC-sized stake bug)", () => {
  const { plan } = plannedStake();
  delete plan.staking;
  assert.throws(() => reviewChoice(plan, "linear"), /no NEAR sizing/);
});
