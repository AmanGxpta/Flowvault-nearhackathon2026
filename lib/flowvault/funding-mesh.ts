// Funding mesh (owner: Stream A). Pure planning, ledger and recovery rules for multi-source funding.
//
// A plan executes from the signed-in NEAR account. When that account's idle USDC can't cover what the plan needs,
// other proven accounts can send USDC to it: each such leg is a USDC transfer to a 1Click deposit address, approved
// in the wallet that controls the source, delivered to the NEAR account as USDC (or refunded to the source). Every
// leg settles on its own chain; nothing makes the legs all-or-nothing, so the plan says where every leg's money is.
//
// All amounts are bigint base units (USDC 6 decimals). Costs are conservative: the route cost uses the quote's
// minimum output (slippage bound included) and gas is valued at the oracle's upper price. Unknown costs block.
import type { ExecutionCapability, ExecutionNetwork, FundingChoice, FundingLeg, FundsLocation, LedgerEntry, MultiSourceFunding, PlanStep, SigningMethod } from "./contracts.ts";
import type { Source } from "./types.ts";
import { decimal } from "./money.ts";
import { NETWORK_NAME } from "./capabilities.ts";

const BPS = 10_000n;
/** No leg below 1 USDC: a dust leg costs a full network fee and 1Click may refuse it. */
export const MIN_LEG_RAW = 1_000000n;
/** At most this many sources in one plan: every extra leg is another wallet approval and another chain to watch. */
export const MAX_LEGS = 3;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
const usd = (raw: bigint | string) => decimal(BigInt(raw), 6);
const short = (a: string) => (a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

/** One source's route terms, measured with a live dry quote at a calibration size. */
export interface SourceTerms {
  accountId: string;
  network: ExecutionNetwork;
  address: string;
  label: string;
  signing: SigningMethod;
  availableRaw: bigint;
  /** Route cost per unit sent, incl. the slippage bound (ceil). null = no quote. */
  rateBps: bigint | null;
  gasAsset: "NEAR" | "ETH" | "SOL";
  gasRaw: bigint | null;
  gasUsdcRaw: bigint | null;
  reasons: string[];
  basis: string;
}

/** Rate from a dry EXACT_INPUT quote: (in − minOut) / in, rounded up. */
export function rateFromQuote(amountInRaw: bigint, minOutRaw: bigint): bigint {
  if (amountInRaw <= 0n || minOutRaw <= 0n || minOutRaw > amountInRaw) throw new Error("Unusable calibration quote.");
  return ceilDiv((amountInRaw - minOutRaw) * BPS, amountInRaw);
}

/** Smallest send that nets `net` at `rate` (rounded up). */
export function sendFor(net: bigint, rateBps: bigint) {
  if (rateBps >= BPS) throw new Error("Route takes everything.");
  return ceilDiv(net * BPS, BPS - rateBps);
}
/** What sending `amount` nets at `rate` (rounded down). */
export function netOf(amount: bigint, rateBps: bigint) {
  return (amount * (BPS - rateBps)) / BPS;
}

export interface CandidateSet {
  choiceId: string;
  mode: "single" | "mixed";
  legs: FundingLeg[];
  costsUsdcRaw: bigint | null;
  netRaw: bigint;
  eligible: boolean;
  reasons: string[];
}

function legFor(t: SourceTerms, net: bigint, index: number): FundingLeg {
  const amount = sendFor(net, t.rateBps!);
  const route = amount - net;
  const cost = t.gasUsdcRaw === null ? null : route + t.gasUsdcRaw;
  return {
    id: `leg-${index + 1}-${t.network}-${t.address.slice(-6).toLowerCase()}`,
    accountId: t.accountId,
    network: t.network,
    address: t.address,
    label: t.label,
    asset: "USDC",
    operation: "oneclick_deposit",
    signer: t.accountId,
    signing: t.signing,
    amountRaw: amount.toString(),
    minNetRaw: net.toString(),
    costsUsdcRaw: cost === null ? null : cost.toString(),
    gas: { asset: t.gasAsset, amountRaw: t.gasRaw === null ? null : t.gasRaw.toString(), usdcRaw: t.gasUsdcRaw === null ? null : t.gasUsdcRaw.toString() },
    stepKind: "fund_transfer",
    rationale: `${usd(amount)} USDC from ${NETWORK_NAME[t.network]} ${short(t.address)} → at least ${usd(net)} USDC in your NEAR account (route up to ${usd(route)}${t.gasUsdcRaw === null ? ", network fee unpriced" : ", network fee ≈ " + usd(t.gasUsdcRaw)}).`,
    eligible: cost !== null,
    reasons: cost === null ? ["GAS_VALUE_UNKNOWN"] : [],
  };
}

const usable = (t: SourceTerms) => t.reasons.length === 0 && t.rateBps !== null && t.rateBps < BPS && t.gasUsdcRaw !== null;
const capacity = (t: SourceTerms) => netOf(t.availableRaw, t.rateBps!);

/** Fill `need` from `sources` in the given order; null when they can't cover it with legs ≥ MIN_LEG_RAW. */
function fill(sources: SourceTerms[], need: bigint): FundingLeg[] | null {
  let left = need;
  const legs: FundingLeg[] = [];
  for (const t of sources) {
    if (left <= 0n) break;
    const take = capacity(t) < left ? capacity(t) : left;
    if (take < MIN_LEG_RAW && take < need) return null;
    legs.push(legFor(t, take, legs.length));
    left -= take;
  }
  return left > 0n ? null : legs;
}
const costOf = (legs: FundingLeg[]) => (legs.some((l) => l.costsUsdcRaw === null) ? null : legs.reduce((n, l) => n + BigInt(l.costsUsdcRaw!), 0n));

/**
 * Every single source that covers the need alone, and the cheapest mixed set (≤ MAX_LEGS sources, filled in
 * ascending route cost). Exhaustive over subsets of the usable sources (capped at 8), so the mixed set is the
 * true minimum under the measured terms, not a greedy guess. Ties prefer fewer legs.
 */
export function candidateSets(sources: SourceTerms[], need: bigint): CandidateSet[] {
  if (need <= 0n) return [];
  const ok = sources.filter(usable).sort((a, b) => Number(a.rateBps! - b.rateBps!)).slice(0, 8);
  const out: CandidateSet[] = [];
  for (const t of sources) {
    const id = `mesh:single:${t.accountId}:${t.network}`;
    if (!usable(t)) {
      out.push({ choiceId: id, mode: "single", legs: [], costsUsdcRaw: null, netRaw: 0n, eligible: false, reasons: t.reasons.length ? t.reasons : ["ROUTE_QUOTE_UNAVAILABLE"] });
      continue;
    }
    const legs = capacity(t) >= need ? fill([t], need) : null;
    out.push(legs
      ? { choiceId: id, mode: "single", legs, costsUsdcRaw: costOf(legs), netRaw: need, eligible: true, reasons: [] }
      : { choiceId: id, mode: "single", legs: [], costsUsdcRaw: null, netRaw: capacity(t), eligible: false, reasons: [`SOURCE_SHORT: covers ${usd(capacity(t))} of ${usd(need)}`] });
  }
  let best: { legs: FundingLeg[]; cost: bigint } | null = null;
  for (let mask = 1; mask < 1 << ok.length; mask++) {
    const subset = ok.filter((_, i) => mask & (1 << i));
    if (subset.length < 2 || subset.length > MAX_LEGS) continue;
    const legs = fill(subset, need);
    // A source that ends up unused (need covered before it) makes this subset a smaller one already tried.
    if (!legs || legs.length !== subset.length) continue;
    const cost = costOf(legs);
    if (cost === null) continue;
    if (!best || cost < best.cost || (cost === best.cost && legs.length < best.legs.length)) best = { legs, cost };
  }
  if (best) out.push({ choiceId: "mesh:mixed", mode: "mixed", legs: best.legs, costsUsdcRaw: best.cost, netRaw: need, eligible: true, reasons: [] });
  // No mixed set because one source already covers it is not a shortfall; only say "short" when it truly is.
  else if (ok.length >= 2 && !out.some((s) => s.eligible))
    out.push({ choiceId: "mesh:mixed", mode: "mixed", legs: [], costsUsdcRaw: null, netRaw: 0n, eligible: false, reasons: [ok.reduce((n, t) => n + capacity(t), 0n) < need ? "SOURCES_SHORT: your other accounts together can't cover it" : "LEGS_TOO_SMALL: the remainder would be under 1 USDC per source"] });
  return out;
}

export interface MeshInput {
  target: string;
  /** USDC the target must hold for the plan (the payment's maximum input). */
  requiredRaw: bigint;
  /** Target's idle USDC usable for this plan (after reserve and other dated payments). */
  idleRaw: bigint;
  sources: SourceTerms[];
  /** Capabilities that can't fund (shown as "not used" with their reasons). */
  unusable?: ExecutionCapability[];
  capturedAt: string;
}

/** Builds one MultiSourceFunding per candidate set and the explanation that stays with it. */
export function meshFunding(i: MeshInput): { sets: CandidateSet[]; funding: Record<string, MultiSourceFunding> } {
  const need = i.requiredRaw > i.idleRaw ? i.requiredRaw - i.idleRaw : 0n;
  const sets = candidateSets(i.sources, need);
  const funding: Record<string, MultiSourceFunding> = {};
  const comparison = sets.map((s) => ({ choiceId: s.choiceId, mode: s.mode, legs: s.legs.map((l) => l.accountId + ":" + l.network), costsUsdcRaw: s.costsUsdcRaw === null ? null : s.costsUsdcRaw.toString(), eligible: s.eligible, reasons: s.reasons }));
  const eligible = sets.filter((s) => s.eligible).sort((a, b) => Number(a.costsUsdcRaw! - b.costsUsdcRaw!) || a.legs.length - b.legs.length);
  const cheapestSingle = eligible.find((s) => s.mode === "single");
  for (const s of sets.filter((x) => x.eligible)) {
    const hold: FundingLeg | null = i.idleRaw > 0n
      ? {
          id: "leg-0-near-idle", accountId: "near:" + i.target, network: "near", address: i.target, label: i.target, asset: "USDC", operation: "hold",
          signer: null, signing: null, amountRaw: (i.idleRaw < i.requiredRaw ? i.idleRaw : i.requiredRaw).toString(), minNetRaw: (i.idleRaw < i.requiredRaw ? i.idleRaw : i.requiredRaw).toString(),
          costsUsdcRaw: "0", gas: { asset: "NEAR", amountRaw: null, usdcRaw: null }, stepKind: null,
          rationale: `${usd(i.idleRaw < i.requiredRaw ? i.idleRaw : i.requiredRaw)} USDC already idle in ${i.target}: used first, no transfer and no cost.`, eligible: true, reasons: [],
        }
      : null;
    const legs = [...(hold ? [hold] : []), ...s.legs];
    const explanation = [
      hold ? `Your NEAR account's idle USDC goes first (${usd(hold.amountRaw)}): it is already where the plan runs.` : `Your NEAR account has no idle USDC free for this after your reserve and other payments.`,
      `${usd(need)} USDC more has to reach ${i.target} from your other accounts.`,
      s.mode === "single"
        ? `One source covers it: ${s.legs[0].label} on ${NETWORK_NAME[s.legs[0].network]}, total cost up to ${usd(s.costsUsdcRaw!)}${eligible[0] === s ? " — the cheapest option after every known cost" : ""}.`
        : `Mixed: ${s.legs.map((l) => NETWORK_NAME[l.network] + " " + short(l.address)).join(" + ")}, total cost up to ${usd(s.costsUsdcRaw!)}${cheapestSingle ? ` vs ${usd(cheapestSingle.costsUsdcRaw!)} from the best single source (${NETWORK_NAME[cheapestSingle.legs[0].network]})` : "; no single account holds enough"}.`,
      `Each source is approved in its own wallet and settles on its own chain. They are not all-or-nothing: if one leg fails, the others still arrive, and this plan shows where every dollar is.`,
      ...sets.filter((x) => !x.eligible && x.mode === "single").map((x) => `Not used: ${x.choiceId.split(":").slice(2, -1).join(":")} on ${NETWORK_NAME[x.choiceId.split(":").at(-1) as ExecutionNetwork] ?? x.choiceId.split(":").at(-1)} — ${x.reasons[0]}`),
      ...(i.unusable ?? []).filter((c) => !c.primary).map((c) => `Not used: ${c.label} on ${NETWORK_NAME[c.network]} — ${c.reasons[0] ?? "nothing to move"}`),
    ];
    funding[s.choiceId] = {
      target: { accountId: "near:" + i.target, network: "near", asset: "USDC", amountRaw: i.requiredRaw.toString() },
      mode: s.mode,
      legs,
      netToTargetRaw: legs.reduce((n, l) => n + BigInt(l.minNetRaw), 0n).toString(),
      costsUsdcRaw: s.costsUsdcRaw!.toString(),
      comparison,
      atomic: false,
      explanation,
      capturedAt: i.capturedAt,
    };
  }
  return { sets, funding };
}

/** The FundingChoice for a set: legs first (independent), then the plan's own settle steps. */
export function meshChoice(s: CandidateSet, settleSteps: FundingChoice["steps"], extraReasons: string[] = []): FundingChoice {
  const reasons = [...new Set([...s.reasons, ...extraReasons])];
  return {
    id: s.choiceId,
    kind: "multi_source",
    eligible: s.eligible && reasons.length === 0,
    reasons,
    amountUsdcRaw: s.legs.reduce((n, l) => n + BigInt(l.amountRaw), 0n).toString(),
    costsUsdcRaw: s.costsUsdcRaw === null ? null : s.costsUsdcRaw.toString(),
    foregoneUsdcRaw: "0",
    interestUsdcRaw: null,
    healthAfter: null,
    availableAt: null,
    steps: [...s.legs.map(() => "fund_transfer" as const), ...settleSteps],
  };
}

/**
 * After review() built a linear chain: legs don't depend on each other (each is its own wallet and chain), and
 * the first settle step waits for every leg. Signers become the source accounts. Mutates the steps.
 */
export function wireLegSteps(steps: PlanStep[], funding: MultiSourceFunding) {
  const moving = funding.legs.filter((l) => l.operation === "oneclick_deposit");
  const legSteps = steps.filter((s) => s.kind === "fund_transfer");
  if (legSteps.length !== moving.length) throw new Error("The reviewed sources don't match the plan's transfer steps.");
  legSteps.forEach((s, i) => {
    const leg = moving[i];
    s.dependsOn = [];
    s.state = "ready";
    s.signer = leg.signer;
    s.expected = { amountRaw: leg.amountRaw, asset: "USDC", usdcRaw: leg.amountRaw, legId: leg.id, venue: leg.network, note: leg.rationale };
  });
  const firstSettle = steps.find((s) => s.kind !== "fund_transfer");
  if (firstSettle) {
    firstSettle.dependsOn = legSteps.map((s) => s.id);
    firstSettle.state = legSteps.length ? "pending" : "ready";
  }
}

/* ───────────── leg journal outcome → ledger and location ───────────── */

export type LegJournalState = "prepared" | "awaiting_wallet" | "submitted" | "confirmed" | "refunded" | "failed" | "unknown";
export interface LegOutcome {
  state: LegJournalState;
  amountInRaw: string;
  depositAddress: string | null;
  deadline: string | null;
  txHash: string | null;
  provider: string | null;
  deliveredRaw: string | null;
  refundedRaw: string | null;
  destinationHashes: string[];
  gasRaw: string | null;
  gasUsdcRaw: string | null;
  at: string;
}

/**
 * Confirmed leg → one internal transfer (principal moved between your own accounts: net worth unchanged) plus the
 * realized route cost and the network fee as fees. The payment it funds books its own payout once, from the NEAR
 * account; the leg never books a payout, so nothing is counted twice. Keys use the leg journal id.
 */
export function legLedger(o: LegOutcome, leg: FundingLeg, ids: { legJournalId: string; planId: string; stepId: string; source: Source }): LedgerEntry[] {
  if (o.state !== "confirmed" || !o.deliveredRaw) return [];
  const sent = BigInt(o.amountInRaw);
  const got = BigInt(o.deliveredRaw);
  const chain = leg.network === "solana" ? ("solana" as const) : leg.network === "ethereum" ? ("eth" as const) : leg.network === "arbitrum" ? ("arb" as const) : leg.network === "base" ? ("base" as const) : ("near" as const);
  const common = { at: o.at, planId: ids.planId, stepId: ids.stepId, attemptId: ids.legJournalId, source: ids.source, realized: true, status: "confirmed" as const, liabilityEffectUsdcRaw: "0" };
  const out: LedgerEntry[] = [
    {
      ...common, id: `${ids.legJournalId}:internal_transfer`, kind: "internal_transfer", asset: "USDC", chain, amountRaw: o.amountInRaw, decimals: 6, usdcRaw: o.amountInRaw,
      netWorthEffectUsdcRaw: "0", txHashes: [o.txHash, ...o.destinationHashes].filter((x): x is string => !!x),
      basis: `Moved ${usd(sent)} USDC from ${NETWORK_NAME[leg.network]} ${short(leg.address)} to your NEAR account through 1Click; ${usd(got)} USDC delivered (provider status ${o.provider ?? "SUCCESS"})`,
    },
  ];
  if (sent > got)
    out.push({
      ...common, id: `${ids.legJournalId}:fee:USDC`, kind: "fee", asset: "USDC", chain, amountRaw: (sent - got).toString(), decimals: 6, usdcRaw: (sent - got).toString(),
      netWorthEffectUsdcRaw: (got - sent).toString(), txHashes: o.txHash ? [o.txHash] : [], basis: "Realized route cost: USDC sent minus USDC delivered",
    });
  if (o.gasRaw && BigInt(o.gasRaw) > 0n)
    out.push({
      ...common, id: `${ids.legJournalId}:fee:${leg.gas.asset}`, kind: "fee", asset: leg.gas.asset, chain, amountRaw: o.gasRaw, decimals: leg.gas.asset === "ETH" ? 18 : leg.gas.asset === "SOL" ? 9 : 24,
      usdcRaw: o.gasUsdcRaw, netWorthEffectUsdcRaw: o.gasUsdcRaw === null ? null : "-" + o.gasUsdcRaw, txHashes: o.txHash ? [o.txHash] : [],
      basis: o.gasUsdcRaw === null ? "Network fee from the finalized receipt; no price evidence, so it is unpriced" : "Network fee from the finalized receipt, valued at the oracle's upper price",
    });
  return out;
}

/** Where a leg's money is, from the step state and its journal (null = never prepared). */
export function fundsLocation(leg: FundingLeg, step: Pick<PlanStep, "state"> | null, o: LegOutcome | null, now = Date.now()): FundsLocation {
  const base = { legId: leg.id, accountId: leg.accountId, network: leg.network, amountRaw: leg.amountRaw, evidence: [] as string[] };
  const where = NETWORK_NAME[leg.network] + " " + short(leg.address);
  if (leg.operation === "hold") return { ...base, where: "target", detail: `Already in ${leg.address}.`, next: null };
  if (o?.txHash) base.evidence.push(o.txHash);
  base.evidence.push(...(o?.destinationHashes ?? []));
  if (!o || o.state === "prepared")
    return { ...base, where: "source", detail: `Still in ${where}. Nothing has been sent.`, next: step?.state === "skipped" ? null : "Approve this leg in its wallet when you're ready." };
  if (o.state === "confirmed")
    return { ...base, amountRaw: o.deliveredRaw ?? leg.minNetRaw, where: "target", detail: `${usd(o.deliveredRaw ?? leg.minNetRaw)} USDC arrived in your NEAR account.`, next: null };
  if (o.state === "refunded")
    return { ...base, amountRaw: o.refundedRaw ?? o.amountInRaw, where: "refunded_to_source", detail: `1Click refunded ${o.refundedRaw ? usd(o.refundedRaw) : "the"} USDC to ${where}. Nothing was converted.`, next: "The plan can't finish with this leg. Cancel it and ask again; the refunded USDC counts again." };
  if (o.state === "failed")
    return { ...base, where: "source", detail: o.txHash ? `The transfer failed on ${NETWORK_NAME[leg.network]}; the USDC stayed in ${where} (only the network fee was spent).` : `Not sent: the deposit window closed. The USDC is still in ${where}.`, next: "Cancel the plan and ask again for fresh figures." };
  if (o.state === "awaiting_wallet") {
    const past = o.deadline && Date.parse(o.deadline) < now;
    return { ...base, where: past ? "unknown" : "source", detail: past ? `Your wallet never reported back and the deposit window closed. If you sent it anyway, 1Click refunds it to ${where}.` : `Waiting for your approval in the wallet for ${where}.`, next: past ? "Check status: FlowVault asks 1Click what arrived at the deposit address." : null };
  }
  if (o.state === "unknown")
    return { ...base, where: "unknown", detail: `Your wallet didn't confirm whether it sent ${usd(o.amountInRaw)} USDC from ${where}. FlowVault checks the deposit address with 1Click instead of guessing.`, next: "Check status. Don't send it again until this resolves." };
  return { ...base, where: "in_transit", detail: `${usd(o.amountInRaw)} USDC left ${where}; 1Click is delivering it (${o.provider ?? "processing"}). If it can't, it refunds to ${where}.`, next: null };
}

/** Short name for a multi-source alternative ("From Base 0x12…ab", "Mixed: Base … + Arbitrum …"). */
export function meshLabel(choiceId: string, f?: MultiSourceFunding): string {
  if (!choiceId.startsWith("mesh:")) return choiceId;
  if (choiceId === "mesh:other-accounts") return "Your other accounts";
  const moving = (f?.legs ?? []).filter((l) => l.operation === "oneclick_deposit");
  if (moving.length) return (f!.mode === "mixed" ? "Mixed: " : "From ") + moving.map((l) => NETWORK_NAME[l.network] + " " + (l.address.length > 14 ? l.address.slice(0, 6) + "…" + l.address.slice(-4) : l.address)).join(" + ");
  const parts = choiceId.split(":");
  return choiceId === "mesh:mixed" ? "Mixed sources" : "From " + (NETWORK_NAME[parts.at(-1) as ExecutionNetwork] ?? parts.at(-1));
}
