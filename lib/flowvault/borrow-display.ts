import type { LendingVenueSnapshot } from "./contracts.ts";

/** Both Rhea decimal APR and Aave ray-normalized APR arrive as fractions, not percentage points. */
export function borrowAprLabel(apr: string | null | undefined): string {
  if (apr == null || !/^\d+(\.\d+)?$/.test(apr)) return "Unavailable";
  const percent = Number(apr) * 100;
  if (!Number.isFinite(percent)) return "Unavailable";
  return percent > 0 && percent < .01 ? "<0.01%" : percent.toFixed(2) + "%";
}
export function collateralValue(snapshot: LendingVenueSnapshot): string | null {
  let value = 0n;
  for (const p of snapshot.positions) {
    if (!/^\d+$/.test(p.collateralRaw)) return null;
    const raw = BigInt(p.collateralRaw);
    if (!raw) continue;
    const price = snapshot.pricesAndRisk.find(r => r.assetId === p.asset.id)?.priceUsdcRaw;
    if (!price || !/^\d+$/.test(price) || BigInt(price) <= 0n) return null;
    value += raw * BigInt(price) / 10n ** BigInt(p.asset.decimals);
  }
  return value.toString();
}
export function borrowHealth(snapshot: Pick<LendingVenueSnapshot,"health"|"stressedHealth"|"minHealth">): {tone:"safe"|"warning"|"danger"|"unknown";label:string;detail:string} {
  if(snapshot.health === "no debt") return {tone:"safe",label:"No debt",detail:"No outstanding loan to liquidate"};
  const current = Number(snapshot.health), stressed = Number(snapshot.stressedHealth), minimum = Number(snapshot.minHealth);
  if(!snapshot.health || !snapshot.stressedHealth || !Number.isFinite(current) || !Number.isFinite(stressed) || !Number.isFinite(minimum)) return {tone:"unknown",label:"Unavailable",detail:"Refresh to verify your account health"};
  if(current <= 1) return {tone:"danger",label:current.toFixed(2),detail:"At or below the liquidation threshold"};
  if(stressed < minimum || current < minimum) return {tone:"warning",label:current.toFixed(2),detail:"Below your minimum after the configured price stress"};
  return {tone:"safe",label:current.toFixed(2),detail:"Above your minimum under the configured price stress"};
}
