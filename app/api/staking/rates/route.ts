import { snapshot } from "@/lib/flowvault/snapshot-cache";
import { publicLiquidRates } from "@/lib/flowvault/staking-options";

/** Public LiNEAR and rNEAR staking rates, no account needed (Research shows them before a wallet is connected).
 * Display only: staking itself keeps its own account-bound options and fresh checks. */
export async function GET() {
  try {
    const out = await snapshot("rates:liquid-staking", publicLiquidRates, (old) => old);
    return Response.json({ ...out, source: "LiNEAR and Rhea liquid staking contracts · variable estimate" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
