/* eslint-disable @typescript-eslint/no-explicit-any -- untyped 1Click JSON */
import test from "node:test";
import assert from "node:assert/strict";
import { quoteBody, checkQuote, transferTx, fundRequestError, unwrapTransaction, WNEAR_ASSET } from "../lib/flowvault/evm-funding.ts";
import { parseIntent } from "../lib/flowvault/assistant.ts";

const req = { chain: "eth" as const, from: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", to: "alice.near", amountRaw: "15000000" };
const good = (sent: any, extra: any = {}) => ({
  timestamp: new Date().toISOString(),
  quoteRequest: { ...sent },
  quote: { amountIn: "15000000", amountOut: "4389338970829239827400000", minAmountOut: "4345445581120947429126000", timeEstimate: 45, ...extra },
});

test("Convert intent is parsed from plain requests and never from 'why blocked'", () => {
  for (const q of ["Convert my available USDC to NEAR", "bridge 10 USDC from Ethereum into NEAR and stake it", "Stake my USDC"]) assert.equal(parseIntent(q).kind, "convert", q);
  const p = parseIntent("bridge 10 USDC from Arbitrum into NEAR and stake it");
  assert.equal(p.amount, "10");
  assert.equal(p.chain, "arb");
  assert.equal(p.action, "stake");
  assert.notEqual(parseIntent("Why was my USDC to NEAR conversion blocked?").kind, "convert");
});

test("A dry quote must echo the request and carry no deposit address", () => {
  const sent = quoteBody(req, true);
  assert.equal(sent.destinationAsset, WNEAR_ASSET);
  assert.equal(sent.recipient, "alice.near");
  assert.equal(sent.refundTo, req.from);
  const q = checkQuote(req, sent, good(sent));
  assert.equal(q.amountIn, "15");
  assert.equal(q.depositAddress, null);
  assert.throws(() => checkQuote(req, sent, good(sent, { depositAddress: "0x" + "1".repeat(40) })), /must not carry a deposit/);
  assert.throws(() => checkQuote(req, sent, { ...good(sent), quoteRequest: { ...sent, recipient: "mallory.near" } }), /different NEAR account/);
  assert.throws(() => checkQuote(req, sent, { ...good(sent), quoteRequest: { ...sent, refundTo: "0x" + "2".repeat(40) } }), /refunds a different/);
  assert.throws(() => checkQuote(req, sent, good(sent, { amountIn: "16000000" })), /different USDC amount/);
  assert.throws(() => checkQuote(req, sent, good(sent, { minAmountOut: "9".repeat(30) })), /bounds/);
});

test("A live quote needs a valid deposit address", () => {
  const sent = quoteBody(req, false);
  assert.throws(() => checkQuote(req, sent, good(sent)), /no valid deposit address/);
  assert.equal(checkQuote(req, sent, good(sent, { depositAddress: "0x" + "1".repeat(40) })).depositAddress, "0x" + "1".repeat(40));
});

test("The MetaMask transfer is exactly USDC.transfer(deposit, amount) with no ETH value", () => {
  const tx = transferTx("eth", req.from, "0x" + "1".repeat(40), "15000000");
  assert.equal(tx.chainId, "0x1");
  assert.equal(tx.to, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  assert.equal(tx.value, "0x0");
  assert.equal(tx.data, "0xa9059cbb" + "1".repeat(40).padStart(64, "0") + (15000000).toString(16).padStart(64, "0"));
  assert.equal(transferTx("arb", req.from, "0x" + "1".repeat(40), "1").chainId, "0xa4b1");
});

test("Requests and unwraps fail closed", () => {
  assert.match(fundRequestError({ ...req, chain: "bnb" as any })!, /Ethereum, Base or Arbitrum/);
  assert.match(fundRequestError({ ...req, to: "Not An Account!" })!, /NEAR account/);
  assert.match(fundRequestError({ ...req, amountRaw: "0" })!, /above zero/);
  assert.throws(() => unwrapTransaction("0"), /Nothing to unwrap/);
  const t = unwrapTransaction("5");
  assert.equal(t.receiverId, "wrap.near");
  assert.equal(t.actions[0].params.methodName, "near_withdraw");
  assert.equal(t.actions[0].params.deposit, "1");
});
