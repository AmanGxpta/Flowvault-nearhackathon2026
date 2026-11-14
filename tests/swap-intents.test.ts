import { test } from "node:test";
import assert from "node:assert/strict";
import { readIntentsQuote, intentsDeposit, intentsPolicyAction, intentsPolicyEntries, verifyEvmDeposit, verifyNearDeposit } from "../lib/flowvault/swap-intents.ts";
import { evaluatePolicy, defaultPolicy } from "../lib/flowvault/policy.ts";

const OWNER = "0x32e54827dca55754ea9cc1cc8455b2b6a7be004a", DEPOSIT = "0x1111111111111111111111111111111111111111";
const USDC_ETH = { network: "eth", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, assetId: "nep141:eth-0xa0b8.omft.near" };
const ETH = { network: "eth", contract: "native", symbol: "ETH", decimals: 18, assetId: "nep141:eth.omft.near" };
const NEAR = { network: "near", contract: "native", symbol: "NEAR", decimals: 24, assetId: "nep141:wrap.near" };
const sent = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC_ETH.assetId, destinationAsset: "nep141:usdc.near", amount: "7000000", depositType: "ORIGIN_CHAIN", recipient: "owner.near", recipientType: "DESTINATION_CHAIN", refundTo: OWNER, refundType: "ORIGIN_CHAIN", deadline: "2026-11-13T12:00:00Z" };

test("a live Intents quote must echo the request and carry a deposit address and bounds", () => {
  const body = { quoteRequest: { ...sent }, quote: { depositAddress: DEPOSIT, amountIn: "7000000", amountOut: "6990000", minAmountOut: "6920000", deadline: "2026-11-13T12:10:00Z", timeEstimate: 45 } };
  const q = readIntentsQuote(body, sent);
  assert.equal(q.depositAddress, DEPOSIT);
  assert.equal(q.minOutRaw, "6920000");
  assert.equal(q.eta, 45);
  assert.throws(() => readIntentsQuote({ ...body, quoteRequest: { ...sent, recipient: "attacker.near" } }, sent), /does not match/);
  assert.throws(() => readIntentsQuote({ ...body, quote: { ...body.quote, depositAddress: undefined } }, sent), /deposit address/);
  assert.throws(() => readIntentsQuote({ ...body, quote: { ...body.quote, minAmountOut: "7000001" } }, sent), /minimum/);
});

test("deposits are exactly one transfer to the deposit address", () => {
  const erc20 = intentsDeposit(USDC_ETH, OWNER, DEPOSIT, "7000000", null).evmTx!;
  assert.equal(erc20.chainId, "0x1");
  assert.equal(erc20.to, USDC_ETH.contract);
  assert.equal(erc20.value, "0x0");
  assert.equal(erc20.data, "0xa9059cbb" + DEPOSIT.slice(2).padStart(64, "0") + (7000000).toString(16).padStart(64, "0"));
  const native = intentsDeposit(ETH, OWNER, DEPOSIT, "1000000000000000", null).evmTx!;
  assert.equal(native.to, DEPOSIT);
  assert.equal(BigInt(native.value), 1000000000000000n);
  const near = intentsDeposit(NEAR, "owner.near", "a".repeat(64), "1000000000000000000000000", null);
  assert.deepEqual(near.transactions.map(t => t.receiverId + "." + t.actions[0].params.methodName), ["wrap.near.near_deposit", "wrap.near.ft_transfer"]);
  assert.equal(near.transactions[1].actions[0].params.args.receiver_id, "a".repeat(64));
  assert.throws(() => intentsDeposit({ ...USDC_ETH, network: "sol" }, OWNER, DEPOSIT, "1", null), /cover NEAR, Ethereum, Base, Arbitrum, BNB Chain and Polygon/);
  // BNB Chain and Polygon deposits are ordinary EVM transfers on their own chain ids.
  assert.equal(intentsDeposit({ ...USDC_ETH, network: "bsc" }, OWNER, DEPOSIT, "1", null).evmTx?.chainId, "0x38");
  assert.equal(intentsDeposit({ ...USDC_ETH, network: "pol" }, OWNER, DEPOSIT, "1", null).evmTx?.chainId, "0x89");
});

test("Intents swaps are checked as selling the input at the 1click venue and need an explicit allow", () => {
  const dep = intentsDeposit(USDC_ETH, OWNER, DEPOSIT, "7000000", null);
  const prep = { accountId: OWNER, from: USDC_ETH, inputUsd: "7", minOutUsd: "6.92", ...dep };
  const action = intentsPolicyAction(prep, 300000n, 0n);
  assert.equal(action.venue, "1click");
  assert.equal(action.movingCost, "0.38");
  const policy = defaultPolicy();
  assert.equal(evaluatePolicy(action, policy, []).allowed, false);
  for (const e of intentsPolicyEntries(prep)) { if (e.type === "venue") policy.venues.push(e.venue); else policy.methods.push({ receiver: e.receiver, method: e.method }); }
  assert.equal(evaluatePolicy(action, policy, []).allowed, true);
});

test("origin receipts prove the exact deposit before delivery is tracked", () => {
  const dep = intentsDeposit(USDC_ETH, OWNER, DEPOSIT, "7000000", null);
  const p = { evmTx: dep.evmTx, from: USDC_ETH, depositAddress: DEPOSIT, amountRaw: "7000000", accountId: OWNER };
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", pad = (a: string) => "0x" + a.slice(2).padStart(64, "0");
  const log = { address: USDC_ETH.contract, topics: [topic, pad(OWNER), pad(DEPOSIT)], data: "0x" + (7000000).toString(16).padStart(64, "0") };
  assert.equal(verifyEvmDeposit({ from: OWNER }, { status: "0x1", logs: [log] }, p)?.state, "deposited");
  assert.equal(verifyEvmDeposit({ from: OWNER }, { status: "0x0", logs: [] }, p)?.state, "failed");
  assert.throws(() => verifyEvmDeposit({ from: OWNER }, { status: "0x1", logs: [{ ...log, data: "0x1" }] }, p), /reviewed amount/);
  assert.throws(() => verifyEvmDeposit({ from: DEPOSIT }, { status: "0x1", logs: [log] }, p), /another wallet/);
  const ev = (amount: string) => ({ outcome: { executor_id: "wrap.near", logs: ["EVENT_JSON:" + JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: "owner.near", new_owner_id: "a".repeat(64), amount }] })] } });
  const np = { from: NEAR, depositAddress: "a".repeat(64), amountRaw: "100", accountId: "owner.near" };
  assert.equal(verifyNearDeposit([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [ev("100")] }], np)?.state, "deposited");
  assert.equal(verifyNearDeposit([{ final_execution_status: "EXECUTED_OPTIMISTIC" }], np), null);
  assert.throws(() => verifyNearDeposit([{ final_execution_status: "FINAL", status: { SuccessValue: "" }, receipts_outcome: [ev("99")] }], np), /reviewed amount/);
});

test("a Solana origin is one SPL USDC transfer in policy terms", async () => {
  const { intentsPolicyEntries } = await import("../lib/flowvault/swap-intents.ts");
  const entries = intentsPolicyEntries({ transactions: [], evmTx: null, from: { network: "sol", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, assetId: "x" }, solTx: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } as never });
  assert.deepEqual(entries.filter((e) => e.type === "method").map((e) => (e as { receiver: string; method: string }).receiver + " " + (e as { method: string }).method), ["spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v transfer"]);
});
