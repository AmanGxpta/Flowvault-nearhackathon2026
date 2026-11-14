import test from "node:test";
import assert from "node:assert/strict";
import { deriveSupplyFlow, defaultSource, tokenText, type SupplyFlow } from "../lib/flowvault/supply-flow.ts";

const flow = (o: Partial<SupplyFlow> = {}): SupplyFlow => ({
  id: "f1", accountId: "alice.near", tokenId: "usdt.tether-token.near", symbol: "USDt", decimals: 6, apy: 9.45,
  source: { from: "eth:native", fromSymbol: "ETH", fromNetwork: "Ethereum", amount: "0.004", expectedRaw: "12340000" },
  createdAt: "2026-11-14T00:00:00Z", updatedAt: "2026-11-14T00:00:00Z", cancelledAt: null, links: {}, ...o,
});
const a = (state: string, o: Record<string, unknown> = {}) => ({ id: "x", state, message: "", hashes: state === "prepared" ? 0 : 1, ...o });

test("a new flow asks you to pay first and waits on everything after", () => {
  const d = deriveSupplyFlow(flow(), {});
  assert.equal(d.status, "your_turn");
  assert.equal(d.current, "pay");
  assert.deepEqual(d.steps.map((s) => s.state), ["current", "waiting", "waiting", "waiting"]);
  assert.match(d.steps[1].detail, /About 12\.34 USDt expected/);
  assert.equal(d.supplyRaw, null);
});

test("while NEAR Intents delivers, the flow is working; what arrived is what gets supplied, not the quote", () => {
  assert.equal(deriveSupplyFlow(flow(), { pay: a("submitted") }).status, "working");
  const d = deriveSupplyFlow(flow(), { pay: a("confirmed", { deliveredRaw: "12290000" }) });
  assert.equal(d.supplyRaw, "12290000");
  assert.equal(d.current, "supply");
  assert.equal(d.status, "your_turn");
  assert.equal(d.steps[2].title, "Supply 12.29 USDt to Rhea");
});

test("a declined wallet prompt is 'not sent' and can be tried again; a refund needs attention", () => {
  const declined = deriveSupplyFlow(flow(), { pay: { ...a("failed"), hashes: 0 } });
  assert.equal(declined.status, "your_turn");
  assert.match(declined.steps[0].detail, /Not sent/);
  const refunded = deriveSupplyFlow(flow(), { pay: a("failed", { refundedRaw: "4000000000000000", message: "Refunded to your wallet." }) });
  assert.equal(refunded.status, "attention");
});

test("a confirmed supply finishes the flow; a closed flow stays closed", () => {
  const d = deriveSupplyFlow(flow(), { pay: a("confirmed", { deliveredRaw: "12290000" }), supply: a("confirmed") });
  assert.equal(d.status, "done");
  assert.equal(d.done, 4);
  assert.equal(deriveSupplyFlow(flow({ cancelledAt: "2026-11-14T01:00:00Z" }), {}).status, "cancelled");
});

test("the offer starts from your most valuable holding and leaves gas on native coins", () => {
  const eth = { id: "eth:native", contract: "native", decimals: 18 }, usdc = { id: "arb:0xaf88", contract: "0xaf88", decimals: 6 };
  const pick = defaultSource([{ token: usdc, raw: "7680000", usd: "7.68" }, { token: eth, raw: "10000000000000000", usd: "32.25" }]);
  assert.equal(pick?.token.id, "eth:native");
  assert.equal(pick?.amount, "0.009");
  assert.equal(defaultSource([{ token: usdc, raw: "7680000", usd: "7.68" }])?.amount, "7.68");
  assert.equal(defaultSource([{ token: usdc, raw: "0", usd: "0" }]), null);
  assert.equal(tokenText("1", 6), "<0.0001");
  assert.equal(defaultSource([{ token: usdc, raw: "10000000", usd: "10" }])?.amount, "10", "whole amounts keep their zeros");
});
