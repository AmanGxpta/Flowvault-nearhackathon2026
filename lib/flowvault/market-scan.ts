// Public market discovery: DexScreener pair stats and GeckoTerminal candles, normalized for display.
// Read-only display data. Nothing here prices an executable action; execution re-reads its own evidence.
import type { Candle } from "./market-display.ts";

export type Frame = "m5" | "h1" | "h6" | "h24";
export interface MarketRow {
  chain: string; address: string; symbol: string; name: string; icon: string | null;
  priceUsd: string | null; change: Partial<Record<Frame, number>>; volume: Partial<Record<Frame, number>>;
  txns: Partial<Record<Frame, { buys: number; sells: number }>>; liquidityUsd: number | null; fdv: number | null; marketCap: number | null;
  pairAddress: string; dexId: string; quoteSymbol: string; createdAt: number | null; url: string | null;
  boosts?: number; website?: string | null; socials?: { type: string; url: string }[];
}
/** DexScreener chain id → FlowVault/1Click catalog network id (for Buy) and GeckoTerminal network id (candles). */
export const CHAINS: Record<string, { network: string; gecko: string; label: string }> = {
  near: { network: "near", gecko: "near", label: "NEAR" }, ethereum: { network: "eth", gecko: "eth", label: "Ethereum" },
  base: { network: "base", gecko: "base", label: "Base" }, arbitrum: { network: "arb", gecko: "arbitrum", label: "Arbitrum" },
  solana: { network: "sol", gecko: "solana", label: "Solana" }, bsc: { network: "bsc", gecko: "bsc", label: "BNB Chain" },
  polygon: { network: "pol", gecko: "polygon_pos", label: "Polygon" }, avalanche: { network: "avax", gecko: "avax", label: "Avalanche" },
  optimism: { network: "op", gecko: "optimism", label: "Optimism" },
  // More DexScreener chains with GeckoTerminal candles; trading on them runs through LI.FI (trade-lifi.ts).
  robinhood: { network: "hood", gecko: "robinhood", label: "Robinhood Chain" }, elysium: { network: "elysium", gecko: "elysium", label: "Elysium" },
  hyperevm: { network: "hyperevm", gecko: "hyperevm", label: "HyperEVM" }, monad: { network: "monad", gecko: "monad", label: "Monad" },
  sonic: { network: "sonic", gecko: "sonic", label: "Sonic" }, unichain: { network: "unichain", gecko: "unichain", label: "Unichain" },
  ink: { network: "ink", gecko: "ink", label: "Ink" }, abstract: { network: "abstract", gecko: "abstract", label: "Abstract" },
  linea: { network: "linea", gecko: "linea", label: "Linea" }, mantle: { network: "mantle", gecko: "mantle", label: "Mantle" },
  berachain: { network: "bera", gecko: "berachain", label: "Berachain" }, scroll: { network: "scroll", gecko: "scroll", label: "Scroll" },
  zksync: { network: "zksync", gecko: "zksync", label: "zkSync" }, seiv2: { network: "sei", gecko: "sei-evm", label: "Sei" },
  cronos: { network: "cronos", gecko: "cro", label: "Cronos" }, celo: { network: "celo", gecko: "celo", label: "Celo" },
  worldchain: { network: "worldchain", gecko: "world-chain", label: "World Chain" }, apechain: { network: "apechain", gecko: "apechain", label: "ApeChain" },
  soneium: { network: "soneium", gecko: "soneium", label: "Soneium" }, plasma: { network: "plasma", gecko: "plasma", label: "Plasma" },
  katana: { network: "katana", gecko: "katana", label: "Katana" }, megaeth: { network: "megaeth", gecko: "megaeth", label: "MegaETH" },
  xlayer: { network: "xlayer", gecko: "x-layer", label: "X Layer" }, gnosischain: { network: "gnosis", gecko: "xdai", label: "Gnosis" },
  metis: { network: "metis", gecko: "metis", label: "Metis" }, mode: { network: "mode", gecko: "mode", label: "Mode" },
  fraxtal: { network: "fraxtal", gecko: "fraxtal", label: "Fraxtal" }, ronin: { network: "ronin", gecko: "ronin", label: "Ronin" },
  flare: { network: "flare", gecko: "flare", label: "Flare" }, kaia: { network: "kaia", gecko: "kaia", label: "Kaia" },
  morph: { network: "morph", gecko: "morph-l2", label: "Morph" }, hemi: { network: "hemi", gecko: "hemi", label: "Hemi" },
  etherlink: { network: "etherlink", gecko: "etherlink", label: "Etherlink" }, taiko: { network: "taiko", gecko: "taiko", label: "Taiko" },
};
const ADDRESS = /^[A-Za-z0-9._:-]{2,90}$/;
const num = (x: unknown): number | null => { const n = typeof x === "string" ? Number(x) : x; return typeof n === "number" && Number.isFinite(n) ? n : null; };
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? x as Record<string, unknown> : {});
const safeUrl = (x: unknown) => (typeof x === "string" && /^https:\/\/[^\s"'<>]{4,300}$/.test(x) ? x : null);

export function parsePair(raw: unknown): MarketRow | null {
  const p = rec(raw), base = rec(p.baseToken), quote = rec(p.quoteToken), info = rec(p.info);
  if (typeof p.chainId !== "string" || !CHAINS[p.chainId] || typeof base.address !== "string" || !ADDRESS.test(base.address) || typeof p.pairAddress !== "string" || !ADDRESS.test(p.pairAddress)) return null;
  const frames: Frame[] = ["m5", "h1", "h6", "h24"];
  const change: MarketRow["change"] = {}, volume: MarketRow["volume"] = {}, txns: MarketRow["txns"] = {};
  for (const f of frames) {
    const c = num(rec(p.priceChange)[f]); if (c !== null) change[f] = c;
    const v = num(rec(p.volume)[f]); if (v !== null) volume[f] = v;
    const t = rec(rec(p.txns)[f]); const b = num(t.buys), s = num(t.sells); if (b !== null && s !== null) txns[f] = { buys: b, sells: s };
  }
  const price = typeof p.priceUsd === "string" && /^\d+(\.\d+)?(e-?\d+)?$/i.test(p.priceUsd) ? p.priceUsd : null;
  return {
    chain: p.chainId, address: base.address, symbol: String(base.symbol ?? "?").slice(0, 24), name: String(base.name ?? base.symbol ?? "").slice(0, 60),
    icon: safeUrl(info.imageUrl), priceUsd: price, change, volume, txns, liquidityUsd: num(rec(p.liquidity).usd), fdv: num(p.fdv), marketCap: num(p.marketCap),
    pairAddress: p.pairAddress, dexId: String(p.dexId ?? "").slice(0, 30), quoteSymbol: String(quote.symbol ?? "").slice(0, 16),
    createdAt: num(p.pairCreatedAt), url: safeUrl(p.url),
    website: safeUrl(rec((info.websites as unknown[] | undefined)?.[0]).url),
    socials: Array.isArray(info.socials) ? (info.socials as unknown[]).slice(0, 4).flatMap(s => { const r = rec(s), u = safeUrl(r.url); return u ? [{ type: String(r.type ?? "link").slice(0, 16), url: u }] : []; }) : [],
  };
}
/** One row per token: the pair with the deepest liquidity (ties: higher 24h volume). */
export function bestPairs(raw: unknown): MarketRow[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(rec(raw).pairs) ? rec(raw).pairs as unknown[] : [];
  const by = new Map<string, MarketRow>();
  for (const x of list.slice(0, 600)) {
    const r = parsePair(x); if (!r) continue;
    const k = r.chain + ":" + r.address.toLowerCase(), old = by.get(k);
    if (!old || (r.liquidityUsd ?? 0) > (old.liquidityUsd ?? 0) || ((r.liquidityUsd ?? 0) === (old.liquidityUsd ?? 0) && (r.volume.h24 ?? 0) > (old.volume.h24 ?? 0))) by.set(k, r);
  }
  return [...by.values()];
}
/** Boost/profile feeds → ordered unique (chain, address) list on supported chains. */
export function feedTokens(raw: unknown, chain: string | "all", limit = 60): { chain: string; address: string; boosts: number }[] {
  const out: { chain: string; address: string; boosts: number }[] = [], seen = new Set<string>();
  for (const x of Array.isArray(raw) ? raw.slice(0, 300) : []) {
    const r = rec(x);
    if (typeof r.chainId !== "string" || !CHAINS[r.chainId] || (chain !== "all" && r.chainId !== chain) || typeof r.tokenAddress !== "string" || !ADDRESS.test(r.tokenAddress)) continue;
    const k = r.chainId + ":" + r.tokenAddress.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    out.push({ chain: r.chainId, address: r.tokenAddress, boosts: num(r.totalAmount) ?? num(r.amount) ?? 0 });
    if (out.length >= limit) break;
  }
  return out;
}
export function parseOhlcv(raw: unknown): Candle[] {
  const list = rec(rec(rec(raw).data).attributes).ohlcv_list;
  if (!Array.isArray(list)) return [];
  const rows = list.slice(0, 500).flatMap(r => {
    if (!Array.isArray(r) || r.length < 6) return [];
    const [t, o, h, l, c, v] = r.map(Number);
    if (![t, o, h, l, c].every(n => Number.isFinite(n) && n > 0) || h < Math.max(o, c) || l > Math.min(o, c)) return [];
    return [{ time: t * 1000, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 }];
  });
  return [...new Map(rows.map(r => [r.time, r])).values()].sort((a, b) => a.time - b.time).slice(-120);
}
export interface TrustSignal { key?: "liquidity" | "age" | "turnover" | "route" | "metadata"; label: string; tone: "good" | "warn" | "bad"; detail: string }
/** What each check is worth in the safety score (a passing check earns its weight, a warning half). */
export const SAFETY_WEIGHTS = { liquidity: 35, age: 25, turnover: 15, metadata: 15, route: 10 } as const;
/**
 * A 0–100 safety score from the checks FlowVault could run. Checks that couldn't run are listed as unknown and left
 * out (never counted as passing); the score covers only what was checked. Any red flag caps the score at 39, so a
 * large token with a thin pool can't look safe because of its size.
 */
export function safetyScore(signals: TrustSignal[]) {
  let earned = 0, possible = 0;
  const checked = new Set<string>();
  for (const s of signals) {
    if (!s.key) continue;
    const w = SAFETY_WEIGHTS[s.key];
    checked.add(s.key); possible += w;
    earned += s.tone === "good" ? w : s.tone === "warn" ? w / 2 : 0;
  }
  if (!possible) return null;
  const red = signals.filter((s) => s.tone === "bad").length;
  const raw = Math.round((earned / possible) * 100);
  return { score: red ? Math.min(39, raw) : raw, redFlags: red, unknown: (Object.keys(SAFETY_WEIGHTS) as (keyof typeof SAFETY_WEIGHTS)[]).filter((k) => !checked.has(k)) };
}
/** Plain-language trust signals from public data. Not an endorsement; each says what it is based on. */
export function trustSignals(r: MarketRow, ctx: { listedForSwap: boolean; verifiedMetadata: boolean | null; now?: number }) {
  const now = ctx.now ?? Date.now(), out: TrustSignal[] = [];
  const liq = r.liquidityUsd ?? 0, vol = r.volume.h24 ?? 0, ageDays = r.createdAt ? (now - r.createdAt) / 86_400_000 : null;
  out.push(liq >= 1_000_000 ? { key: "liquidity", label: "Deep liquidity", tone: "good", detail: "Over $1M in the main pool, so typical trades move the price little." }
    : liq >= 50_000 ? { key: "liquidity", label: "Moderate liquidity", tone: "warn", detail: "$50k–$1M in the main pool. Larger trades will move the price." }
    : { key: "liquidity", label: "Thin liquidity", tone: "bad", detail: "Under $50k in the main pool. Expect high price impact and exit risk." });
  if (ageDays !== null) out.push(ageDays >= 90 ? { key: "age", label: "Established pool", tone: "good", detail: `Main pool is ${Math.floor(ageDays)} days old.` } : ageDays >= 7 ? { key: "age", label: "Young pool", tone: "warn", detail: `Main pool is ${Math.floor(ageDays)} days old.` } : { key: "age", label: "Brand-new pool", tone: "bad", detail: "Main pool is under a week old. New tokens carry the most risk." });
  if (liq > 0) { const turn = vol / liq; out.push(turn > 20 ? { key: "turnover", label: "Unusual turnover", tone: "warn", detail: `24h volume is ${turn.toFixed(0)}× liquidity, which can signal wash trading or a short-lived spike.` } : { key: "turnover", label: "Normal turnover", tone: "good", detail: `24h volume is ${turn.toFixed(1)}× liquidity.` }); }
  out.push(ctx.listedForSwap ? { key: "route", label: "Swappable in FlowVault", tone: "good", detail: "Listed in the NEAR Intents / Ref catalog FlowVault quotes from." } : { key: "route", label: "Routed through LI.FI", tone: "good", detail: "Not in the NEAR catalog; FlowVault quotes it live through LI.FI from your own wallets, and shows when no route exists." });
  if (ctx.verifiedMetadata !== null) out.push(ctx.verifiedMetadata ? { key: "metadata", label: "Metadata matches", tone: "good", detail: "On-chain token metadata matches the catalog’s symbol and decimals." } : { key: "metadata", label: "Metadata mismatch", tone: "bad", detail: "On-chain metadata differs from the catalog. Check the contract before trading." });
  return out;
}
