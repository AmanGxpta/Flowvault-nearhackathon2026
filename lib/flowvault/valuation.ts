// Engines: the ONE place net worth, spendable, holdback, surplus, reservations and stress values are
// computed. Pure and synchronous: evidence is gathered by valuation-evidence.ts and passed in.
// All money is bigint base units; USDC values are 6-decimal raw strings. Never coerce unknown to zero.
import { ownerPositions } from "./accounts.ts";
import { decimal, units } from "./money.ts";
import type { CapitalView, Reservation, Valuation } from "./contracts.ts";
import type {
  ConversionQuote,
  PriceEvidence,
  PricedAsset,
  ValuationEvidence,
} from "./valuation-evidence.ts";
import type { Mandate, Obligation, Portfolio, Position, Source, Workspace } from "./types.ts";

const LSTS: Record<string, string> = { LiNEAR: "linear-protocol.near", rNEAR: "lst.rhealab.near" };
const DECIMALS: Record<string, number> = { USDC: 6, USDT: 6, NEAR: 24, LiNEAR: 24, rNEAR: 24, ETH: 18, SOL: 9 };
const STABLE = new Set(["USDC", "USDT"]);
/** Refundable drift buffer on a reservation held until the due date. */
export const DRIFT_BPS = { stable: 50n, volatile: 1000n };
/** Route-cost allowance when no live quote is available (price evidence only). */
export const ROUTE_COST_BPS = 100n;
export const ROUTE_COST_MIN_RAW = 1_000000n;
/** Default stress drawdown for non-stable assets, unless the policy's credit row sets one. */
export const DEFAULT_STRESS_BPS = 3000;
const SNAPSHOT_MAX_AGE_MS = 180_000;
const CENT = 10_000n;
const E6 = 1_000_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const roundUpCent = (n: bigint) => ceilDiv(n, CENT) * CENT;
export const UNAVAILABLE = "unavailable";

/* ───────────── prices ───────────── */

/** USDC raw value of `raw` token units. Assets use the oracle's lower bound, liabilities the upper. */
export function usdcValue(
  raw: bigint,
  decimals: number,
  asset: PricedAsset,
  prices: PriceEvidence,
  side: "asset" | "liability",
): bigint {
  if (asset === "USDC") return decimals === 6 ? raw : (raw * E6) / 10n ** BigInt(decimals);
  const p = prices.prices[asset],
    u = prices.prices.USDC;
  if (!p || !u) throw new Error(asset + " or USDC price evidence unavailable.");
  const [pc, uc] = [BigInt(p.confE12), BigInt(u.confE12)];
  const price = side === "asset" ? BigInt(p.usdE12) - pc : BigInt(p.usdE12) + pc;
  const usdc = side === "asset" ? BigInt(u.usdE12) + uc : BigInt(u.usdE12) - uc;
  if (price <= 0n || usdc <= 0n) throw new Error(asset + " price confidence too wide.");
  const num = raw * price * E6,
    den = 10n ** BigInt(decimals) * usdc;
  return side === "asset" ? num / den : ceilDiv(num, den);
}

function fresh(at: string | null | undefined, now: number) {
  return !!at && Number.isFinite(Date.parse(at)) && now <= Date.parse(at);
}

/* ───────────── positions ───────────── */

function quantity(p: Position): { raw: bigint; decimals: number } | null {
  const decimals = p.decimals ?? DECIMALS[p.asset];
  if (decimals === undefined) return null;
  try {
    if (p.rawAmount !== undefined && /^\d+$/.test(p.rawAmount))
      return { raw: BigInt(p.rawAmount), decimals };
    return { raw: units(p.amount, decimals), decimals };
  } catch {
    return null;
  }
}

/** Observed valuation of one owner position. Unknown → usdcRaw null with a reason. */
export function valuePosition(
  p: Position,
  source: Source,
  prices: PriceEvidence | null,
  capturedAt: string,
  now = Date.now(),
): Valuation {
  const q = quantity(p);
  const base = {
    positionId: p.id,
    kind: "observed" as const,
    asset: p.asset,
    chain: p.chain,
    quantityRaw: q ? q.raw.toString() : "0",
    decimals: q?.decimals ?? 0,
    source,
    capturedAt: p.capturedAt ?? capturedAt,
  };
  const none = (reason: string): Valuation => ({
    ...base,
    usdcRaw: null,
    basis: "No verified valuation",
    freshUntil: null,
    unavailableReason: reason,
  });
  if (source === "demo" && p.asset !== "USDC" && p.valuation?.source === "demo")
    return {
      ...base,
      usdcRaw: units(p.valuation.amount).toString(),
      basis: "Fictional example valuation",
      freshUntil: null,
    };
  if (!q) return none("Quantity or decimals unverified.");
  if (q.raw === 0n)
    return { ...base, usdcRaw: "0", basis: "Zero balance", freshUntil: null };
  if (source === "demo") {
    if (p.asset === "USDC")
      return { ...base, usdcRaw: q.raw.toString(), basis: "Fictional example USDC", freshUntil: null };
    if (p.valuation?.source === "demo")
      return {
        ...base,
        usdcRaw: units(p.valuation.amount).toString(),
        basis: "Fictional example valuation",
        freshUntil: null,
      };
    return none("Fictional position has no example valuation.");
  }
  if (p.venueValuation) {
    const v=p.venueValuation;
    if (!fresh(v.freshUntil, now) || !/^\d+$/.test(v.usdcRaw) || p.source!=="live") return none("Venue price evidence unavailable/stale.");
    return {...base,usdcRaw:v.usdcRaw,basis:v.basis,freshUntil:v.freshUntil};
  }
  if (p.asset === "USDC")
    return {
      ...base,
      usdcRaw: q.raw.toString(),
      basis: "Native USDC at face value (the plan's unit)",
      freshUntil: null,
    };
  if (!prices) return none("Price evidence unavailable.");
  if (!fresh(prices.freshUntil, now)) return none("Price evidence is stale.");
  const side = p.kind === "debt" ? "liability" : "asset";
  try {
    // ETH and SOL (Interface A2, additive): connected EVM and Solana wallets, same Pyth evidence.
    if (p.asset === "NEAR" || p.asset === "USDT" || p.asset === "ETH" || p.asset === "SOL")
      return {
        ...base,
        usdcRaw: usdcValue(q.raw, q.decimals, p.asset, prices, side).toString(),
        basis: prices.basis,
        freshUntil: prices.freshUntil,
      };
    const lst = LSTS[p.asset];
    if (lst) {
      const rate = prices.lstNearPerToken[p.asset as "LiNEAR" | "rNEAR"];
      if (!rate) return none(p.asset + " price view unavailable.");
      const near = (q.raw * BigInt(rate)) / 10n ** 24n;
      return {
        ...base,
        usdcRaw: usdcValue(near, 24, "NEAR", prices, side).toString(),
        basis: `${prices.basis}; ${p.asset} ft_price ${rate}`,
        freshUntil: prices.freshUntil,
        underlying: { asset: "NEAR", quantityRaw: near.toString(), decimals: 24 },
        countedVia: `lst:${lst}:${p.accountId ?? "owner"}`,
      };
    }
  } catch (e) {
    return none((e as Error).message);
  }
  return none(p.asset + " has no verified price source.");
}

/* ───────────── portfolio value ───────────── */

/** Values owner positions once (receipt tokens counted once) with stress rows for volatile assets.
 * Shared by capitalView() and usableBalances(): the single net-worth calculation. */
export function valuePortfolio(
  owner: Position[],
  source: Source,
  prices: PriceEvidence | null,
  capturedAt: string,
  now = Date.now(),
  stressBps: Record<string, number> = {},
) {
  const valuations: Valuation[] = [];
  const excluded: CapitalView["excluded"] = [];
  const counted = new Set<string>();
  let assets = 0n,
    debt = 0n,
    stressedAssets = 0n,
    unknownValue = false;
  for (const x of owner) {
    if (x.amount === "unknown") {
      excluded.push({ positionId: x.id, reason: "Read unavailable." });
      unknownValue = true;
      continue;
    }
    const v = valuePosition(x, source, prices, capturedAt, now);
    if (v.countedVia) {
      if (counted.has(v.countedVia)) {
        excluded.push({ positionId: x.id, reason: "Same receipt balance already counted (" + v.countedVia + ")." });
        continue;
      }
      counted.add(v.countedVia);
    }
    valuations.push(v);
    if (v.usdcRaw === null) {
      unknownValue = true;
      excluded.push({ positionId: x.id, reason: v.unavailableReason ?? "Unvalued." });
      continue;
    }
    const n = BigInt(v.usdcRaw);
    if (x.kind === "debt") debt += n;
    else {
      assets += n;
      const stable = STABLE.has(x.asset);
      const bps = stable ? 0 : (stressBps[x.asset] ?? DEFAULT_STRESS_BPS);
      const stressed = (n * BigInt(10000 - bps)) / 10000n;
      stressedAssets += stressed;
      if (!stable && n > 0n)
        valuations.push({
          ...v,
          kind: "stress",
          usdcRaw: stressed.toString(),
          stressBps: bps,
          basis: v.basis + `; ${bps} bps drawdown`,
        });
    }
  }
  return { valuations, excluded, assets, debt, stressedAssets, unknownValue };
}

/* ───────────── reservations ───────────── */

function payoutDecimals(o: Obligation) {
  return o.token === "NEAR" ? 24 : 6;
}
function pendingStatus(o: Obligation) {
  return !["paid", "cancelled"].includes(o.status);
}
/** Obligations the plan must protect now: within the horizon (whole final UTC day) or legacy-protected. */
export function dueInHorizon(m: Mandate, obligations: Obligation[], now = Date.now()) {
  const end = Date.parse(
    new Date(now + m.horizon * 86400000).toISOString().slice(0, 10) + "T23:59:59.999Z",
  );
  return obligations.filter(
    (o) =>
      pendingStatus(o) &&
      (o.legacyProtected || Date.parse(o.dueDate + "T23:59:59.999Z") <= end),
  );
}

export interface ReserveContext {
  source: Source;
  prices?: PriceEvidence | null;
  quote?: ConversionQuote | null;
  now?: number;
}
/** Conservative USDC reservation for one obligation. Never zero for a pending payout; when no evidence
 * exists the reservation carries unavailableReason and its amounts are the literal "unavailable". */
export function reserveFor(o: Obligation, ctx: ReserveContext): Reservation {
  const now = ctx.now ?? Date.now();
  const dec = payoutDecimals(o);
  const payout = units(o.amount, dec);
  const head = {
    obligationId: o.id,
    payoutRaw: payout.toString(),
    payoutAsset: o.token,
    payoutChain: o.destination,
    payoutDecimals: dec,
    source: ctx.source,
  };
  const ok = (
    conversion: bigint,
    costs: bigint,
    buffer: bigint,
    basis: string,
    capturedAt: string,
    freshUntil: string | null,
  ): Reservation => {
    const reserve = roundUpCent(conversion + costs + buffer);
    return {
      ...head,
      reserveUsdcRaw: reserve.toString(),
      conversionUsdcRaw: conversion.toString(),
      costsUsdcRaw: costs.toString(),
      // Rounding up to the cent is part of the refundable buffer.
      bufferUsdcRaw: (reserve - conversion - costs).toString(),
      basis,
      capturedAt,
      freshUntil,
    };
  };
  const nowIso = new Date(now).toISOString();
  if (o.token === "USDC")
    return ok(payout, 0n, 0n, "Native USDC at face value; route costs are checked when the payment is quoted.", nowIso, null);
  if (ctx.source === "demo" && o.token === "USDT")
    return ok(payout, 0n, 0n, "Fictional example equivalence (example scope only).", nowIso, null);
  const missing: string[] = [];
  const drift = STABLE.has(o.token) ? DRIFT_BPS.stable : DRIFT_BPS.volatile;
  if (ctx.source === "live" && ctx.quote && o.token !== "NEAR") {
    const q = ctx.quote;
    if (q.obligationId !== o.id) missing.push("Quote belongs to another obligation.");
    else if (!fresh(q.validUntil, now)) missing.push("Conversion quote expired.");
    else {
      const amountIn = BigInt(q.amountInRaw),
        minIn = BigInt(q.minAmountInRaw);
      const conversion = q.outputValueRaw !== null ? BigInt(q.outputValueRaw) : minIn;
      const costs = minIn > conversion ? minIn - conversion : 0n;
      const buffer = (amountIn - minIn) + ceilDiv(amountIn * drift, 10000n);
      return ok(
        conversion > minIn ? minIn : conversion,
        costs,
        buffer,
        `${q.basis}; refundable buffer = quote slippage + ${drift} bps drift`,
        q.capturedAt,
        q.validUntil,
      );
    }
  }
  if (ctx.source === "live" && ctx.prices) {
    const p = ctx.prices;
    if (!fresh(p.freshUntil, now)) missing.push("Price evidence is stale.");
    else
      try {
        const conversion = usdcValue(payout, dec, o.token as PricedAsset, p, "liability");
        const allowance = ceilDiv(conversion * ROUTE_COST_BPS, 10000n);
        const costs = allowance > ROUTE_COST_MIN_RAW ? allowance : ROUTE_COST_MIN_RAW;
        return ok(
          conversion,
          costs,
          ceilDiv(conversion * drift, 10000n),
          `${p.basis}; oracle upper bound; ${ROUTE_COST_BPS} bps (min 1 USDC) route-cost allowance, no live quote; ${drift} bps refundable drift buffer`,
          p.capturedAt,
          p.freshUntil,
        );
      } catch (e) {
        missing.push((e as Error).message);
      }
  }
  return {
    ...head,
    reserveUsdcRaw: UNAVAILABLE,
    conversionUsdcRaw: UNAVAILABLE,
    costsUsdcRaw: UNAVAILABLE,
    bufferUsdcRaw: UNAVAILABLE,
    basis: "No conversion evidence",
    capturedAt: nowIso,
    freshUntil: null,
    unavailableReason:
      `No verified ${o.token}→USDC conversion evidence${missing.length ? " (" + missing.join(" ") + ")" : ""}. The obligation stays protected and blocks automation.`,
  };
}

/** A reservation is usable for a decision only if it is available, fresh and still matches the obligation. */
export function usableReservation(r: Reservation | undefined, o: Obligation, now = Date.now()) {
  return (
    !!r &&
    !r.unavailableReason &&
    r.obligationId === o.id &&
    r.payoutAsset === o.token &&
    r.payoutChain === o.destination &&
    r.payoutRaw === units(o.amount, payoutDecimals(o)).toString() &&
    (r.freshUntil === null || fresh(r.freshUntil, now))
  );
}

/** Reservation used by the sync holdback path: computed in place for face-value cases, otherwise
 * the evidence-backed one attached to the mandate. Throws (blocks automation) when neither exists. */
export function reservationFor(m: Mandate, o: Obligation, now = Date.now()): Reservation {
  const source = m.source ?? "live";
  if (o.token === "USDC" || (source === "demo" && o.token === "USDT"))
    return reserveFor(o, { source, now });
  const attached = m.evidenceReservations?.find((r) => r.obligationId === o.id);
  if (usableReservation(attached, o, now)) return attached!;
  throw new Error(
    "Obligation valuation unavailable: " +
      (attached?.unavailableReason ??
        `${o.label} (${o.amount} ${o.token}) has no fresh USDC conversion evidence; automation is blocked until it is valued.`),
  );
}

/** Attach evidence-backed reservations to the mandate so every sync holdback call uses them. */
export function attachReservations(w: Workspace, evidence: ValuationEvidence, now = Date.now()) {
  w.mandate.evidenceReservations = w.obligations
    .filter((o) => pendingStatus(o) && o.token !== "USDC")
    .map((o) =>
      reserveFor(o, {
        source: w.mode,
        prices: evidence.prices,
        quote: evidence.quotes.find((q) => q.obligationId === o.id) ?? null,
        now,
      }),
    );
  return w;
}

/* ───────────── capital view ───────────── */

export interface CapitalReport extends CapitalView {
  source: Source;
  accountId: string | null;
  /** Why a figure is null or partial. */
  reasons: string[];
  /** Assets minus debt after stress drawdowns; null when any input is unknown. */
  stressedNetWorthUsdcRaw: string | null;
  debtUsdcRaw: string | null;
  reserveUsdcRaw: string;
  committedInFlightUsdcRaw: string;
  /** True when any figure automation depends on is unknown. */
  blocksAutomation: boolean;
  evidence: { prices: string | null; pricesFreshUntil: string | null; errors: string[] };
}

export function capitalView(
  w: Workspace,
  portfolio: Portfolio,
  evidence: ValuationEvidence = { prices: null, quotes: [], errors: [] },
  options: { now?: number; committedRaw?: bigint; stressBps?: Record<string, number> } = {},
): CapitalReport {
  const now = options.now ?? Date.now();
  if (portfolio.source !== w.mode)
    throw new Error("Example and live capital sources cannot be mixed.");
  const source = w.mode;
  const prices = source === "live" ? evidence.prices : null;
  const reasons: string[] = [...evidence.errors];
  const excluded: CapitalView["excluded"] = [];
  const owner = ownerPositions(portfolio.positions);
  for (const x of portfolio.positions)
    if (x.ownership === "watched")
      excluded.push({ positionId: x.id, reason: "Watched address: observed only, no signing authority, not in net worth." });
  const snapshotFresh =
    Number.isFinite(Date.parse(portfolio.capturedAt)) &&
    Math.abs(now - Date.parse(portfolio.capturedAt)) <= SNAPSHOT_MAX_AGE_MS;
  if (!snapshotFresh) reasons.push("Portfolio snapshot is stale.");
  if (!owner.length) reasons.push("No position evidence available.");
  reasons.push(...portfolio.errors);
  const sectionGap = (figure: string) =>
    (portfolio.sections ?? [])
      .filter((s) => ["unavailable", "partial"].includes(s.status) && s.affects.includes(figure as never))
      .map((s) => s.id + ": " + (s.reasons.join("; ") || s.status));
  const netGaps = sectionGap("netWorth");
  reasons.push(...netGaps);

  const { valuations, assets, debt, stressedAssets, unknownValue, excluded: valueExcluded } =
    valuePortfolio(owner, source, prices, portfolio.capturedAt, now, options.stressBps);
  excluded.push(...valueExcluded);
  if (unknownValue) reasons.push("Some exposure has no verified USDC valuation.");
  const netKnown = !unknownValue && !netGaps.length && snapshotFresh && owner.length > 0 && !portfolio.errors.length;

  // Spendable: USDC the owner's NEAR wallet can sign for now, minus in-flight commitments.
  const signer = source === "demo" ? null : w.accountId;
  let wallet = 0n;
  for (const x of owner) {
    if (x.asset !== "USDC" || x.kind !== "wallet") continue;
    const nearWallet = (!x.chain && !x.network) || x.chain === "near";
    const signable =
      nearWallet && (source === "demo" || (!!signer && portfolio.accountId === signer && (!x.accountId || x.accountId === signer)));
    if (signable) wallet += units(x.amount);
    else
      excluded.push({
        positionId: x.id,
        reason: nearWallet
          ? "Not the workspace's signing account."
          : "Read-only address: FlowVault observes it but cannot sign for it.",
      });
  }
  const cashGaps = sectionGap("cashNow");
  if (cashGaps.length) reasons.push(...cashGaps.filter((r) => !reasons.includes(r)));
  const committed = options.committedRaw ?? 0n;
  const spendable = snapshotFresh && !cashGaps.length && wallet > committed ? wallet - committed : 0n;

  // Holdback: reserve + conservative reservations for every protected obligation.
  const reservations = w.obligations
    .filter(pendingStatus)
    .map((o) =>
      reserveFor(o, {
        source,
        prices,
        quote: evidence.quotes.find((q) => q.obligationId === o.id) ?? null,
        now,
      }),
    );
  const reserve = units(w.mandate.reserve);
  let holdback: bigint | null = reserve;
  for (const o of dueInHorizon(w.mandate, w.obligations, now)) {
    const r = reservations.find((x) => x.obligationId === o.id)!;
    if (r.unavailableReason) {
      holdback = null;
      reasons.push(o.id + ": " + r.unavailableReason);
    } else if (holdback !== null) holdback += BigInt(r.reserveUsdcRaw);
  }
  const noSigner = source === "live" && !signer;
  if (noSigner) reasons.push("No NEAR signing account in this workspace.");
  const surplus =
    holdback === null || !snapshotFresh || cashGaps.length || noSigner
      ? null
      : spendable > holdback
        ? spendable - holdback
        : 0n;

  return {
    source,
    accountId: portfolio.accountId,
    netWorthUsdcRaw: netKnown ? (assets - debt).toString() : null,
    stressedNetWorthUsdcRaw: netKnown ? (stressedAssets - debt).toString() : null,
    debtUsdcRaw: netKnown ? debt.toString() : null,
    spendableNowUsdcRaw: spendable.toString(),
    reserveUsdcRaw: reserve.toString(),
    holdbackUsdcRaw: holdback === null ? null : holdback.toString(),
    surplusUsdcRaw: surplus === null ? null : surplus.toString(),
    committedInFlightUsdcRaw: committed.toString(),
    valuations,
    reservations,
    excluded,
    reasons: [...new Set(reasons)],
    blocksAutomation: holdback === null || surplus === null,
    evidence: {
      prices: prices?.basis ?? null,
      pricesFreshUntil: prices?.freshUntil ?? null,
      errors: evidence.errors,
    },
    capturedAt: new Date(now).toISOString(),
  };
}

/** Display helper: raw USDC string → decimal text, null stays null. */
export function usdcText(raw: string | null) {
  return raw === null || raw === UNAVAILABLE ? null : decimal(BigInt(raw));
}

/* ───────────── action valuation (policy caps) ───────────── */

export interface ActionValuation {
  usdcRaw: string | null;
  basis: string;
  capturedAt: string;
  freshUntil: string | null;
  unavailableReason?: string;
}
/** USDC value of a NEAR/LST amount an action moves, for USDC-denominated policy caps. Conservative:
 * the oracle UPPER bound, so a cap is never under-counted. Unknown → usdcRaw null (caller blocks). */
export function actionValuation(
  raw: bigint,
  asset: "NEAR" | "LiNEAR" | "rNEAR",
  prices: PriceEvidence | null,
  now = Date.now(),
): ActionValuation {
  const at = new Date(now).toISOString();
  if (!prices || prices.source !== "live")
    return { usdcRaw: null, basis: "No price evidence", capturedAt: at, freshUntil: null, unavailableReason: "NEAR price evidence unavailable." };
  if (!fresh(prices.freshUntil, now))
    return { usdcRaw: null, basis: prices.basis, capturedAt: at, freshUntil: prices.freshUntil, unavailableReason: "NEAR price evidence is stale." };
  try {
    let near = raw;
    if (asset !== "NEAR") {
      const rate = prices.lstNearPerToken[asset];
      if (!rate) throw new Error(asset + " price view unavailable.");
      near = ceilDiv(raw * BigInt(rate), 10n ** 24n);
    }
    return {
      usdcRaw: usdcValue(near, 24, "NEAR", prices, "liability").toString(),
      basis: prices.basis + "; oracle upper bound for cap checks",
      capturedAt: prices.capturedAt,
      freshUntil: prices.freshUntil,
    };
  } catch (e) {
    return { usdcRaw: null, basis: prices.basis, capturedAt: at, freshUntil: prices.freshUntil, unavailableReason: (e as Error).message };
  }
}

/** USDC that in-flight wallet attempts will spend from the owner's wallet. Only supply, pay and repay
 * spend USDC; withdraw/borrow/collateral steps move other assets or bring USDC in. */
export function usdcInFlightRaw(
  attempts: { accountId: string; kind: string; amount: string }[],
  accountId: string | null,
) {
  return attempts
    .filter((a) => a.accountId === accountId && ["supply", "pay", "repay"].includes(a.kind))
    .reduce((n, a) => n + units(a.amount), 0n);
}
