import { test } from "node:test";
import assert from "node:assert/strict";
import { readLifiQuote, approveTx, readLifiStatus, tradePolicyAction, tradePolicyEntries, tradeReceivers, DS_CHAINS, EVM_NATIVE, SOLANA_ID, type TradeRequest } from "../lib/flowvault/trade-lifi.ts";
import { evaluatePolicy, defaultPolicy } from "../lib/flowvault/policy.ts";

const OWNER = "0x32e54827dca55754ea9cc1cc8455b2b6a7be004a", ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", TOKEN = "0x1111111111111111111111111111111111111111";
const sent: TradeRequest = { fromChain: 1, toChain: 4663, fromToken: EVM_NATIVE, toToken: TOKEN, fromAmount: "3000000000000000", fromAddress: OWNER, toAddress: OWNER, slippage: 0.03 };
const body = {
  id: "q1", tool: "relay",
  action: { fromChainId: 1, toChainId: 4663, fromToken: { address: EVM_NATIVE, symbol: "ETH", decimals: 18, priceUSD: "1964.3" }, toToken: { address: TOKEN, symbol: "PONS", decimals: 18, priceUSD: "0.15" }, fromAmount: sent.fromAmount, fromAddress: OWNER, toAddress: OWNER },
  estimate: { toAmount: "38000000000000000000", toAmountMin: "36860000000000000000", approvalAddress: ROUTER, executionDuration: 20, fromAmountUSD: "5.89", toAmountUSD: "5.70", feeCosts: [{ name: "LIFI Fixed Fee", amountUSD: "0.0147", included: true }], gasCosts: [{ amountUSD: "0.21" }] },
  transactionRequest: { chainId: 1, from: OWNER, to: ROUTER, value: "0xaa87bee538000", data: "0x4630a0d8" + "00".repeat(64), gasLimit: "0x5208" },
};

test("DexScreener chains map to LI.FI, including Robinhood, Elysium, HyperEVM, BSC and Solana", () => {
  assert.equal(DS_CHAINS.robinhood, 4663); assert.equal(DS_CHAINS.elysium, 99901); assert.equal(DS_CHAINS.hyperevm, 999); assert.equal(DS_CHAINS.bsc, 56); assert.equal(DS_CHAINS.solana, SOLANA_ID);
});

test("a LI.FI quote must echo the request and send exactly the reviewed value", () => {
  const q = readLifiQuote(body, sent);
  assert.equal(q.evmTx?.to, ROUTER);
  assert.equal(BigInt(q.evmTx!.value), 3000000000000000n);
  assert.equal(q.gasUsd, "0.2100");
  assert.throws(() => readLifiQuote({ ...body, action: { ...body.action, toAddress: TOKEN } }, sent), /does not match/);
  assert.throws(() => readLifiQuote({ ...body, transactionRequest: { ...body.transactionRequest, value: "0x1" } }, sent), /different amount/);
  assert.throws(() => readLifiQuote({ ...body, transactionRequest: { ...body.transactionRequest, from: TOKEN } }, sent), /doesn't match/);
  assert.throws(() => readLifiQuote({ ...body, estimate: { ...body.estimate, toAmountMin: "99000000000000000000" } }, sent), /invalid amounts/);
  assert.throws(() => readLifiQuote({ message: "No available quotes for the requested transfer" }, sent), /No available quotes/);
});

test("approvals are for the exact amount, never unlimited", () => {
  const a = approveTx(1, OWNER, TOKEN, ROUTER, 5_000000n);
  assert.equal(a.data, "0x095ea7b3" + ROUTER.slice(2).toLowerCase().padStart(64, "0") + (5_000000).toString(16).padStart(64, "0"));
  assert.equal(a.to, TOKEN);
});

test("trades sell the input at the LI.FI venue and need an explicit allow for each router", () => {
  const q = readLifiQuote(body, sent);
  const receivers = tradeReceivers(1, [q.evmTx!], false);
  assert.deepEqual(receivers, [{ receiver: "1:" + ROUTER.toLowerCase(), method: "lifi-route" }]);
  assert.deepEqual(tradeReceivers(1, [approveTx(1, OWNER, TOKEN, ROUTER, 1n), q.evmTx!], false).map(r => r.method), ["approve", "lifi-route"]);
  const action = tradePolicyAction({ accountId: OWNER, recipient: OWNER, from: q.from, fromUsd: q.fromUsd, minOutUsd: "5.529", gasUsd: q.gasUsd, receivers });
  assert.equal(action.venue, "lifi");
  assert.equal(action.movingCost, "0.571");
  const policy = defaultPolicy();
  assert.equal(evaluatePolicy(action, policy, []).allowed, false);
  for (const e of tradePolicyEntries(receivers, "Ethereum")) { if (e.type === "venue") policy.venues.push(e.venue); else policy.methods.push({ receiver: e.receiver, method: e.method }); }
  assert.equal(evaluatePolicy(action, policy, []).allowed, true);
});

test("delivery comes only from LI.FI's DONE status", () => {
  assert.equal(readLifiStatus({ status: "DONE", substatus: "COMPLETED", receiving: { amount: "100", txHash: "0xabc" } })?.state, "confirmed");
  assert.equal(readLifiStatus({ status: "DONE", substatus: "PARTIAL", receiving: { amount: "90", token: { symbol: "USDC" } } })?.state, "partial");
  assert.equal(readLifiStatus({ status: "DONE", substatus: "REFUNDED" })?.state, "failed");
  assert.equal(readLifiStatus({ status: "PENDING" }), null);
});
