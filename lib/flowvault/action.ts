import { ownerPositions } from "./accounts.ts";
import { calendarRanking } from "./calendar.ts";
import { holdback as planHoldback } from "./obligations.ts";
import { units, decimal } from "./money.ts";
import type { Mandate, MarketSnapshot, Portfolio } from "./types";

/** Exact USDC text with thousands separators; no float rounding. */
export function usdc(value: bigint): string {
  const [whole, frac] = decimal(value).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
}
/** Smallest move worth recommending (1 USDC); dust is never suggested. */
const MINIMUM_MOVE = 1_000_000n;
/** Planner reasons that a manual, liquidity-acknowledged Rhea supply may still proceed with. */
const ACKNOWLEDGEABLE = new Set(["Withdrawal timing is unverified"]);

export type NextAction =
  | {
      kind: "supply";
      amount: string;
      title: string;
      detail: string;
      caveats: string[];
    }
  | {
      kind: "withdraw";
      amount: string;
      shortfall: string;
      title: string;
      detail: string;
      caveats: string[];
    }
  | {
      kind: "plan" | "manage" | "none";
      title: string;
      detail: string;
      caveats: string[];
    };

/**
 * The single recommended next step for the cash plan. A recommendation only: it never prepares,
 * signs or submits anything. The wallet must keep reserve + cash need in USDC; surplus beyond that
 * may go to Rhea, and a shortfall is restored from Rhea supply first.
 */
export function nextAction(
  mandate: Mandate,
  market: MarketSnapshot,
  portfolio: Portfolio,
  now = Date.now(),
): NextAction {
  portfolio = { ...portfolio, positions: ownerPositions(portfolio.positions) };
  const requiredSections = (portfolio.sections ?? []).filter(
    (s) =>
      ["near-usdc", "rhea", "near"].includes(s.id) && s.status !== "observed",
  );
  if (portfolio.errors.length || requiredSections.length)
    return {
      kind: "none",
      title: "Balances are unavailable",
      detail: "No step is recommended until your balances are read.",
      caveats: requiredSections.flatMap((s) =>
        s.reasons.map((r) => s.id + ": " + r),
      ),
    };
  if (portfolio.source !== market.source)
    return {
      kind: "none",
      title: "Portfolio and market sources differ",
      detail: "Refresh matching live or example evidence before planning.",
      caveats: [],
    };
  if (
    portfolio.source === "live" &&
    (!Number.isFinite(Date.parse(portfolio.capturedAt)) ||
      Math.abs(now - Date.parse(portfolio.capturedAt)) > 180000)
  )
    return {
      kind: "none",
      title: "Refresh your balances",
      detail: "Stale balances cannot establish a safe next action.",
      caveats: [],
    };
  const calendar = mandate.obligations
    ? calendarRanking(mandate, market, portfolio, {}, now)
    : null;
  const rows = portfolio.positions.filter((p) => p.asset === "USDC");
  const sum = (filter: (p: (typeof rows)[number]) => boolean) =>
    rows.filter(filter).reduce((n, p) => n + units(p.amount), 0n);
  const wallet = sum(
    (p) => p.kind === "wallet" && (!p.chain || p.chain === "near"),
  );
  const rhea = sum((p) => p.kind === "supplied" && p.id.startsWith("rhea"));
  const encumbered = sum((p) => p.kind === "debt" || p.kind === "collateral");
  const holdback = planHoldback(mandate, now);
  const caveats =
    (portfolio.sections ?? []).some((s) => s.status === "unavailable") ||
    portfolio.errors.length
      ? ["Some balance reads failed; this step uses only what was read."]
      : [];
  const by = new Date(mandate.cashDate + "T12:00:00").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
  if (encumbered > 0n)
    return {
      kind: "manage",
      title: "Manage collateral or debt on Rhea",
      detail:
        "This account has Rhea collateral or debt. Its health is unverified here, so FlowVault does not recommend a move.",
      caveats,
    };

  const shortfall = holdback - wallet;
  if (shortfall > 0n) {
    if (rhea === 0n)
      return {
        kind: "none",
        title: "Your wallet is below your plan",
        detail: `You need ${usdc(shortfall)} more USDC in your wallet for your reserve and the ${by} cash need, and there is no Rhea supply to withdraw from. Add USDC or edit your cash plan.`,
        caveats,
      };
    const amount = shortfall < rhea ? shortfall : rhea;
    const residual = shortfall - amount;
    return {
      kind: "withdraw",
      amount: decimal(amount),
      shortfall: decimal(shortfall),
      title: `Withdraw ${usdc(amount)} USDC to restore your reserve before ${by}`,
      detail: `Your wallet holds ${usdc(wallet)} USDC against a ${usdc(holdback)} USDC reserve plus cash need.`,
      caveats: [
        ...caveats,
        ...(residual > 0n
          ? [
              `Even after this withdrawal, ${usdc(residual)} USDC is still missing.`,
            ]
          : []),
        "Withdrawal depends on Rhea's available liquidity at approval time.",
      ],
    };
  }

  const surplus = wallet - holdback;
  if (surplus < MINIMUM_MOVE)
    return {
      kind: "none",
      title: "Nothing to do",
      detail: `Your wallet covers your reserve and the ${by} cash need, and there is no surplus worth moving.`,
      caveats,
    };
  if (!mandate.approved.includes("rhea-usdc"))
    return {
      kind: "plan",
      title: `Approve Rhea Lending to put ${usdc(surplus)} USDC to work`,
      detail:
        "Your reserve and cash need are covered. No approved strategy can take the surplus yet.",
      caveats,
    };
  const rheaMarket = market.markets.find((m) => m.id === "rhea-usdc");
  const reasons = rheaMarket
    ? planReasons(mandate, rheaMarket, now)
    : ["Rhea Lending was not returned"];
  const blocking = reasons.filter((r) => !ACKNOWLEDGEABLE.has(r));
  const calendarBlockers =
    calendar?.strategies.find((s) => s.id === "rhea-usdc")?.reasons ?? [];
  if (calendarBlockers.length)
    return {
      kind: "none",
      title: "Review the earning and exit plan first",
      detail:
        "The calendar does not establish a net advantage for this supply: " +
        calendarBlockers.join("; "),
      caveats: [
        ...caveats,
        "Manual supply is a separate owner-reviewed action, not an automated recommendation.",
      ],
    };
  if (blocking.length)
    return {
      kind: "none",
      title: "Nothing to do right now",
      detail: `${usdc(surplus)} USDC is above your plan, but Rhea Lending does not fit yet: ${blocking.join("; ")}.`,
      caveats,
    };
  return {
    kind: "supply",
    amount: decimal(surplus),
    title: `Supply ${usdc(surplus)} surplus USDC to Rhea`,
    detail: `Keeps ${usdc(holdback)} USDC in your wallet for your reserve and the ${by} cash need.`,
    caveats: [
      ...caveats,
      ...(
        calendar?.strategies.find((s) => s.id === "rhea-usdc")?.reasons ?? []
      ).map((r) => "Calendar estimate: " + r),
      ...reasons.map((r) =>
        r === "Withdrawal timing is unverified"
          ? "Withdrawal timing is unverified and depends on liquidity; you acknowledge this before approving."
          : r,
      ),
    ],
  };
}

function planReasons(
  mandate: Mandate,
  m: MarketSnapshot["markets"][number],
  now: number,
) {
  const reasons: string[] = [];
  if (!m.available || m.apr === null)
    reasons.push("its current rate or availability is unverified");
  const daysToCash = Math.max(
    0,
    (Date.parse(mandate.cashDate + "T23:59:59.999Z") - now) / 86400000,
  );
  if (m.exitDays === null) reasons.push("Withdrawal timing is unverified");
  else if (
    m.exitDays + (m.family === "staking" ? (mandate.leadDays ?? 1) : 1) >
    daysToCash
  )
    reasons.push("its withdrawal window conflicts with your cash date");
  return reasons;
}
