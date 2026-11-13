/** Public chart data only. These display numbers must never construct an executable order. */
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface BookLevel { price: string; size: string; }
export interface LastTrade { price: string; side: "buy" | "sell"; time: number; }
export interface DisplayMarket { coin: string; interval: string; capturedAt: string; bookAt: number | null; mid: string | null; candles: Candle[]; bids: BookLevel[]; asks: BookLevel[]; warnings: string[]; stale: boolean; /** Latest public print from the trades stream (display only). */ last?: LastTrade | null; }
const INTERVAL_MS: Record<string, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "1h": 3600e3, "4h": 14400e3, "1d": 86400e3 };
export const intervalMs = (i: string) => INTERVAL_MS[i] ?? 0;
/** Newest trade for this coin from a Hyperliquid trades frame (B = buyer took the ask). */
export function parseTrades(raw: unknown, coin: string): LastTrade | null {
  if (!Array.isArray(raw)) return null;
  let best: LastTrade | null = null;
  for (const t of raw as { coin?: string; px?: unknown; side?: string; time?: unknown }[]) {
    if (!t || t.coin !== coin || !positive(t.px) || !Number.isSafeInteger(t.time) || (t.side !== "B" && t.side !== "A")) continue;
    if (!best || (t.time as number) >= best.time) best = { price: String(t.px), side: t.side === "B" ? "buy" : "sell", time: t.time as number };
  }
  return best;
}
/** Mid between the best bid and ask of a book (display only). */
export function bookMid(bids: BookLevel[], asks: BookLevel[]): string | null {
  const b = Number(bids[0]?.price), a = Number(asks[0]?.price);
  return b > 0 && a > 0 && a >= b ? String(Number(((a + b) / 2).toPrecision(12))) : null;
}
const positive = (n: unknown) => (typeof n === "number" || typeof n === "string" && /^\d+(\.\d+)?$/.test(n)) && Number.isFinite(Number(n)) && Number(n) > 0;
export function parseCandles(raw: unknown, coin: string, interval: string): Candle[] {
  if (!Array.isArray(raw)) throw new Error("Price history is unavailable.");
  const rows: Candle[] = raw.slice(-500).flatMap(row => {
    if (!row || row.s !== coin || row.i !== interval || !Number.isSafeInteger(row.t) || ![row.o, row.h, row.l, row.c].every(positive)) return [];
    const [open, high, low, close] = [row.o, row.h, row.l, row.c].map(Number);
    if (high < Math.max(open, close) || low > Math.min(open, close) || low > high) return [];
    return [{ time: row.t, open, high, low, close, volume: (typeof row.v === "number" || typeof row.v === "string" && /^\d+(\.\d+)?$/.test(row.v)) && Number.isFinite(Number(row.v)) ? Number(row.v) : 0 }];
  });
  return [...new Map(rows.map(row => [row.time, row])).values()].sort((a, b) => a.time - b.time).slice(-96);
}
export function parseBook(raw: unknown, coin: string): { bids: BookLevel[]; asks: BookLevel[]; bookAt: number } {
  const book = raw as { coin?: string; time?: number; levels?: { px: string; sz: string }[][] };
  if (!book || book.coin !== coin || !Number.isSafeInteger(book.time) || !Array.isArray(book.levels) || book.levels.length !== 2) throw new Error("Order book is unavailable.");
  const levels = book.levels.map(side => {
    if (!Array.isArray(side)) return [];
    return side.filter(row => row && positive(row.px) && positive(row.sz)).slice(0, 10).map(row => ({ price: row.px, size: row.sz }));
  });
  return { bids: levels[0], asks: levels[1], bookAt: book.time! };
}
export function displayMid(raw: unknown): string | null { return positive(raw) ? String(raw) : null; }
