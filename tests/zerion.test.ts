import test from "node:test";
import assert from "node:assert/strict";
import { mapZerionPosition, mapZerionNft, readZerionWallet, memoryZerionStore, networkName, POSITIONS_TTL_MS, STALE_MAX_MS } from "../lib/flowvault/zerion.ts";
import { readProvenAccounts, EVM_COVERAGE_GAP } from "../lib/flowvault/account-reads.ts";
import { applyAccountAction } from "../lib/flowvault/account-registry.ts";
import { capitalView } from "../lib/flowvault/valuation.ts";
import type { Portfolio, Position, Workspace } from "../lib/flowvault/types.ts";

const ADDR = "0xC75ca609DE85D3a0A79ba2F1DAF95EA526498382";
const addr = ADDR.toLowerCase();
const AT = "2026-11-14T00:00:00.000Z", FRESH = "2099-01-01T00:00:00.000Z";
const pos = (o: { id: string; chain: string; symbol: string; type?: string; int: string; decimals: number; value: number | null; protocol?: string; impl?: string | null; trash?: boolean; dapp?: string }) => ({
  type: "positions",
  id: o.id,
  attributes: {
    name: o.symbol, position_type: o.type ?? "wallet", protocol: o.protocol ?? null, value: o.value,
    quantity: { int: o.int, decimals: o.decimals },
    fungible_info: { name: o.symbol, symbol: o.symbol, icon: { url: "https://x/" + o.symbol + ".png" }, implementations: [{ chain_id: o.chain, address: o.impl === undefined ? "0x" + o.symbol.toLowerCase().padEnd(40, "0") : o.impl, decimals: o.decimals }] },
    flags: { displayable: true, is_trash: !!o.trash },
  },
  relationships: { chain: { data: { type: "chains", id: o.chain } }, ...(o.dapp ? { dapp: { data: { type: "dapps", id: o.dapp } } } : {}) },
});
// Shaped like the wallet in the demo: tokens on several chains, DeFi positions, spam, an unpriced token, a loan.
const ROWS = [
  pos({ id: "zro-eth", chain: "ethereum", symbol: "ZRO", int: "148400000000000000000", decimals: 18, value: 235.96 }),
  pos({ id: "wefi-poly", chain: "polygon", symbol: "WEFI", int: "41528950000000000000000", decimals: 18, value: 207.08 }),
  pos({ id: "eth-native", chain: "ethereum", symbol: "ETH", int: "20683000000000000", decimals: 18, value: 28.53, impl: null }),
  pos({ id: "usdc-base", chain: "base", symbol: "USDC", int: "188589", decimals: 6, value: 0.19, impl: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }),
  pos({ id: "usdc-poly", chain: "polygon", symbol: "USDC", int: "5000000", decimals: 6, value: 5 }),
  pos({ id: "dao-staked", chain: "ethereum", symbol: "DAO", type: "staked", protocol: "DAO Maker", int: "5000000000000000000000", decimals: 18, value: 93.95 }),
  pos({ id: "wefi-loan", chain: "polygon", symbol: "USDT", type: "loan", protocol: "WeFi", int: "10000000", decimals: 6, value: 10 }),
  pos({ id: "spam", chain: "base", symbol: "CLAIM", int: "1000", decimals: 0, value: 50000, trash: true }),
  pos({ id: "unpriced", chain: "ethereum", symbol: "NGMI", int: "483877058", decimals: 0, value: null }),
  pos({ id: "hl", chain: "arbitrum", symbol: "USDC", type: "deposit", protocol: "Hyperliquid", int: "1000000", decimals: 6, value: 1, dapp: "hyperliquid" }),
];
const NFTS = [
  { id: "n1", attributes: { amount: "1", value: 120.5, nft_info: { name: "Punk #1", contract_address: "0x1", token_id: "1", content: { preview: { url: "https://x/1.png" } }, flags: { is_spam: false } }, collection_info: { name: "Punks" } }, relationships: { chain: { data: { id: "ethereum" } } } },
  { id: "n2", attributes: { amount: "1", value: 0, nft_info: { name: "Claim your reward", flags: { is_spam: true } } }, relationships: { chain: { data: { id: "base" } } } },
];

test("Zerion rows map to valued positions; spam, unpriced and FlowVault's own reads are left out", () => {
  const out = ROWS.map((r) => mapZerionPosition(r, ADDR, AT, FRESH, { hyperliquid: true }));
  const kept = out.filter((x): x is Position => !("skip" in x));
  assert.deepEqual(kept.map((p) => p.displayAsset).sort(), ["DAO", "USDC", "USDT", "WEFI", "ZRO"]);
  // Engine assets on whole-wallet rows are network-qualified, so planning code never treats them as its own USDC.
  assert.deepEqual(kept.filter((p) => p.displayAsset === "USDC" || p.displayAsset === "USDT").map((p) => p.asset).sort(), ["USDC (Polygon)", "USDT (Polygon)"]);
  assert.equal(kept.find((p) => p.displayAsset === "ZRO")!.asset, "ZRO");
  const skips = out.filter((x): x is { skip: string } => "skip" in x).map((x) => x.skip).sort();
  assert.deepEqual(skips, ["own read", "own read", "own read", "spam", "unpriced"]);
  const zro = kept.find((p) => p.asset === "ZRO")!;
  assert.equal(zro.amount, "148.4");
  assert.equal(zro.chain, "eth");
  assert.equal(zro.network, "Ethereum");
  assert.equal(zro.venueValuation?.usdcRaw, "235960000");
  assert.equal(zro.valuation?.amount, "235.96");
  const wefi = kept.find((p) => p.asset === "WEFI")!;
  assert.equal(wefi.chain, undefined);
  assert.equal(wefi.network, "Polygon");
  assert.equal(kept.find((p) => p.displayAsset === "USDT")!.kind, "debt");
  assert.match(kept.find((p) => p.asset === "DAO")!.label, /DAO Maker · Staked DAO/);
  assert.equal(networkName("binance-smart-chain"), "BNB Chain");
  assert.equal(networkName("some-new-chain"), "Some New Chain");
});

test("NFTs keep their floor and drop spam", () => {
  const n = NFTS.map((r) => mapZerionNft(r, ADDR));
  assert.equal(n[1], null);
  assert.deepEqual({ name: n[0]!.name, collection: n[0]!.collection, network: n[0]!.network, floorUsd: n[0]!.floorUsd }, { name: "Punk #1", collection: "Punks", network: "Ethereum", floorUsd: 120.5 });
});

test("the wallet read waits out indexing, authenticates with the key and caches briefly", async () => {
  let store = memoryZerionStore();
  const calls: { url: string; auth: string | null }[] = [];
  let first = true;
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    if (url.includes("/positions/") && first) { first = false; return new Response("", { status: 202, headers: { "retry-after": "0" } }); }
    return Response.json({ data: url.includes("/nft-positions/") ? NFTS : ROWS });
  };
  const r = await readZerionWallet(ADDR, { key: "zk_test", hyperliquid: true, fetcher, budgetMs: 5000, store });
  assert.equal(calls[0].auth, "Basic " + btoa("zk_test:"));
  assert.ok(calls.some((c) => c.url.includes(`/wallets/${addr}/positions/`) && c.url.includes("filter[trash]=only_non_trash") && c.url.includes("filter[positions]=no_filter")));
  assert.equal(r.positions.length, 5);
  assert.equal(r.nfts.length, 1);
  assert.match(r.notes[0], /1 token has no market price/);
  // Zerion's own total: everything non-trash and priced, loans subtracted.
  assert.equal(r.totalUsd, 235.96 + 207.08 + 28.53 + 0.19 + 5 + 93.95 - 10 + 1);
  const n = calls.length;
  await readZerionWallet(ADDR, { key: "zk_test", hyperliquid: true, fetcher, store });
  assert.equal(calls.length, n, "a second read within five minutes is served from the shared cache");
});

test("a refused key or a failed NFT read is said plainly", async () => {
  let store = memoryZerionStore();
  await assert.rejects(readZerionWallet(ADDR, { key: "bad", hyperliquid: false, store, fetcher: async () => new Response("", { status: 401 }) }), /refused the API key/);
  store = memoryZerionStore();
  const r = await readZerionWallet(ADDR, { key: "k", hyperliquid: false, store, fetcher: async (u) => (u.includes("nft") ? new Response("", { status: 500 }) : Response.json({ data: ROWS })) });
  assert.ok(r.notes.some((x) => /NFTs couldn't be read/.test(x)));
});

function workspace(): Workspace {
  const w = { mode: "live", accountId: null, obligations: [], operations: [], mandate: { version: 1, reserve: "0", horizon: 30 } } as unknown as Workspace;
  applyAccountAction(w, { action: "proven", chain: "evm", address: ADDR, method: "siwe" });
  return w;
}
const ethOnly = async (chain: "eth" | "base" | "arb", address: string) => [{ id: `${chain}-eth-${address}`, label: "ETH", asset: "ETH", amount: "0", rawAmount: "0", decimals: 18, kind: "wallet", chain, accountId: address.toLowerCase() } as Position];

test("connected EVM wallets are read on every chain when Zerion is configured, and said to be partial when not", async () => {
  let store = memoryZerionStore();
  const w = workspace();
  const withZerion = await readProvenAccounts(w, {
    evm: ethOnly, solana: async () => [], near: async () => ({}) as Portfolio,
    zerion: (a, o) => readZerionWallet(a, { key: "k", hyperliquid: o.hyperliquid, store, fetcher: async (u) => Response.json({ data: u.includes("nft") ? NFTS : ROWS }) }),
  });
  const all = withZerion.sections.find((s) => s.id.endsWith(":all"))!;
  assert.equal(all.status, "observed");
  assert.equal(withZerion.nfts.length, 1);
  assert.ok(withZerion.positions.some((p) => p.network === "Polygon" && p.asset === "WEFI"));
  // The Hyperliquid reader isn't configured here, so Zerion's Hyperliquid row is kept.
  assert.ok(withZerion.positions.some((p) => p.venue === "Hyperliquid"));

  const without = await readProvenAccounts(w, { evm: ethOnly, solana: async () => [], near: async () => ({}) as Portfolio });
  const gap = without.sections.find((s) => s.id.endsWith(":all"))!;
  assert.equal(gap.status, "partial");
  assert.equal(gap.reasons[0], EVM_COVERAGE_GAP);

  const failing = await readProvenAccounts(w, { evm: ethOnly, solana: async () => [], near: async () => ({}) as Portfolio, zerion: async () => { throw new Error("Zerion rate limit reached."); } });
  const down = failing.sections.find((s) => s.id.endsWith(":all"))!;
  assert.equal(down.status, "unavailable");
  assert.match(down.reasons[0], /rate limit/);
});

test("Zerion values count once in net worth, loans are subtracted, and USDC on another chain is never spendable", () => {
  const w = workspace();
  const now = Date.parse("2026-11-14T00:00:00.000Z");
  const kept = ROWS.map((r) => mapZerionPosition(r, ADDR, AT, FRESH, { hyperliquid: true })).filter((x): x is Position => !("skip" in x));
  const p: Portfolio = { source: "live", accountId: null, capturedAt: new Date(now).toISOString(), errors: [], positions: kept.map((x) => ({ ...x, ownership: "owner" as const })) };
  const c = capitalView(w, p, undefined, { now });
  // ZRO 235.96 + WEFI 207.08 + USDC(Polygon) 5 + DAO 93.95 − loan 10
  assert.equal(c.netWorthUsdcRaw, "531990000");
  assert.equal(c.spendableNowUsdcRaw, "0");
  assert.ok(!c.valuations.some((v) => v.asset === "USDC"), "Polygon USDC is never the plan's USDC");
});

test("scam airdrop NFTs that Zerion doesn't flag are dropped; a rate limit is waited out", async () => {
  const { looksLikeAirdropScam } = await import("../lib/flowvault/zerion.ts");
  assert.ok(looksLikeAirdropScam("ug evmentry.com"));
  assert.ok(looksLikeAirdropScam("oh 𝙚𝙫𝙢𝙚𝙣𝙩𝙧𝙮 𝙘𝙤𝙢"));
  assert.ok(looksLikeAirdropScam("Uniswap voucher", null));
  assert.ok(looksLikeAirdropScam("$340,000 reward"));
  assert.ok(!looksLikeAirdropScam("Lunaria Imaginator", "pARticle pack"));
  assert.ok(!looksLikeAirdropScam("Introducing World App 49085"));
  let store = memoryZerionStore();
  let hits = 0;
  const r = await readZerionWallet(ADDR, { key: "k", hyperliquid: false, budgetMs: 6000, store, fetcher: async (u) => {
    if (u.includes("/positions/") && hits++ === 0) return new Response("", { status: 429, headers: { "retry-after": "0" } });
    return Response.json({ data: u.includes("nft") ? NFTS : ROWS });
  } });
  // No Hyperliquid reader here, so Zerion's Hyperliquid row is kept: 5 + 1.
  assert.equal(r.positions.length, 6);
  assert.equal(hits, 2, "the 429 was retried once");
  assert.equal(networkName("xdai"), "Gnosis");
});

test("the cache survives reloads, the daily budget is never exceeded, and a fallback read says how old it is", async () => {
  let t = Date.parse("2026-11-14T10:00:00Z");
  const now = () => t;
  const store = memoryZerionStore();
  let calls = 0, down = false;
  const fetcher = async (u: string) => { calls++; if (down) return new Response("", { status: 500 }); return Response.json({ data: u.includes("nft") ? NFTS : ROWS }); };
  const read = (dailyLimit = 1800) => readZerionWallet(ADDR, { key: "k", hyperliquid: true, store, fetcher, now, dailyLimit, budgetMs: 2000 });
  await read();
  assert.equal(calls, 2, "tokens and NFTs");
  // A user refreshing over and over within five minutes: no requests at all.
  for (let i = 0; i < 50; i++) { t += 5000; await read(); }
  assert.equal(calls, 2);
  // Past five minutes only the tokens are re-read; NFTs keep for thirty.
  t += POSITIONS_TTL_MS;
  await read();
  assert.equal(calls, 3);
  // Budget spent: no request goes out; the last read is shown, with its time, and its values stay counted.
  t += POSITIONS_TTL_MS;
  const capped = await read(3);
  assert.equal(calls, 3);
  assert.match(capped.notes[0], /^Values from 10:\d\d UTC: today's Zerion request budget is used up/);
  assert.ok(Date.parse(capped.positions[0].venueValuation!.freshUntil) > t);
  // Zerion down: the last read is used up to six hours, then the read fails plainly.
  down = true;
  t += POSITIONS_TTL_MS;
  assert.match((await read()).notes[0], /^Values from .*HTTP 500/);
  t += STALE_MAX_MS;
  await assert.rejects(read(), /HTTP 500/);
});

test("two loads at the same moment share one request", async () => {
  const store = memoryZerionStore();
  let calls = 0;
  const fetcher = async (u: string) => { calls++; await new Promise((r) => setTimeout(r, 30)); return Response.json({ data: u.includes("nft") ? NFTS : ROWS }); };
  await Promise.all([1, 2, 3].map(() => readZerionWallet(ADDR, { key: "k", hyperliquid: true, store, fetcher })));
  assert.equal(calls, 2);
});
