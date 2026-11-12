import { ownerPositions } from "./accounts";
import { stressCapacity } from "./credit";
import { view, RHEA, USDC } from "./near";
import { availableLiquidity } from "./withdraw";
import { units, decimal } from "./money";
import type { Portfolio } from "./types";
import type { Policy } from "./policy";
/** Read-only, same-asset USDC scenario. Other collateral requires a verified price/risk adapter. */
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
  const settings = policy?.creditRows?.find(
    (x) => x.assetId === USDC || x.assetId === "USDC",
  );
  if (!settings)
    return {
      capacity: null,
      reason: "No saved USDC stress policy.",
      borrowExecution: false,
    };
  if (
    p.errors.length ||
    p.sections?.some(
      (s) => ["rhea", "near"].includes(s.id) && s.status !== "observed",
    )
  )
    return {
      capacity: null,
      reason: "Portfolio coverage/health is incomplete.",
      borrowExecution: false,
    };
  if (p.source === "demo")
    return stressCapacity([
      {
        id: "example-rhea",
        source: "demo",
        capturedAt: new Date().toISOString(),
        existingDebt: "0",
        protocolLimit: "50000",
        liquidity: "50000",
        assets: [settings],
      },
    ]);
  const [r, config, metadata] = await Promise.all([
    view<any[]>(RHEA, "get_assets_paged_detailed", {
      from_index: 0,
      limit: 100,
    }),
    view<any>(RHEA, "get_config"),
    view<any>(USDC, "ft_metadata"),
  ]);
  if (config.data.contract_mode !== "Running" || metadata.data.decimals !== 6)
    return {
      capacity: null,
      reason: "Market not Running or token precision unverified.",
      borrowExecution: false,
    };
  const a = r.data.find((x) => x.token_id === USDC);
  if (!a || a.config?.can_borrow !== true)
    return {
      capacity: null,
      reason: "USDC borrowing configuration unavailable/disabled.",
      borrowExecution: false,
    };
  if (
    !Number.isInteger(a.config.extra_decimals) ||
    a.config.extra_decimals < 0 ||
    a.config.extra_decimals > 32
  )
    return {
      capacity: null,
      reason: "Rhea extra decimals unverified.",
      borrowExecution: false,
    };
  const scale = 10n ** BigInt(a.config.extra_decimals);
  const value = p.positions
    .filter((x) => x.asset === "USDC" && x.kind === "collateral")
    .reduce((n, x) => n + units(x.amount), 0n);
  const debt = p.positions
    .filter((x) => x.asset === "USDC" && x.kind === "debt")
    .reduce((n, x) => n + units(x.amount), 0n);
  const limit = BigInt(a.config.borrowed_limit) - BigInt(a.borrowed.balance);
  const remaining = limit > 0n ? limit / scale : 0n;
  return {
    ...stressCapacity([
      {
        id: "rhea-usdc",
        source: "live",
        capturedAt: new Date().toISOString(),
        existingDebt: decimal(debt),
        protocolLimit: decimal(remaining + debt),
        liquidity: decimal(availableLiquidity(a) / scale),
        debtRiskBps: a.config.volatility_ratio,
        assets: [
          {
            ...settings,
            value: decimal(value),
            collateralId: p.accountId + ":rhea:USDC",
            liquidationThresholdBps: a.config.volatility_ratio,
            protocolLtvBps: 10000,
            eligible: true,
          },
        ],
      },
    ]),
    valuationEvidence:
      "Nominal same-asset USDC collateral/debt only. No independent USD price claim; full borrow execution is disabled.",
  };
}
