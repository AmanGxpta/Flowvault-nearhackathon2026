import { hlPost } from "@/lib/flowvault/perps-service";
import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { parseBook, parseCandles, displayMid, type DisplayMarket } from "@/lib/flowvault/market-display";

/** Hyperliquid public Info API. No account identity, sessions, mutations or execution authority. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, coin = q.get("coin") ?? "ETH", interval = q.get("interval") ?? "15m";
  if (!["ETH", "BTC", "NEAR"].includes(coin) || !["15m", "1h", "4h"].includes(interval)) return Response.json({ error: "Choose a supported market and timeframe." }, { status: 400 });
  try {
    const load = async (): Promise<DisplayMarket> => {
      const now = Date.now(), ms = interval === "15m" ? 900000 : interval === "1h" ? 3600000 : 14400000;
      // https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
      const results = await Promise.allSettled([
        hlPost("/info", { type: "candleSnapshot", req: { coin, interval, startTime: now - 96 * ms, endTime: now } }),
        hlPost("/info", { type: "l2Book", coin }), hlPost("/info", { type: "allMids" }),
      ]);
      const warnings: string[] = [];
      let candles: DisplayMarket["candles"] = [], book: Pick<DisplayMarket, "bids" | "asks" | "bookAt"> = { bids: [], asks: [], bookAt: null }, mid: string | null = null;
      try { if (results[0].status === "fulfilled") candles = parseCandles(results[0].value, coin, interval); else throw new Error(); if (!candles.length) throw new Error(); } catch { warnings.push("Price history unavailable"); }
      try { if (results[1].status === "fulfilled") book = parseBook(results[1].value, coin); else throw new Error(); } catch { warnings.push("Order book unavailable"); }
      if (results[2].status === "fulfilled") mid = displayMid(results[2].value?.[coin]);
      if (!mid) warnings.push("Current price unavailable");
      if (!candles.length && book.bookAt === null && !mid) throw new Error("Market data is temporarily unavailable.");
      return { coin, interval, capturedAt: new Date(now).toISOString(), candles, ...book, mid, warnings, stale: false };
    };
    const result = q.get("fresh") === "1" ? await load() : await snapshot<DisplayMarket>("display-market:" + coin + ":" + interval, load, old => ({ ...old, stale: true, warnings: [...old.warnings, "Showing the last successful read."] }));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 503 }); }
}
