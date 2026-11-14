import test from "node:test";
import assert from "node:assert/strict";
import { autoPick, summarize, amountForUsd, spendableRaw, GAS_USD, type CollectSource } from "../lib/flowvault/collect.ts";

const src = (key: string, network: string, symbol: string, amount: number, price: number, decimals = 6, native = false): CollectSource => ({
  key, tokenId: network + ":" + symbol, symbol, network, account: "0xa", decimals, balanceRaw: BigInt(Math.round(amount * 10 ** Math.min(decimals, 9))).toString() + "0".repeat(Math.max(0, decimals - 9)), price, gasUsd: GAS_USD[network] ?? 0.05, native,
});
// Dust spread over chains: $3 to send, nothing large enough alone except on Ethereum, which is expensive.
const SOURCES = [
  src("eth-usdc", "eth", "USDC", 800, 1),
  src("base-usdc", "base", "USDC", 1.2, 1),
  src("arb-usdt", "arb", "USDT", 0.9, 1),
  src("pol-usdc", "pol", "USDC", 0.7, 1),
  src("bsc-bnb", "bsc", "BNB", 0.002, 620, 18, true),
  src("sol-sol", "sol", "SOL", 0.004, 165, 9, true),
  src("near-dust", "near", "USDC", 0.1, 1),
];

test("cheap chains first: $3 is collected from L2s and cheap chains before touching Ethereum, and lands on target", () => {
  const picks = autoPick(SOURCES, 3);
  const keys = picks.map((p) => p.key);
  assert.ok(!keys.includes("eth-usdc"), "Ethereum's gas makes it the last resort");
  assert.ok(!keys.includes("near-dust"), "dust below the minimum leg is skipped");
  const s = summarize(SOURCES, picks, 3);
  assert.ok(s.complete, `delivered ${s.deliveredUsd}`);
  assert.ok(s.overUsd < 0.6, "the last leg is sized to the remainder, not the whole balance");
  assert.ok(s.gasUsd < 0.2);
});

test("excluding sources and setting a priority changes the plan; a too-small set is short", () => {
  const withEth = autoPick(SOURCES, 3, { priority: ["eth-usdc"] });
  assert.deepEqual(withEth.map((p) => p.key), ["eth-usdc"]);
  const s = summarize(SOURCES, withEth, 3);
  assert.ok(s.complete && s.gasUsd >= 0.8, "one Ethereum leg: complete but costs more gas");
  const short = summarize(SOURCES, autoPick(SOURCES, 3, { exclude: new Set(["eth-usdc", "base-usdc", "bsc-bnb"]) }), 3);
  assert.equal(short.complete, false);
  assert.ok(short.shortUsd > 0.5);
});

test("native coins keep gas back, and an amount for a dollar value never exceeds what can be spent", () => {
  const bnb = SOURCES.find((s) => s.key === "bsc-bnb")!;
  assert.equal(spendableRaw(bnb), 1_800_000_000_000_000n);
  assert.equal(amountForUsd(bnb, 1000), spendableRaw(bnb).toString());
  const usdc = SOURCES.find((s) => s.key === "base-usdc")!;
  assert.equal(amountForUsd(usdc, 0.995), "1000000");
});
