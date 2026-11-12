import { ownerPositions } from "./accounts";
import { stressCapacity } from "./credit";
import { lendingPreview } from "./lending-live";
import type { Portfolio } from "./types";
import type { Policy } from "./policy";
/** Example: fictional scenario. Live: Engines lending capacity (real Rhea collateral and debt). */
export async function portfolioCredit(p: Portfolio, policy?: Policy) {
  p = { ...p, positions: ownerPositions(p.positions) };
  if (p.source === "demo" && policy?.creditRows?.length) {
    const rows = policy.creditRows.map((r) => {
      const permission = policy.assetRows?.find((a) => a.asset === r.assetId);
      return {
        ...r,
        eligible: r.eligible && !policy.protectedAssets.includes(r.assetId),
        permissions: r.permissions.filter((x) =>
          permission?.uses.includes(x as any),
        ),
      };
    });
    return {
      ...stressCapacity([
        {
          id: "example-rhea-lst",
          source: "demo",
          capturedAt: new Date().toISOString(),
          existingDebt: "0",
          protocolLimit: "50000",
          liquidity: "50000",
          assets: rows,
        },
      ]),
      fictional: true,
      valuationEvidence:
        "Illustrative LiNEAR/rNEAR values and stress scenario; Rhea collateral flags/7000 volatility ratios checked 2026-11-12. Positions are not currently pledged; no borrowing is prepared.",
    };
  }
  // Engines E2: live capacity comes from the account's real Rhea collateral, debt and asset configs
  // (lending.ts), never from nominal sums here.
  if (p.source !== "live")
    return { capacity: null, reason: "No saved example credit policy.", borrowExecution: false };
  if (!p.accountId)
    return { capacity: null, reason: "No live NEAR account.", borrowExecution: false };
  const { capacity: c } = await lendingPreview(p.accountId, policy);
  return {
    source: "live",
    readOnly: false,
    executable: c.capacityUsdcRaw !== null,
    borrowExecution: c.capacityUsdcRaw !== null,
    capacity: c.capacity,
    capacityUsdcRaw: c.capacityUsdcRaw,
    bindingConstraint: c.bindingConstraint,
    health: c.health,
    stressedHealth: c.stressedHealth,
    minHealth: c.minHealth,
    borrowApr: c.borrowApr,
    collateral: c.collateral,
    debt: c.debt,
    reasons: c.reasons,
    reason: c.capacityUsdcRaw === null ? c.reasons.join(", ") || "Capacity unverified." : null,
    valuationEvidence:
      "Rhea get_account_all_positions + get_assets_paged_detailed (volatility ratios, borrowed_limit, liquidity) and Rhea's Pyth prices; LiNEAR/rNEAR collateral family; owner-signed steps via /api/lending.",
  };
}
