"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, ShieldCheck, ShieldAlert, Shield, Star, Globe, Share2 } from "lucide-react";
import { TokenIcon } from "./AssetIdentity";
import { CandleChart } from "./MarketPanel";
import { chainNetwork, marketId, type ScreenRow } from "./MarketScreener";
import { api } from "./live";
import { TradePanel } from "./TradePanel";
import { fmtUsd, fmtPct, ago } from "./swap-format";
import type { Candle } from "@/lib/flowvault/market-display";

interface Detail { row: ScreenRow; candles: Candle[]; signals: { label: string; tone: "good" | "warn" | "bad"; detail: string }[]; swapId: string | null; pairs: number; source: string; capturedAt: string }
interface PolicyView { policy?: { protectedAssets: string[]; venues: string[]; assetRows?: { asset: string; uses: string[] }[]; perActionCap: string; dailyCap: string; version: number } }
const priceFmt = (n: number) => n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toPrecision(4);

export function TokenPage({ token, back, buy, watched, toggleWatch, share }: { token: { chain: string; address: string; symbol?: string }; back: () => void; buy: (swapId: string) => void; watched: boolean; toggleWatch: () => void; share?: (card: { title: string; subtitle: string; lines: string[] }) => void }) {
  const [tf, setTf] = useState("1h");
  const [detail, setDetail] = useState<Detail | null>(null), [error, setError] = useState("");
  const [policy, setPolicy] = useState<PolicyView["policy"] | null>(null);
  // Live: price, stats and candles re-read every 15 seconds while the page is visible (and on return to the tab).
  useEffect(() => {
    let abort = new AbortController();
    const read = () => {
      if (document.visibilityState === "hidden") return;
      abort.abort(); abort = new AbortController();
      fetch(`/api/discover/token?chain=${encodeURIComponent(token.chain)}&address=${encodeURIComponent(token.address)}&tf=${tf}`, { signal: abort.signal, cache: "no-store" })
        .then(async r => { const b = await r.json() as Detail & { error?: string }; if (!r.ok) throw new Error(b.error); setDetail(b); setError(""); })
        .catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    };
    read();
    const timer = setInterval(read, 15_000);
    document.addEventListener("visibilitychange", read);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [token.chain, token.address, tf]);
  useEffect(() => { api("/api/policy", undefined, "GET").then((b: PolicyView) => setPolicy(b.policy ?? null)).catch(() => setPolicy(null)); }, []);

  const r = detail?.row;
  const symbol = r?.symbol ?? token.symbol ?? "Token";
  const protectedAsset = !!policy?.protectedAssets.some(a => a.toLowerCase() === symbol.toLowerCase());
  const row = policy?.assetRows?.find(a => a.asset.toLowerCase() === symbol.toLowerCase());
  const canSwap = policy ? (!policy.assetRows || !!row?.uses.includes("sell")) : null;
  const refAllowed = policy ? policy.venues.includes("v2.ref-finance.near") : null;
  const t24 = r?.txns.h24;
  const stats: [string, string][] = r ? [
    ["Market cap", fmtUsd(r.marketCap ?? r.fdv)], ["FDV", fmtUsd(r.fdv)], ["Liquidity", fmtUsd(r.liquidityUsd)], ["24h volume", fmtUsd(r.volume.h24 ?? 0)],
    ["24h trades", t24 ? (t24.buys + t24.sells).toLocaleString() : "—"], ["Pool age", r.createdAt ? ago(r.createdAt).replace(" ago", "") : "—"],
  ] : [];
  return <div className="fv-token-page">
    <div className="fv-token-top">
      <button type="button" className="fv-text-button" onClick={back}><ArrowLeft size={15} /> Markets</button>
      <div className="fv-actions">
        <button type="button" className="fv-button" aria-pressed={watched} onClick={toggleWatch}><Star size={15} fill={watched ? "currentColor" : "none"} /> {watched ? "Watching" : "Watch"}</button>
        {share && r && <button type="button" className="fv-button" onClick={() => share({ title: `${r.symbol} · ${fmtUsd(r.priceUsd)}`, subtitle: `${fmtPct(r.change.h24 ?? null)} in 24h · liquidity ${fmtUsd(r.liquidityUsd)}`, lines: detail!.signals.slice(0, 5).map(s => (s.tone === "good" ? "✓ " : "! ") + s.label) })}><Share2 size={15} /> Share</button>}
      </div>
    </div>
    {error && !detail && <section className="fv-panel fv-empty"><h3>Token data unavailable</h3><p>{error}</p></section>}
    <section className="fv-panel fv-token-hero">
      <div className="fv-token-id"><TokenIcon symbol={symbol} image={r?.icon ?? undefined} network={chainNetwork(token.chain)} size={52} />
        <div><h1>{symbol}<small>{r?.name}</small></h1><p className="fv-address">{token.address}</p></div></div>
      <div className="fv-token-price"><strong>{r?.priceUsd ? fmtUsd(r.priceUsd) : detail ? "—" : "…"}</strong>
        <div className="fv-token-changes">{(["m5", "h1", "h6", "h24"] as const).map(f => <span key={f} className={(r?.change[f] ?? 0) >= 0 ? "fv-up" : "fv-down"}><small>{f === "m5" ? "5m" : f === "h1" ? "1h" : f === "h6" ? "6h" : "24h"}</small>{fmtPct(r?.change[f] ?? null)}</span>)}</div></div>
    </section>
    <div className="fv-token-stats">{stats.length ? stats.map(([k, v]) => <div key={k}><small>{k}</small><strong>{v}</strong></div>) : Array.from({ length: 6 }, (_, i) => <div key={i} className="fv-stat-skeleton"><small>&nbsp;</small><strong>&nbsp;</strong></div>)}</div>
    <div className="fv-token-layout">
      <section className="fv-panel fv-token-chart">
        <div className="fv-chart-toolbar"><span>Price · USD</span>{["15m", "1h", "4h", "1d"].map(x => <button type="button" key={x} aria-pressed={tf === x} onClick={() => setTf(x)}>{x}</button>)}</div>
        {detail?.candles.length ? <CandleChart key={tf + marketId(token)} candles={detail.candles} coin={symbol} fmt={priceFmt} /> : <div className="fv-chart-loading">{detail ? "No candle history for this pool yet." : "Reading price history…"}</div>}
        {t24 && <div className="fv-flow"><span>24h flow</span><i className="fv-buysell fv-buysell-wide"><em style={{ width: (t24.buys / Math.max(1, t24.buys + t24.sells) * 100) + "%" }} /></i><small>{t24.buys.toLocaleString()} buys · {t24.sells.toLocaleString()} sells</small></div>}
      </section>
      <aside className="fv-token-side">
        <section className="fv-panel fv-token-buy">
          <h2>Trade {symbol}</h2>
          {detail?.swapId ? <><p>Best route across Rhea / Ref and NEAR Intents, checked against your limits.</p><div className="fv-actions"><button type="button" className="fv-button fv-primary" onClick={() => buy(detail.swapId!)}>Buy {symbol}</button><button type="button" className="fv-button" onClick={() => buy("sell:" + detail.swapId!)}>Sell</button></div></>
            : detail ? <TradePanel chain={token.chain} address={token.address} symbol={symbol} /> : <p className="fv-muted">Checking availability…</p>}
          {r?.url && <a className="fv-text-button" href={r.url} target="_blank" rel="noopener noreferrer">Pair on DexScreener <ArrowUpRight size={13} /></a>}
          {r?.website && <a className="fv-text-button" href={r.website} target="_blank" rel="noopener noreferrer"><Globe size={13} /> Website</a>}
        </section>
        <section className="fv-panel fv-trust">
          <h2><Shield size={16} /> Before you trade</h2>
          {(detail?.signals ?? []).map(s => <div key={s.label} className={"fv-signal is-" + s.tone}><span className="fv-signal-dot" /><div><strong>{s.label}</strong><small>{s.detail}</small></div></div>)}
          <h3>Your plan</h3>
          {!policy ? <p className="fv-muted">Connect your wallet to check this token against your limits.</p> : <>
            <div className={"fv-signal is-" + (protectedAsset ? "bad" : "good")}><span className="fv-signal-dot" /><div><strong>{protectedAsset ? "Protected in your policy" : "Not a protected asset"}</strong><small>{protectedAsset ? "Your policy keeps this asset from being spent or swapped." : "Your policy doesn’t lock this asset."}</small></div></div>
            <div className={"fv-signal is-" + (canSwap ? "good" : "warn")}><span className="fv-signal-dot" /><div><strong>{canSwap ? "Swaps allowed" : "Needs a swap permission"}</strong><small>{canSwap ? "Your asset rules allow selling it in a swap." : "The swap review offers “Allow and continue” to add it."}</small></div></div>
            <div className={"fv-signal is-" + (refAllowed ? "good" : "warn")}><span className="fv-signal-dot" /><div><strong>{refAllowed ? "Rhea / Ref approved" : "Rhea / Ref not yet approved"}</strong><small>Per-action cap {fmtUsd(policy.perActionCap)} · daily cap {fmtUsd(policy.dailyCap)} · policy v{policy.version}</small></div></div>
          </>}
          {detail && (detail.signals.some(s => s.tone === "bad") ? <p className="fv-trust-verdict is-bad"><ShieldAlert size={15} /> High-risk signals. Size small or skip.</p> : <p className="fv-trust-verdict"><ShieldCheck size={15} /> No high-risk signals in public data.</p>)}
        </section>
      </aside>
    </div>
    {detail && <p className="fv-muted fv-token-source">{detail.source} · {detail.pairs} pair{detail.pairs === 1 ? "" : "s"} found · read {ago(detail.capturedAt)}.</p>}
  </div>;
}
