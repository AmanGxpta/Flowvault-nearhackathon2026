import { test } from "node:test";
import assert from "node:assert/strict";
import { refActions, buildSwapTransactions, nearFeeBound, swapPolicyAction, swapPolicyEntries, verifySwapReceipts, REF_EXCHANGE, WRAP_NEAR } from "../lib/flowvault/swap-exec.ts";
import { evaluatePolicy, defaultPolicy } from "../lib/flowvault/policy.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const near = { contract: "native", symbol: "NEAR", decimals: 24 }, usdc = { contract: USDC, symbol: "USDC", decimals: 6 };
const ONE = "1000000000000000000000000";

test("Ref routes become actions whose inputs add up to exactly the reviewed amount", () => {
  const routes = [
    { pools: [{ pool_id: "1", token_in: WRAP_NEAR, token_out: "usdt.tether-token.near", amount_in: "600000000000000000000000" }, { pool_id: "2", token_in: "usdt.tether-token.near", token_out: USDC, min_amount_out: "2000000" }] },
    { pools: [{ pool_id: "3", token_in: WRAP_NEAR, token_out: USDC, amount_in: "400000000000000000000000", min_amount_out: "1400000" }] },
  ];
  const r = refActions(routes, WRAP_NEAR, USDC, ONE);
  assert.equal(r.minOutRaw, "3400000");
  assert.equal(r.actions.length, 3);
  assert.equal(r.actions[0].amount_in, "600000000000000000000000");
  assert.equal(r.actions[0].min_amount_out, "0"); // intermediate hop
  assert.equal(r.actions[1].amount_in, undefined);
  assert.throws(() => refActions(routes, WRAP_NEAR, USDC, "999"), /add up/);
  assert.throws(() => refActions([{ pools: [{ pool_id: "1", token_in: WRAP_NEAR, token_out: "x.near", amount_in: ONE, min_amount_out: "1" }] }], WRAP_NEAR, USDC, ONE), /different pair/);
  assert.throws(() => refActions([{ pools: [{ pool_id: "1", token_in: WRAP_NEAR, token_out: "a.near", amount_in: ONE }, { pool_id: "2", token_in: "b.near", token_out: USDC, min_amount_out: "1" }] }], WRAP_NEAR, USDC, ONE), /disconnected/);
});

test("paying in NEAR wraps first; receiving NEAR asks Ref to unwrap; registrations only when missing", () => {
  const { actions, minOutRaw } = refActions([{ pools: [{ pool_id: "3", token_in: WRAP_NEAR, token_out: USDC, amount_in: ONE, min_amount_out: "3400000" }] }], WRAP_NEAR, USDC, ONE);
  const txs = buildSwapTransactions({ accountId: "owner.near", from: near, to: usdc, amountRaw: ONE, actions, minOutRaw, wrapStorageRaw: null, outStorageRaw: "1250000000000000000000", refStorageRaw: null });
  assert.deepEqual(txs.map(t => t.receiverId), [WRAP_NEAR, USDC, WRAP_NEAR]);
  assert.equal(txs[0].actions[0].params.methodName, "near_deposit");
  assert.equal(txs[0].actions[0].params.deposit, ONE);
  const swap = txs[2].actions[0].params;
  assert.equal(swap.methodName, "ft_transfer_call");
  assert.equal(swap.args.receiver_id, REF_EXCHANGE);
  assert.equal(swap.deposit, "1");
  assert.equal(JSON.parse(String(swap.args.msg)).skip_unwrap_near, undefined);

  const back = refActions([{ pools: [{ pool_id: "3", token_in: USDC, token_out: WRAP_NEAR, amount_in: "1000000", min_amount_out: "280000000000000000000000" }] }], USDC, WRAP_NEAR, "1000000");
  const out = buildSwapTransactions({ accountId: "owner.near", from: usdc, to: near, amountRaw: "1000000", ...back, wrapStorageRaw: null, outStorageRaw: null, refStorageRaw: "1020000000000000000000" });
  assert.deepEqual(out.map(t => t.receiverId), [REF_EXCHANGE, USDC]);
  assert.equal(JSON.parse(String(out[1].actions[0].params.args.msg)).skip_unwrap_near, false);
  assert.throws(() => buildSwapTransactions({ accountId: "owner.near", from: near, to: { contract: WRAP_NEAR, symbol: "wNEAR", decimals: 24 }, amountRaw: ONE, actions, minOutRaw, wrapStorageRaw: null, outStorageRaw: null }), /not a swap/);
  const fee = nearFeeBound(out, 0n);
  assert.ok(fee.feeRaw > 1020000000000000000000n, "storage and gas count toward the NEAR fee bound");
});

test("a swap is checked as selling its input asset, and blocks until the owner allows Ref", () => {
  const { actions, minOutRaw } = refActions([{ pools: [{ pool_id: "3", token_in: WRAP_NEAR, token_out: USDC, amount_in: ONE, min_amount_out: "3400000" }] }], WRAP_NEAR, USDC, ONE);
  const transactions = buildSwapTransactions({ accountId: "owner.near", from: near, to: usdc, amountRaw: ONE, actions, minOutRaw, wrapStorageRaw: null, outStorageRaw: null });
  const prep = { accountId: "owner.near", from: near, tokenIn: WRAP_NEAR, tokenOut: USDC, inputUsd: "3.5", minOutUsd: "3.4", transactions };
  const action = swapPolicyAction(prep, 30000000000000000000000n, 100000n);
  assert.equal(action.kind, "swap");
  assert.equal(action.amount, "3.5");
  assert.equal(action.movingCost, "0.2");
  const policy = defaultPolicy();
  const blocked = evaluatePolicy(action, policy, []);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.violations.some(v => v.code === "VENUE_NOT_ALLOWED"));
  for (const e of swapPolicyEntries(prep)) { if (e.type === "venue") policy.venues.push(e.venue); else policy.methods.push({ receiver: e.receiver, method: e.method }); }
  assert.equal(evaluatePolicy(action, policy, []).allowed, true);
  // Unpriced assets fail closed on cost.
  const unpriced = swapPolicyAction({ ...prep, minOutUsd: null }, 1n, 1n);
  assert.ok(evaluatePolicy(unpriced, policy, []).violations.some(v => v.code === "COST_UNVERIFIED"));
  // With asset rows in use, the input needs a sell permission.
  const rows = { ...policy, assetRows: [{ asset: "NEAR", chain: "near" as const, priority: "P2" as const, uses: ["hold" as const] }] };
  assert.ok(evaluatePolicy(action, rows, []).violations.some(v => v.code === "ASSET_USE_NOT_ALLOWED"));
});

const event = (token: string, from: string, to: string, amount: string) => ({ id: "r" + Math.random(), outcome: { executor_id: token, logs: ["EVENT_JSON:" + JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [{ old_owner_id: from, new_owner_id: to, amount }] })] } });
test("receipts confirm only a delivered output at or above the minimum", () => {
  const p = { accountId: "owner.near", tokenIn: WRAP_NEAR, tokenOut: USDC, amountRaw: ONE, minOutRaw: "3400000", to: usdc };
  const ok = verifySwapReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [event(WRAP_NEAR, "owner.near", REF_EXCHANGE, ONE), event(USDC, REF_EXCHANGE, "owner.near", "3450000")] }], p);
  assert.equal(ok?.state, "confirmed");
  assert.equal(ok?.received, "3.45");
  const refunded = verifySwapReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [event(WRAP_NEAR, "owner.near", REF_EXCHANGE, ONE), event(WRAP_NEAR, REF_EXCHANGE, "owner.near", ONE)] }], p);
  assert.equal(refunded?.state, "failed");
  assert.equal(verifySwapReceipts([{ final_execution_status: "EXECUTED_OPTIMISTIC" }], p), null);
  const nativeOut = verifySwapReceipts([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [], receipts: [{ predecessor_id: REF_EXCHANGE, receiver_id: "owner.near", receipt: { Action: { actions: [{ Transfer: { deposit: "290000000000000000000000" } }] } } }] }], { ...p, tokenIn: USDC, tokenOut: WRAP_NEAR, minOutRaw: "280000000000000000000000", to: near });
  assert.equal(nativeOut?.state, "confirmed");
});
