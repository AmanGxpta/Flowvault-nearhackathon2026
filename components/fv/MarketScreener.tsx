"use client";
import { useEffect, useMemo, useState } from "react";
import { Search, Star, RefreshCw, Flame, Sparkles, Trophy, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { TokenIcon, NetworkLabel } from "./AssetIdentity";
import { fmtUsd, fmtPct, ago } from "./swap-format";
import type { MarketRow, Frame } from "@/lib/flowvault/market-scan";

export type ScreenRow = MarketRow & { swapId: string | null };
type Feed = "top" | "trending" | "new" | "watch";
type SortKey = "volume" | "change" | "liquidity" | "txns" | "age" | "mcap";
const FEEDS: { id: Feed; label: string; Icon: typeof Flame }[] = [{ id: "top", label: "NEAR markets", Icon: Trophy }, { id: "trending", label: "Trending", Icon: Flame }, { id: "new", label: "New", Icon: Sparkles }];
const CHAIN_OPTS = [["all", "All chains"], ["near", "NEAR"], ["solana", "Solana"], ["base", "Base"], ["ethereum", "Ethereum"], ["bsc", "BNB Chain"], ["arbitrum", "Arbitrum"], ["robinhood", "Robinhood"], ["hyperevm", "HyperEVM"], ["elysium", "Elysium"], ["monad", "Monad"]] as const;
const NET: Record<string, string> = { near: "near", ethereum: "eth", base: "base", arbitrum: "arb", solana: "solana", bsc: "bnb", polygon: "pol", avalanche: "avax", optimism: "op", hyperevm: "hyperliquid", elysium: "hyperliquid", monad: "monad", berachain: "bera", scroll: "scroll", xlayer: "xlayer", plasma: "plasma", abstract: "abstract", gnosischain: "gnosis" };
export const marketId = (r: { chain: string; address: string }) => r.chain + ":" + r.address;

function useFeed(feed: Feed, chain: string, ids: string[], tick: number) {
  const [data, setData] = useState<{ key: string; rows: ScreenRow[]; at: string } | null>(null), [error, setError] = useState("");
  const key = feed + "|" + chain + "|" + (feed === "watch" ? ids.join(",") : "") + "|" + tick;
  useEffect(() => {
    const abort = new AbortController();
    const url = "/api/discover?feed=" + feed + "&chain=" + (feed === "top" ? "near" : chain) + (feed === "watch" ? "&ids=" + encodeURIComponent(ids.join(",")) : "");
    fetch(url, { signal: abort.signal, cache: "no-store" }).then(async r => {
      const b = await r.json() as { rows?: ScreenRow[]; capturedAt?: string; error?: string };
      if (!r.ok || !b.rows) throw new Error(b.error ?? "Market data unavailable");
      setData({ key, rows: b.rows, at: b.capturedAt ?? new Date().toISOString() }); setError("");
    }).catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    return () => abort.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- key encodes every input
  return { rows: data?.key === key ? data.rows : null, stale: data && data.key !== key ? data.rows : null, at: data?.at ?? null, error };
}

export function MarketScreener({ watch, toggleWatch, open, buy, watchOnly = false }: { watch: string[]; toggleWatch: (id: string) => void; open: (r: ScreenRow) => void; buy: (swapId: string) => void; watchOnly?: boolean }) {
  const [feed, setFeed] = useState<Feed>(watchOnly ? "watch" : "top"), [chain, setChain] = useState("all"), [frame, setFrame] = useState<Frame>("h24");
  const [query, setQuery] = useState(""), [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null), [tick, setTick] = useState(0);
  const active: Feed = watchOnly ? "watch" : feed;
  const { rows, stale, at, error } = useFeed(active, chain, watch, tick);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 45_000); return () => clearInterval(t); }, []);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = (rows ?? stale ?? []).filter(r => !q || (r.symbol + " " + r.name + " " + r.address).toLowerCase().includes(q));
    if (!sort) return base;
    const v = (r: ScreenRow) => sort.key === "volume" ? r.volume[frame] ?? 0 : sort.key === "change" ? r.change[frame] ?? -1e9 : sort.key === "liquidity" ? r.liquidityUsd ?? 0 : sort.key === "txns" ? (r.txns[frame]?.buys ?? 0) + (r.txns[frame]?.sells ?? 0) : sort.key === "mcap" ? r.marketCap ?? r.fdv ?? 0 : -(r.createdAt ?? 0);
    return [...base].sort((a, b) => (sort.desc ? v(b) - v(a) : v(a) - v(b)));
  }, [rows, stale, query, sort, frame]);
  const head = (key: SortKey, label: string) => <button type="button" className={"fv-th" + (sort?.key === key ? " is-sorted" : "")} onClick={() => setSort(s => s?.key === key ? { key, desc: !s.desc } : { key, desc: true })}>{label}{sort?.key === key ? (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />) : null}</button>;
  const loading = !rows && !error;

  return <section className="fv-panel fv-screener">
    <div className="fv-screener-bar">
      {!watchOnly && <div className="fv-segment" role="tablist">{FEEDS.map(f => <button type="button" role="tab" key={f.id} aria-selected={feed === f.id} onClick={() => setFeed(f.id)}><f.Icon size={14} />{f.label}</button>)}</div>}
      <div className="fv-screener-tools">
        <label className="fv-search-input fv-screener-search"><Search size={15} /><input aria-label="Filter markets" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by name or contract" /></label>
        <div className="fv-segment fv-segment-small" role="group" aria-label="Timeframe">{(["m5", "h1", "h6", "h24"] as Frame[]).map(f => <button type="button" key={f} aria-pressed={frame === f} onClick={() => setFrame(f)}>{f === "m5" ? "5m" : f === "h1" ? "1h" : f === "h6" ? "6h" : "24h"}</button>)}</div>
        {active !== "top" && active !== "watch" && <select aria-label="Chain" value={chain} onChange={e => setChain(e.target.value)}>{CHAIN_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
        <button type="button" className="fv-icon-button" aria-label="Refresh markets" onClick={() => setTick(x => x + 1)}><RefreshCw size={15} className={loading ? "fv-spin" : ""} /></button>
      </div>
    </div>
    <div className="fv-screener-table" role="table" aria-label="Markets">
      <div className="fv-screener-row fv-screener-head" role="row"><span>Token</span><span>Price</span>{head("change", "Change")}{head("liquidity", "Liquidity")}{head("volume", "Volume")}{head("txns", "Trades")}{head("mcap", "Mkt cap")}<span /></div>
      {loading && Array.from({ length: 8 }, (_, i) => <div key={i} className="fv-screener-row fv-screener-skeleton"><span /><span /><span /><span /><span /><span /><span /><span /></div>)}
      {list.slice(0, 80).map(r => {
        const id = marketId(r), t = r.txns[frame], ch = r.change[frame];
        return <div key={id} className="fv-screener-row" role="row" tabIndex={0} onClick={() => open(r)} onKeyDown={e => { if (e.key === "Enter") open(r); }}>
          <span className="fv-screener-token">
            <button type="button" className="fv-star" aria-label={(watch.includes(id) ? "Remove " : "Add ") + r.symbol + " to watchlist"} aria-pressed={watch.includes(id)} onClick={e => { e.stopPropagation(); toggleWatch(id); }}><Star size={15} fill={watch.includes(id) ? "currentColor" : "none"} /></button>
            <TokenIcon symbol={r.symbol} image={r.icon ?? undefined} network={NET[r.chain]} size={34} />
            <span><strong>{r.symbol}</strong><small>{r.name !== r.symbol ? r.name : ""}{r.createdAt ? " · " + ago(r.createdAt).replace(" ago", "") : ""}</small></span>
          </span>
          <span className="fv-num"><strong>{r.priceUsd ? fmtUsd(r.priceUsd) : "—"}</strong></span>
          <span className={"fv-num " + (ch === undefined ? "" : ch >= 0 ? "fv-up" : "fv-down")}>{fmtPct(ch ?? null)}</span>
          <span className="fv-num">{r.liquidityUsd !== null ? fmtUsd(r.liquidityUsd) : "—"}</span>
          <span className="fv-num">{fmtUsd(r.volume[frame] ?? 0)}</span>
          <span className="fv-num fv-trades">{t ? <><b>{(t.buys + t.sells).toLocaleString()}</b><i className="fv-buysell"><em style={{ width: (t.buys / Math.max(1, t.buys + t.sells) * 100) + "%" }} /></i></> : "—"}</span>
          <span className="fv-num">{r.marketCap ?? r.fdv ? fmtUsd(r.marketCap ?? r.fdv) : "—"}</span>
          <span className="fv-screener-action">{r.swapId ? <button type="button" className="fv-buy" onClick={e => { e.stopPropagation(); buy(r.swapId!); }}>Buy</button> : <span className="fv-muted" title="Not in FlowVault's swap catalog">View <ArrowUpRight size={12} /></span>}</span>
        </div>;
      })}
      {!loading && !list.length && <div className="fv-empty"><h3>{active === "watch" ? "Your watchlist is empty" : error ? "Markets are unavailable" : "No matching market"}</h3><p>{active === "watch" ? "Star tokens in Discover to follow their price, liquidity and flow here." : error || "Try another filter."}</p></div>}
    </div>
    <div className="fv-panel-foot">DexScreener public pairs · best-liquidity pair per token{at ? " · read " + ago(at) : ""}. Listings are not endorsements; open a token for its risk signals.</div>
  </section>;
}
export function chainNetwork(chain: string) { return NET[chain] ?? chain; }
export { NetworkLabel };
