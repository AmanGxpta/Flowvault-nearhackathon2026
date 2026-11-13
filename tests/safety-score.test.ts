import test from "node:test";
import assert from "node:assert/strict";
import { safetyScore, trustSignals, type MarketRow } from "../lib/flowvault/market-scan.ts";

const row = (o: Partial<MarketRow>): MarketRow => ({ chain: "base", address: "0x1", symbol: "T", name: "T", icon: null, priceUsd: "1", change: {}, volume: { h24: 100 }, txns: {}, liquidityUsd: 2_000_000, fdv: 1e9, marketCap: 5e8, pairAddress: "0xp", dexId: "x", quoteSymbol: "WETH", createdAt: Date.parse("2025-01-01"), url: null, ...o });
const now = Date.parse("2026-11-13");

test("a deep, established, routable pool scores high", () => {
  const s = safetyScore(trustSignals(row({}), { listedForSwap: true, verifiedMetadata: true, now }))!;
  assert.equal(s.score, 100); assert.equal(s.redFlags, 0); assert.deepEqual(s.unknown, []);
});
test("size never hides a thin pool: any red flag caps the score below 40", () => {
  // A large market cap and FDV with $1.8K of liquidity (the KAITO-on-Base case).
  const s = safetyScore(trustSignals(row({ liquidityUsd: 1800, volume: { h24: 122 }, createdAt: null }), { listedForSwap: true, verifiedMetadata: null, now }))!;
  assert.ok(s.score <= 39, String(s.score)); assert.equal(s.redFlags, 1);
  assert.deepEqual(s.unknown.sort(), ["age", "metadata"], "checks that couldn't run are reported, not counted as passing");
});
test("warnings earn half their weight", () => {
  const s = safetyScore(trustSignals(row({ liquidityUsd: 200_000 }), { listedForSwap: true, verifiedMetadata: true, now }))!;
  assert.equal(s.score, Math.round(((35 / 2 + 25 + 15 + 15 + 10) / 100) * 100));
});
