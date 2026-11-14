import test from "node:test";
import assert from "node:assert/strict";
import { distribution, groupProtocols, groupTokens, splitSmall, totals, type HoldingRow } from "../lib/flowvault/portfolio-view.ts";

const row = (o: Partial<HoldingRow> & { id: string; symbol: string }): HoldingRow => ({ name: o.symbol, kind: "wallet", usd: null, quantity: null, network: "Ethereum", account: "0xa", walletLabel: "0xa…", venue: null, ...o });
// Two wallets, one asset on three chains, DeFi with a loan, dust and an unvalued token.
const ROWS: HoldingRow[] = [
  row({ id: "1", symbol: "ETH", name: "Ethereum ETH", usd: 28.53, quantity: 0.0207, network: "Ethereum" }),
  row({ id: "2", symbol: "ETH", name: "Base ETH", usd: 13.6, quantity: 0.00989, network: "Base" }),
  row({ id: "3", symbol: "ETH", name: "Arbitrum ETH", usd: 5.11, quantity: 0.00372, network: "Arbitrum", account: "0xb", walletLabel: "0xb…" }),
  row({ id: "4", symbol: "ZRO", usd: 235.96, quantity: 148.4 }),
  row({ id: "5", symbol: "WEFI", usd: 207.08, quantity: 41528.95, network: "Polygon" }),
  row({ id: "6", symbol: "DUST", usd: 0.12, quantity: 6.3 }),
  row({ id: "7", symbol: "NGMI", usd: null, quantity: 4.8e8 }),
  row({ id: "8", symbol: "DAO", kind: "staking", venue: "DAO Maker", usd: 93.95, quantity: 5000 }),
  row({ id: "9", symbol: "WETH", kind: "supplied", venue: "WeFi", usd: 48.47, network: "Polygon" }),
  row({ id: "10", symbol: "USDT", kind: "debt", venue: "WeFi", usd: 10, network: "Polygon" }),
];

test("tokens group by asset across chains and wallets, biggest first, with a unit price only when fully valued", () => {
  const g = groupTokens(ROWS);
  assert.deepEqual(g.map((x) => x.symbol), ["ZRO", "WEFI", "ETH", "DUST", "NGMI"]);
  const eth = g.find((x) => x.symbol === "ETH")!;
  assert.equal(eth.rows.length, 3);
  assert.deepEqual(eth.networks, ["Ethereum", "Base", "Arbitrum"]);
  assert.equal(eth.wallets.length, 2);
  assert.ok(Math.abs(eth.usd! - 47.24) < 1e-9);
  assert.equal(eth.name, "ETH", "names differ per chain, so the symbol stands in");
  assert.equal(eth.rows[0].network, "Ethereum", "legs sorted by value");
  assert.equal(g.find((x) => x.symbol === "NGMI")!.price, null);
  assert.ok(Math.abs(g.find((x) => x.symbol === "ZRO")!.price! - 1.59) < 0.001);
});

test("dust hides behind a toggle; unvalued assets stay visible", () => {
  const { shown, hidden } = splitSmall(groupTokens(ROWS));
  assert.deepEqual(hidden.map((x) => x.symbol), ["DUST"]);
  assert.ok(shown.some((x) => x.symbol === "NGMI"));
});

test("DeFi groups by protocol with debt subtracted", () => {
  const p = groupProtocols(ROWS);
  assert.deepEqual(p.map((x) => x.venue), ["DAO Maker", "WeFi"]);
  const wefi = p[1];
  assert.ok(Math.abs(wefi.usd - 38.47) < 1e-9);
  assert.equal(wefi.debt, 10);
  assert.equal(wefi.rows.at(-1)!.kind, "debt");
});

test("network and wallet splits count debt against their slice and fold the tail into Other", () => {
  const net = distribution(ROWS, (r) => r.network);
  assert.equal(net[0].label, "Ethereum");
  const polygon = net.find((s) => s.label === "Polygon")!;
  assert.ok(Math.abs(polygon.usd - (207.08 + 48.47 - 10)) < 1e-9);
  assert.ok(Math.abs(net.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  const folded = distribution(ROWS, (r) => r.symbol, 2);
  assert.equal(folded.length, 3);
  assert.match(folded[2].label, /^Other \(\d+\)$/);
  assert.ok(folded[2].members.includes("ETH"));
  const t = totals(ROWS);
  assert.equal(t.unvalued, 1);
  assert.equal(t.debt, 10);
  assert.ok(Math.abs(t.defi - (93.95 + 48.47)) < 1e-9);
});

test("each wallet gets its own summary: value, share, counts, networks by size and top assets", async () => {
  const { summarizeWallets, walletNameMap } = await import("../lib/flowvault/portfolio-view.ts");
  const names = walletNameMap([{ account: "0xa", walletLabel: "0xa…" }, { account: "0xa", walletLabel: "DeFi wallet" }, { account: "0xb", walletLabel: "0xb…" }]);
  assert.equal(names.get("0xa"), "DeFi wallet");
  assert.equal(names.get("0xb"), "0xb…");
  const w = summarizeWallets(ROWS, [{ accountId: "0xa", floorUsd: 50, amount: "2" }, { accountId: "0xa", floorUsd: null, amount: "1" }], names);
  assert.deepEqual(w.map((x) => x.account), ["0xa", "0xb"]);
  const a = w[0];
  assert.equal(a.label, "DeFi wallet");
  assert.equal(a.nfts, 2);
  assert.equal(a.nftFloor, 100);
  assert.equal(a.defi, 2);
  assert.deepEqual(a.top.map((t) => t.symbol), ["ZRO", "WEFI", "ETH"]);
  assert.equal(a.networks[0], "Ethereum");
  assert.ok(Math.abs(w[0].share + w[1].share - 1) < 1e-9);
});
