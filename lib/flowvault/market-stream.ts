import { bookMid, displayMid, intervalMs, parseBook, parseCandles, parseTrades, type DisplayMarket } from "./market-display.ts";
/** Pure merge boundary: foreign markets/intervals and older book snapshots cannot overwrite the active feed. */
export function mergeMarketFrame(old: DisplayMarket, frame: unknown, now = Date.now()): DisplayMarket {
  if (!frame || typeof frame !== "object") return old;
  const { channel, data } = frame as { channel?: string; data?: unknown };
  try {
    if (channel === "l2Book") {
      const book = parseBook(data, old.coin);
      if (old.bookAt && book.bookAt < old.bookAt) return old;
      // allMids arrives rarely on the public feed; a newer book gives a current mid.
      return { ...old, ...book, mid: bookMid(book.bids, book.asks) ?? old.mid, capturedAt: new Date(now).toISOString(), stale: false };
    }
    if (channel === "allMids") {
      const mid = displayMid((data as { mids?: Record<string, unknown> })?.mids?.[old.coin]);
      return mid ? { ...old, mid, capturedAt: new Date(now).toISOString(), stale: false } : old;
    }
    if (channel === "trades") {
      const t = parseTrades(data, old.coin);
      if (!t || (old.last && t.time < old.last.time)) return old;
      // The forming candle follows every print, so the chart moves between candle frames.
      const span = intervalMs(old.interval), c = old.candles.at(-1), px = Number(t.price);
      const candles = c && span && t.time >= c.time && t.time < c.time + span
        ? [...old.candles.slice(0, -1), { ...c, close: px, high: Math.max(c.high, px), low: Math.min(c.low, px) }]
        : old.candles;
      return { ...old, last: t, candles, capturedAt: new Date(now).toISOString(), stale: false };
    }
    if (channel === "candle") {
      const incoming = parseCandles(Array.isArray(data) ? data : [data], old.coin, old.interval);
      if (!incoming.length) return old;
      const candles = [...new Map([...old.candles, ...incoming].map(c => [c.time, c])).values()].sort((a,b) => a.time-b.time).slice(-300);
      return { ...old, candles, capturedAt: new Date(now).toISOString(), stale: false };
    }
  } catch { /* Bad frames preserve the last good data; connection health is managed separately. */ }
  return old;
}
