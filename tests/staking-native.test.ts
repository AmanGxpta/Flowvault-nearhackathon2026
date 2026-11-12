// P2 native validator staking: evaluation, on-chain proposal acceptance, preparation guards, authority
// statement and finalized-receipt verification. Receipt logs are copied from real finalized mainnet
// transactions on astro-stakers.poolv1.near (12 Nov 2026):
//   deposit_and_stake 9fypaaVTeMSMp8gzWF9nMxhA6SKGeUKX1wKUnzjR8TUr, unstake 7RoReRMXR2cU1ntMZR4zH52ngEuF3UoTyYSN5herUXTP,
//   withdraw BUnTWi3CKLXxsxRBAcNQjBkhDvMMRAeqyqTkTZXG6Z95.
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateValidator,
  acceptProposal,
  buildNativePreparation,
  verifyNativeOutcome,
  fundAuthority,
  NOT_DEPLOYED,
  REFERENCE_POOL_CODE,
} from "../lib/flowvault/staking-native.ts";
import { attemptLedger } from "../lib/flowvault/ledger.ts";

const POOL = "astro-stakers.poolv1.near";
const NOW = Date.parse("2026-11-12T12:00:00Z");
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const evidence = (over: Record<string, unknown> = {}): any => ({
  poolId: POOL,
  capturedAt: "2026-11-12T12:00:00Z",
  whitelisted: true,
  codeHash: REFERENCE_POOL_CODE[0],
  epochHeight: 3500,
  current: { stake: "1", slashed: false, producedBlocks: 707, expectedBlocks: 707, producedChunks: 3378, expectedChunks: 3380 },
  inNextEpoch: true,
  fee: { numerator: 1, denominator: 100 },
  paused: false,
  ownerId: "astrostakers.near",
  totalStaked: "1",
  account: { staked: "5000000000000000000000000", unstaked: "2000000000000000000000000", canWithdraw: true },
  errors: [],
  ...over,
});

test("validator evaluation: verified reference pool is eligible; each failed check blocks new stake", () => {
  const ok = evaluateValidator(evidence());
  assert.equal(ok.eligible, true);
  assert.equal(ok.feeBps, 100);
  assert.equal(ok.uptimeBps, 9995);
  for (const [over, name] of [
    [{ whitelisted: false }, "WHITELISTED"],
    [{ codeHash: "other" }, "REFERENCE_CODE"],
    [{ fee: { numerator: 15, denominator: 100 } }, "FEE"],
    [{ paused: true }, "NOT_PAUSED"],
    [{ current: null }, "ACTIVE"],
    [{ inNextEpoch: false }, "NEXT_EPOCH"],
    [{ current: { stake: "1", slashed: false, producedBlocks: 50, expectedBlocks: 100, producedChunks: 50, expectedChunks: 100 } }, "UPTIME"],
    [{ whitelisted: null }, "WHITELISTED"],
  ] as const) {
    const e = evaluateValidator(evidence(over as any));
    assert.equal(e.eligible, false, name);
    assert.ok(e.reasons.some((r) => r.startsWith(name)), name + ": " + e.reasons.join("|"));
  }
  // Exits still work from a verified pool that has stopped validating; not from unverified code.
  assert.equal(evaluateValidator(evidence({ current: null, paused: true })).exitsVerified, true);
  assert.equal(evaluateValidator(evidence({ codeHash: "other" })).exitsVerified, false);
});

const value = { usdcRaw: "35000000", basis: "test", capturedAt: "", freshUntil: "2026-11-12T12:05:00Z" };
const fee = { usdcRaw: "450000", basis: "test", capturedAt: "", freshUntil: "2026-11-12T12:05:00Z" };
const capital = (surplus: string | null): any => ({ surplusUsdcRaw: surplus });
const base = (over: Record<string, unknown> = {}): any => ({
  accountId: "owner.near",
  revision: 3,
  mandateVersion: 2,
  policyVersion: 1,
  req: { kind: "native_stake", pool: POOL, amountRaw: 10n ** 25n, approveStake: true },
  validator: evaluateValidator(evidence()),
  onChain: NOT_DEPLOYED,
  value,
  fee,
  capital: capital("100000000"),
  nativeAvailableYocto: 20n * 10n ** 24n,
  now: NOW,
  ...over,
});

test("stake preparation: exact deposit_and_stake, explicit approval, surplus, gas reserve and honest authority", () => {
  const p = buildNativePreparation(base());
  assert.equal(p.transactions.length, 1);
  assert.equal(p.transactions[0].receiverId, POOL);
  assert.deepEqual(p.transactions[0].actions[0].params, { methodName: "deposit_and_stake", args: {}, gas: "125000000000000", deposit: "10000000000000000000000000" });
  assert.equal(p.policyAction.kind, "stake");
  assert.deepEqual(p.policyAction.methods, [{ receiver: POOL, method: "deposit_and_stake" }]);
  assert.equal(p.onChain.status, "not_deployed");
  assert.equal(p.authority.contractHoldsFunds, false);
  assert.equal(p.authority.contractCanRestrictWallet, false);
  assert.equal(p.authority.flowvaultSigns, false);
  assert.match(p.authority.statement, /No policy contract is deployed/);
  assert.throws(() => buildNativePreparation(base({ req: { kind: "native_stake", pool: POOL, amountRaw: 10n ** 25n } })), /STAKE_NEEDS_EXPLICIT_APPROVAL/);
  assert.throws(() => buildNativePreparation(base({ capital: capital("1000000") })), /surplus/);
  assert.throws(() => buildNativePreparation(base({ capital: capital(null) })), /surplus/);
  assert.throws(() => buildNativePreparation(base({ nativeAvailableYocto: 10n ** 25n })), /0.5 NEAR/);
  assert.throws(() => buildNativePreparation(base({ validator: evaluateValidator(evidence({ paused: true })) })), /VALIDATOR_NOT_ELIGIBLE/);
  assert.throws(() => buildNativePreparation(base({ value: { ...value, usdcRaw: null } })), /valuation/);
});

test("unstake and withdraw: bounded by the pool balance; withdraw only when the pool says so", () => {
  const u = buildNativePreparation(base({ req: { kind: "native_unstake", pool: POOL, amountRaw: 5n * 10n ** 24n } }));
  assert.deepEqual(u.transactions[0].actions[0].params.args, { amount: "5000000000000000000000000" });
  assert.equal(u.transactions[0].actions[0].params.deposit, "0");
  assert.equal(u.availability.withdrawableAfterEpochs, 4);
  assert.throws(() => buildNativePreparation(base({ req: { kind: "native_unstake", pool: POOL, amountRaw: 6n * 10n ** 24n } })), /staked balance/);
  const stuck = evaluateValidator(evidence({ account: { staked: "0", unstaked: "2000000000000000000000000", canWithdraw: false } }));
  assert.throws(() => buildNativePreparation(base({ validator: stuck, req: { kind: "native_withdraw", pool: POOL, amountRaw: 2n * 10n ** 24n } })), /not withdrawable yet/);
  const w = buildNativePreparation(base({ req: { kind: "native_withdraw", pool: POOL, amountRaw: 2n * 10n ** 24n }, capital: capital(null) }));
  assert.equal(w.transactions[0].actions[0].params.methodName, "withdraw");
});

const proposal = (over: Record<string, unknown> = {}, action: Record<string, unknown> = {}): any => ({
  id: "7", owner: "owner.near", agent: "agent.near", plan_version: "4", status: "approved", expires_at_ms: String(NOW + 3_600_000),
  action: { kind: "stake", asset_id: USDC, venue: "native:" + POOL, receiver: POOL, method: "deposit_and_stake", amount: "40000000", recipient: "owner.near", moving_cost: "0", gas_yocto: "125000000000000000000000", ...action },
  ...over,
});
const expected = { kind: "native_stake" as const, accountId: "owner.near", pool: POOL, method: "deposit_and_stake", usdcValueRaw: "35000000", gasYocto: "125000000000000000000000" };
const input = (p: any) => ({ owner: "owner.near", planVersion: "4", settlementAsset: USDC, proposal: p });

test("on-chain acceptance: only an owner-approved, current, matching proposal is accepted", () => {
  const a = acceptProposal("policy.owner.near", input(proposal()), expected, USDC, NOW);
  assert.equal(a.status, "accepted");
  assert.match(a.status === "accepted" ? a.basis : "", /grants no transaction authority/);
  for (const [p, why] of [
    [proposal({ status: "pending" }), /pending/],
    [proposal({ status: "recorded" }), /recorded/],
    [proposal({ plan_version: "3" }), /older on-chain plan/],
    [proposal({ expires_at_ms: String(NOW - 1) }), /expired/],
    [proposal({}, { amount: "30000000" }), /exceeds the approved proposal amount/],
    [proposal({}, { receiver: "other.poolv1.near" }), /receiver or method/],
    [proposal({}, { kind: "supply" }), /kind/],
    [proposal({ owner: "else.near" }), /owner/],
    [null, /not found/],
  ] as const)
    assert.throws(() => acceptProposal("policy.owner.near", input(p), expected, USDC, NOW), why);
  assert.throws(() => acceptProposal("policy.owner.near", { ...input(proposal()), owner: "else.near" }, expected, USDC, NOW), /policy contract owner/);
  assert.match(fundAuthority("owner.near", "policy.owner.near").statement, /holds no funds.*cannot stop a wallet with a full-access key/);
});

const tx = (signer: string, logs: string[], status: Record<string, unknown> = { SuccessValue: "" }) => ({
  final_execution_status: "FINAL",
  transaction: { signer_id: signer, receiver_id: POOL },
  receipts_outcome: [
    { id: "r1", outcome: { executor_id: POOL, status, logs } },
    { id: "r2", outcome: { executor_id: POOL, status: { SuccessValue: "" }, logs: [] } },
  ],
});
const prep = (kind: string, amountRaw: string, accountId: string): any => ({ kind, amountRaw, accountId, pool: POOL });
const S = "57a50db5c557e0e1afc09078a4217ada040fc1f72a35fd4f4e4e0228e4070d37";

test("verification from real mainnet pool receipts; wrong amounts, accounts or failures fail closed", () => {
  const stakeLogs = [
    `@${S} deposited 850000000000000000000000000. New unstaked balance is 850000000000000000000000000`,
    `@${S} staking 849999999999999999999999998. Received 481173229271031478326392712 new staking shares. Total 2 unstaked balance and 481173229271031478326392712 staking shares`,
    "Contract total staked balance is 33358838425348807481839036510544. Total number of shares 18883976482183125224716952683431",
  ];
  const ok = verifyNativeOutcome(tx(S, stakeLogs), prep("native_stake", "850000000000000000000000000", S), 0) as any;
  assert.equal(ok.state, "confirmed");
  assert.equal(ok.effect.stakedRaw, "849999999999999999999999998");
  assert.equal(verifyNativeOutcome(tx(S, stakeLogs), prep("native_stake", "900000000000000000000000000", S), 0).state, "failed");
  assert.equal(verifyNativeOutcome(tx("other.near", stakeLogs), prep("native_stake", "850000000000000000000000000", "other.near"), 0).state, "failed");
  assert.equal(verifyNativeOutcome(tx(S, stakeLogs, { Failure: {} }), prep("native_stake", "850000000000000000000000000", S), 0).state, "failed");
  assert.equal(verifyNativeOutcome({ ...tx(S, stakeLogs), final_execution_status: "EXECUTED" }, prep("native_stake", "850000000000000000000000000", S), 0).state, "pending");

  const unstakeLogs = ["@oh-my-god.near unstaking 43175868924217918671546292. Spent 24442209715693790946274156 staking shares. Total 43175868924217918671546293 unstaked balance and 0 staking shares"];
  // Requested 43175868924217918671546291 on chain; the pool's share rounding reported +1 yocto.
  assert.equal(verifyNativeOutcome(tx("oh-my-god.near", unstakeLogs), prep("native_unstake", "43175868924217918671546291", "oh-my-god.near"), 0).state, "confirmed");
  assert.equal(verifyNativeOutcome(tx("oh-my-god.near", unstakeLogs), prep("native_unstake", "40000000000000000000000000", "oh-my-god.near"), 0).state, "failed");

  const withdrawLogs = ["@tsytsorin.near withdrawing 4732025017114803090710002356. New unstaked balance is 0"];
  assert.equal(verifyNativeOutcome(tx("tsytsorin.near", withdrawLogs), prep("native_withdraw", "4732025017114803090710002356", "tsytsorin.near"), 0).state, "confirmed");
  // Another account's log in the same receipt is not ours.
  assert.equal(verifyNativeOutcome(tx("tsytsorin.near", withdrawLogs.map((l) => l.replace("tsytsorin", "x"))), prep("native_withdraw", "4732025017114803090710002356", "tsytsorin.near"), 0).state, "failed");
});

test("ledger: native stake is a position entry with zero net-worth effect", () => {
  const a: any = {
    id: "n1", accountId: "owner.near", kind: "native_stake", amount: "35", mandateVersion: 1, createdAt: "", expiresAt: "", state: "confirmed",
    preparation: { asset: "NEAR", amountRaw: "10000000000000000000000000", decimals: 24, usdcValueRaw: "35000000", pool: POOL },
    hashes: [], message: "", updatedAt: "2026-11-12T12:00:00Z",
  };
  const [e] = attemptLedger(a, null);
  assert.equal(e.kind, "position_entry");
  assert.equal(e.netWorthEffectUsdcRaw, "0");
  assert.equal(e.positionId, "native:" + POOL);
});

test("journal: verifyOutcome dispatches native attempts and summarizes a verified withdraw", async () => {
  const { verifyOutcome, summarizeOutcomes } = await import("../lib/flowvault/execution.ts");
  const p: any = {
    kind: "native_withdraw", accountId: "tsytsorin.near", pool: POOL, amountRaw: "4732025017114803090710002356", amount: "x",
    transactions: [{ receiverId: POOL, actions: [{ type: "FunctionCall", params: { methodName: "withdraw", args: { amount: "4732025017114803090710002356" }, gas: "125000000000000", deposit: "0" } }] }],
  };
  const attempt: any = { id: "w1", accountId: "tsytsorin.near", kind: "native_withdraw", preparation: p, hashes: ["h"] };
  const args = Buffer.from(JSON.stringify({ amount: "4732025017114803090710002356" })).toString("base64");
  const result = {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: { signer_id: "tsytsorin.near", receiver_id: POOL, actions: [{ FunctionCall: { method_name: "withdraw", args, gas: 125000000000000, deposit: "0" } }] },
    transaction_outcome: { outcome: { status: { SuccessReceiptId: "r1" } } },
    receipts_outcome: [{ id: "r1", outcome: { executor_id: POOL, status: { SuccessValue: "" }, logs: ["@tsytsorin.near withdrawing 4732025017114803090710002356. New unstaked balance is 0"] } }],
  };
  const o = verifyOutcome(result, attempt);
  assert.equal(o.state, "confirmed", o.message);
  assert.equal(summarizeOutcomes(attempt, [o]).state, "confirmed");
  // A different amount in the signed payload is rejected before any receipt is trusted.
  const other = { ...result, transaction: { ...result.transaction, actions: [{ FunctionCall: { method_name: "withdraw", args: Buffer.from('{"amount":"1"}').toString("base64"), gas: 125000000000000, deposit: "0" } }] } };
  assert.throws(() => verifyOutcome(other, attempt), /does not match/);
});
