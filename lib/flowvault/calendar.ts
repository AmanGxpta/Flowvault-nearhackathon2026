import { ownerPositions } from "./accounts.ts";
import { positive } from "./money.ts";
import { units, decimal, carry } from "./money.ts";
import { holdback } from "./obligations.ts";
import type { Mandate, MarketSnapshot, Portfolio } from "./types.ts";
export interface StrategyCosts {
  entryCost: string | null;
  exitCost: string | null;
  liquidity: string | null;
}
export function calendarRanking(
  m: Mandate,
  market: MarketSnapshot,
  p: Portfolio,
  costs: Record<string, StrategyCosts> = {},
  now = Date.now(),
  options: { amount?: string } = {},
) {
  p = { ...p, positions: ownerPositions(p.positions) };
  if (market.source !== p.source)
    throw new Error("Live and example strategy evidence cannot be mixed.");
  const wallet = p.positions
    .filter(
      (x) =>
        x.asset === "USDC" &&
        x.kind === "wallet" &&
        (!x.chain || x.chain === "near"),
    )
    .reduce((n, x) => n + units(x.amount), 0n);
  let protectedAmount: bigint | null;
  try {
    protectedAmount = holdback(m, now);
  } catch {
    protectedAmount = null;
  }
  const availableSurplus =
    protectedAmount !== null && wallet > protectedAmount
      ? wallet - protectedAmount
      : 0n;
  const principal =
    options.amount === undefined ? availableSurplus : positive(options.amount);
  const due = (m.obligations ?? [])
    .filter((o) => !["paid", "cancelled"].includes(o.status))
    .map((o) => ({ id: o.id, dueDate: o.dueDate }))
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
    );
  if (!due.length)
    due.push({
      id: "horizon",
      dueDate: new Date(now + m.horizon * 86400000).toISOString().slice(0, 10),
    });
  const stale =
    !Number.isFinite(Date.parse(market.capturedAt)) ||
    Math.abs(now - Date.parse(market.capturedAt)) > 180000;
  const strategies = market.markets.map((s) => {
    const c =
      costs[s.id] ??
      (market.source === "demo"
        ? { entryCost: "0", exitCost: "0", liquidity: "1000000" }
        : { entryCost: null, exitCost: null, liquidity: null });
    const validAmount = (value: string | null) => {
      try {
        return value !== null && units(value) >= 0n;
      } catch {
        return false;
      }
    };
    const exitKnown =
      s.exitDays !== null && Number.isFinite(s.exitDays) && s.exitDays >= 0;
    let rateKnown = false;
    try {
      rateKnown = s.apr !== null && units(s.apr, 12) >= 0n;
    } catch {
      /* unknown rate */
    }
    const costKnown = validAmount(c.entryCost) && validAmount(c.exitCost);
    const reasons: string[] = [];
    if (principal > availableSurplus) reasons.push("AMOUNT_EXCEEDS_SURPLUS");
    if (
      !Number.isFinite(Date.parse(p.capturedAt)) ||
      Math.abs(now - Date.parse(p.capturedAt)) > 180000
    )
      reasons.push("STALE_PORTFOLIO");
    if (!m.approved.includes(s.id)) reasons.push("VENUE_NOT_APPROVED");
    if (s.asset !== "USDC") reasons.push("ASSET_MISMATCH");
    if (!s.available || !rateKnown)
      reasons.push("RATE_OR_AVAILABILITY_UNVERIFIED");
    if (stale) reasons.push("STALE_MARKET");
    if (p.errors.length) reasons.push("PORTFOLIO_COVERAGE_INCOMPLETE");
    if (protectedAmount === null) reasons.push("OBLIGATION_VALUATION_UNKNOWN");
    if (principal === 0n) reasons.push("NO_SURPLUS");
    if (!exitKnown) reasons.push("EXIT_WINDOW_UNKNOWN");
    if (!costKnown) reasons.push("COSTS_UNVERIFIED");
    if (!validAmount(c.liquidity)) reasons.push("EXIT_LIQUIDITY_UNVERIFIED");
    else if (units(c.liquidity!) < principal)
      reasons.push("INSUFFICIENT_EXIT_LIQUIDITY");
    const dates = due.map((d) => {
      const remaining = Date.parse(d.dueDate + "T23:59:59.999Z") - now;
      const days = Math.max(0, Math.floor(remaining / 86400000));
      const exclusions = [...reasons];
      if (!Number.isFinite(remaining) || days > 3650)
        exclusions.push("HORIZON_UNSUPPORTED");
      if (remaining <= 0) exclusions.push("DEADLINE_PASSED");
      if (
        exitKnown &&
        (s.exitDays! + (s.family === "staking" ? (m.leadDays ?? 1) : 1)) *
          86400000 >
          remaining
      )
        exclusions.push("EXIT_MISSES_DUE_DATE");
      const earningDays =
        !exitKnown || !Number.isFinite(days) || days > 3650
          ? null
          : Math.max(0, days - Math.ceil(s.exitDays!));
      const earned =
        !rateKnown || earningDays === null
          ? null
          : earningDays
            ? carry(principal, s.apr!, earningDays)
            : 0n;
      const net =
        earned === null || !costKnown
          ? null
          : earned - units(c.entryCost!) - units(c.exitCost!);
      if (net !== null && net <= 0n)
        exclusions.push("NO_NET_ADVANTAGE_OVER_LIQUID");
      return {
        obligationId: d.id,
        dueDate: d.dueDate,
        days,
        earningDays,
        grossEarnings: earned === null ? null : decimal(earned),
        entryCost: c.entryCost,
        exitCost: c.exitCost,
        netEarnings: net === null ? null : decimal(net),
        stayingLiquidEarnings: "0",
        eligible: !exclusions.length,
        exclusions,
      };
    });
    return {
      id: s.id,
      name: s.name,
      asset: s.asset,
      source: market.source,
      principal: decimal(principal),
      eligible: dates.every((d) => d.eligible),
      reasons: [...new Set(dates.flatMap((d) => d.exclusions))],
      dates,
      gettingThisBack: {
        exitDays: s.exitDays,
        liquidity: c.liquidity,
        entryCost: c.entryCost,
        exitCost: c.exitCost,
        guaranteed: false,
        note:
          market.source === "demo"
            ? "Fictional exit/cost scenario."
            : "Live exit timing and costs require verified evidence; an APR is not an exit guarantee.",
      },
    };
  });
  const eligible = strategies
    .filter((s) => s.eligible)
    .sort((a, b) => {
      const av = units(a.dates[0].netEarnings!),
        bv = units(b.dates[0].netEarnings!);
      return av > bv ? -1 : av < bv ? 1 : a.id.localeCompare(b.id);
    });
  return {
    source: market.source,
    fictional: market.source === "demo",
    capturedAt: market.capturedAt,
    holdback: protectedAmount === null ? null : decimal(protectedAmount),
    surplus: decimal(availableSurplus),
    comparisonAmount: decimal(principal),
    leadDays: m.leadDays ?? 1,
    chosen: eligible[0]?.id ?? null,
    strategies,
    baseline: "Stay liquid: zero modeled earnings and no entry/exit costs.",
    executable: false,
  };
}
