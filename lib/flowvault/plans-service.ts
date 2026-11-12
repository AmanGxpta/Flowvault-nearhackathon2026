// Builds action plans from ENGINE figures (owner: Interface). Every amount here is computed by an existing
// engine (calendar ranking, payment sources, policy evaluation, exact-output quote). This file only maps
// those results into the shared FundingChoice / ActionPlan contracts and never invents a figure.
// When Engines ships capitalView()/reserveFor(), swap the gather step below; the mapping stays.
import type { ActionPlan, FundingChoice, PlanObjective, StepKind } from "./contracts";
import type { Obligation, Workspace, Portfolio, MarketSnapshot } from "./types";
import { calendarRanking } from "./calendar";
import { evaluatePolicy, defaultPolicy } from "./policy";
import type { PolicyAction, LedgerEntry as PolicyLedgerEntry } from "./policy";
import { workspaceLedger } from "./policy-context";
import { readLedger } from "./policy-store";
import { workspacePortfolio } from "./portfolio-service";
import { demoMarket } from "./seed";
import { liveMarket, dryCashQuote } from "./near";
import { compareObligation } from "./payment-comparison";
import { paymentInventory } from "./payment-inventory";
import { otherObligationHoldback, paymentSources } from "./payments";
import { payoutAsset, payoutSupported } from "./evm";
import { movingCost } from "./payout-valuation";
import { SUPPLY_USDC as USDC, SUPPLY_RHEA as RHEA } from "./supply";
import { units, decimal } from "./money";
import { portfolioCredit } from "./credit-live";
import { lendingPreview } from "./lending-live";
import { borrowFundingChoice } from "./lending";
import { planList } from "./plans-store";
import { newPlan, planContext, review, applyCreditEffects, type StepSpec } from "./plans";
import { adapterFor } from "./step-adapters";
import { withCapitalEvidence, readValuationEvidence, type PriceEvidence } from "./valuation-evidence";
import { capitalView } from "./valuation";
import { evaluatePool } from "./staking-native-live";
import { sizeStake, stakeAlternatives, exitSteps, stakingReviewSpecs, walletNear } from "./staking-plans";
import type { StakingSizing } from "./staking-plans";

/** Local, additive extras stored beside the contract fields (never a redefinition of them). */
export interface PlanExtras {
  recommendedChoiceId?: string;
  /** Total USDC the payment may draw (exact-output maximum input), used to size the deposit step. */
  fundingUsdcRaw?: string;
  /** Engine summary lines for review, each traceable to a named engine. */
  figures?: { label: string; value: string | null; engine: string }[];
  /** Where the figures came from: fictional example, dry quote, or fresh live reads. */
  evidence?: string;
  title?: string;
  /** Collateral moves sized by the lending engine (collateral_add / collateral_release steps, in order). */
  collateral?: { asset: string; amountRaw: string }[];
  /** Engines: staking steps sized in raw NEAR / LiNEAR and bound to their venue, per alternative id. */
  staking?: StakingSizing;
  /** Borrowing as a payment/cash source (lending engine): carried from evaluation through review, the borrow
   * step and the resulting liability, so the debt never detaches from the payment it funded. */
  credit?: {
    venue: "Rhea";
    debtBeforeUsdcRaw: string | null;
    newDebtUsdcRaw: string;
    interestUsdcRaw: string | null;
    stressedHealthAfter: string | null;
    borrowApr: string | null;
    minHealth: string | null;
  };
}
export type StoredPlan = ActionPlan & PlanExtras;

interface SessionLike {
  id: string;
  workspace: Workspace;
  revision: number;
}

const raw = (v: string | null | undefined, d = 6) => (v == null ? null : units(v, d).toString());

async function gather(s: SessionLike) {
  const [{ portfolio }, market, ledger] = await Promise.all([
    workspacePortfolio(s.workspace),
    s.workspace.mode === "demo" ? demoMarket() : liveMarket(),
    readLedger(s.id),
  ]);
  return { portfolio: portfolio as Portfolio, market: market as MarketSnapshot, ledger: workspaceLedger(s.workspace, ledger) as PolicyLedgerEntry[] };
}

function policyAction(w: Workspace, kind: string, amount: string, extra: Partial<PolicyAction> = {}): PolicyAction {
  const account = w.accountId ?? "fictional-example";
  return {
    kind,
    asset: "USDC",
    chain: "near",
    amount,
    recipient: account,
    venue: RHEA,
    movingCost: "0",
    gasNear: "0.250000000000000000000001",
    source: w.mode,
    accountId: account,
    methods: [{ receiver: RHEA, method: "execute" }],
    ...extra,
  } as PolicyAction;
}

/** A choice whose steps have no registered adapter is shown, but never offered as executable. */
function adapterReasons(steps: StepKind[]) {
  return steps.filter((k) => !adapterFor(k)).map((k) => "NO_EXECUTION_ADAPTER:" + k);
}

/* ───────────── deploy surplus until the next payment ───────────── */

async function deploySurplus(s: SessionLike, base: BaseInput): Promise<StoredPlan> {
  const w = s.workspace;
  const { portfolio, market, ledger } = await gather(s);
  let ranking: ReturnType<typeof calendarRanking>;
  try {
    ranking = calendarRanking(w.mandate, market, portfolio, {}, Date.now());
  } catch (e) {
    // Holdback needs a valuation for every obligation (Engines' reserveFor); without it nothing is deployable.
    const plan = newPlan({ ...base, objective: "deploy_surplus", alternatives: [], blockedReasons: ["HOLDBACK_UNAVAILABLE: " + (e instanceof Error ? e.message : String(e))] }) as StoredPlan;
    plan.title = "Surplus can't be established";
    plan.evidence = "Live reads at " + portfolio.capturedAt;
    return plan;
  }
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const surplus = units(ranking.surplus);
  const supplyCheck = surplus > 0n ? evaluatePolicy(policyAction(w, "supply", ranking.surplus), policy, ledger) : null;
  const next = w.obligations.filter((o) => !["paid", "cancelled"].includes(o.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  // Engines: a NEAR strategy stakes idle NEAR the owner already holds, sized in NEAR within verified surplus.
  const staking: StakingSizing = {};
  const ev = await stakingEvidence(w, portfolio);
  const stakeSize = sizeStake({ walletRaw: walletNear(portfolio), surplusUsdcRaw: ev.capital.surplusUsdcRaw ?? null, prices: ev.prices });
  const alternatives: FundingChoice[] = ranking.strategies.map((st) => {
    // Only Rhea USDC has a supply adapter; any other venue must never be routed to it.
    const steps: StepKind[] = st.id === "rhea-usdc" ? ["supply"] : st.id === "linear" ? ["stake"] : [];
    const stakeReasons = steps[0] === "stake" ? (stakeSize ? stakeSize.reasons : ["EXAMPLE_WORKSPACE_STAKE_NOT_SIZED"]) : [];
    if (steps[0] === "stake" && stakeSize && stakeSize.amountRaw > 0n)
      staking[st.id] = { venue: "linear-protocol.near", steps: [{ kind: "stake", amountRaw: stakeSize.amountRaw.toString(), asset: "NEAR", usdcRaw: stakeSize.usdcRaw.toString(), note: "Stakes idle NEAR you already hold; your USDC stays put" }] };
    const reasons = [
      ...st.reasons,
      ...stakeReasons,
      ...(steps.length ? [] : ["NO_EXECUTION_ADAPTER:" + st.id]),
      ...(surplus > 0n ? [] : ["NO_ELIGIBLE_SURPLUS"]),
      ...(steps[0] === "supply" ? (supplyCheck?.violations ?? []).map((v) => v.code) : []),
      ...adapterReasons(steps),
    ];
    const first = st.dates?.[0];
    return {
      id: st.id,
      kind: "idle_cash",
      eligible: reasons.length === 0 && st.eligible,
      reasons,
      amountUsdcRaw: steps[0] === "stake" ? (stakeSize?.usdcRaw ?? 0n).toString() : surplus.toString(),
      costsUsdcRaw: first?.entryCost != null && first?.exitCost != null ? (units(first.entryCost) + units(first.exitCost)).toString() : null,
      foregoneUsdcRaw: null,
      interestUsdcRaw: null,
      healthAfter: null,
      availableAt: st.gettingThisBack?.exitDays != null ? new Date(Date.now() + st.gettingThisBack.exitDays * 86400000).toISOString().slice(0, 10) : null,
      steps,
    };
  });
  const pick = alternatives.find((a) => a.id === ranking.chosen && a.eligible) ?? alternatives.find((a) => a.eligible);
  const chosen = ranking.strategies.find((x) => x.id === pick?.id);
  const plan = newPlan({
    ...base,
    objective: "deploy_surplus",
    request: { ...base.request, amountRaw: surplus.toString(), asset: "USDC", chain: "near", deadline: next?.dueDate },
    alternatives,
    recommendedChoiceId: pick?.id,
    blockedReasons: surplus > 0n ? [] : ["NO_ELIGIBLE_SURPLUS"],
    effects: {
      reserveAfterUsdcRaw: raw(ranking.holdback),
      debtAfterUsdcRaw: null,
      costsUsdcRaw: pick?.costsUsdcRaw ?? null,
      exposure: pick ? [
        { asset: "USDC · NEAR wallet", deltaRaw: (-surplus).toString(), decimals: 6 },
        { asset: "USDC · " + (chosen?.name ?? pick.id), deltaRaw: surplus.toString(), decimals: 6 },
      ] : [],
    },
  }) as StoredPlan;
  if (Object.keys(staking).length) plan.staking = staking;
  plan.title = pick ? `Put ${grouped(ranking.surplus)} USDC of surplus to work until ${next?.dueDate ?? "your next payment"}` : "No surplus can be put to work";
  plan.evidence = w.mode === "demo" ? "Fictional example figures" : "Live reads at " + portfolio.capturedAt;
  plan.figures = [
    { label: "Eligible surplus", value: ranking.surplus, engine: "calendarRanking" },
    { label: "Held back for reserve and dated payments", value: ranking.holdback, engine: "calendarRanking" },
    { label: "Engine pick", value: chosen?.name ?? null, engine: "calendarRanking" },
    { label: "Net estimate to " + (chosen?.dates?.[0]?.dueDate ?? "next date"), value: chosen?.dates?.[0]?.netEarnings ?? null, engine: "calendarRanking" },
  ];
  return plan;
}

/* ───────────── pay an obligation (idle cash, or withdraw then pay) ───────────── */

type Checked = { allowed: boolean; violations: { code: string; message: string }[] };
interface PayEvaluation {
  sources: { idleAvailable: string; withdrawalNeeded: string; covered: boolean; plans: { id: string; eligible: boolean }[]; rheaUnknownReason?: string | null } | null;
  funding: string | null;
  output: string | null;
  reasons: string[];
  payCheck: Checked | null;
  withdrawCheck: Checked | null;
  evidence: string;
}
async function paySources(s: SessionLike, o: Obligation): Promise<PayEvaluation> {
  const w = s.workspace;
  const { portfolio, market, ledger } = await gather(s);
  if (w.mode === "demo") {
    const c = compareObligation(o.id, { workspace: w, portfolio, market, ledger, creditCapacity: null });
    return {
      sources: c.sources,
      funding: c.quote?.maxInput ?? null,
      output: c.quote?.outputValueUsdc ?? o.amount,
      reasons: c.reasons as string[],
      payCheck: c.policy,
      withdrawCheck: null as Checked | null,
      evidence: "Fictional example figures and route costs",
    };
  }
  if (!w.accountId) throw new Error("Open your live account before planning a payment.");
  if (!payoutSupported(o.destination, o.token))
    return { sources: null, funding: null, output: null, reasons: ["NO_LIVE_ROUTE"], payCheck: null, withdrawCheck: null, evidence: "No live route for this chain and token" };
  const route = payoutAsset(o.destination, o.token);
  const [inv, dry] = await Promise.allSettled([
    paymentInventory(w.accountId),
    dryCashQuote(w.accountId, o.recipient, o.destination, units(o.amount, route.decimals).toString(), route.token as "USDC" | "USDT"),
  ]);
  // Fail closed into a blocked plan that names the failed read; never a guessed figure.
  if (inv.status === "rejected" || dry.status === "rejected") {
    const why = (x: PromiseSettledResult<unknown>) => (x.status === "rejected" ? (x.reason instanceof Error ? x.reason.message : String(x.reason)) : null);
    return {
      sources: null, funding: null, output: null, payCheck: null, withdrawCheck: null,
      reasons: [inv.status === "rejected" ? "READ_FAILED: " + why(inv) : null, dry.status === "rejected" ? "QUOTE_UNAVAILABLE: " + why(dry) : null].filter((x): x is string => !!x),
      evidence: "Live reads at " + new Date().toISOString(),
    };
  }
  const inventory = inv.value;
  const quote = dry.value;
  const sources = paymentSources(inventory.wallet, inventory.rhea, otherObligationHoldback(w, o), quote.maxInput);
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const payCheck = evaluatePolicy(
    policyAction(w, "pay", quote.maxInput, {
      recipient: o.recipient.toLowerCase(),
      venue: "1click",
      movingCost: movingCost(quote.maxInput, quote.outputValueUsdc ?? o.amount),
      methods: [{ receiver: USDC, method: "ft_transfer" }],
    }),
    policy,
    ledger,
  );
  const withdrawCheck = units(sources.withdrawalNeeded) > 0n ? evaluatePolicy(policyAction(w, "withdraw", sources.withdrawalNeeded), policy, ledger) : null;
  return {
    sources: { ...sources, rheaUnknownReason: inventory.reason },
    funding: quote.maxInput,
    output: quote.outputValueUsdc ?? null,
    reasons: [] as string[],
    payCheck,
    withdrawCheck,
    evidence: "Live reads and a 1Click dry quote at " + quote.capturedAt + "; the payment journal refreshes both before anything is signed",
  };
}

async function payObligation(s: SessionLike, base: BaseInput, obligationId: string, objective: PlanObjective = "pay_obligation"): Promise<StoredPlan> {
  const w = s.workspace;
  const o = w.obligations.find((x) => x.id === obligationId);
  if (!o) throw new Error("Obligation not found.");
  if (["paid", "cancelled"].includes(o.status)) throw new Error("That payment is already " + o.status + ".");
  const supported = payoutSupported(o.destination, o.token);
  const decimals = supported ? payoutAsset(o.destination, o.token).decimals : 6;
  const r = await paySources(s, o);
  const src = r.sources;
  const funding = r.funding ? units(r.funding) : null;
  const withdrawal = src ? units(src.withdrawalNeeded) : null;
  const payViolations = (r.payCheck?.violations ?? []).map((v) => v.code);
  const common = [...r.reasons.filter((x) => x !== "INSUFFICIENT_ELIGIBLE_CASH"), ...payViolations, ...(supported ? [] : ["NO_LIVE_ROUTE"])];
  const costs = funding !== null && r.output ? (funding - units(r.output)).toString() : null;
  const idleSteps: StepKind[] = ["pay_quote", "pay_deposit", "verify_payout"];
  const wSteps: StepKind[] = ["withdraw", ...idleSteps];
  const alternatives: FundingChoice[] = [
    {
      id: "idle-cash", kind: "idle_cash",
      eligible: false, reasons: [...common, ...(src ? (src.plans[0]?.eligible ? [] : ["IDLE_CASH_SHORT"]) : ["SOURCES_UNVERIFIED"]), ...adapterReasons(idleSteps)],
      amountUsdcRaw: funding?.toString() ?? "0", costsUsdcRaw: costs, foregoneUsdcRaw: "0", interestUsdcRaw: null, healthAfter: null,
      availableAt: new Date().toISOString().slice(0, 10), steps: idleSteps,
    },
    {
      id: "withdraw-then-pay", kind: "withdraw",
      eligible: false,
      reasons: [
        ...common,
        ...(withdrawal === null ? ["SOURCES_UNVERIFIED"] : withdrawal === 0n ? ["NOT_NEEDED_IDLE_CASH_COVERS"] : src?.covered ? [] : ["RHEA_SUPPLY_SHORT"]),
        ...(r.withdrawCheck?.violations ?? []).map((v) => v.code),
        ...adapterReasons(wSteps),
      ],
      amountUsdcRaw: withdrawal?.toString() ?? "0", costsUsdcRaw: costs, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null,
      availableAt: null, steps: wSteps,
    },
  ];
  // Borrowing as a source comes from the lending engine; the new-debt approval is enforced at the borrow step.
  const src2 = await creditSource(w, funding ?? 0n, o.dueDate);
  const b = src2.choice;
  alternatives.push({ ...b, reasons: [...new Set([...approvalLater(b.reasons), ...common, ...(funding === null ? ["SOURCES_UNVERIFIED"] : []), ...adapterReasons(b.steps)])] });
  for (const a of alternatives) a.reasons = [...new Set(a.reasons)];
  for (const a of alternatives.slice(0, 3)) a.eligible = a.reasons.length === 0;
  const protectedAssets = (w.policy ?? defaultPolicy(w.mandate.maxMoveCost)).protectedAssets ?? [];
  for (const asset of protectedAssets)
    alternatives.push({
      id: "sell-" + asset.toLowerCase(), kind: "sell", eligible: false, reasons: ["PROTECTED_ASSET:" + asset],
      amountUsdcRaw: "0", costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps: [],
    });
  const pick = alternatives.find((a) => a.eligible);
  const plan = newPlan({
    ...base,
    objective,
    request: {
      ...base.request, amountRaw: units(o.amount, decimals).toString(), asset: o.token, chain: o.destination,
      recipient: o.recipient, deadline: o.dueDate, obligationId: o.id,
    },
    alternatives,
    recommendedChoiceId: pick?.id,
    effects: {
      reserveAfterUsdcRaw: raw(w.mandate.reserve),
      debtAfterUsdcRaw: "0",
      costsUsdcRaw: costs,
      exposure: funding !== null ? [{ asset: "USDC · NEAR", deltaRaw: (-funding).toString(), decimals: 6 }] : [],
    },
  }) as StoredPlan;
  plan.fundingUsdcRaw = funding?.toString();
  if (src2.credit) plan.credit = src2.credit;
  plan.title = `Pay ${o.label}: exactly ${grouped(o.amount)} ${o.token} on ${CHAIN[o.destination] ?? o.destination} by ${o.dueDate}`;
  plan.evidence = r.evidence;
  plan.figures = [
    { label: "Recipient receives exactly", value: `${grouped(o.amount)} ${o.token}`, engine: "obligation" },
    { label: "Most it can draw (USDC)", value: r.funding, engine: w.mode === "demo" ? "exampleCashQuote" : "dryCashQuote" },
    { label: "Idle wallet USDC after other payments", value: src?.idleAvailable ?? null, engine: "paymentSources" },
    { label: "Rhea withdrawal needed", value: src?.withdrawalNeeded ?? null, engine: "paymentSources" },
    { label: "Reserve kept", value: w.mandate.reserve, engine: "mandate" },
  ];
  return plan;
}

/* ───────────── access cash (monitor: spendable below the holdback ahead of a payment) ───────────── */

const EXIT_MARKET: Record<string, string> = { LiNEAR: "linear", rNEAR: "rnear", NEAR: "native" };

async function accessCash(
  s: SessionLike, base: BaseInput, amount: bigint, deadline: string | undefined, title: string | undefined, figures: PlanExtras["figures"],
): Promise<StoredPlan> {
  const w = s.workspace;
  const { portfolio, market, ledger } = await gather(s);
  const owner = portfolio.positions.filter((p) => p.ownership !== "watched");
  const supplied = owner
    .filter((p) => p.kind === "supplied" && p.asset === "USDC" && (!p.chain || p.chain === "near"))
    .reduce((n, p) => n + units(p.amount), 0n);
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const check = evaluatePolicy(policyAction(w, "withdraw", decimal(amount)), policy, ledger);
  const today = new Date().toISOString().slice(0, 10);
  const wSteps: StepKind[] = ["withdraw"];
  const alternatives: FundingChoice[] = [
    {
      id: "withdraw-rhea", kind: "withdraw",
      eligible: false,
      reasons: [...(supplied >= amount ? [] : ["RHEA_SUPPLY_SHORT"]), ...check.violations.map((v) => v.code), ...adapterReasons(wSteps)],
      amountUsdcRaw: amount.toString(), costsUsdcRaw: w.mode === "demo" ? "0" : null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null,
      availableAt: today, steps: wSteps,
    },
  ];
  // Unstaking (Engines): each staking position gets the steps that actually exit it, sized in its own units and
  // bound to its venue. The NEAR it returns is not USDC; with no swap step it cannot fund a USDC need by itself.
  const { prices } = await stakingEvidence(w, portfolio);
  const staking: StakingSizing = {};
  for (const p of owner.filter((x) => x.kind === "staking")) {
    const exit = exitSteps(p, prices);
    if (!exit) continue;
    const m = market.markets.find((x) => x.id === EXIT_MARKET[p.asset]);
    const ready = exit.kinds.includes("wait_until")
      ? m?.exitDays == null && !exit.kinds.some((k) => k.startsWith("native_")) ? null
        : new Date(Date.now() + ((m?.exitDays ?? 3) + (w.mandate.leadDays ?? 1)) * 86400000).toISOString().slice(0, 10)
      : today;
    const id = "unstake-" + p.id;
    staking[id] = { venue: exit.venue, steps: exit.steps };
    const usdc = BigInt(exit.steps.at(-1)!.usdcRaw || "0");
    alternatives.push({
      id, kind: "unstake", eligible: false,
      reasons: [
        ...exit.reasons,
        ...(ready === null ? ["EXIT_WINDOW_UNKNOWN"] : deadline && ready > deadline ? ["EXIT_MISSES_DUE_DATE"] : []),
        ...(usdc === 0n ? ["POSITION_VALUE_UNKNOWN"] : usdc < amount ? ["POSITION_TOO_SMALL"] : []),
        "NO_SWAP_STEP",
        ...adapterReasons(exit.kinds),
      ],
      amountUsdcRaw: usdc.toString(), costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: ready, steps: exit.kinds,
    });
  }
  const cashCredit = await creditSource(w, amount, deadline ?? today);
  const b = cashCredit.choice;
  const bSteps: StepKind[] = ["borrow"];
  alternatives.push({ ...b, steps: bSteps, reasons: [...new Set([...approvalLater(b.reasons), ...adapterReasons(bSteps)])] });
  for (const a of alternatives) {
    a.reasons = [...new Set(a.reasons)];
    a.eligible = a.reasons.length === 0;
  }
  const pick = alternatives.find((a) => a.eligible);
  const plan = newPlan({
    ...base,
    objective: "access_cash",
    request: { ...base.request, amountRaw: amount.toString(), asset: "USDC", chain: "near", deadline },
    alternatives,
    recommendedChoiceId: pick?.id,
    effects: {
      reserveAfterUsdcRaw: raw(w.mandate.reserve),
      debtAfterUsdcRaw: pick?.kind === "borrow" ? amount.toString() : "0",
      costsUsdcRaw: pick?.costsUsdcRaw ?? null,
      exposure: pick?.kind === "withdraw" ? [
        { asset: "USDC · Rhea supply", deltaRaw: (-amount).toString(), decimals: 6 },
        { asset: "USDC · NEAR wallet", deltaRaw: amount.toString(), decimals: 6 },
      ] : [],
    },
  }) as StoredPlan;
  if (Object.keys(staking).length) plan.staking = staking;
  plan.title = title ?? `Free up ${grouped(decimal(amount))} USDC${deadline ? " by " + deadline : ""}`;
  if (cashCredit.credit) plan.credit = cashCredit.credit;
  plan.evidence = w.mode === "demo" ? "Fictional example figures" : "Live reads at " + portfolio.capturedAt;
  plan.figures = figures?.length ? figures : [{ label: "Rhea USDC supply", value: decimal(supplied), engine: "workspacePortfolio" }];
  return plan;
}

/* ───────────── borrow under stress limits ───────────── */

type Cap = Awaited<ReturnType<typeof lendingPreview>>["capacity"];
/** New debt is evaluated as "eligible once you approve it"; the plan enforces the approval at the borrow step. */
const approvalLater = (reasons: string[]) => reasons.filter((r) => r !== "NEW_DEBT_NEEDS_EXPLICIT_APPROVAL");

/** A slow read fails closed into a named reason instead of hanging the plan. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => { t = setTimeout(() => reject(new Error(what + " timed out after " + ms / 1000 + " s")), ms); })]).finally(() => clearTimeout(t));
}
const CREDIT_READ_MS = 20_000;

/** One Rhea read gives both the borrow alternative and the credit facts the plan carries forward. */
async function creditSource(w: Workspace, amount: bigint, dueDate: string | null) {
  const { cap, failure } = await liveCapacity(w);
  const choice = borrowFundingChoice(cap, amount, dueDate, true);
  if (failure) choice.reasons.push("CREDIT_READ_FAILED: " + failure);
  const debt = (cap as { healthDetail?: { debtUsdcRaw?: string } } | null)?.healthDetail?.debtUsdcRaw ?? null;
  const credit: PlanExtras["credit"] = cap
    ? { venue: "Rhea", debtBeforeUsdcRaw: debt, newDebtUsdcRaw: amount.toString(), interestUsdcRaw: choice.interestUsdcRaw, stressedHealthAfter: choice.healthAfter, borrowApr: cap.borrowApr ?? null, minHealth: cap.minHealth ?? null }
    : undefined;
  return { choice, credit };
}

async function liveCapacity(w: Workspace): Promise<{ cap: Cap | null; failure: string | null }> {
  if (w.mode !== "live" || !w.accountId) return { cap: null, failure: null };
  try {
    return { cap: (await within(lendingPreview(w.accountId, w.policy), CREDIT_READ_MS, "Rhea credit read")).capacity, failure: null };
  } catch (e) {
    return { cap: null, failure: e instanceof Error ? e.message : String(e) };
  }
}

async function borrowPlan(s: SessionLike, base: BaseInput): Promise<StoredPlan> {
  const w = s.workspace;
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const steps: StepKind[] = ["borrow"];
  let capacityRaw: bigint | null = null;
  let reasons: string[] = [];
  let figures: PlanExtras["figures"] = [];
  let evidence = "";
  let healthAfter: string | null = null;
  let collateral: { asset: string; amountRaw: string }[] = [];
  if (w.mode === "live") {
    const { cap, failure } = await liveCapacity(w);
    capacityRaw = cap?.capacityUsdcRaw != null ? BigInt(cap.capacityUsdcRaw) : null;
    reasons = [...(failure ? ["CREDIT_READ_FAILED: " + failure] : []), ...(cap?.reasons ?? []), ...(capacityRaw === null ? ["CAPACITY_UNKNOWN"] : capacityRaw === 0n ? ["NO_STRESS_CAPACITY"] : [])];
    if (cap?.minBorrowUsdcRaw && capacityRaw !== null && capacityRaw > 0n && capacityRaw < BigInt(cap.minBorrowUsdcRaw)) reasons.push("BELOW_MIN_BORROW");
    healthAfter = cap?.stressedHealth ?? null;
    collateral = (cap?.collateral ?? []).filter((c) => c.eligible && BigInt(c.walletRaw) > 0n).map((c) => ({ asset: c.asset, amountRaw: c.walletRaw }));
    evidence = "Live Rhea reads (Pyth prices, finalized state)";
    figures = [
      { label: "Capacity from posted collateral", value: cap?.capacity ?? null, engine: "borrowCapacity" },
      { label: "Binding constraint", value: cap?.bindingConstraint ?? null, engine: "borrowCapacity" },
      { label: "Health now", value: cap?.health ?? null, engine: "borrowCapacity" },
      { label: "Stressed health", value: cap?.stressedHealth ?? null, engine: "borrowCapacity" },
      { label: "Minimum health", value: cap?.minHealth ?? null, engine: "policy" },
      { label: "Borrow APR (variable)", value: cap?.borrowApr != null ? cap.borrowApr + "%" : null, engine: "Rhea" },
      ...(cap?.collateral ?? []).map((c) => ({ label: c.asset + " in your wallet (not collateral)", value: c.walletRaw === "0" ? "0" : decimal(BigInt(c.walletRaw), 24), engine: "Rhea" })),
    ];
  } else {
    // Example: the illustrative credit story (fictional LiNEAR/rNEAR, not pledged), never signable.
    type CreditView = { capacity: string | null; capacityDisplay?: string | null; reason?: string; valuationEvidence?: string; markets?: { bindingConstraint?: string; rows?: { assetId: string; healthCeiling?: string | null }[] }[] };
    let credit: CreditView | null = null;
    try {
      const { portfolio } = await gather(s);
      credit = (await portfolioCredit(portfolio, policy)) as CreditView;
    } catch (e) {
      reasons.push("CREDIT_READ_FAILED: " + (e instanceof Error ? e.message : String(e)));
    }
    capacityRaw = credit?.capacity ? units(credit.capacity) : null;
    if (capacityRaw === null) reasons.push("CAPACITY_UNKNOWN");
    const rows = credit?.markets?.[0]?.rows ?? [];
    evidence = credit?.valuationEvidence ?? "Fictional example figures";
    figures = [
      { label: "Stress capacity", value: credit?.capacity ?? null, engine: "stressCapacity" },
      { label: "Binding constraint", value: credit?.markets?.[0]?.bindingConstraint ?? null, engine: "stressCapacity" },
      ...rows.map((r) => ({ label: r.assetId + " · health ceiling", value: r.healthCeiling ?? null, engine: "stressCapacity" })),
    ];
  }
  figures.push({ label: "Protected assets (never collateral)", value: policy.protectedAssets.join(", ") || "none", engine: "policy" });
  const alternatives: FundingChoice[] = [
    {
      id: "rhea-borrow", kind: "borrow", eligible: false, reasons: [...new Set([...reasons, ...adapterReasons(steps)])],
      amountUsdcRaw: capacityRaw ? capacityRaw.toString() : "0", costsUsdcRaw: null, foregoneUsdcRaw: "0",
      interestUsdcRaw: null, healthAfter, availableAt: null, steps,
    },
  ];
  if (collateral.length)
    alternatives.push({
      id: "add-collateral", kind: "borrow", eligible: adapterReasons(["collateral_add"]).length === 0, reasons: adapterReasons(["collateral_add"]),
      amountUsdcRaw: "0", costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null,
      steps: collateral.map(() => "collateral_add" as StepKind),
    });
  alternatives[0].eligible = alternatives[0].reasons.length === 0;
  const plan = newPlan({
    ...base, objective: "borrow",
    request: { ...base.request, amountRaw: capacityRaw ? capacityRaw.toString() : undefined, asset: "USDC", chain: "near" },
    alternatives, recommendedChoiceId: alternatives.find((a) => a.eligible)?.id,
    effects: { reserveAfterUsdcRaw: raw(w.mandate.reserve), debtAfterUsdcRaw: capacityRaw ? capacityRaw.toString() : null, costsUsdcRaw: null, exposure: capacityRaw ? [{ asset: "USDC debt · Rhea", deltaRaw: capacityRaw.toString(), decimals: 6 }] : [] },
  }) as StoredPlan;
  plan.collateral = collateral;
  plan.title = capacityRaw === null ? "Borrowing capacity can't be established" : `Borrow up to ${grouped(decimal((capacityRaw / 10000n) * 10000n))} USDC under your stress limits`;
  plan.evidence = evidence;
  plan.figures = figures;
  return plan;
}

/* ───────────── repay a loan with available cash ───────────── */

async function repayPlan(s: SessionLike, base: BaseInput): Promise<StoredPlan> {
  const w = s.workspace;
  const { portfolio, market } = await gather(s);
  let debt = 0n;
  let release: { asset: string; amountRaw: string }[] = [];
  let failure: string | null = null;
  if (w.mode === "live") {
    const r = await liveCapacity(w);
    failure = r.failure;
    debt = (r.cap?.debt ?? []).filter((d) => d.asset === "USDC" && d.raw).reduce((n, d) => n + BigInt(d.raw!), 0n);
    release = (r.cap?.collateral ?? []).filter((c) => BigInt(c.collateralRaw) > 0n).map((c) => ({ asset: c.asset, amountRaw: c.collateralRaw }));
  } else {
    debt = portfolio.positions.filter((x) => x.ownership !== "watched" && x.kind === "debt" && x.asset === "USDC").reduce((n, x) => n + units(x.amount), 0n);
  }
  let surplus: bigint | null = null;
  let holdback: string | null = null;
  try {
    const ranking = calendarRanking(w.mandate, market, portfolio, {}, Date.now());
    surplus = units(ranking.surplus);
    holdback = ranking.holdback;
  } catch {
    surplus = null;
  }
  const amount = surplus === null ? 0n : surplus < debt ? surplus : debt;
  const repaySteps: StepKind[] = ["repay"];
  const fullSteps: StepKind[] = ["repay", ...release.map(() => "collateral_release" as StepKind)];
  const common = [
    ...(failure ? ["CREDIT_READ_FAILED: " + failure] : []),
    ...(debt === 0n ? ["NO_DEBT_FOUND"] : []),
    ...(surplus === null ? ["HOLDBACK_UNAVAILABLE"] : surplus === 0n ? ["NO_CASH_ABOVE_HOLDBACK"] : []),
  ];
  const alternatives: FundingChoice[] = [
    { id: "repay-from-cash", kind: "idle_cash", eligible: false, reasons: [...common, ...adapterReasons(repaySteps)], amountUsdcRaw: amount.toString(), costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps: repaySteps },
    { id: "repay-and-release", kind: "idle_cash", eligible: false, reasons: [...common, ...(debt > 0n && amount < debt ? ["PARTIAL_REPAY_ONLY"] : []), ...(release.length ? [] : ["NO_COLLATERAL_TO_RELEASE"]), ...adapterReasons(fullSteps)], amountUsdcRaw: amount.toString(), costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps: fullSteps },
  ];
  for (const a of alternatives) a.eligible = a.reasons.length === 0;
  const plan = newPlan({
    ...base, objective: "repay",
    request: { ...base.request, amountRaw: amount.toString(), asset: "USDC", chain: "near" },
    alternatives, recommendedChoiceId: alternatives.find((a) => a.eligible)?.id,
    effects: { reserveAfterUsdcRaw: raw(holdback), debtAfterUsdcRaw: (debt - amount).toString(), costsUsdcRaw: null, exposure: amount ? [{ asset: "USDC · NEAR wallet", deltaRaw: (-amount).toString(), decimals: 6 }] : [] },
  }) as StoredPlan;
  plan.collateral = release;
  plan.title = debt === 0n ? "No loan to repay" : `Repay ${amount === debt ? "the" : "part of the"} ${grouped(decimal(debt))} USDC loan from cash above your holdback`;
  plan.evidence = w.mode === "demo" ? "Fictional example figures" : "Live Rhea and wallet reads at " + portfolio.capturedAt;
  plan.figures = [
    { label: "USDC debt", value: decimal(debt), engine: w.mode === "live" ? "Rhea" : "portfolio" },
    { label: "Held back for reserve and dated payments", value: holdback, engine: "calendarRanking" },
    { label: "Cash above holdback", value: surplus === null ? null : decimal(surplus), engine: "calendarRanking" },
    { label: "Repay now", value: decimal(amount), engine: "plan" },
  ];
  return plan;
}

/* ───────────── a payment moved: re-plan it ───────────── */

async function changePlan(s: SessionLike, base: BaseInput, label?: string): Promise<StoredPlan> {
  const w = s.workspace;
  const pending = w.obligations.filter((o) => !["paid", "cancelled"].includes(o.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // A moved payment is visible where an earlier plan recorded a different deadline for the same obligation.
  const earlier = (await planList(s.id, 50)).map((x) => x.plan).filter((p) => p.source === w.mode && p.request.obligationId && p.request.deadline);
  const moved = pending.map((o) => ({ o, was: earlier.find((p) => p.request.obligationId === o.id && p.request.deadline !== o.dueDate)?.request.deadline })).filter((x) => x.was && x.was > x.o.dueDate);
  const lower = label?.toLowerCase();
  const target = (lower && pending.find((o) => o.label.toLowerCase().includes(lower))) || moved[0]?.o || pending[0];
  if (!target) {
    const plan = newPlan({ ...base, objective: "respond_to_change", alternatives: [], blockedReasons: ["NO_PENDING_PAYMENT"] }) as StoredPlan;
    plan.title = "No pending payment to re-plan";
    return plan;
  }
  const plan = await payObligation(s, base, target.id, "respond_to_change");
  const was = moved.find((x) => x.o.id === target.id)?.was;
  const superseded = earlier.filter((p) => p.state === "superseded").length;
  plan.title = was
    ? `${target.label} moved from ${was} to ${target.dueDate}: fund it in time`
    : `${target.label} is your next payment (${target.dueDate}): fund it in time`;
  plan.figures = [
    { label: "Payment", value: `${grouped(target.amount)} ${target.token} · ${target.label} · due ${target.dueDate}`, engine: "calendar" },
    { label: "Previously planned for", value: was ?? (lower ? null : "not recorded; showing your nearest payment"), engine: "plans" },
    ...(plan.figures ?? []),
    { label: "Earlier plans superseded by changes", value: String(superseded), engine: "plans" },
  ];
  return plan;
}

const CHAIN: Record<string, string> = { near: "NEAR", base: "Base", arb: "Arbitrum", bnb: "BNB Chain", eth: "Ethereum" };
/** Display grouping of an engine decimal string (no float rounding). */
function grouped(v: string) {
  const [w, f] = v.split(".");
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}


/** Prices and capital for staking sizing. Live: Engines' price evidence and capitalView. Example: FICTIONAL
 * prices derived from the example portfolio's own fictional valuations (labelled demo; never mixed with live),
 * so example stake/exit plans can be reviewed end to end. Example plans still can never be prepared. */
export function examplePrices(portfolio: Portfolio, now = Date.now()): PriceEvidence | null {
  const perToken = (id: string) => {
    const x = portfolio.positions.find((p) => p.id === id);
    if (!x?.valuation?.amount) return null;
    const qty = units(x.amount, 6);
    return qty > 0n ? (units(x.valuation.amount, 12) * 1_000000n) / qty : null;
  };
  const near = perToken("near-wallet");
  if (portfolio.source !== "demo" || !near) return null;
  const at = new Date(now).toISOString();
  const price = (usdE12: bigint) => ({ usdE12: usdE12.toString(), confE12: "0", publishedAt: at, priceIdentifier: "fictional-example" });
  const lst: Record<string, string> = {};
  for (const [asset, id] of [["LiNEAR", "linear-shares"], ["rNEAR", "rnear-shares"]] as const) {
    const v = perToken(id);
    if (v) lst[asset] = ((v * 10n ** 24n) / near).toString();
  }
  return {
    source: "demo", oracle: "fictional example", basis: "Fictional example prices from the example portfolio; not market data",
    blockHeight: null, capturedAt: at, freshUntil: new Date(now + 3_600_000).toISOString(),
    prices: { NEAR: price(near), USDC: price(1_000000000000n) }, lstNearPerToken: lst, unavailable: [],
  } as PriceEvidence;
}
async function stakingEvidence(w: Workspace, portfolio: Portfolio) {
  if (w.mode === "live") {
    const evidence = await readValuationEvidence(w);
    return { prices: evidence.prices, capital: capitalView(w, portfolio, evidence) };
  }
  return { prices: examplePrices(portfolio), capital: capitalView(w, portfolio) };
}

/* ───────────── entry points ───────────── */

interface BaseInput {
  id: string;
  key: string;
  source: ActionPlan["source"];
  accountId: string | null;
  createdBy: ActionPlan["createdBy"];
  request: ActionPlan["request"];
  context: ActionPlan["context"];
}

export interface PlanRequest {
  objective: PlanObjective;
  key: string;
  obligationId?: string;
  text?: string;
  /** Free-text payment label from the question (changed-payment intent). */
  label?: string;
  createdBy?: ActionPlan["createdBy"];
  /** access_cash (monitor): USDC raw to free up, by a date, with the capital figures that raised it. */
  amountRaw?: string;
  deadline?: string;
  title?: string;
  figures?: PlanExtras["figures"];
  /** stake: "linear" or a native validator pool. unstake: the portfolio position to exit. */
  venue?: string;
  positionId?: string;
}

export async function evaluatePlan(s: SessionLike, id: string, req: PlanRequest): Promise<StoredPlan> {
  const base: BaseInput = {
    id,
    key: req.key,
    source: s.workspace.mode,
    accountId: s.workspace.mode === "live" ? s.workspace.accountId : null,
    createdBy: req.createdBy ?? "user",
    request: req.text ? { text: req.text } : {},
    context: planContext(s.workspace, s.revision),
  };
  // Attaches Engines' obligation reservations so every holdback below uses the shared valuation (live only).
  await withCapitalEvidence(s.workspace);
  if (req.objective === "deploy_surplus") return deploySurplus(s, base);
  if (req.objective === "pay_obligation") {
    if (!req.obligationId) throw new Error("Choose the payment to plan.");
    return payObligation(s, base, req.obligationId);
  }
  if (req.objective === "borrow") return borrowPlan(s, base);
  if (req.objective === "repay") return repayPlan(s, base);
  if (req.objective === "respond_to_change") return changePlan(s, base, req.label);
  if (req.objective === "stake") return stakePlan(s, base, req.amountRaw ? BigInt(req.amountRaw) : null, req.venue ?? null);
  if (req.objective === "unstake") {
    if (!req.positionId) throw new Error("Choose the staking position to exit.");
    return unstakePlan(s, base, req.positionId, req.amountRaw ? BigInt(req.amountRaw) : null);
  }
  if (req.objective === "access_cash") {
    if (!req.amountRaw || BigInt(req.amountRaw) <= 0n) throw new Error("Choose how much cash to free up.");
    return accessCash(s, base, BigInt(req.amountRaw), req.deadline, req.title, req.figures);
  }
  throw new Error(`Plans for ${req.objective} are not available yet.`);
}

/** Expands the owner's choice into steps sized by the engine figures stored on the plan. */
export function reviewChoice(plan: StoredPlan, choiceId: string) {
  const choice = plan.alternatives.find((a) => a.id === choiceId);
  if (!choice) throw new Error("Alternative not found.");
  // Staking steps are sized in raw NEAR / LiNEAR and bound to their venue by the staking engine.
  const sized = stakingReviewSpecs(plan, choiceId);
  if (sized) return review(plan, choiceId, sized);
  let collateralIndex = 0;
  const specs: StepSpec[] = choice.steps.map((kind) => {
    if (kind === "supply")
      return { kind, expected: { amountRaw: choice.amountUsdcRaw, asset: "USDC", usdcRaw: choice.amountUsdcRaw, note: "strategy:" + choice.id } };
    if (kind === "withdraw")
      return { kind, expected: { amountRaw: choice.amountUsdcRaw, asset: "USDC", usdcRaw: choice.amountUsdcRaw, note: "Only the shortfall above idle cash" } };
    if (kind === "borrow") return { kind, expected: { amountRaw: choice.amountUsdcRaw, asset: "USDC", usdcRaw: choice.amountUsdcRaw, note: "New debt on Rhea; needs your explicit approval" } };
    if (kind === "repay") return { kind, expected: { amountRaw: choice.amountUsdcRaw, asset: "USDC", usdcRaw: choice.amountUsdcRaw, note: "Never spends your holdback" } };
    if (kind === "collateral_add" || kind === "collateral_release") {
      const c = (plan.collateral ?? [])[collateralIndex++];
      return { kind, expected: { amountRaw: c?.amountRaw, asset: c?.asset, note: kind === "collateral_add" ? "Pledged on Rhea; stays yours" : "Released only if stressed health stays above your minimum" } };
    }
    if (kind === "pay_quote") return { kind, expected: { note: "Executable exact-output quote; no signature" } };
    if (kind === "pay_deposit")
      return { kind, expected: { usdcRaw: plan.fundingUsdcRaw, asset: "USDC", note: "At most this much USDC; the quote sets the exact deposit" } };
    if (kind === "verify_payout")
      return { kind, expected: { amountRaw: plan.request.amountRaw, asset: plan.request.asset, note: "Exact output, verified on the destination chain" } };
    return { kind, expected: {} };
  });
  if (choice.kind === "borrow") applyCreditEffects(plan, choice);
  return review(plan, choiceId, specs);
}


/* ───────────── stake idle NEAR (LiNEAR or a verified validator) and exit staking (Engines) ───────────── */

async function stakePlan(s: SessionLike, base: BaseInput, requestedRaw: bigint | null, venue: string | null): Promise<StoredPlan> {
  const w = s.workspace;
  const { portfolio, market, ledger } = await gather(s);
  const ev = await stakingEvidence(w, portfolio);
  const sizing = sizeStake({ requestedRaw, walletRaw: walletNear(portfolio), surplusUsdcRaw: ev.capital.surplusUsdcRaw ?? null, prices: ev.prices });
  const pool = venue && venue !== "linear" ? venue : null;
  const validator = pool && w.mode === "live" ? await evaluatePool(pool, w.accountId ?? null).catch(() => null) : null;
  const linearExit = market.markets.find((m) => m.id === "linear")?.exitDays ?? null;
  const { alternatives, staking } = stakeAlternatives({
    w, policy: w.policy ?? defaultPolicy(w.mandate.maxMoveCost), ledger, sizing, validator, pool, linearExitDays: linearExit, adapterReasons,
  });
  // Example plans are reviewable with fictional prices; assertPreparable refuses to prepare any example plan.
  const preferred = alternatives.find((a) => a.id === (pool ? "native:" + pool : "linear") && a.eligible);
  const pick = preferred ?? alternatives.find((a) => a.eligible);
  const plan = newPlan({
    ...base,
    objective: "stake",
    request: { ...base.request, amountRaw: sizing.amountRaw.toString(), asset: "NEAR", chain: "near", venue: venue ?? "linear" },
    alternatives,
    recommendedChoiceId: pick?.id,
    blockedReasons: sizing.amountRaw > 0n ? [] : sizing.reasons,
    effects: {
      reserveAfterUsdcRaw: ev.capital.holdbackUsdcRaw ?? null,
      debtAfterUsdcRaw: null,
      costsUsdcRaw: null,
      exposure: pick ? [
        { asset: "NEAR · wallet", deltaRaw: (-sizing.amountRaw).toString(), decimals: 24 },
        { asset: pick.id === "linear" ? "NEAR · staked as LiNEAR" : "NEAR · staked with " + pool, deltaRaw: sizing.amountRaw.toString(), decimals: 24 },
      ] : [],
    },
  }) as StoredPlan;
  plan.staking = staking;
  const near = decimal(sizing.amountRaw, 24).replace(/(\.\d{0,4})\d*$/, "$1");
  plan.title = sizing.amountRaw > 0n ? `Stake ${near} NEAR ${pick?.id.startsWith("native:") ? "with " + pool : "for LiNEAR"}` : "No idle NEAR can be staked";
  plan.evidence = w.mode === "demo" ? "Fictional example figures and prices" : "Live reads at " + portfolio.capturedAt + (ev.prices ? "; " + ev.prices.basis : "");
  plan.figures = [
    { label: "NEAR to stake", value: near, engine: "staking-plans.sizeStake" },
    { label: "Value (oracle lower bound, USDC)", value: decimal(sizing.usdcRaw), engine: "valuation.usdcValue" },
    { label: "Verified surplus (USDC)", value: ev.capital.surplusUsdcRaw == null ? null : decimal(BigInt(ev.capital.surplusUsdcRaw)), engine: "capitalView" },
    ...(validator ? [{ label: "Validator", value: validator.eligible ? "verified · fee " + ((validator.feeBps ?? 0) / 100).toFixed(2) + "% · uptime " + ((validator.uptimeBps ?? 0) / 100).toFixed(2) + "%" : "not eligible", engine: "evaluateValidator" }] : []),
  ];
  return plan;
}

async function unstakePlan(s: SessionLike, base: BaseInput, positionId: string, requestedRaw: bigint | null): Promise<StoredPlan> {
  const w = s.workspace;
  const { portfolio } = await gather(s);
  const p = portfolio.positions.find((x) => x.id === positionId && x.ownership !== "watched");
  if (!p || p.kind !== "staking") throw new Error("That staking position is not in your portfolio.");
  const { prices } = await stakingEvidence(w, portfolio);
  const exit = exitSteps(p, prices, requestedRaw);
  if (!exit) throw new Error("This position has no exit FlowVault can execute.");
  const id = "exit:" + p.id;
  const value = BigInt(exit.steps.at(-1)!.usdcRaw || "0");
  const reasons = [...new Set([...exit.reasons, ...adapterReasons(exit.kinds)])];
  const ready = exit.kinds.includes("wait_until") ? new Date(Date.now() + 72 * 3_600_000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const choice: FundingChoice = {
    id, kind: "unstake", eligible: reasons.length === 0, reasons, amountUsdcRaw: value.toString(),
    costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: ready, steps: exit.kinds,
  };
  const plan = newPlan({
    ...base,
    objective: "unstake",
    request: { ...base.request, positionId: p.id, amountRaw: exit.steps.find((x) => x.kind !== "wait_until")!.amountRaw, asset: p.asset, chain: "near", venue: exit.venue },
    alternatives: [choice],
    recommendedChoiceId: choice.eligible ? id : undefined,
    effects: {
      reserveAfterUsdcRaw: null, debtAfterUsdcRaw: null, costsUsdcRaw: null,
      exposure: [{ asset: "NEAR · wallet (after unbonding)", deltaRaw: exit.steps.at(-1)!.amountRaw, decimals: 24 }],
    },
  }) as StoredPlan;
  plan.staking = { [id]: { venue: exit.venue, steps: exit.steps } };
  plan.title = `Exit ${p.label} back to your wallet`;
  plan.evidence = w.mode === "demo" ? "Fictional example figures" : "Live reads at " + portfolio.capturedAt;
  plan.figures = [
    { label: "Position", value: p.amount + " " + p.asset, engine: "workspacePortfolio" },
    { label: "NEAR back in your wallet", value: decimal(BigInt(exit.steps.at(-1)!.amountRaw), 24), engine: "staking-plans.exitSteps" },
    { label: "Earliest, estimated", value: ready, engine: "staking-plans (4 epochs + margin)" },
  ];
  return plan;
}
