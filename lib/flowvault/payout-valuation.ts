import { units, decimal } from "./money.ts";
export interface PayoutValuation {
  source: "1click-token-prices";
  originPrice: string;
  destinationPrice: string;
  originUpdatedAt: string;
  destinationUpdatedAt: string;
  capturedAt: string;
  outputValueUsdc: string;
}
export function payoutValuation(
  origin: any,
  dest: any,
  amount: string,
  now = Date.now(),
): PayoutValuation {
  const o = String(origin?.price),
    d = String(dest?.price),
    op = units(o, 12),
    dp = units(d, 12);
  if (op <= 0n || dp <= 0n) throw new Error("Payout FX valuation unavailable.");
  for (const t of [origin?.priceUpdatedAt, dest?.priceUpdatedAt])
    if (
      typeof t !== "string" ||
      !Number.isFinite(Date.parse(t)) ||
      Math.abs(now - Date.parse(t)) > 180000
    )
      throw new Error("Payout FX valuation is stale or unavailable.");
  return {
    source: "1click-token-prices",
    originPrice: o,
    destinationPrice: d,
    originUpdatedAt: origin.priceUpdatedAt,
    destinationUpdatedAt: dest.priceUpdatedAt,
    capturedAt: new Date(now).toISOString(),
    outputValueUsdc: decimal((units(amount) * dp) / op),
  };
}
export function assertFreshValuation(
  v: PayoutValuation | undefined,
  now = Date.now(),
) {
  if (!v) throw new Error("Payout FX valuation unavailable.");
  for (const t of [v.originUpdatedAt, v.destinationUpdatedAt])
    if (
      !Number.isFinite(Date.parse(t)) ||
      Math.abs(now - Date.parse(t)) > 180000
    )
      throw new Error(
        "Payout FX valuation is stale or unavailable. Requote before signing.",
      );
}
export function movingCost(input: string, value: string) {
  const n = units(input) - units(value);
  return decimal(n > 0n ? n : 0n);
}
