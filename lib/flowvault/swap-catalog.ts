import { snapshot } from "./snapshot-cache.ts";
import { publicJson, refMetadata } from "./research-service.ts";
import { swapCatalog, type SwapToken } from "./swap-explorer.ts";

/** 1Click listed assets plus Ref token metadata, with USD prices: 1Click's price where it lists one, otherwise
 * Ref's indexer price for NEAR tokens (matched by contract and decimals). Prices are display estimates; execution
 * re-reads its own evidence. */
export async function swapTokenCatalog(): Promise<SwapToken[]> {
  return snapshot("swap:explore-catalog:v3", async () => {
    const [a, m, p] = await Promise.allSettled([
      publicJson("https://1click.chaindefuser.com/v0/tokens"), refMetadata(), publicJson("https://indexer.ref.finance/list-token-price"),
    ]);
    if (a.status !== "fulfilled" && m.status !== "fulfilled") throw new Error("Token catalog unavailable.");
    const tokens = swapCatalog(a.status === "fulfilled" ? a.value : [], m.status === "fulfilled" ? m.value : {});
    const prices = p.status === "fulfilled" && p.value && typeof p.value === "object" ? p.value as Record<string, { price?: unknown; decimal?: unknown }> : {};
    for (const t of tokens) {
      if (t.price || t.network !== "near") continue;
      const row = prices[t.contract === "native" ? "wrap.near" : t.contract];
      if (row && row.decimal === t.decimals && typeof row.price === "string" && /^\d+(\.\d+)?$/.test(row.price) && Number(row.price) > 0) t.price = row.price;
    }
    return tokens;
  }, old => old);
}
