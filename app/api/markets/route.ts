import { hlPost } from "@/lib/flowvault/perps-service";
import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { parseBook, parseCandles, displayMid, type DisplayMarket } from "@/lib/flowvault/market-display";

export interface PerpListing { coin: string; price: string | null; change24h: number | null; volume24h: number | null; openInterestUsd: number | null; funding: number | null; maxLeverage: number }
/** Every listed (not delisted) Hyperliquid perp with mark price, 24h change, volume, open interest and funding. */
async function perpListings(): Promise<PerpListing[]> {
  return snapshot("perp-listings", async () => {
    const [meta, ctxs] = await hlPost("/info", { type: "metaAndAssetCtxs" }) as [{ universe: { name: string; maxLeverage: number; isDelisted?: boolean }[] }, { markPx?: string; prevDayPx?: string; dayNtlVlm?: string; openInterest?: string; funding?: string }[]];
    const num = (v?: string) => (v && /^-?\d+(\.\d+)?(e-?\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : null);
    return meta.universe.flatMap((u, i) => {
      if (u.isDelisted) return [];
      const c = ctxs[i] ?? {}, mark = num(c.markPx), prev = num(c.prevDayPx), oi = num(c.openInterest);
      return [{ coin: u.name, price: mark !== null && mark > 0 ? c.markPx! : null, change24h: mark && prev ? ((mark - prev) / prev) * 100 : null, volume24h: num(c.dayNtlVlm), openInterestUsd: oi !== null && mark ? oi * mark : null, funding: num(c.funding), maxLeverage: u.maxLeverage }];
    }).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  }, old => old);
}

/** Hyperliquid public Info API. No account identity, sessions, mutations or execution authority. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, coin = q.get("coin") ?? "ETH", interval = q.get("interval") ?? "15m";
  if (q.get("list") === "perps") {
    try { return Response.json({ markets: await perpListings(), capturedAt: new Date().toISOString(), source: "Hyperliquid metaAndAssetCtxs (public)" }, { headers: { "Cache-Control": "no-store" } }); }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 503 }); }
  }
  if (!/^[A-Za-z0-9]{1,20}$/.test(coin) || !["15m", "1h", "4h"].includes(interval)) return Response.json({ error: "Choose a supported market and timeframe." }, { status: 400 });
  if (!["ETH", "BTC", "NEAR"].includes(coin)) {
    const listed = await perpListings().catch(() => [] as PerpListing[]);
    if (!listed.some((m) => m.coin === coin)) return Response.json({ error: `${coin} isn't a listed Hyperliquid perp.` }, { status: 400 });
  }
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
