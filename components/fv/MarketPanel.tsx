"use client";
import { useState } from "react";
import type { Candle } from "@/lib/flowvault/market-display";
import { TokenIcon, NetworkLabel } from "./AssetIdentity";
import { useLiveMarket } from "./useLiveMarket";
import { RefreshCw } from "lucide-react";

/** Display precision follows the price, so cheap markets (XRP, kPEPE) keep distinct book levels. */
const price = (value: number | string) => { const n = Number(value); if (!Number.isFinite(n)) return "—"; if (n > 0 && n < 1) return n.toPrecision(5); const d = n >= 1000 ? 2 : n >= 100 ? 3 : 4; return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d }); };
export function MarketPanel({ initialCoin = "ETH", onCoin, picker }: { initialCoin?: string; onCoin?: (coin: string) => void; picker?: React.ReactNode }) {
  const coin = initialCoin;
  const [interval, setInterval] = useState("15m"), [reload, setReload] = useState(0);
  const [mobileTab, setMobileTab] = useState("Chart");
  const { data, error, status } = useLiveMarket(coin, interval, reload);
  const busy = !data && !error;
  function select(value: string) { onCoin?.(value); }
  return <section className="fv-panel fv-market-panel">
    <div className="fv-market-heading">{picker ?? <div className="fv-market-choices">{["ETH", "BTC", "NEAR"].map(value => <button key={value} aria-pressed={coin === value} onClick={() => select(value)}><TokenIcon symbol={value} core size={25}/>{value}<small>PERP</small></button>)}</div>}<NetworkLabel network="hyperliquid"/></div>
    <div className="fv-price-heading"><strong key={data?.last?.time ?? 0} className={data?.last ? "fv-tick is-" + data.last.side : undefined}>{data?.last ? "$" + price(data.last.price) : data?.mid ? "$" + price(data.mid) : busy ? "Reading market…" : "Price unavailable"}</strong><span>{coin} perpetual · {data?.last ? "last trade" + (data.mid ? " · mid $" + price(data.mid) : "") + " · " : ""}{data?.stale ? "Last good data · reconnecting" : status}</span><button className="fv-icon-button" aria-label="Refresh market data" disabled={busy} onClick={() => setReload(x => x + 1)}><RefreshCw size={16}/></button></div>
    <div className="fv-market-mobile-tabs">{["Chart", "Order book"].map(x => <button key={x} aria-pressed={mobileTab === x} onClick={() => setMobileTab(x)}>{x}</button>)}</div>
    {error && !data && <div className="fv-empty" role="status"><h3>Market data is unavailable</h3><p>{error}</p><button className="fv-button" onClick={() => setReload(x => x + 1)}>Try again</button></div>}
    {(!error || data) && <div className="fv-chart-layout"><div className={"fv-chart-area" + (mobileTab !== "Chart" ? " fv-mobile-hidden" : "")}><div className="fv-chart-toolbar"><span>Candles</span>{["15m", "1h", "4h"].map(x => <button key={x} aria-pressed={interval === x} onClick={() => setInterval(x)}>{x}</button>)}</div>{data?.candles.length ? <CandleChart key={coin+interval} candles={data.candles} coin={coin}/> : <div className="fv-chart-loading">{busy ? "Reading price history…" : "No price history in this read."}</div>}</div><div className={"fv-order-book" + (mobileTab !== "Order book" ? " fv-mobile-hidden" : "")}><h3>Order book</h3><div className="fv-book-label"><span>Price (USDC)</span><span>Size ({coin})</span></div>{data?.asks.slice(0, 7).reverse().map((r, i) => <div className="fv-book-row fv-ask" key={'a'+i}><span>{price(r.price)}</span><span>{r.size}</span></div>)}<div className="fv-book-mid">{data?.mid ? price(data.mid) : "—"}</div>{data?.bids.slice(0, 7).map((r,i) => <div className="fv-book-row fv-bid" key={'b'+i}><span>{price(r.price)}</span><span>{r.size}</span></div>)}{!data?.bids.length && !data?.asks.length && <p>{busy ? "Reading order book…" : "Order book unavailable"}</p>}</div></div>}
    <div className="fv-panel-foot">{data ? "Hyperliquid · read " + new Date(data.capturedAt).toLocaleTimeString() + ". " + data.warnings.join(". ") : "Public market data; no wallet needed."} Streaming prices are indicative. Orders receive fresh execution checks.</div>
  </section>;
}
export function CandleChart({ candles, coin, fmt = price }: { candles: Candle[]; coin: string; fmt?: (n: number) => string }) {
  const [hover, setHover] = useState<Candle | null>(null);
  const max = Math.max(...candles.map(c => c.high)), min = Math.min(...candles.map(c => c.low));
  const span = Math.max(max - min, max * .001), top = max + span * .08, bottom = min - span * .08;
  const y = (n: number) => 24 + (top - n) / (top - bottom) * 270, w = 650 / candles.length;
  const active = hover ?? candles.at(-1)!;
  return <><div className="fv-candle-readout"><span>{new Date(active.time).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span><span>O {fmt(active.open)}</span><span>H {fmt(active.high)}</span><span>L {fmt(active.low)}</span><span>C {fmt(active.close)}</span></div><svg className="fv-candle-chart" viewBox="0 0 760 340" role="img" aria-label={coin + ' price history, ' + candles.length + ' candles. Latest close ' + fmt(candles.at(-1)!.close) + ' USDC.'} onMouseLeave={() => setHover(null)}>{[0,.25,.5,.75,1].map(t => <g key={t}><line x1="20" x2="685" y1={24+t*270} y2={24+t*270} stroke="var(--fvb-E3E6DB)" strokeDasharray="3 5"/><text x="697" y={28+t*270} fontSize="10" fill="var(--fvc-6F786B)">{fmt(top-t*(top-bottom))}</text></g>)}{candles.map((c,i) => { const x=24+(i+.5)*w, color=c.close>=c.open?'#499279':'#c27869'; return <g key={c.time} onMouseEnter={() => setHover(c)}><rect x={x-w/2} y="20" width={w} height="280" fill="transparent"/><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color}/><rect x={x-Math.max(1,w*.28)} y={Math.min(y(c.open),y(c.close))} width={Math.max(2,w*.56)} height={Math.max(1,Math.abs(y(c.open)-y(c.close)))} fill={color}/><title>{new Date(c.time).toLocaleString()} · Open {c.open}, High {c.high}, Low {c.low}, Close {c.close}</title></g>; })}<text x="24" y="327" fontSize="10" fill="var(--fvc-6F786B)">{new Date(candles[0].time).toLocaleDateString()}</text><text x="590" y="327" fontSize="10" fill="var(--fvc-6F786B)">{new Date(candles.at(-1)!.time).toLocaleDateString()}</text></svg></>;
}
