import test from "node:test";
import assert from "node:assert/strict";
import { todayCards, USDC_NEAR } from "../lib/flowvault/today.ts";

const base = {
  holdings: [
    { tokenId: "base:usdc", symbol: "USDC", network: "base", amount: 120, usd: 120 },
    { tokenId: "arb:usdt", symbol: "USDT", network: "arb", amount: 80, usd: 80 },
    { tokenId: "eth:native", symbol: "ETH", network: "eth", amount: 0.42, usd: 1354 },
    { tokenId: "near:native", symbol: "NEAR", network: "near", amount: 42, usd: 134 },
  ],
  rates: [{ tokenId: "usdt.tether-token.near", symbol: "USDt", supplyApy: 9.45 }, { tokenId: "x", symbol: "FRAX", supplyApy: 13.9 }, { tokenId: "wrap.near", symbol: "wNEAR", supplyApy: 0.3 }],
  stakeApy: 4.3,
  held24h: { "eth:native": 6.2 },
  trending: [{ tokenId: null, symbol: "BONK", chain: "Solana", changeH24: 12.4, priceUsd: 0.00002 }],
};

test("today's suggestions: idle stablecoins first, then moves in what you hold, staking and trending", () => {
  const cards = todayCards(base);
  assert.deepEqual(cards.map((c) => c.id), ["idle-stables", "move:eth:native", "stake-near", "trending"]);
  const idle = cards[0];
  assert.match(idle.title, /\$200\.00 of idle stablecoins/);
  assert.match(idle.body, /2 chains/);
  assert.deepEqual(idle.action, { kind: "supply", tokenId: "usdt.tether-token.near" }, "the best USDC/USDT market wins; FRAX may not route");
  const move = cards[1];
  assert.equal(move.tone, "move-up");
  assert.deepEqual(move.action, { kind: "swap", from: "eth:native", to: USDC_NEAR, amount: "0.105" });
  assert.match(cards[2].body, /about 1\.78 NEAR a year/);
});

test("nothing idle, nothing moving, nothing to stake: only what's actually there", () => {
  const cards = todayCards({ ...base, holdings: [{ tokenId: "eth:native", symbol: "ETH", network: "eth", amount: 0.001, usd: 3 }], held24h: { "eth:native": -9 }, stakeApy: null, trending: [] });
  assert.deepEqual(cards, []);
  const down = todayCards({ ...base, held24h: { "eth:native": -7.5 } }).find((c) => c.id === "move:eth:native")!;
  assert.equal(down.tone, "move-down");
  assert.match(down.title, /down 7\.5% today/);
});
