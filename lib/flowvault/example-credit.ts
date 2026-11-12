import type { CreditMarket } from "./credit.ts";
/** Illustrative valuations/stress choices; Rhea collateral eligibility verified 2026-11-12. Not deposited collateral. */
export function exampleCreditRows(): CreditMarket["assets"] {
  return [
    {
      assetId: "LiNEAR",
      collateralId: "linear-shares",
      value: "207.36",
      drawdownBps: 6000,
      ltvCapBps: 5000,
      liquidationThresholdBps: 7000,
      protocolLtvBps: 7000,
      minHealth: "1.5",
      priority: "P3",
      permissions: ["hold", "pledge", "borrow"],
      eligible: true,
    },
    {
      assetId: "rNEAR",
      collateralId: "rnear-shares",
      value: "84.8",
      drawdownBps: 6000,
      ltvCapBps: 5000,
      liquidationThresholdBps: 7000,
      protocolLtvBps: 7000,
      minHealth: "1.5",
      priority: "P3",
      permissions: ["hold", "pledge", "borrow"],
      eligible: true,
    },
  ];
}
