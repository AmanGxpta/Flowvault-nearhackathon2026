"use client";
// Spot trading view for any DexScreener token on the Trade screen: the token's own pool stats (price, market cap,
// FDV, liquidity, volume, transactions, age, safety checks) and 5m/1h/6h/24h moves, its pool candles, and the
// in-app trade (LI.FI from your wallets, or the NEAR swap for NEAR tokens). Prices come from the token's own pool
// on its own chain, never from a different exchange's listing of a similar ticker.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Globe, ShieldAlert, ShieldCheck } from "lucide-react";
import { ProChart } from "./ProChart";
import { TradePanel } from "./TradePanel";
import { useTokenDetail } from "./TokenPage";
import { networkInfo } from "./AssetIdentity";
import { chainNetwork } from "./MarketScreener";
import { fmtPct, ago } from "./swap-format";

const compact = (n: number | null | undefined) => n === null || n === undefined ? "—" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
const px = (v: string | number | null | undefined) => { const n = Number(v); return !v || !Number.isFinite(n) ? "—" : "$" + (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toPrecision(4)); };
const priceFmt = (n: number) => n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : n.toPrecision(4);

export function SpotDesk({ token, buy, picker }: { token: { chain: string; address: string; symbol: string }; buy: (swapId: string) => void; picker: React.ReactNode }) {
  const [tf, setTf] = useState("15m");
  const { detail, error } = useTokenDetail(token, tf);
  const r = detail?.row;
  // The price ticks green or red when a refresh moves it.
  const prev = useRef<{ key: string; price: number } | null>(null);
  const [tick, setTick] = useState<{ dir: "buy" | "sell"; at: number } | null>(null);
  useEffect(() => {
    const p = Number(r?.priceUsd), key = token.chain + token.address;
    if (!(p > 0)) return;
    const old = prev.current;
    prev.current = { key, price: p };
    if (!old || old.key !== key || old.price === p) return;
    const t = setTimeout(() => setTick({ dir: p > old.price ? "buy" : "sell", at: Date.now() }), 0);
    return () => clearTimeout(t);
  }, [r?.priceUsd, token.chain, token.address]);

  const signals = detail?.signals ?? [], safety = detail?.safety ?? null;
  const worst = signals.some(s => s.tone === "bad") ? "bad" : signals.some(s => s.tone === "warn") ? "warn" : "good";
  const t24 = r?.txns.h24;
  const stats: [string, React.ReactNode][] = [
    ["Mcap", compact(r?.marketCap ?? r?.fdv)], ["FDV", compact(r?.fdv)], ["Liquidity", compact(r?.liquidityUsd)], ["Vol 24h", compact(r?.volume.h24)],
    ["Txns 24h", t24 ? (t24.buys + t24.sells).toLocaleString() : "—"], ["Age", r?.createdAt ? ago(r.createdAt).replace(" ago", "") : "—"],
    ["Safety", safety ? <span className={"fv-safety is-" + (safety.score >= 70 ? "good" : safety.score >= 40 ? "warn" : "bad")} title={`${safety.score}/100 from ${signals.length} public checks${safety.redFlags ? ` · ${safety.redFlags} red flag${safety.redFlags > 1 ? "s" : ""} cap the score at 39` : ""}${safety.unknown.length ? ` · not known: ${safety.unknown.join(", ")}` : ""}. Size alone never raises it.`}>{safety.score}/100<i><em style={{ width: safety.score + "%" }} /></i></span> : "—"],
  ];
  return <div className="fv-spot-desk">
    <section className="fv-panel fv-spot-bar">
      {picker}
      <div className="fv-spot-price"><small>Price</small><strong key={tick?.at ?? 0} className={tick ? "fv-tick is-" + tick.dir : undefined}>{px(r?.priceUsd)}</strong></div>
      <div className="fv-spot-stats">{stats.map(([k, v]) => <div key={k}><small>{k}</small><strong>{detail ? v : "…"}</strong></div>)}</div>
    </section>
    {error && !detail && <p className="fv-notice" role="status">{error}</p>}
    <div className="fv-trade-layout">
      <section className="fv-panel fv-token-chart fv-spot-chart">
        <div className="fv-chart-toolbar"><span>{token.symbol}/{r?.quoteSymbol ?? "USD"} · {networkInfo(chainNetwork(token.chain))?.name ?? token.chain} · {r?.dexId ?? "pool"}</span>{["15m", "1h", "4h", "1d"].map(x => <button type="button" key={x} aria-pressed={tf === x} onClick={() => setTf(x)}>{x}</button>)}</div>
        {detail?.candles.length ? <ProChart seriesKey={tf + token.address} candles={detail.candles} fmt={priceFmt} height={380} /> : <div className="fv-chart-loading">{detail ? "No candle history for this pool yet." : "Reading price history…"}</div>}
        {t24 && <div className="fv-flow"><span>24h flow</span><i className="fv-buysell fv-buysell-wide"><em style={{ width: (t24.buys / Math.max(1, t24.buys + t24.sells)) * 100 + "%" }} /></i><small>{t24.buys.toLocaleString()} buys · {t24.sells.toLocaleString()} sells</small></div>}
        <p className="fv-muted fv-spot-source">{detail ? `Pool price on ${r?.dexId ?? "the DEX"} · refreshes every 15s · read ${ago(detail.capturedAt)}` : "Reading the pool…"}{r?.url && <> · <a className="fv-text-button" href={r.url} target="_blank" rel="noopener noreferrer">DexScreener <ArrowUpRight size={12} /></a></>}{r?.website && <> · <a className="fv-text-button" href={r.website} target="_blank" rel="noopener noreferrer"><Globe size={12} /> Website</a></>}</p>
      </section>
      <aside className="fv-spot-side">
        <section className="fv-panel fv-spot-changes">{(["m5", "h1", "h6", "h24"] as const).map(f => <div key={f}><small>{f === "m5" ? "5M" : f === "h1" ? "1H" : f === "h6" ? "6H" : "24H"}</small><strong className={(r?.change[f] ?? 0) >= 0 ? "fv-up" : "fv-down"}>{fmtPct(r?.change[f] ?? null)}</strong></div>)}</section>
        <section className="fv-panel fv-token-buy">
          {detail?.swapId ? <><h2>Trade {token.symbol}</h2><p>Best route across Rhea / Ref and NEAR Intents, checked against your limits.</p><div className="fv-actions"><button type="button" className="fv-button fv-primary" onClick={() => buy(detail.swapId!)}>Buy {token.symbol}</button><button type="button" className="fv-button" onClick={() => buy("sell:" + detail.swapId!)}>Sell</button></div></>
            : detail ? <TradePanel key={token.chain + token.address} chain={token.chain} address={token.address} symbol={token.symbol} /> : <p className="fv-muted">Checking availability…</p>}
        </section>
        <section className="fv-panel fv-trust fv-spot-trust">
          <h2>{worst === "bad" ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />} Safety checks{safety && <small className="fv-safety-head">{safety.score}/100</small>}</h2>
          {safety?.unknown.length ? <p className="fv-muted fv-chat-small">Couldn’t check: {safety.unknown.join(", ")}. Unknown checks don’t count as passing.</p> : null}
          {signals.map(s => <div key={s.label} className={"fv-signal is-" + s.tone}><span className="fv-signal-dot" /><div><strong>{s.label}</strong><small>{s.detail}</small></div></div>)}
          {!signals.length && <p className="fv-muted">{detail ? "No public checks available." : "Reading…"}</p>}
        </section>
      </aside>
    </div>
  </div>;
}
