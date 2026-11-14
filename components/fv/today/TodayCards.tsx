"use client";
// "What you can do today": 3–5 suggestions on the dashboard, built from your holdings and today's market (Rhea rates,
// staking APY, 24h moves of what you hold, DexScreener trending). Each opens an existing flow with the details filled
// in; nothing executes from here. Works the same in Demo Mode with the example wallets.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Flame, Landmark, Sprout, TrendingDown, TrendingUp } from "lucide-react";
import { useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { todayCards, type TodayAction, type TodayCard, type TodayMover, type TodayRate } from "@/lib/flowvault/today";
import { CHAINS } from "@/lib/flowvault/market-scan";
import { EXAMPLE_NEAR_ACCOUNT } from "@/lib/flowvault/example-wallets";
import { cacheGet, cacheSet } from "../hub/motion";

/** Native coins as DexScreener lists them (their wrapped token), for 24h moves. */
const WRAPPED: Record<string, string> = {
  "eth:native": "ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "base:native": "base:0x4200000000000000000000000000000000000006",
  "arb:native": "arbitrum:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "op:native": "optimism:0x4200000000000000000000000000000000000006",
  "near:native": "near:wrap.near", "sol:native": "solana:So11111111111111111111111111111111111111112", "bsc:native": "bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "pol:native": "polygon:0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "avax:native": "avalanche:0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
};
const DEX_CHAIN = Object.fromEntries(Object.entries(CHAINS).map(([dex, c]) => [c.network, dex]));
const ICON = { earn: Sprout, "move-up": TrendingUp, "move-down": TrendingDown, stake: Landmark, trend: Flame } as const;

export function TodayCards({ owner: liveOwner, example, navigate }: { owner: string; example: boolean; navigate: (screen: string) => void }) {
  const owner = example ? EXAMPLE_NEAR_ACCOUNT : liveOwner;
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, !!owner, example);
  const [rates, setRates] = useState<TodayRate[]>([]), [stakeApy, setStakeApy] = useState<number | null>(null), [trending, setTrending] = useState<TodayMover[]>([]), [moves, setMoves] = useState<Record<string, number>>({});
  // Which reads have answered (success or failure). Cards are computed once they all have, so the set never
  // flickers as each source lands; a revisit shows the last set at once and swaps in the fresh one.
  const [done, setDone] = useState({ rates: false, staking: false, trending: false, moves: false, timeout: false });
  const mark = useCallback((k: keyof typeof done) => setDone((d) => (d[k] ? d : { ...d, [k]: true })), []);
  const cacheKey = "today:" + (example ? "example" : owner);
  const [cached] = useState(() => cacheGet<TodayCard[]>(cacheKey));
  useEffect(() => { const t = setTimeout(() => mark("timeout"), 5000); return () => clearTimeout(t); }, [mark]);
  useEffect(() => {
    let live = true;
    fetch("/api/rates", { cache: "no-store" }).then((r) => r.json() as Promise<never>).then((b: { rows?: { token: string; symbol: string; supplyApy: number | null; canSupply?: boolean }[] }) => { if (live) setRates((b.rows ?? []).filter((r) => r.canSupply !== false).map((r) => ({ tokenId: r.token, symbol: r.symbol, supplyApy: r.supplyApy }))); }).catch(() => {}).finally(() => { if (live) mark("rates"); });
    fetch("/api/discover?feed=trending&chain=all", { cache: "no-store" }).then((r) => r.json() as Promise<never>).then((b: { rows?: { symbol: string; chain: string; change: { h24?: number }; priceUsd: string | null; swapId: string | null; icon: string | null; liquidityUsd: number | null; volume: { h24?: number } }[] }) => { if (live) setTrending((b.rows ?? []).filter((r) => (r.liquidityUsd ?? 0) >= 500_000 && (r.volume?.h24 ?? 0) >= 250_000 && Math.abs(r.change?.h24 ?? 0) < 300).slice(0, 8).map((r) => ({ tokenId: r.swapId, symbol: r.symbol, chain: CHAINS[r.chain]?.label ?? r.chain, changeH24: r.change?.h24 ?? null, priceUsd: r.priceUsd ? Number(r.priceUsd) : null, icon: r.icon }))); }).catch(() => {}).finally(() => { if (live) mark("trending"); });
    fetch("/api/staking/rates", { cache: "no-store" }).then((r) => r.json() as Promise<never>).then((b: { options?: { id: string; aprPercent?: string | null }[] }) => { const a = b.options?.find((o) => o.id === "linear")?.aprPercent; if (live && a) setStakeApy(Number(a)); }).catch(() => {}).finally(() => { if (live) mark("staking"); });
    return () => { live = false; };
  }, [example, mark]);
  const held = useMemo(() => Object.entries(holdings.balances).flatMap(([id, b]) => { const t = tokens.find((x) => x.id === id); return t ? [{ tokenId: id, symbol: t.symbol, network: t.network, amount: Number(b.amount), usd: b.usd !== null ? Number(b.usd) : null }] : []; }), [holdings.balances, tokens]);
  // 24h moves of what you hold (DexScreener), keyed by catalog id.
  const watchKey = held.filter((h) => (h.usd ?? 0) >= 5).map((h) => h.tokenId).sort().join(",");
  useEffect(() => {
    const ids = watchKey.split(",").filter(Boolean).flatMap((id) => { if (WRAPPED[id]) return [[id, WRAPPED[id]]]; const [n, c] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)]; return DEX_CHAIN[n] && c !== "native" ? [[id, DEX_CHAIN[n] + ":" + c]] : []; }).slice(0, 60);
    if (!ids.length) { if (holdings.loaded) { const t = setTimeout(() => mark("moves"), 0); return () => clearTimeout(t); } return; }
    let live = true;
    fetch("/api/discover?feed=watch&ids=" + encodeURIComponent(ids.map(([, d]) => d).join(",")), { cache: "no-store" }).then((r) => r.json() as Promise<never>).then((b: { rows?: { chain: string; address: string; change: { h24?: number } }[] }) => {
      if (!live) return;
      const m: Record<string, number> = {};
      for (const [id, d] of ids) { const r = (b.rows ?? []).find((x) => (x.chain + ":" + x.address).toLowerCase() === d.toLowerCase()); if (typeof r?.change?.h24 === "number") m[id] = r.change.h24; }
      setMoves(m);
    }).catch(() => {}).finally(() => { if (live) mark("moves"); });
    return () => { live = false; };
  }, [watchKey, holdings.loaded, mark]);

  const ready = done.timeout || (holdings.loaded && done.rates && done.staking && done.trending && done.moves);
  const fresh = ready ? todayCards({ holdings: held, rates, stakeApy, held24h: moves, trending }) : null;
  useEffect(() => { if (fresh) cacheSet(cacheKey, fresh); }, [JSON.stringify(fresh)]); // eslint-disable-line react-hooks/exhaustive-deps -- cache the computed set
  const cards = fresh ?? cached;
  if (!owner || (cards && !cards.length)) return null;
  const go = (a: TodayAction) => {
    const url = new URL(window.location.href);
    for (const k of ["supply", "swap", "tab", "sflow", "flow", "buy"]) url.searchParams.delete(k);
    if (a.kind === "supply") { url.searchParams.set("tab", "supply"); url.searchParams.set("supply", a.tokenId); history.replaceState(null, "", url); navigate("earn"); }
    else if (a.kind === "swap") { url.searchParams.set("swap", [a.from, a.to, a.amount ?? ""].join("|")); history.replaceState(null, "", url); navigate("swap"); window.dispatchEvent(new Event("fv-prefill")); }
    else if (a.kind === "stake") { url.searchParams.set("tab", "stake"); history.replaceState(null, "", url); navigate("earn"); }
    else navigate("markets");
  };
  return <section className="fv-today" aria-label="What you can do today">
    <div className="fv-today-head"><h2>What you can do today</h2><small>{!fresh ? <span className="fv-updating"><span className="fv-live-dot" /> {cards ? "Refreshing" : "Reading your wallets and today's market"}</span> : <>From your wallets and today&apos;s market{example ? " · example balances" : ""} · rates are variable, nothing runs without your review</>}</small></div>
    {!cards ? <div className="fv-today-grid">{[0, 1, 2].map((i) => <div key={i} className="fv-today-card fv-skel-card" style={{ ["--i" as string]: i }}><div className="fv-skel" style={{ width: 28, height: 28 }} /><div className="fv-skel fv-skel-line" style={{ width: "80%", height: 14 }} /><div className="fv-skel fv-skel-line" style={{ width: "95%" }} /><div className="fv-skel fv-skel-line" style={{ width: "70%" }} /><div className="fv-skel fv-skel-line" style={{ width: "45%", marginTop: 14 }} /></div>)}</div>
    : <div className="fv-today-grid" key={fresh ? "fresh" : "cached"}>{cards.map((c: TodayCard, i) => { const Icon = ICON[c.tone]; return <article key={c.id} className={"fv-today-card fv-rise is-" + c.tone} style={{ ["--i" as string]: i }}>
      <div className="fv-today-top"><span className="fv-today-icon"><Icon size={16} /></span>{c.figure && <strong className="fv-today-figure">{c.figure}</strong>}</div>
      <h3>{c.title}</h3><p>{c.body}</p>
      <button type="button" className="fv-text-button fv-today-cta" onClick={() => go(c.action)}>{c.cta} <ArrowRight size={13} /></button>
    </article>; })}</div>}
  </section>;
}
