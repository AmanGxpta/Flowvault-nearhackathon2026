import { publicJson } from "@/lib/flowvault/research-service";
import { swapTokenCatalog } from "@/lib/flowvault/swap-catalog";
import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { bestPairs, parseOhlcv, trustSignals, CHAINS } from "@/lib/flowvault/market-scan";
import { view } from "@/lib/flowvault/near";

const FRAMES: Record<string, [string, number]> = { "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1] };
/** One token: best pair stats (DexScreener), candles (GeckoTerminal) and plain-language trust signals. Read-only. */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const chain = q.get("chain") ?? "", address = q.get("address") ?? "", tf = FRAMES[q.get("tf") ?? "1h"] ? q.get("tf")! : "1h";
    if (!CHAINS[chain] || !/^[A-Za-z0-9._:-]{2,90}$/.test(address)) throw new Error("Choose a supported token.");
    const g = CHAINS[chain].gecko;
    const [pairs, catalog, pools] = await Promise.all([
      snapshot(`token:${chain}:${address}`, () => publicJson(`https://api.dexscreener.com/tokens/v1/${chain}/${encodeURIComponent(address)}`), old => old),
      swapTokenCatalog().catch(() => []),
      snapshot(`gecko-pools:${g}:${address}`, () => publicJson(`https://api.geckoterminal.com/api/v2/networks/${g}/tokens/${encodeURIComponent(address)}/pools?page=1`), old => old).catch(() => null),
    ]);
    const rows = bestPairs(pairs);
    const row = rows.find(r => r.address.toLowerCase() === address.toLowerCase());
    if (!row) throw new Error("No public trading pair found for this token.");
    const pool = (pools as { data?: { attributes?: { address?: string } }[] } | null)?.data?.[0]?.attributes?.address;
    const [unit, aggregate] = FRAMES[tf];
    const candles = typeof pool === "string" && /^[A-Za-z0-9._:-]{2,120}$/.test(pool)
      ? parseOhlcv(await snapshot(`gecko-ohlcv:${g}:${pool}:${tf}`, () => publicJson(`https://api.geckoterminal.com/api/v2/networks/${g}/pools/${encodeURIComponent(pool)}/ohlcv/${unit}?aggregate=${aggregate}&limit=120&currency=usd`), old => old).catch(() => null))
      : [];
    const swap = catalog.find(t => t.id.toLowerCase() === (CHAINS[chain].network + ":" + address).toLowerCase());
    let verified: boolean | null = null;
    if (chain === "near" && swap) {
      try { const m = await view<{ symbol?: string; decimals?: number }>(address, "ft_metadata", {}); verified = m.data.decimals === swap.decimals; } catch { verified = null; }
    }
    return Response.json({
      row, pairs: rows.length, candles, timeframe: tf, swapId: swap?.id ?? null, capturedAt: new Date().toISOString(),
      signals: trustSignals(row, { listedForSwap: !!swap, verifiedMetadata: verified }),
      source: "DexScreener pair stats · GeckoTerminal candles" + (chain === "near" ? " · NEAR RPC metadata" : "") + ". Display only; not an endorsement.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
