import { z } from "zod";
import { units, decimal } from "./money.ts";
const money = z.string().refine((v) => {
  try {
    return units(v) >= 0n;
  } catch {
    return false;
  }
});
const bps = z.number().int().min(0).max(10000);
export const creditRowSchema = z.object({
  assetId: z.string(),
  collateralId: z.string(),
  value: money.nullable(),
  drawdownBps: bps,
  ltvCapBps: bps,
  liquidationThresholdBps: bps.nullable(),
  protocolLtvBps: bps.nullable(),
  minHealth: z.string().refine((v) => {
    try {
      return units(v) >= 1000000n;
    } catch {
      return false;
    }
  }),
  priority: z.enum(["P1", "P2", "P3"]),
  permissions: z.array(
    z.enum(["hold", "sell", "supply", "pledge", "borrow", "fees"]),
  ),
  eligible: z.boolean(),
});
export const creditMarketSchema = z.object({
  id: z.string(),
  source: z.enum(["demo", "live"]),
  capturedAt: z.string(),
  existingDebt: money.nullable(),
  protocolLimit: money.nullable(),
  liquidity: money.nullable(),
  debtRiskBps: bps.optional(),
  assets: z.array(creditRowSchema).max(50),
});
export type CreditMarket = z.infer<typeof creditMarketSchema>;
const display = (n: bigint) => decimal((n + 5000n) / 10000n, 2);
export function stressCapacity(input: CreditMarket[], now = Date.now()) {
  const markets = z.array(creditMarketSchema).max(30).parse(input);
  if (new Set(markets.map((m) => m.source)).size > 1)
    throw new Error("Live and example credit sources cannot be mixed.");
  for (const m of markets)
    if (new Set(m.assets.map((a) => a.collateralId)).size !== m.assets.length)
      throw new Error("Duplicate collateral position inside a market.");
  if (new Set(markets.map((m) => m.id)).size !== markets.length)
    throw new Error("Duplicate credit market ID.");
  // Deterministic global assignment: one collateral position can contribute to only one market.
  const assigned = new Map<string, string>();
  const ranked = markets
    .flatMap((m) => m.assets.map((a) => ({ m: m.id, a })))
    .filter(
      (x) =>
        x.a.eligible &&
        x.a.permissions.includes("pledge") &&
        x.a.permissions.includes("borrow"),
    )
    .sort(
      (x, y) =>
        x.a.priority.localeCompare(y.a.priority) ||
        x.a.assetId.localeCompare(y.a.assetId) ||
        x.m.localeCompare(y.m),
    );
  for (const x of ranked)
    if (!assigned.has(x.a.collateralId)) assigned.set(x.a.collateralId, x.m);
  let total = 0n;
  let unknown = false;
  const results = markets.map((m) => {
    const reasons: string[] = [];
    if (
      !Number.isFinite(Date.parse(m.capturedAt)) ||
      Math.abs(now - Date.parse(m.capturedAt)) > 180000
    )
      reasons.push("STALE_MARKET");
    let cap = 0n,
      health = 0n,
      protocol = 0n;
    const rows = m.assets.map((a) => {
      const excluded = !a.eligible
        ? "INELIGIBLE_COLLATERAL"
        : !a.permissions.includes("pledge") || !a.permissions.includes("borrow")
          ? "PERMISSION_DENIED"
          : assigned.get(a.collateralId) !== m.id
            ? "COLLATERAL_ALREADY_ASSIGNED"
            : null;
      if (excluded)
        return {
          ...a,
          excluded,
          stressedValue: null,
          policyCeiling: null,
          healthCeiling: null,
        };
      if (
        a.value === null ||
        a.liquidationThresholdBps === null ||
        a.protocolLtvBps === null
      ) {
        reasons.push(a.assetId + ": UNKNOWN_VALUATION_OR_PROTOCOL_RULES");
        return {
          ...a,
          excluded: "UNVERIFIED",
          stressedValue: null,
          policyCeiling: null,
          healthCeiling: null,
        };
      }
      const value = units(a.value);
      const stressed = (value * BigInt(10000 - a.drawdownBps)) / 10000n;
      const policy = (stressed * BigInt(a.ltvCapBps)) / 10000n;
      const h =
        (stressed *
          BigInt(a.liquidationThresholdBps) *
          BigInt(m.debtRiskBps ?? 10000) *
          1000000n) /
        (10000n * 10000n * units(a.minHealth));
      cap += policy;
      health += h;
      protocol += (value * BigInt(a.protocolLtvBps)) / 10000n;
      return {
        ...a,
        excluded: null,
        stressedValue: decimal(stressed),
        policyCeiling: decimal(policy),
        healthCeiling: decimal(h),
        healthCeilingDisplay: display(h),
      };
    });
    if (
      m.existingDebt === null ||
      m.protocolLimit === null ||
      m.liquidity === null
    )
      reasons.push("UNKNOWN_DEBT_LIMIT_OR_LIQUIDITY");
    if (reasons.length) {
      unknown = true;
      return {
        id: m.id,
        source: m.source,
        capacity: null,
        capacityDisplay: null,
        bindingConstraint: "unverified",
        reasons,
        rows,
      };
    }
    const debt = units(m.existingDebt!);
    const bounds = [
      ["user_ltv", cap],
      ["stressed_health", health],
      ["protocol_ltv", protocol],
      ["protocol_limit", units(m.protocolLimit!)],
      ["liquidity", units(m.liquidity!) + debt],
    ] as const;
    const binding = [...bounds].sort((a, b) =>
      a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0].localeCompare(b[0]),
    )[0];
    const available = binding[1] > debt ? binding[1] - debt : 0n;
    total += available;
    return {
      id: m.id,
      source: m.source,
      capacity: decimal(available),
      capacityDisplay: display(available),
      bindingConstraint: binding[0],
      existingDebt: m.existingDebt,
      reasons,
      rows,
    };
  });
  return {
    readOnly: true,
    executable: false,
    borrowExecution: false,
    source: markets[0]?.source ?? "demo",
    capacity: unknown ? null : decimal(total),
    capacityDisplay: unknown ? null : display(total),
    knownSubtotal: decimal(total),
    markets: results,
    collateralAssignments: Object.fromEntries(assigned),
    note: "Scenario preview, not credit approval. Capacity is floored in base units; two-decimal display is rounded and must never be used to construct debt.",
  };
}

/** Stress impact is a valuation scenario, never permission to pledge protected capital. */
export function assetStress(
  asset: string,
  value: string | null,
  drawdownBps: number,
) {
  if (!Number.isInteger(drawdownBps) || drawdownBps < 0 || drawdownBps > 10000)
    throw new Error("Invalid stress drawdown.");
  const before = value === null ? null : units(value);
  const stressed =
    before === null ? null : (before * BigInt(10000 - drawdownBps)) / 10000n;
  return {
    asset,
    drawdownBps,
    valueBefore: before === null ? null : decimal(before),
    stressedValue: stressed === null ? null : decimal(stressed),
    loss:
      before === null || stressed === null ? null : decimal(before - stressed),
    readOnly: true,
  };
}
