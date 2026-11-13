"use client";
import { useEffect, useState } from "react";
import { TokenIcon, NetworkLabel } from "./AssetIdentity";
import { useLiveMarket } from "./useLiveMarket";
import { RefreshCw } from "lucide-react";
import { ProChart } from "./ProChart";

/** Display precision follows the price, so cheap markets (XRP, kPEPE) keep distinct book levels. */
const price = (value: number | string) => { const n = Number(value); if (!Number.isFinite(n)) return "—"; if (n > 0 && n < 1) return n.toPrecision(5); const d = n >= 1000 ? 2 : n >= 100 ? 3 : 4; return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d }); };
export function MarketPanel({ initialCoin = "ETH", onCoin, picker }: { initialCoin?: string; onCoin?: (coin: string) => void; picker?: React.ReactNode }) {
  const coin = initialCoin;
  const [interval, setInterval] = useState("15m"), [reload, setReload] = useState(0);
  const [mobileTab, setMobileTab] = useState("Chart");
  const { data, error, status } = useLiveMarket(coin, interval, reload);
  // 24h change, volume, open interest, funding and max leverage for this market (public, every 30 seconds).
  const [stats, setStats] = useState<{ coin: string; change24h: number | null; volume24h: number | null; openInterestUsd: number | null; funding: number | null; maxLeverage: number } | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { if (!document.hidden) fetch("/api/markets?list=perps", { cache: "no-store" }).then(r => r.json() as Promise<{ markets?: NonNullable<typeof stats>[] }>).then(b => { if (live) setStats(b.markets?.find(m => m.coin === coin) ?? null); }).catch(() => {}); };
    const first = window.setTimeout(read, 0), t = window.setInterval(read, 30_000);
    return () => { live = false; window.clearTimeout(first); window.clearInterval(t); };
  }, [coin]);
  const compact = (n: number | null | undefined) => n === null || n === undefined ? "—" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  const busy = !data && !error;
  function select(value: string) { onCoin?.(value); }
  return <section className="fv-panel fv-market-panel">
    <div className="fv-market-heading">{picker ?? <div className="fv-market-choices">{["ETH", "BTC", "NEAR"].map(value => <button key={value} aria-pressed={coin === value} onClick={() => select(value)}><TokenIcon symbol={value} core size={25}/>{value}<small>PERP</small></button>)}</div>}<NetworkLabel network="hyperliquid"/></div>
    <div className="fv-price-heading"><strong key={data?.last?.time ?? 0} className={data?.last ? "fv-tick is-" + data.last.side : undefined}>{data?.last ? "$" + price(data.last.price) : data?.mid ? "$" + price(data.mid) : busy ? "Reading market…" : "Price unavailable"}</strong><span>{coin} perpetual · {data?.last ? "last trade" + (data.mid ? " · mid $" + price(data.mid) : "") + " · " : ""}{data?.stale ? "Last good data · reconnecting" : status}</span><button className="fv-icon-button" aria-label="Refresh market data" disabled={busy} onClick={() => setReload(x => x + 1)}><RefreshCw size={16}/></button></div>
    {stats && stats.coin === coin && <div className="fv-perp-strip">
      <div><small>24h change</small><strong className={(stats.change24h ?? 0) >= 0 ? "fv-up" : "fv-down"}>{stats.change24h === null ? "—" : (stats.change24h >= 0 ? "+" : "") + stats.change24h.toFixed(2) + "%"}</strong></div>
      <div><small>24h volume</small><strong>{compact(stats.volume24h)}</strong></div>
      <div><small>Open interest</small><strong>{compact(stats.openInterestUsd)}</strong></div>
      <div title="Hyperliquid funding is paid every hour; positive means longs pay shorts."><small>Funding / 1h</small><strong className={(stats.funding ?? 0) >= 0 ? "" : "fv-down"}>{stats.funding === null ? "—" : (stats.funding * 100).toFixed(4) + "%"}</strong></div>
      <div><small>Max leverage</small><strong>{stats.maxLeverage}×</strong></div>
    </div>}
    <div className="fv-market-mobile-tabs">{["Chart", "Order book"].map(x => <button key={x} aria-pressed={mobileTab === x} onClick={() => setMobileTab(x)}>{x}</button>)}</div>
    {error && !data && <div className="fv-empty" role="status"><h3>Market data is unavailable</h3><p>{error}</p><button className="fv-button" onClick={() => setReload(x => x + 1)}>Try again</button></div>}
    {(!error || data) && <div className="fv-chart-layout"><div className={"fv-chart-area" + (mobileTab !== "Chart" ? " fv-mobile-hidden" : "")}><div className="fv-chart-toolbar"><span>Candles</span>{["1m", "5m", "15m", "1h", "4h", "1d"].map(x => <button key={x} aria-pressed={interval === x} onClick={() => setInterval(x)}>{x}</button>)}</div>{data?.candles.length ? <ProChart seriesKey={coin + ":" + interval} candles={data.candles} fmt={price} height={360}/> : <div className="fv-chart-loading">{busy ? "Reading price history…" : "No price history in this read."}</div>}</div><div className={"fv-order-book" + (mobileTab !== "Order book" ? " fv-mobile-hidden" : "")}><h3>Order book</h3><div className="fv-book-label"><span>Price (USDC)</span><span>Size ({coin})</span></div>{data?.asks.slice(0, 7).reverse().map((r, i) => <div className="fv-book-row fv-ask" key={'a'+i}><span>{price(r.price)}</span><span>{r.size}</span></div>)}<div className="fv-book-mid">{data?.mid ? price(data.mid) : "—"}</div>{data?.bids.slice(0, 7).map((r,i) => <div className="fv-book-row fv-bid" key={'b'+i}><span>{price(r.price)}</span><span>{r.size}</span></div>)}{!data?.bids.length && !data?.asks.length && <p>{busy ? "Reading order book…" : "Order book unavailable"}</p>}</div></div>}
    <div className="fv-panel-foot">{data ? "Hyperliquid · read " + new Date(data.capturedAt).toLocaleTimeString() + ". " + data.warnings.join(". ") : "Public market data; no wallet needed."} Streaming prices are indicative. Orders receive fresh execution checks.</div>
  </section>;
}
