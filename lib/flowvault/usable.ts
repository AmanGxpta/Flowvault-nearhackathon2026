import { ownerPositions } from "./accounts.ts";
import { units, decimal } from "./money.ts";
import type { Portfolio, PortfolioSection } from "./types.ts";
import { valuePortfolio, usdcText } from "./valuation.ts";
import type { CapitalReport } from "./valuation.ts";
import type { PriceEvidence } from "./valuation-evidence.ts";
export interface BalanceMetric {
  amount: string | null;
  knownSubtotal: string;
  unit: "USDC";
  source: "demo" | "live";
  capturedAt: string;
  fresh: boolean;
  coverage: "complete" | "partial" | "unknown";
  reasons: string[];
  excludedSections?: { id: string; reasons: string[]; status: string }[];
}
export function usableBalances(
  p: Portfolio,
  dates: string[],
  committed = "0",
  credit: string | null = null,
  now = Date.now(),
  /** Engines evidence: with prices, NEAR/LST exposure is valued; capital adds spendable/holdback/surplus. */
  evidence: { prices?: PriceEvidence | null; capital?: CapitalReport } = {},
) {
  p = { ...p, positions: ownerPositions(p.positions) };
  // Net worth is the shared valuation pass (valuation.ts), never a local sum.
  const value = valuePortfolio(
    p.positions,
    p.source,
    p.source === "live" ? (evidence.prices ?? null) : null,
    p.capturedAt,
    now,
  );
  const fresh =
    Number.isFinite(Date.parse(p.capturedAt)) &&
    Math.abs(now - Date.parse(p.capturedAt)) <= 180000;
  const positionIssues = p.positions.flatMap((x) => [
    ...(x.source && x.source !== p.source
      ? ["Mixed live/example position evidence."]
      : []),
    ...(x.capturedAt &&
    (!Number.isFinite(Date.parse(x.capturedAt)) ||
      Math.abs(now - Date.parse(x.capturedAt)) > 180000)
      ? [x.id + ": position is stale."]
      : []),
  ]);
  const usd = p.positions.filter((x) => x.asset === "USDC");
  const sum = (kind: string[]) =>
    usd
      .filter((x) => kind.includes(x.kind))
      .reduce((n, x) => n + units(x.amount), 0n);
  const all = value.assets - value.debt;
  const reserved = units(committed);
  const wallet = sum(["wallet"]);
  const cash = wallet > reserved ? wallet - reserved : 0n;
  const unvalued = value.unknownValue;
  const metric = (
    n: bigint,
    unknown: string[] = [],
    name: PortfolioSection["affects"][number] = "netWorth",
  ): BalanceMetric => {
    const excludedSections = (p.sections ?? []).filter(
      (s) =>
        ["unavailable", "partial"].includes(s.status) &&
        s.affects.includes(name),
    );
    const reasons = [
      ...excludedSections.flatMap((s) => s.reasons.map((r) => s.id + ": " + r)),
      ...p.errors,
      ...positionIssues,
      ...(!p.positions.length ? ["No position evidence available."] : []),
      ...(!fresh ? ["Snapshot is stale."] : []),
      ...unknown,
    ];
    return {
      amount: reasons.length ? null : decimal(n),
      knownSubtotal: decimal(n),
      unit: "USDC",
      source: p.source,
      capturedAt: p.capturedAt,
      fresh,
      coverage: !p.positions.length
        ? "unknown"
        : reasons.length
          ? "partial"
          : "complete",
      reasons,
      excludedSections: excludedSections.map((s) => ({
        id: s.id,
        status: s.status,
        reasons: s.reasons,
      })),
    };
  };
  const supplied =
    sum(["supplied", "collateral"]) +
    (p.source === "demo"
      ? p.positions
          .filter(
            (x) =>
              x.asset !== "USDC" &&
              x.kind === "staking" &&
              x.valuation?.source === "demo",
          )
          .reduce((n, x) => n + units(x.valuation!.amount), 0n)
      : 0n);
  return {
    scope:
      "Explicitly requested public accounts only; nominal USDC units, not a USD oracle valuation.",
    netWorth: metric(
      all,
      unvalued ? ["Non-USDC exposure has no verified USDC valuation."] : [],
    ),
    excludedSections: (p.sections ?? [])
      .filter((s) => ["unavailable", "partial"].includes(s.status))
      .map((s) => ({
        id: s.id,
        status: s.status,
        reasons: s.reasons,
        amount: null,
        excluded: true,
      })),
    cashNow: metric(cash, [], "cashNow"),
    withdrawableByDate: dates.map((date) => {
      const deadline = Date.parse(date + "T23:59:59.999Z");
      if (!Number.isFinite(deadline))
        throw new Error("Invalid usable-balance date.");
      let n = cash;
      const unknown: string[] = [];
      for (const x of usd.filter((x) => x.kind === "supplied")) {
        if (
          x.availableAt &&
          !x.availabilityIsEstimate &&
          Date.parse(x.availableAt) <= deadline
        )
          n += units(x.amount);
        else unknown.push(`${x.id}: withdrawal timing/liquidity unverified.`);
      }
      if (sum(["collateral"]) > 0n)
        unknown.push(
          "Collateral is not withdrawable without a complete health calculation.",
        );
      return { date, ...metric(n, unknown, "withdrawableByDate") };
    }),
    borrowingHeadroom: {
      ...metric(
        credit === null ? 0n : units(credit),
        credit === null
          ? ["Stress capacity preview has not been evaluated."]
          : [],
        "borrowingHeadroom",
      ),
    },
    committedCapital: metric(supplied + reserved, [], "committedCapital"),
    unvaluedAssets: value.valuations
      .filter((v) => v.kind === "observed" && v.usdcRaw === null)
      .map((v) => ({
        id: v.positionId,
        asset: v.asset,
        amount: p.positions.find((x) => x.id === v.positionId)?.amount ?? "unknown",
        valuation: null,
        reason: v.unavailableReason ?? null,
      })),
    valuations: value.valuations,
    capital: evidence.capital
      ? {
          spendableNow: usdcText(evidence.capital.spendableNowUsdcRaw),
          holdback: usdcText(evidence.capital.holdbackUsdcRaw),
          surplus: usdcText(evidence.capital.surplusUsdcRaw),
          netWorth: usdcText(evidence.capital.netWorthUsdcRaw),
          blocksAutomation: evidence.capital.blocksAutomation,
          reasons: evidence.capital.reasons,
        }
      : null,
    committedInFlight: committed,
  };
}
