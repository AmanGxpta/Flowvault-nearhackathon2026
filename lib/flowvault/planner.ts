import { ownerPositions } from "./accounts.ts";
import { obligationCash } from "./obligations.ts";
import { carry, decimal, positive, units } from "./money.ts";
import type {
  CashQuote,
  Mandate,
  MarketSnapshot,
  Portfolio,
  Operation,
} from "./types";
export function allocationPlan(
  mandate: Mandate,
  snapshot: MarketSnapshot,
  portfolio: Portfolio,
  now = Date.now(),
) {
  portfolio = { ...portfolio, positions: ownerPositions(portfolio.positions) };
  const totals = portfolio.positions
    .filter((p) => p.asset === "USDC" && p.kind !== "debt")
    .reduce((n, p) => n + units(p.amount), 0n);
  const debt = portfolio.positions
    .filter((p) => p.asset === "USDC" && p.kind === "debt")
    .reduce((n, p) => n + units(p.amount), 0n);
  const reserve = units(mandate.reserve);
  const cash = obligationCash(mandate, now);
  const daysToCash = Math.max(
    0,
    (Date.parse(mandate.cashDate + "T00:00:00Z") - now) / 86400000,
  );
  const remaining = totals - debt - reserve - cash;
  const candidates = snapshot.markets.map((m) => {
    const reasons: string[] = [];
    if (!mandate.approved.includes(m.id))
      reasons.push("Outside your approved strategies");
    if (m.asset !== "USDC")
      reasons.push("NEAR exposure does not match this USDC plan");
    if (!m.available || m.apr === null)
      reasons.push("Current rate or availability is unverified");
    if (m.exitDays === null) reasons.push("Withdrawal timing is unverified");
    else if (m.exitDays + 1 > daysToCash)
      reasons.push("Withdrawal window conflicts with your cash date");
    return { ...m, eligible: reasons.length === 0, reasons };
  });
  const chosen = candidates
    .filter((x) => x.eligible)
    .sort((a, b) => Number(b.apr) - Number(a.apr))[0];
  return {
    total: decimal(totals),
    debt: decimal(debt),
    reserved: decimal(reserve + cash),
    deployable: decimal(remaining > 0n ? remaining : 0n),
    deficit: decimal(remaining < 0n ? -remaining : 0n),
    chosen: chosen?.id ?? null,
    candidates,
    rationale: chosen
      ? `${chosen.name} fits the approved asset and cash window. Any move still needs a current quote and cost check.`
      : "Keep the position unchanged until an eligible strategy fits your mandate.",
    executable: false,
  };
}
export function compareCash(
  amount: string,
  days: number,
  quote: CashQuote,
  market: MarketSnapshot,
  portfolio: Portfolio,
  mandate: Mandate,
  now = Date.now(),
  reservedCash: bigint = units(mandate.reserve),
) {
  portfolio = { ...portfolio, positions: ownerPositions(portfolio.positions) };
  const target = positive(quote.outputValueUsdc ?? amount);
  if (quote.amountOut !== decimal(positive(amount)))
    throw new Error("Quote does not match the requested net payout.");
  if (quote.source !== portfolio.source || market.source !== portfolio.source)
    throw new Error("Live and example evidence cannot be mixed.");
  const funding = positive(quote.maxInput);
  const low = positive(quote.minInput);
  if (funding < low) throw new Error("Invalid quote input bounds.");
  const lending = market.markets.find((x) => x.id === "rhea-usdc");
  const freeRaw =
    portfolio.positions
      .filter(
        (p) =>
          p.asset === "USDC" &&
          p.kind === "wallet" &&
          (!p.chain || p.chain === "near"),
      )
      .reduce((n, p) => n + units(p.amount), 0n) - reservedCash;
  const free = freeRaw > 0n ? freeRaw : 0n;
  const sourceCashKnown = !portfolio.sections?.some(
    (s) => ["near-usdc", "near"].includes(s.id) && s.status !== "observed",
  );
  const capitalNeeded = funding > free ? funding - free : 0n;
  const supply = lending?.apr ? carry(capitalNeeded, lending.apr, days) : null;
  const borrow = lending?.borrowApr
    ? carry(capitalNeeded, lending.borrowApr, days)
    : null;
  const blockers: string[] = sourceCashKnown
    ? []
    : [
        "NEAR wallet USDC is unavailable. Other adapter observations cannot establish source cash.",
      ];
  if (Date.parse(quote.validUntil) <= now)
    blockers.push("This quote has expired. Request a fresh comparison.");
  if (now - Date.parse(market.capturedAt) > 180000)
    blockers.push("Market data is stale. Refresh before reviewing.");
  if (market.source === "live")
    blockers.push(
      "Full protocol, relayer and network costs still require verification.",
    );
  if (!portfolio.accountId && portfolio.source === "live")
    blockers.push("A public account is required to check balances.");
  if (portfolio.errors.length)
    blockers.push(
      "Some account reads failed. A complete balance cannot be inferred.",
    );
  const hasDebt = portfolio.positions.some(
    (p) => p.kind === "debt" && units(p.amount) > 0n,
  );
  let preferred =
    free >= funding
      ? "Use available cash"
      : free > 0n
        ? "Use cash + withdraw"
        : "Withdraw from earning";
  if (supply === null || borrow === null) {
    preferred = "More information needed";
    blockers.push("A comparable supply and borrowing rate is unavailable.");
  } else if (borrow < supply && mandate.borrowing && hasDebt === false)
    preferred = "Borrowing has lower modeled carry";
  if (low - target > units(mandate.maxMoveCost))
    blockers.push(
      "The quoted routing shortfall already exceeds your move-cost limit.",
    );
  const withdrawableObserved =
    portfolio.positions
      .filter(
        (p) => p.asset === "USDC" && ["wallet", "supplied"].includes(p.kind),
      )
      .reduce((n, p) => n + units(p.amount), 0n) - reservedCash;
  if (withdrawableObserved < funding)
    blockers.push(
      "Observed unpledged USDC beyond your reserve does not cover this payout.",
    );
  const borrowBlockers = [
    "Collateral eligibility and health after borrowing are unverified.",
    "A repayment source and exact debt approval are required.",
  ];
  if (!mandate.borrowing)
    borrowBlockers.unshift("Your plan does not allow new borrowing.");
  if (hasDebt)
    borrowBlockers.unshift(
      "Existing debt requires a complete cross-asset health calculation.",
    );
  return {
    amountOut: decimal(positive(amount)),
    cashAvailable: sourceCashKnown ? decimal(free) : null,
    cashAvailableKnownSubtotal: decimal(free),
    capitalNeeded: sourceCashKnown ? decimal(capitalNeeded) : null,
    fundingUpper: quote.maxInput,
    fundingMin: quote.minInput,
    buffer: quote.buffer,
    routingShortfall: decimal(low > target ? low - target : 0n),
    days,
    preferred,
    supplyCarry: !sourceCashKnown || supply === null ? null : decimal(supply),
    borrowCarry: !sourceCashKnown || borrow === null ? null : decimal(borrow),
    extraBorrowCarry:
      supply === null || borrow === null ? null : decimal(borrow - supply),
    blockers,
    borrowBlockers,
    executable: false,
    source: quote.source,
    validUntil: quote.validUntil,
    assumption:
      "Current APR held constant over the horizon; this is a scenario, not a forecast. Funding buffer may be refunded.",
  };
}
export function transition(
  op: Operation,
  state: Operation["state"],
  version: number,
  now = Date.now(),
): Operation {
  if (op.mandateVersion !== version)
    throw new Error("Your plan changed. Generate a fresh proposal.");
  if (Date.parse(op.expiresAt) <= now)
    throw new Error("Proposal expired. Generate a new one.");
  if (op.state !== "draft" || !["reviewed", "cancelled"].includes(state))
    throw new Error("This operation cannot make that transition.");
  return { ...op, state };
}
