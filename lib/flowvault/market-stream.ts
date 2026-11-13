import { displayMid, parseBook, parseCandles, type DisplayMarket } from "./market-display.ts";
/** Pure merge boundary: foreign markets/intervals and older book snapshots cannot overwrite the active feed. */
export function mergeMarketFrame(old: DisplayMarket, frame: unknown, now = Date.now()): DisplayMarket {
  if (!frame || typeof frame !== "object") return old;
  const { channel, data } = frame as { channel?: string; data?: unknown };
  try {
    if (channel === "l2Book") {
      const book = parseBook(data, old.coin);
      if (old.bookAt && book.bookAt < old.bookAt) return old;
      return { ...old, ...book, capturedAt: new Date(now).toISOString(), stale: false };
    }
    if (channel === "allMids") {
      const mid = displayMid((data as { mids?: Record<string, unknown> })?.mids?.[old.coin]);
      return mid ? { ...old, mid, capturedAt: new Date(now).toISOString(), stale: false } : old;
    }
    if (channel === "candle") {
      const incoming = parseCandles(Array.isArray(data) ? data : [data], old.coin, old.interval);
      if (!incoming.length) return old;
      const candles = [...new Map([...old.candles, ...incoming].map(c => [c.time, c])).values()].sort((a,b) => a.time-b.time).slice(-96);
      return { ...old, candles, capturedAt: new Date(now).toISOString(), stale: false };
    }
  } catch { /* Bad frames preserve the last good data; connection health is managed separately. */ }
  return old;
}
