import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { publicJson } from "@/lib/flowvault/research-service";
import { swapTokenCatalog } from "@/lib/flowvault/swap-catalog";
import { bestPairs, feedTokens, CHAINS, type MarketRow } from "@/lib/flowvault/market-scan";

/** Public market discovery (DexScreener). Read-only display data: no session, no wallet, no execution. */
async function pairsFor(list: { chain: string; address: string }[]): Promise<MarketRow[]> {
  const byChain = new Map<string, string[]>();
  for (const t of list) byChain.set(t.chain, [...(byChain.get(t.chain) ?? []), t.address]);
  const batches: Promise<unknown>[] = [];
  for (const [chain, addresses] of byChain)
    for (let i = 0; i < addresses.length; i += 30)
      batches.push(publicJson(`https://api.dexscreener.com/tokens/v1/${chain}/${addresses.slice(i, i + 30).map(encodeURIComponent).join(",")}`).catch(() => []));
  return (await Promise.all(batches)).flatMap(b => bestPairs(b));
}
async function feed(kind: string, chain: string): Promise<MarketRow[]> {
  if (kind === "trending" || kind === "new") {
    const url = kind === "trending" ? "https://api.dexscreener.com/token-boosts/top/v1" : "https://api.dexscreener.com/token-profiles/latest/v1";
    const tokens = feedTokens(await publicJson(url), chain, 60);
    const rows = await pairsFor(tokens);
    const boost = new Map(tokens.map(t => [t.chain + ":" + t.address.toLowerCase(), t.boosts]));
    for (const r of rows) r.boosts = boost.get(r.chain + ":" + r.address.toLowerCase()) ?? 0;
    return kind === "new" ? rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) : rows.sort((a, b) => (b.boosts ?? 0) - (a.boosts ?? 0) || (b.volume.h24 ?? 0) - (a.volume.h24 ?? 0));
  }
  // "top": the NEAR tokens FlowVault can swap, ranked by 24h volume.
  const catalog = await swapTokenCatalog();
  const near = catalog.filter(t => t.network === "near" && t.contract !== "native" && (t.assetId || t.price)).slice(0, 150).map(t => ({ chain: "near", address: t.contract }));
  return (await pairsFor(near)).sort((a, b) => (b.volume.h24 ?? 0) - (a.volume.h24 ?? 0));
}
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const kind = ["trending", "new", "top", "watch", "search"].includes(q.get("feed") ?? "") ? q.get("feed")! : "top";
    const chain = q.get("chain") ?? "all";
    if (chain !== "all" && !CHAINS[chain]) throw new Error("Unsupported chain.");
    let rows: MarketRow[];
    if (kind === "search") {
      // Pair search (ticker, name or contract) across DexScreener; only chains FlowVault can trade or chart.
      const term = (q.get("q") ?? "").trim().slice(0, 64);
      if (term.length < 2) throw new Error("Type at least two characters.");
      rows = (await snapshot(`discover:search:${term.toLowerCase()}`, async () => bestPairs(await publicJson("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(term))), old => old))
        .filter(r => chain === "all" || r.chain === chain).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    } else if (kind === "watch") {
      const ids = (q.get("ids") ?? "").split(",").filter(Boolean).slice(0, 90).map(id => { const i = id.indexOf(":"); return { chain: id.slice(0, i), address: id.slice(i + 1) }; }).filter(t => CHAINS[t.chain] && t.address);
      rows = ids.length ? await pairsFor(ids) : [];
    } else rows = await snapshot(`discover:${kind}:${chain}`, () => feed(kind, chain), old => old);
    const catalog = await swapTokenCatalog().catch(() => []);
    const swappable = new Map(catalog.map(t => [t.id.toLowerCase(), t.id]));
    const icons = new Map(catalog.filter(t => t.icon).map(t => [t.id, t.icon!]));
    return Response.json({
      feed: kind, chain, capturedAt: new Date().toISOString(),
      rows: rows.slice(0, 100).map(r => { const swapId = swappable.get((CHAINS[r.chain].network + ":" + r.address).toLowerCase()) ?? null; return { ...r, icon: r.icon ?? (swapId ? icons.get(swapId) ?? null : null), swapId }; }),
      source: "DexScreener public pairs (best-liquidity pair per token). Display only; not an endorsement.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
