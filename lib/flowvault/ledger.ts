// Engines E3: the ledger and the period statement. Pure functions over journal records only: confirmed
// wallet attempts (finalized-receipt verification), payment plans (destination-chain proof), and the plan
// ledger outbox (StepAdapter.check results). Nothing is inferred from UI state. Principal moves are
// internal (net worth unchanged); a borrow adds a matching liability; a repay removes it. Yield and
// interest are booked only where evidence exists; forecasts are kept apart and never counted as realized.
import type { LedgerEntry, LedgerKind } from "./contracts";
import type { Source } from "./types";
import type { WalletAttempt } from "./execution";
import type { LendingPreparation } from "./lending";
import type { PaymentPlan } from "./payments";
import type { PriceEvidence } from "./valuation-evidence";
import { usdcValue } from "./valuation.ts";
import { decimal, units } from "./money.ts";

const LENDING = new Set(["collateral_add", "borrow", "repay", "collateral_release"]);
const STAKING: Record<string, LedgerKind> = {
  stake: "position_entry",
  unstake: "internal_transfer",
  withdraw_unstaked: "position_exit",
};
const PAID = "paid";
const big = (v: string | null | undefined) => (v && /^-?\d+$/.test(v) ? BigInt(v) : null);

/** Canonical identity: the same economic effect seen by the journal and by a plan step is one entry. */
export function ledgerKey(e: Pick<LedgerEntry, "id" | "attemptId" | "kind" | "asset">) {
  // Asset is part of the identity: a deposit's NEAR gas and its payment's USDC route cost are both fees.
  return e.attemptId ? `${e.attemptId}:${e.kind}:${e.asset}` : e.id;
}

function confirmedAt(a: WalletAttempt) {
  const step = [...(a.timeline ?? [])].reverse().find((s) => s.phase.startsWith("receipt:") && s.status === "confirmed");
  return step?.at ?? a.updatedAt;
}

/** NEAR gas burnt, from verified finalized outcomes (one per hash, last observation wins). */
export function gasBurnt(a: WalletAttempt): { yocto: bigint; complete: boolean } {
  const perHash = new Map<string, { amount: string | null; verified: boolean }>();
  for (const s of a.timeline ?? [])
    if (s.phase.startsWith("receipt:"))
      for (const f of s.fees) if (f.unit === "yoctoNEAR") perHash.set(s.phase, f);
  let yocto = 0n,
    complete = perHash.size > 0 && perHash.size >= a.hashes.length;
  for (const f of perHash.values()) {
    if (!f.verified || f.amount === null || !/^\d+$/.test(f.amount)) complete = false;
    else yocto += BigInt(f.amount);
  }
  return { yocto, complete };
}

function nearUsdc(yocto: bigint, prices: PriceEvidence | null) {
  if (!prices) return null;
  try {
    // A cost uses the oracle upper bound. Valued at the current price, not the price at the time.
    return usdcValue(yocto, 24, "NEAR", prices, "liability");
  } catch {
    return null;
  }
}

function base(a: WalletAttempt, source: Source) {
  return {
    at: confirmedAt(a),
    chain: "near" as const,
    attemptId: a.id,
    txHashes: a.hashes,
    source,
    realized: true,
  };
}

/** Entries for one wallet attempt. Confirmed → confirmed entries; submitted → pending; unknown/partial →
 * unresolved (visible, never counted). Prepared/failed attempts moved nothing and produce no principal entry. */
export function attemptLedger(a: WalletAttempt, prices: PriceEvidence | null, source: Source = "live"): LedgerEntry[] {
  const status: LedgerEntry["status"] | null =
    a.state === "confirmed" ? "confirmed" : a.state === "submitted" ? "pending" : a.state === "unknown" || a.state === "partial" ? "unresolved" : null;
  const out: LedgerEntry[] = [];
  const b = base(a, source);
  const counted = status === "confirmed";
  const principal = (e: Omit<LedgerEntry, "at" | "chain" | "attemptId" | "txHashes" | "source" | "realized" | "status" | "id">) =>
    out.push({ ...b, ...e, id: `${a.id}:${e.kind}`, status: status!, netWorthEffectUsdcRaw: counted ? e.netWorthEffectUsdcRaw : null, liabilityEffectUsdcRaw: counted ? e.liabilityEffectUsdcRaw : null });
  if (status) {
    if (a.kind === "supply" || a.kind === "withdraw") {
      const raw = units(a.amount).toString();
      principal({
        kind: "internal_transfer", asset: "USDC", amountRaw: raw, decimals: 6, usdcRaw: raw,
        netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: "0", positionId: "rhea-usdc",
        basis: a.kind === "supply" ? "Rhea USDC supply verified from finalized receipts" : "Rhea USDC withdrawal verified from the native USDC payout event",
      });
    } else if (LENDING.has(a.kind)) {
      const p = a.preparation as LendingPreparation;
      const usdc = p.asset === "USDC" ? p.amountRaw : p.usdcValueRaw;
      const kind: LedgerKind = a.kind === "borrow" ? "borrow" : a.kind === "repay" ? "repay" : "internal_transfer";
      principal({
        kind, asset: p.asset, amountRaw: p.amountRaw, decimals: p.decimals, usdcRaw: usdc, positionId: "rhea:" + p.tokenId,
        netWorthEffectUsdcRaw: "0",
        liabilityEffectUsdcRaw: kind === "borrow" ? p.amountRaw : kind === "repay" ? "-" + p.amountRaw : "0",
        basis:
          kind === "borrow" ? "Rhea borrow + USDC payout verified from finalized receipts"
          : kind === "repay" ? "Rhea repay verified from finalized receipts; covers accrued interest first, any excess stays supplied"
          : a.kind === "collateral_add" ? "Rhea increase_collateral verified from finalized receipts" : "Rhea decrease_collateral and payout verified from finalized receipts",
      });
    } else if (a.kind in STAKING) {
      const p = a.preparation as unknown as { asset: string; amountRaw: string; decimals: number; usdcValueRaw?: string };
      principal({
        kind: STAKING[a.kind], asset: p.asset, amountRaw: p.amountRaw, decimals: p.decimals, usdcRaw: p.usdcValueRaw ?? null,
        netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: "0", positionId: p.asset === "LiNEAR" || a.kind !== "stake" ? "linear" : "native",
        basis: `Staking ${a.kind} verified from finalized receipts (principal moves between NEAR and the staked position)`,
      });
    }
    // 'pay' deposits are booked from the payment journal (destination proof), not from the deposit.
  }
  // Gas actually burnt is a realized cost whenever a signed transaction executed, whatever its outcome.
  if (a.hashes.length && (status === "confirmed" || a.state === "failed" || a.state === "partial")) {
    const gas = gasBurnt(a);
    if (gas.yocto > 0n) {
      const usdc = nearUsdc(gas.yocto, prices);
      out.push({
        ...b, id: `${a.id}:fee`, kind: "fee", asset: "NEAR", amountRaw: gas.yocto.toString(), decimals: 24,
        usdcRaw: usdc === null ? null : usdc.toString(), netWorthEffectUsdcRaw: usdc === null ? null : (-usdc).toString(),
        liabilityEffectUsdcRaw: "0", status: gas.complete ? "confirmed" : "unresolved",
        basis: "NEAR gas burnt from verified finalized outcomes" + (usdc === null ? "; USDC value unavailable" : "; valued at the current Rhea Pyth price (upper bound)"),
      });
    }
  }
  return out;
}

/** Entries for one payment plan: payment_out on destination proof, the route cost when it is separable,
 * and a provider-reported refund (unresolved until the source side proves it). */
export function paymentLedger(p: PaymentPlan, deposit?: WalletAttempt, source: Source = "live"): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  // USDC actually sent is the verified deposit; the quote's amountIn only stands in when it matches.
  const deposited = deposit?.state === "confirmed" ? units(deposit.amount) : null;
  const sentRaw = deposited ?? big(p.retainedSignedQuote?.quote?.amountIn ?? null);
  const proof = p.destinationProof as { amount?: string; decimals?: number; transactionHash?: string; timestamp?: string } | undefined;
  const at = p.updatedAt;
  const link = { attemptId: p.depositAttemptId, source, chain: p.obligationSnapshot.destination, txHashes: [...(proof?.transactionHash ? [proof.transactionHash] : []), ...p.hashes] };
  if (p.state === PAID && proof?.amount && /^\d+$/.test(proof.amount)) {
    const outRaw = BigInt(proof.amount);
    const dec = Number(proof.decimals ?? 6);
    // The payout's USDC value: a USDC payout is face value; a USDT payout uses the route's own valuation.
    const valueRaw =
      p.obligationSnapshot.token === "USDC" && dec === 6 ? outRaw
      : p.outputValueUsdc ? units(p.outputValueUsdc) : null;
    const cost = sentRaw !== null && valueRaw !== null && sentRaw >= valueRaw ? sentRaw - valueRaw : null;
    out.push({
      ...link, id: `${p.id}:payment_out`, at, kind: "payment_out", asset: p.obligationSnapshot.token, amountRaw: outRaw.toString(), decimals: dec,
      usdcRaw: (valueRaw ?? sentRaw)?.toString() ?? null,
      netWorthEffectUsdcRaw: cost !== null ? (-valueRaw!).toString() : sentRaw !== null ? (-sentRaw).toString() : null,
      liabilityEffectUsdcRaw: "0", realized: true, status: "confirmed",
      basis: "Exact payout verified from a finalized destination-chain receipt" + (cost === null && sentRaw !== null ? "; includes the route cost (not separable)" : ""),
    });
    if (cost !== null && cost > 0n)
      out.push({
        ...link, id: `${p.id}:fee`, at, kind: "fee", asset: "USDC", amountRaw: cost.toString(), decimals: 6, usdcRaw: cost.toString(),
        netWorthEffectUsdcRaw: (-cost).toString(), liabilityEffectUsdcRaw: "0", realized: true, status: "confirmed",
        basis: "1Click route cost: USDC deposited minus the USDC value of the verified payout",
      });
  } else if (deposited !== null && !["paid", "refunded", "failed", "cancelled"].includes(p.state)) {
    out.push({
      ...link, id: `${p.id}:payment_out`, at, kind: "payment_out", asset: p.obligationSnapshot.token, amountRaw: units(p.obligationSnapshot.amount).toString(),
      decimals: 6, usdcRaw: deposited.toString(), netWorthEffectUsdcRaw: null, liabilityEffectUsdcRaw: "0", realized: false, status: "pending",
      basis: "Payment in flight; booked when the destination receipt is verified",
    });
  }
  const refund = [...(p.timeline ?? [])].reverse().find((s) => s.refund)?.refund as { reportedAmount?: string; sourceProofVerified?: boolean } | undefined;
  if (refund?.reportedAmount && /^\d+$/.test(refund.reportedAmount))
    out.push({
      ...link, id: `${p.id}:refund`, at, kind: "refund", asset: "USDC", amountRaw: refund.reportedAmount, decimals: 6, usdcRaw: refund.reportedAmount,
      netWorthEffectUsdcRaw: refund.sourceProofVerified ? "0" : null, liabilityEffectUsdcRaw: "0", realized: !!refund.sourceProofVerified,
      status: refund.sourceProofVerified ? "confirmed" : "unresolved",
      basis: refund.sourceProofVerified ? "Refund verified on the source chain" : "Provider-reported refund; not yet proven on the source chain",
    });
  else if (deposited !== null && ["refunded", "failed", "deadline-passed"].includes(p.state))
    out.push({
      ...link, id: `${p.id}:refund`, at, kind: "refund", asset: "USDC", amountRaw: deposited.toString(), decimals: 6, usdcRaw: null,
      netWorthEffectUsdcRaw: null, liabilityEffectUsdcRaw: "0", realized: false, status: "unresolved",
      basis: `Deposit confirmed but the payment is ${p.state}; refund amount not yet reported or proven`,
    });
  return out;
}

export interface LedgerInputs {
  source: Source;
  accountId: string | null;
  attempts: WalletAttempt[];
  payments: PaymentPlan[];
  outbox: LedgerEntry[];
  prices: PriceEvidence | null;
}

/** One ledger: journal entries first; plan-outbox entries for the same effect only add plan/step links. */
export function buildLedger(i: LedgerInputs): LedgerEntry[] {
  const byKey = new Map<string, LedgerEntry>();
  const scoped = <T extends { accountId?: string }>(x: T) => !i.accountId || !x.accountId || x.accountId === i.accountId;
  for (const a of i.attempts.filter(scoped)) for (const e of attemptLedger(a, i.prices, i.source)) byKey.set(ledgerKey(e), e);
  for (const p of i.payments.filter(scoped))
    for (const e of paymentLedger(p, i.attempts.find((a) => a.id === p.depositAttemptId), i.source)) byKey.set(ledgerKey(e), e);
  for (const e of i.outbox) {
    if (e.source !== i.source) continue;
    const k = ledgerKey(e);
    const known = byKey.get(k);
    if (known) byKey.set(k, { ...known, planId: known.planId ?? e.planId, stepId: known.stepId ?? e.stepId, positionId: known.positionId ?? e.positionId });
    else byKey.set(k, e);
  }
  return [...byKey.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.id < y.id ? -1 : 1));
}

/* ───────────── evidence-based accrual and forecast ───────────── */

export interface LendingObservation {
  /** Live USDC debt now (native raw, rounded up) and Rhea's borrow APR (decimal fraction text). */
  debtUsdcRaw: string | null;
  borrowApr: string | null;
  suppliedUsdcRaw: string | null;
  supplyApr: string | null;
  capturedAt: string;
  error?: string;
}

/** Journaled borrow principal minus repays. Accrued interest = observed debt − principal, only when the
 * first journaled borrow proves the debt was zero before it and no repay could have paid interest down. */
export function accruedInterest(entries: LedgerEntry[], attempts: WalletAttempt[], obs: LendingObservation | null, now: string): LedgerEntry | null {
  const borrows = entries.filter((e) => e.kind === "borrow" && e.status === "confirmed");
  if (!borrows.length || !obs?.debtUsdcRaw) return null;
  const first = attempts.find((a) => a.id === borrows[0].attemptId);
  if ((first?.preparation as LendingPreparation | undefined)?.debtBeforeUsdcRaw !== "0") return null;
  if (entries.some((e) => e.kind === "repay" && e.status === "confirmed")) return null;
  const principal = borrows.reduce((n, e) => n + BigInt(e.amountRaw), 0n);
  const accrued = BigInt(obs.debtUsdcRaw) - principal;
  if (accrued <= 0n) return null;
  return {
    id: "rhea-usdc-debt:interest:" + obs.capturedAt, at: now, kind: "interest", asset: "USDC", chain: "near",
    amountRaw: accrued.toString(), decimals: 6, usdcRaw: accrued.toString(), netWorthEffectUsdcRaw: (-accrued).toString(),
    liabilityEffectUsdcRaw: accrued.toString(), realized: false, status: "confirmed", positionId: "rhea:USDC-debt", txHashes: [],
    source: "live", basis: `Accrued, unpaid: observed Rhea USDC debt at ${obs.capturedAt} minus journaled principal (debt was 0 before the first journaled borrow)`,
  };
}

const YEAR_MS = 365 * 86_400_000;
/** Forecasts at today's variable APR; never realized, never in the realized totals. */
export function forecastEntries(obs: LendingObservation | null, days: number, now: number): LedgerEntry[] {
  if (!obs) return [];
  const out: LedgerEntry[] = [];
  const at = new Date(now + days * 86_400_000).toISOString();
  const accrue = (raw: string | null, apr: string | null) => {
    if (!raw || !apr || !/^\d+(\.\d+)?$/.test(apr)) return null;
    const aprE12 = units(apr.replace(/(\.\d{12})\d+$/, "$1"), 12);
    return (BigInt(raw) * aprE12 * BigInt(days * 86_400_000)) / (10n ** 12n * BigInt(YEAR_MS));
  };
  const y = accrue(obs.suppliedUsdcRaw, obs.supplyApr);
  if (y !== null && y > 0n)
    out.push({
      id: "forecast:rhea-usdc:yield", at, kind: "yield", asset: "USDC", chain: "near", amountRaw: y.toString(), decimals: 6, usdcRaw: y.toString(),
      netWorthEffectUsdcRaw: y.toString(), liabilityEffectUsdcRaw: "0", realized: false, status: "pending", positionId: "rhea-usdc", txHashes: [],
      source: "live", basis: `Forecast: ${days} days on supplied USDC at today's variable supply APR ${obs.supplyApr} (not guaranteed)`,
    });
  const i = accrue(obs.debtUsdcRaw, obs.borrowApr);
  if (i !== null && i > 0n)
    out.push({
      id: "forecast:rhea-usdc:interest", at, kind: "interest", asset: "USDC", chain: "near", amountRaw: i.toString(), decimals: 6, usdcRaw: i.toString(),
      netWorthEffectUsdcRaw: (-i).toString(), liabilityEffectUsdcRaw: i.toString(), realized: false, status: "pending", positionId: "rhea:USDC-debt", txHashes: [],
      source: "live", basis: `Forecast: ${days} days on USDC debt at today's variable borrow APR ${obs.borrowApr}`,
    });
  return out;
}

/* ───────────── statement ───────────── */

/** usdcRaw is null when any entry is unpriced (fail closed); pricedUsdcRaw is the partial sum. */
type Sum = { usdcRaw: string | null; pricedUsdcRaw: string; count: number; unpriced: number };
function total(entries: LedgerEntry[], pick: (e: LedgerEntry) => string | null): Sum {
  let n = 0n,
    unpriced = 0;
  for (const e of entries) {
    const v = big(pick(e));
    if (v === null) unpriced++;
    else n += v;
  }
  return { usdcRaw: unpriced ? null : n.toString(), pricedUsdcRaw: n.toString(), count: entries.length, unpriced };
}
const abs = (e: LedgerEntry) => (e.usdcRaw && e.usdcRaw.startsWith("-") ? e.usdcRaw.slice(1) : e.usdcRaw);

export interface StatementObligation {
  id: string;
  dueDate: string;
  token: string;
  amount: string;
  reservedUsdcRaw: string | null;
  unavailableReason?: string;
}

export interface Statement {
  source: Source;
  fictional: boolean;
  accountId: string | null;
  period: { from: string; to: string };
  generatedAt: string;
  /** What happened to my capital: realized net-worth effect and the moves behind it. */
  capital: {
    netWorthEffect: Sum;
    internalMoves: Sum;
    positionEntries: Sum;
    positionExits: Sum;
    paymentsOut: Sum;
    note: string;
  };
  /** What it cost. */
  cost: { fees: Sum; gasNearRaw: string; interestPaid: Sum; note: string };
  /** What it earned (realized only). */
  earned: { yield: Sum; incentives: Sum; refunds: Sum };
  /** What I still owe. */
  owed: {
    borrowedInPeriod: Sum;
    repaidInPeriod: Sum;
    journaledPrincipalUsdcRaw: string;
    observedDebtUsdcRaw: string | null;
    accruedInterestUsdcRaw: string | null;
    debtObservedAt: string | null;
    upcomingObligations: StatementObligation[];
    reasons: string[];
  };
  forecast: { entries: LedgerEntry[]; days: number; basis: string };
  pending: LedgerEntry[];
  unresolved: LedgerEntry[];
  entries: LedgerEntry[];
}

export function buildStatement(input: {
  source: Source;
  accountId: string | null;
  entries: LedgerEntry[];
  attempts?: WalletAttempt[];
  from: string;
  to: string;
  lending?: LendingObservation | null;
  obligations?: StatementObligation[];
  forecastDays?: number;
  now?: number;
}): Statement {
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const inPeriod = (e: LedgerEntry) => e.at >= input.from && e.at < input.to;
  const accrual = input.source === "live" ? accruedInterest(input.entries, input.attempts ?? [], input.lending ?? null, nowIso) : null;
  const all = accrual && input.to > nowIso ? [...input.entries, accrual] : input.entries;
  const period = all.filter(inPeriod);
  const counted = period.filter((e) => e.status === "confirmed" && e.realized);
  const of = (...k: LedgerKind[]) => counted.filter((e) => k.includes(e.kind));
  const reasons: string[] = [];
  if (input.lending?.error) reasons.push("Live debt read unavailable: " + input.lending.error);
  const principal = input.entries
    .filter((e) => e.status === "confirmed" && (e.kind === "borrow" || e.kind === "repay"))
    .reduce((n, e) => n + (big(e.liabilityEffectUsdcRaw) ?? 0n), 0n);
  const gas = counted.filter((e) => e.kind === "fee" && e.asset === "NEAR").reduce((n, e) => n + BigInt(e.amountRaw), 0n);
  const days = input.forecastDays ?? 30;
  return {
    source: input.source,
    fictional: input.source === "demo",
    accountId: input.accountId,
    period: { from: input.from, to: input.to },
    generatedAt: nowIso,
    capital: {
      netWorthEffect: total(counted, (e) => e.netWorthEffectUsdcRaw),
      internalMoves: total(of("internal_transfer"), abs),
      positionEntries: total(of("position_entry"), abs),
      positionExits: total(of("position_exit"), abs),
      paymentsOut: total(of("payment_out"), abs),
      note: "Supplies, withdrawals, collateral and staking moves are internal: net worth is unchanged. Payments, fees and interest reduce it; realized yield increases it. Price moves are not booked here; see /api/valuation for today's value.",
    },
    cost: {
      fees: total(of("fee"), abs),
      gasNearRaw: gas.toString(),
      interestPaid: total(of("interest"), abs),
      note: "Gas is valued at today's oracle upper bound. A 1Click route cost is booked only when the payout's USDC value is known. Interest inside a repay is not separated unless the debt baseline is proven.",
    },
    earned: { yield: total(of("yield"), abs), incentives: total(of("incentive"), abs), refunds: total(of("refund"), abs) },
    owed: {
      borrowedInPeriod: total(of("borrow"), abs),
      repaidInPeriod: total(of("repay"), abs),
      journaledPrincipalUsdcRaw: (principal > 0n ? principal : 0n).toString(),
      observedDebtUsdcRaw: input.lending?.debtUsdcRaw ?? null,
      accruedInterestUsdcRaw: accrual?.amountRaw ?? null,
      debtObservedAt: input.lending?.debtUsdcRaw ? input.lending.capturedAt : null,
      upcomingObligations: input.obligations ?? [],
      reasons,
    },
    forecast: {
      entries: input.source === "live" ? forecastEntries(input.lending ?? null, days, now) : [],
      days,
      basis: "Today's variable Rhea APRs applied to today's balances. Forecasts are never counted as realized.",
    },
    pending: period.filter((e) => e.status === "pending"),
    unresolved: period.filter((e) => e.status === "unresolved"),
    entries: period,
  };
}

/* ───────────── CSV ───────────── */

const COLUMNS = [
  "at", "kind", "status", "realized", "asset", "chain", "amount", "usdc", "net_worth_effect_usdc", "liability_effect_usdc",
  "basis", "plan_id", "step_id", "attempt_id", "position_id", "tx_hashes", "source", "id",
] as const;
function cell(v: string) {
  // Quote always; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-\d/.test(v) ? "'" + v : v;
  return '"' + safe.replace(/"/g, '""') + '"';
}
const usd = (v: string | null) => (v === null ? "" : decimal(BigInt(v)));
export function ledgerCsv(entries: LedgerEntry[]) {
  const rows = entries.map((e) =>
    [
      e.at, e.kind, e.status, String(e.realized), e.asset, e.chain ?? "", decimal(BigInt(e.amountRaw || "0"), e.decimals),
      usd(e.usdcRaw), usd(e.netWorthEffectUsdcRaw), usd(e.liabilityEffectUsdcRaw), e.basis, e.planId ?? "", e.stepId ?? "",
      e.attemptId ?? "", e.positionId ?? "", e.txHashes.join(" "), e.source, e.id,
    ].map(cell).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/* ───────────── example ledger (fictional, example workspace only) ───────────── */

export function demoLedger(now = Date.now()): LedgerEntry[] {
  const day = 86_400_000;
  const at = (d: number) => new Date(now - d * day).toISOString();
  const e = (id: string, d: number, kind: LedgerKind, amountRaw: string, nw: string, li: string, basis: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
    id: "example:" + id, at: at(d), kind, asset: "USDC", chain: "near", amountRaw, decimals: 6, usdcRaw: amountRaw.replace("-", ""),
    netWorthEffectUsdcRaw: nw, liabilityEffectUsdcRaw: li, realized: true, status: "confirmed", txHashes: [], source: "demo",
    basis: "Fictional example. " + basis, ...extra,
  });
  return [
    e("supply", 21, "internal_transfer", "4000000000", "0", "0", "Idle USDC supplied to a lending venue.", { positionId: "rhea-usdc" }),
    e("yield", 7, "yield", "6420000", "6420000", "0", "Supply interest realized on withdrawal.", { positionId: "rhea-usdc" }),
    e("withdraw", 7, "internal_transfer", "1506420000", "0", "0", "Withdrawal before a payment date.", { positionId: "rhea-usdc" }),
    e("payment", 6, "payment_out", "1500000000", "-1500000000", "0", "Supplier payment delivered.", { asset: "USDC", chain: "base" }),
    e("fee", 6, "fee", "1840000", "-1840000", "0", "Route cost of the payment."),
  ];
}
