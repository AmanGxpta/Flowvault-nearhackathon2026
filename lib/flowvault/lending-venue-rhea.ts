// Rhea compatibility adapter. Existing maths, payloads, policy checks and finalized receipt verifier
// remain authoritative. This boundary does not introduce a second execution or balance engine.
import type { LendingVenueAdapter, LendingVenueSnapshot, VenueAsset } from "./contracts.ts";
import { units } from "./money.ts";
import type { Policy } from "./policy.ts";
import { COLLATERAL_FAMILY, LENDING_USDC, borrowCapacity, borrowFundingChoice, prepareLending, rheaValue } from "./lending.ts";
import type { LendingState, PrepareRequest, LendingPreparation } from "./lending.ts";

const collateral: VenueAsset[] = Object.entries(COLLATERAL_FAMILY).map(([symbol, id]) => ({ id, symbol, decimals: 24, chain: "near" }));
const debt: VenueAsset[] = [{ id: LENDING_USDC, symbol: "USDC", decimals: 6, chain: "near" }];
export function inspectRhea(st: LendingState, policy?: Policy, now = Date.now()): LendingVenueSnapshot {
  const cap = borrowCapacity(st, policy, now);
  // Current capacity uses identical risk/policy bounds with the collateral drawdown removed.
  const current = borrowCapacity(st, policy ? { ...policy, creditRows: policy.creditRows?.map(r => ({ ...r, drawdownBps: 0 })) } : policy, now);
  const assets = [...collateral, ...debt];
  const usdc = st.assets[LENDING_USDC];
  const toRaw = (v: bigint, extra: number, up = false) => {
    const scale = 10n ** BigInt(extra);
    return ((v + (up ? scale - 1n : 0n)) / scale).toString();
  };
  const liquid = usdc ? usdc.suppliedInner + usdc.reservedInner - usdc.borrowedInner : null;
  const reasons = [...cap.reasons];
  return {
    venueId: "rhea:near", accountId: st.accountId, source: st.source, capturedAt: st.capturedAt,
    freshUntil: new Date(Date.parse(st.capturedAt) + 180_000).toISOString(),
    collateralAssets: collateral, debtAssets: debt,
    positions: Object.entries(st.assets).map(([id, a]) => ({
      asset: assets.find(x => x.id === id) ?? { id, symbol: id, decimals: a.decimals, chain: "near" },
      suppliedRaw: toRaw(st.supplied[id] ?? 0n, a.extraDecimals),
      collateralRaw: toRaw(st.collateral[id] ?? 0n, a.extraDecimals),
      liabilityRaw: toRaw(st.borrowed[id] ?? 0n, a.extraDecimals, true),
      walletRaw: st.wallet[id]?.toString() ?? null,
      valueUsdcRaw: rheaValue(id, (st.supplied[id] ?? 0n) + (st.collateral[id] ?? 0n), st, "asset")?.toString() ?? null,
    })),
    pricesAndRisk: Object.entries(st.assets).map(([id, a]) => ({ assetId: id,
      priceUsdcRaw: rheaValue(id, 10n ** BigInt(a.decimals + a.extraDecimals), st, "asset")?.toString() ?? null,
      ltvBps: usdc ? Math.floor(a.volatilityRatio * usdc.volatilityRatio / 10000) : null,
      liquidationThresholdBps: a.volatilityRatio, liquidationBonusBps: null,
    })),
    liquidityUsdcRaw: liquid === null ? null : toRaw(liquid > 0n ? liquid : 0n, usdc.extraDecimals),
    currentCapacityUsdcRaw: current.capacityUsdcRaw, stressedCapacityUsdcRaw: cap.capacityUsdcRaw,
    debtUsdcRaw: cap.healthDetail.unknown.length ? null : cap.healthDetail.debtUsdcRaw,
    health: cap.health, stressedHealth: cap.stressedHealth, minHealth: cap.minHealth, borrowApr: cap.borrowApr,
    interest: { variable: true, accruedIncludedInLiability: true, basis: "Rhea account balances include accrued interest; APR is variable, not a promised cost." },
    liquidation: { exposed: !cap.healthDetail.noDebt, thresholdHealth: "1", reasons: cap.healthDetail.unknown },
    exit: { instant: false, reasons: ["Release requires a fresh stressed-health check, token liquidity and finalized payout; unknown liquidation penalty remains undisclosed."] },
    reasons,
  };
}
export const rheaLendingVenue: LendingVenueAdapter<LendingState, PrepareRequest, LendingPreparation, Policy> = {
  id: "rhea:near", chain: "near", supportedCollateral: collateral, supportedDebt: debt,
  async read(accountId) { return (await import("./lending-live.ts")).readLendingState(accountId); },
  inspect: inspectRhea,
  prepareOperation: prepareLending,
  fundingChoice(st, policy, amount, date, approved, now) { return borrowFundingChoice(borrowCapacity(st, policy, now), amount, date, approved, now); },
  monitor(s) {
    if (s.reasons.length || s.debtUsdcRaw === null) return [{ severity: "warn", reason: "Rhea risk evidence unavailable: " + s.reasons.join(", ") }];
    if (s.stressedHealth !== null && s.stressedHealth !== "no debt" && units(s.stressedHealth) < units(s.minHealth))
      return [{ severity: "urgent", reason: "Rhea stressed health is below policy minimum; review repayment or collateral." }];
    return [];
  },
};
