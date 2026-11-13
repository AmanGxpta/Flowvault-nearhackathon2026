"use client";
// Price chart on TradingView Lightweight Charts™ (Apache-2.0, https://www.tradingview.com/), fed only with
// FlowVault's own data: Hyperliquid candles and trades for perps, the token's own pool for spot. Zoom, pan,
// crosshair OHLC readout, volume, and a live last-price line. Live updates move the latest candle in place, so the
// owner's zoom and scroll position survive every tick.
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp, type MouseEventParams } from "lightweight-charts";
import type { Candle } from "@/lib/flowvault/market-display";

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
/** Decimal places that keep cheap markets readable (0.0000123) and big ones tidy (68,602.00). */
function precisionFor(p: number) {
  if (!(p > 0)) return 2;
  if (p >= 1000) return 2;
  if (p >= 1) return 4;
  return Math.min(10, Math.max(4, Math.ceil(-Math.log10(p)) + 4));
}
/** The canvas can't read CSS variables, so read the theme's values from the page (and again on theme change). */
function themeColors(el: HTMLElement) {
  const css = getComputedStyle(el), v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { text: v("--fvc-6F786B", "#6F786B"), grid: v("--fvb-EEF0E8", "#EEF0E8"), border: v("--fvb-E3E6DB", "#E3E6DB"), bg: "transparent", up: "#499279", down: "#c27869", cross: v("--fvc-8A9285", "#8A9285") };
}

export function ProChart({ candles, seriesKey, fmt, height = 340 }: { candles: Candle[]; seriesKey: string; fmt: (n: number) => string; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null), price = useRef<ISeriesApi<"Candlestick"> | null>(null), volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const loaded = useRef<{ key: string; lastT: number } | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const byTime = useRef(new Map<number, Candle>());

  // Create once; restyle when the theme changes.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = themeColors(el);
    const api = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text, fontSize: 11, fontFamily: "inherit", attributionLogo: true },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: c.border, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 8 },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: c.cross, labelBackgroundColor: "#2B4233" }, horzLine: { color: c.cross, labelBackgroundColor: "#2B4233" } },
      // The wheel scrolls the page; zoom with the buttons, drag to pan, drag an axis to rescale, pinch on touch.
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    price.current = api.addSeries(CandlestickSeries, { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceLineVisible: true, lastValueVisible: true });
    volume.current = api.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    api.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const move = (p: MouseEventParams) => setHover(p.time ? byTime.current.get(Number(p.time)) ?? null : null);
    api.subscribeCrosshairMove(move);
    chart.current = api;
    const restyle = () => {
      const t = themeColors(el);
      api.applyOptions({ layout: { textColor: t.text }, grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } }, rightPriceScale: { borderColor: t.border }, timeScale: { borderColor: t.border } });
    };
    const watch = new MutationObserver(restyle);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", restyle);
    return () => { watch.disconnect(); media.removeEventListener("change", restyle); api.unsubscribeCrosshairMove(move); api.remove(); chart.current = null; price.current = null; volume.current = null; loaded.current = null; };
  }, []);

  // Data: a new market or timeframe replaces the series; the same series only updates its newest candles.
  useEffect(() => {
    const p = price.current, vol = volume.current;
    if (!p || !vol || !candles.length) return;
    const rows = candles.map((c) => ({ ...c, t: sec(c.time) })).filter((c, i, a) => i === 0 || c.t > a[i - 1].t);
    byTime.current = new Map(rows.map((c) => [c.t as number, c]));
    const last = rows[rows.length - 1];
    const prec = precisionFor(last.close);
    p.applyOptions({ priceFormat: { type: "price", precision: prec, minMove: 1 / 10 ** prec } });
    const bar = (c: (typeof rows)[number]) => ({ time: c.t, open: c.open, high: c.high, low: c.low, close: c.close });
    const vbar = (c: (typeof rows)[number]) => ({ time: c.t, value: c.volume, color: c.close >= c.open ? "rgba(73,146,121,.35)" : "rgba(194,120,105,.35)" });
    const prev = loaded.current;
    if (prev && prev.key === seriesKey && last.t >= prev.lastT) {
      // Same market: move the forming candle and append new ones; history and the owner's view stay put.
      for (const c of rows) if (c.t >= prev.lastT) { p.update(bar(c)); vol.update(vbar(c)); }
    } else {
      p.setData(rows.map(bar));
      vol.setData(rows.map(vbar));
      chart.current?.timeScale().fitContent();
    }
    loaded.current = { key: seriesKey, lastT: last.t };
  }, [candles, seriesKey]);

  /** Zoom around the newest candles: factor < 1 shows fewer bars, > 1 more. */
  function zoom(factor: number) {
    const ts = chart.current?.timeScale(), r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const span = Math.max(10, (r.to - r.from) * factor);
    ts.setVisibleLogicalRange({ from: r.to - span, to: r.to });
  }
  const shown = hover ?? candles[candles.length - 1];
  return <div className="fv-prochart">
    {shown && <div className="fv-candle-readout"><span>{new Date(shown.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span>O {fmt(shown.open)}</span><span>H {fmt(shown.high)}</span><span>L {fmt(shown.low)}</span><span className={shown.close >= shown.open ? "fv-up" : "fv-down"}>C {fmt(shown.close)}</span>{shown.volume > 0 && <span>Vol {Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(shown.volume)}</span>}</div>}
    <div className="fv-prochart-zoom" role="group" aria-label="Chart zoom">
      <button type="button" aria-label="Zoom in" onClick={() => zoom(0.6)}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoom(1.6)}>−</button>
      <button type="button" aria-label="Show all history" onClick={() => chart.current?.timeScale().fitContent()}>Fit</button>
    </div>
    <div ref={host} className="fv-prochart-canvas" style={{ height }} role="img" aria-label={`Price chart, ${candles.length} candles. Latest close ${candles.length ? fmt(candles[candles.length - 1].close) : "unknown"}.`} />
  </div>;
}
