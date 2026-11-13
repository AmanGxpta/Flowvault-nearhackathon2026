import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandles, parseBook, displayMid } from "../lib/flowvault/market-display.ts";

test("chart data rejects foreign symbols, intervals, invalid prices and inconsistent OHLC", () => {
  const row = { s: "ETH", i: "15m", t: 1000, o: "2000", h: "2100", l: "1900", c: "2050", v: "12.5" };
  assert.deepEqual(parseCandles([row, { ...row, s: "BTC" }, { ...row, i: "4h" }, { ...row, h: "1950" }, { ...row, l: "2100" }, { ...row, o: "Infinity" }], "ETH", "15m"), [{ time: 1000, open: 2000, high: 2100, low: 1900, close: 2050, volume: 12.5 }]);
  assert.throws(() => parseCandles(null, "ETH", "15m"));
});
test("chart history is sorted, deduplicated and bounded without making up missing candles", () => {
  const row = { s: "BTC", i: "1h", o: "100", h: "110", l: "90", c: "105", v: "1" };
  const candles = parseCandles(Array.from({ length: 120 }, (_, i) => ({ ...row, t: 120 - i })), "BTC", "1h");
  assert.equal(candles.length, 96);
  assert.equal(candles[0].time, 25);
  assert.equal(candles.at(-1)!.time, 120);
  assert.equal(parseCandles([{ ...row, t: 1 }, { ...row, t: 1 }], "BTC", "1h").length, 1);
});
test("order book and current price never infer a different market or treat unknown as zero", () => {
  assert.equal(displayMid(undefined), null);
  assert.equal(displayMid("0"), null);
  assert.equal(displayMid("1e4"), null);
  assert.equal(displayMid("42000.1"), "42000.1");
  assert.throws(() => parseBook({ coin: "BTC", time: 1, levels: [[], []] }, "ETH"));
  assert.throws(() => parseBook({ coin: "ETH", levels: [[], []] }, "ETH"));
  const book = parseBook({ coin: "ETH", time: 123, levels: [[{ px: "2000", sz: "0.001" }, { px: "NaN", sz: "1" }], []] }, "ETH");
  assert.deepEqual(book.bids, [{ price: "2000", size: "0.001" }]);
  assert.deepEqual(book.asks, []);
});
