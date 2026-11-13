import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { view } from "@/lib/flowvault/near";
import { refMetadata } from "@/lib/flowvault/research-service";
import { refPrices } from "@/lib/flowvault/swap-journal";
import { pricedValue } from "@/lib/flowvault/wallet-research";
import { decimal } from "@/lib/flowvault/money";

const RHEA = "contract.main.burrow.near";
type Pool = { balance?: string };
type Asset = { token_id: string; supply_apr?: string; borrow_apr?: string; supplied?: Pool; borrowed?: Pool; reserved?: string; config?: { extra_decimals?: number; can_deposit?: boolean; can_borrow?: boolean; can_use_as_collateral?: boolean; volatility_ratio?: number; supplied_limit?: string; borrowed_limit?: string } };
const pct = (x?: string) => (typeof x === "string" && /^\d+(\.\d+)?$/.test(x) ? Number(x) * 100 : null);

/** Public Rhea (Burrow) lending markets: supply/borrow APR, totals, utilization and collateral terms. Display
 * only; supply, borrow and repay keep their own fresh preflight in the plan/journal flows. */
export async function GET() {
  try {
    const out = await snapshot("rates:rhea", async () => {
      const [assets, meta, prices] = await Promise.all([view<Asset[]>(RHEA, "get_assets_paged_detailed", { from_index: 0, limit: 100 }), refMetadata().catch(() => ({} as Record<string, { symbol: string; name: string; decimals: number; icon?: string }>)), refPrices().catch(() => ({} as Record<string, unknown>))]);
      const rows = assets.data.flatMap(a => {
        const m = meta[a.token_id], c = a.config ?? {};
        if (!m || !c.can_deposit && !c.can_borrow) return [];
        const extra = Number(c.extra_decimals) || 0, d = m.decimals + extra;
        const raw = (p?: Pool) => (p && /^\d+$/.test(p.balance ?? "") ? BigInt(p.balance!) : 0n);
        const supplied = raw(a.supplied) + (/^\d+$/.test(a.reserved ?? "") ? BigInt(a.reserved!) : 0n), borrowed = raw(a.borrowed);
        const usd = (n: bigint) => { const v = pricedValue((n / 10n ** BigInt(extra)).toString(), m.decimals, prices[a.token_id]); return v === null ? null : Number(decimal(v / 1000000n)); };
        return [{
          token: a.token_id, symbol: m.symbol, name: m.name, icon: m.icon ?? null,
          supplyApy: pct(a.supply_apr), borrowApy: pct(a.borrow_apr),
          supplied: Number(decimal(supplied, d)), borrowed: Number(decimal(borrowed, d)), suppliedUsd: usd(supplied), borrowedUsd: usd(borrowed),
          utilization: supplied > 0n ? Number(borrowed * 10000n / supplied) / 100 : 0,
          canSupply: c.can_deposit !== false, canBorrow: !!c.can_borrow, collateral: !!c.can_use_as_collateral, ltv: c.volatility_ratio ? c.volatility_ratio / 100 : null,
        }];
      }).sort((x, y) => (y.suppliedUsd ?? 0) - (x.suppliedUsd ?? 0));
      return { rows, blockHeight: assets.blockHeight, capturedAt: new Date().toISOString() };
    }, old => old);
    return Response.json({ ...out, source: "Rhea (Burrow) finalized view · Ref prices for USD totals. Rates are variable." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
