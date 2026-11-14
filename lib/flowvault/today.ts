// "What you can do today", pure. A handful of suggestions built from what you hold and today's market: idle
// stablecoins that could be earning, a big move in something you own, NEAR that could be staked, and what's trending.
// Each suggestion carries the numbers behind it and one action that opens an existing flow (nothing executes from
// here). Market data is display data; every action still gets its own live quote, checks and wallet approval.

export interface TodayHolding { tokenId: string; symbol: string; network: string; amount: number; usd: number | null }
export interface TodayRate { tokenId: string; symbol: string; supplyApy: number | null }
export interface TodayMover { tokenId: string | null; symbol: string; chain: string; changeH24: number | null; priceUsd: number | null; icon?: string | null }
export interface TodayInputs { holdings: TodayHolding[]; rates: TodayRate[]; stakeApy: number | null; held24h: Record<string, number>; trending: TodayMover[] }
export type TodayAction = { kind: "supply"; tokenId: string } | { kind: "swap"; from: string; to: string; amount?: string } | { kind: "stake" } | { kind: "markets" };
export interface TodayCard { id: string; tone: "earn" | "move-up" | "move-down" | "stake" | "trend"; title: string; body: string; figure?: string; cta: string; action: TodayAction }

const STABLES = new Set(["USDC", "USDT", "USDT.E", "USDC.E", "DAI", "USDE", "FRAX", "PYUSD"]);
const isStable = (s: string) => STABLES.has(s.toUpperCase());
const usd = (n: number) => (n >= 1000 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2));
const pct = (n: number) => (n > 0 ? "+" : "") + n.toFixed(1) + "%";
const NET: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", pol: "Polygon", op: "Optimism", avax: "Avalanche", gnosis: "Gnosis" };
/** USDC on NEAR: the default "take profit into" target. */
export const USDC_NEAR = "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** Up to `max` suggestions, most useful first. */
export function todayCards(i: TodayInputs, max = 5): TodayCard[] {
  const out: TodayCard[] = [];

  // 1. Idle stablecoins: money in wallets earning nothing, against the best stablecoin supply rate.
  const idle = i.holdings.filter((h) => isStable(h.symbol) && (h.usd ?? 0) > 0);
  const idleUsd = idle.reduce((n, h) => n + (h.usd ?? 0), 0);
  // Target USDC or USDT markets: the ones a swap can reliably deliver into (other stablecoins may not route).
  const bestStable = [...i.rates].filter((r) => /^USD[CT]/i.test(r.symbol) && r.supplyApy !== null && r.supplyApy > 0).sort((a, b) => b.supplyApy! - a.supplyApy!)[0];
  if (idleUsd >= 5 && bestStable) {
    const chains = new Set(idle.map((h) => h.network)).size, yearly = idleUsd * bestStable.supplyApy! / 100;
    out.push({ id: "idle-stables", tone: "earn", title: `Put ${usd(idleUsd)} of idle stablecoins to work`,
      body: `You hold ${usd(idleUsd)} in stablecoins across ${chains} chain${chains === 1 ? "" : "s"}, earning nothing. Rhea pays ${bestStable.supplyApy!.toFixed(2)}% on ${bestStable.symbol} today: about ${usd(yearly)} a year, variable.`,
      figure: bestStable.supplyApy!.toFixed(2) + "% APY", cta: `Swap and supply ${bestStable.symbol}`, action: { kind: "supply", tokenId: bestStable.tokenId } });
  }

  // 2. Big moves in what you hold (±5% in 24h, positions worth at least $5).
  const moves = i.holdings.filter((h) => !isStable(h.symbol) && (h.usd ?? 0) >= 5 && Math.abs(i.held24h[h.tokenId] ?? 0) >= 5)
    .sort((a, b) => Math.abs(i.held24h[b.tokenId]) * (b.usd ?? 0) - Math.abs(i.held24h[a.tokenId]) * (a.usd ?? 0));
  for (const h of moves.slice(0, 2)) {
    const ch = i.held24h[h.tokenId], up = ch > 0;
    out.push({ id: "move:" + h.tokenId, tone: up ? "move-up" : "move-down", title: `${h.symbol} is ${up ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% today`,
      body: up ? `You hold ${usd(h.usd ?? 0)} of ${h.symbol} on ${NET[h.network] ?? h.network}. If you want to lock some of that in, review a swap of a quarter into USDC.` : `You hold ${usd(h.usd ?? 0)} of ${h.symbol} on ${NET[h.network] ?? h.network}. Check whether it still fits your plan before adding or trimming.`,
      figure: pct(ch), cta: up ? "Review taking a quarter into USDC" : `Review ${h.symbol}`, action: up ? { kind: "swap", from: h.tokenId, to: USDC_NEAR, amount: trim(h.amount / 4) } : { kind: "swap", from: USDC_NEAR, to: h.tokenId } });
  }

  // 3. NEAR that could be staked.
  const near = i.holdings.find((h) => h.tokenId === "near:native");
  if (near && near.amount >= 1 && i.stakeApy) {
    const yearly = (near.amount - 0.5) * i.stakeApy / 100;
    out.push({ id: "stake-near", tone: "stake", title: `Your ${trim(near.amount)} NEAR could earn ${i.stakeApy.toFixed(2)}%`,
      body: `Staked as LiNEAR it earns about ${trim(yearly)} NEAR a year and stays liquid: swap it back when liquidity allows, or unstake in about 2–3 days. FlowVault keeps 0.5 NEAR for fees.`,
      figure: i.stakeApy.toFixed(2) + "% APY", cta: "Stake NEAR", action: { kind: "stake" } });
  }

  // 4. What's trending (DexScreener boosts), top movers with a price.
  const trend = i.trending.filter((t) => t.changeH24 !== null && t.priceUsd !== null).slice(0, 4);
  if (trend.length) out.push({ id: "trending", tone: "trend", title: "Trending today",
    body: trend.map((t) => `${t.symbol} on ${t.chain} ${pct(t.changeH24!)}`).join(" · ") + ". Trending isn't a recommendation: check liquidity and age before buying.",
    cta: "See trending tokens", action: { kind: "markets" } });

  return out.slice(0, max);
}
const trim = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(3)).replace(/\.?0+$/, "");
