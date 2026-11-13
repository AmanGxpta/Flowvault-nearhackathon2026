// Autonomous mandates (owner: Stream C). Pure and deterministic: lifecycle, canonical digest for the owner's
// signature, the decision rules for supported strategies and the checker that every proposed action must pass.
// Arithmetic is bigint USDC base units (6 decimals). Research can only ADVISE (sourced, veto-only); it never
// sizes an action, widens a limit or skips a check. Unknown evidence fails closed.
import { sha256 } from "@noble/hashes/sha2";
import type {
  ActionPlan,
  AgentMandate,
  MandateActionKind,
  MandateAuthority,
  MandateCheck,
  MandateState,
} from "./contracts.ts";
import type { StrategySpec } from "./strategy-spec.ts";
import { SUPPLY_USDC } from "./supply.ts";

export const MANDATE_LIMITS = {
  maxScopeEntries: 30,
  minEveryMinutes: 15,
  maxEveryMinutes: 7 * 24 * 60,
  maxValidityDays: 90,
  maxActionsPerDay: 24,
};

/* ───────────── lifecycle ───────────── */

/** Allowed transitions. Anything else is refused. Revoked and expired are terminal. */
const NEXT: Record<MandateState, MandateState[]> = {
  draft: ["approved", "revoked"],
  approved: ["active", "draft", "revoked", "expired"],
  active: ["paused", "revoked", "expired"],
  paused: ["active", "draft", "revoked", "expired"],
  expired: [],
  revoked: [],
};
export function canTransition(from: MandateState, to: MandateState) {
  return NEXT[from].includes(to);
}
export function transition(m: AgentMandate, to: MandateState, at: string): AgentMandate {
  if (!canTransition(m.state, to)) throw new Error(`A ${m.state} mandate cannot become ${to}.`);
  if (to === "approved" && !m.approval) throw new Error("Approval needs the owner's wallet signature over this mandate.");
  if (to === "active") {
    if (!m.approval || m.approval.digest !== mandateDigest(m)) throw new Error("The signed terms don't match this mandate; sign the current version.");
    if (Date.parse(at) >= Date.parse(m.validUntil)) throw new Error("This mandate has expired.");
    if (m.frozen) throw new Error("This mandate is frozen: " + m.frozen.reason + " Resolve it first.");
  }
  const next: AgentMandate = { ...m, state: to, updatedAt: at };
  if (to === "draft") next.approval = null;
  if (to === "active") next.schedule = { ...m.schedule, nextRunAt: m.schedule.nextRunAt ?? at };
  if (to === "paused" || to === "revoked" || to === "expired") next.schedule = { ...m.schedule, nextRunAt: null };
  return next;
}
/** Applies the clock: an active/approved/paused mandate past validUntil becomes expired. */
export function applyClock(m: AgentMandate, now: number): AgentMandate {
  if (["active", "approved", "paused"].includes(m.state) && now >= Date.parse(m.validUntil))
    return transition(m, "expired", new Date(now).toISOString());
  return m;
}

/* ───────────── canonical digest (what the owner signs) ───────────── */

/** Terms only: id, version, account, scope, limits, permissions, protection, freshness, concentration, validity,
 * schedule interval and the authority kind. Runtime fields (state, approval, frozen, run times) are excluded. */
export function mandateTerms(m: AgentMandate) {
  return {
    id: m.id,
    version: m.version,
    source: m.source,
    accountId: m.accountId,
    title: m.title,
    validFrom: m.validFrom,
    validUntil: m.validUntil,
    scope: m.scope,
    limits: m.limits,
    ...(m.perps ? { perps: m.perps } : {}),
    borrowing: m.borrowing,
    spending: m.spending,
    protection: m.protection,
    freshness: m.freshness,
    concentration: m.concentration,
    everyMinutes: m.schedule.everyMinutes,
    authority: { kind: m.authority.kind, delegate: m.authority.delegate ?? null, ...(m.authority.custodyContract ? {custodyContract:m.authority.custodyContract} : {}) },
  };
}
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}
export function mandateDigest(m: AgentMandate) {
  const bytes = sha256(new TextEncoder().encode(canonicalJson(mandateTerms(m))));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/** The exact text the owner's NEAR wallet signs (NEP-413). */
export function approvalMessage(m: AgentMandate) {
  const d = mandateDigest(m);
  return [
    "Approve FlowVault mandate",
    `Mandate: ${m.title} (${m.id} v${m.version})`,
    `Account: ${m.accountId}`,
    `Valid: ${m.validFrom} to ${m.validUntil}`,
    `Capital limit: ${usdc(m.limits.capitalUsdcRaw)} USDC; per action ${usdc(m.limits.perActionUsdcRaw)}; per day ${usdc(m.limits.dailyUsdcRaw)}; lifetime ${usdc(m.limits.cumulativeUsdcRaw)}`,
    `Borrowing: ${m.borrowing.allowed ? "allowed up to " + usdc(m.borrowing.maxDebtUsdcRaw) + " USDC" : "not allowed"}. Spending to others: ${m.spending.allowed ? "allowed" : "not allowed"}.`,
    ...(m.authority.custodyContract ? [`Custody vault: ${m.authority.custodyContract.contractId}; operator ${m.authority.custodyContract.operatorId}; policy version ${m.authority.custodyContract.operatorVersion}; code ${m.authority.custodyContract.codeHash}. Owner and contract full-access keys can upgrade custody code.`] : []),
    `Execution: ${m.authority.kind === "owner_signs_each" ? "FlowVault prepares; your wallet signs every transaction" : m.authority.kind}`,
    ...(m.perps ? [`Perpetuals: maximum leverage ${m.perps.maxLeverage}x; maximum order ${usdc(m.perps.maxNotionalUsdcRaw)} USDC; loss stop ${usdc(m.limits.maxStrategyLossUsdcRaw)} USDC; liquidation cushion ${m.perps.minLiquidationDistanceBps} bps.`] : []),
    `Terms digest: ${d}`,
    "Signing is free, sends no transaction and moves no funds.",
  ].join("\n");
}

/* ───────────── validation ───────────── */

const RAW = /^\d{1,30}$/;
export function validateMandate(m: AgentMandate, strategies: StrategySpec[] = []): string[] {
  const p: string[] = [];
  const raw = (label: string, v: string) => (RAW.test(v) ? BigInt(v) : (p.push(`${label} must be whole USDC base units.`), 0n));
  const cap = raw("Capital limit", m.limits.capitalUsdcRaw);
  const per = raw("Per-action limit", m.limits.perActionUsdcRaw);
  const day = raw("Daily limit", m.limits.dailyUsdcRaw);
  const life = raw("Lifetime limit", m.limits.cumulativeUsdcRaw);
  raw("Cost limit", m.limits.maxCostUsdcRaw);
  raw("Loss limit", m.limits.maxStrategyLossUsdcRaw);
  raw("Reserve floor", m.protection.reserveFloorUsdcRaw);
  raw("Debt limit", m.borrowing.maxDebtUsdcRaw);
  if (cap <= 0n) p.push("Capital limit must be above zero.");
  if (per > day) p.push("Per-action limit is above the daily limit.");
  if (day > life) p.push("Daily limit is above the lifetime limit.");
  // Perps: per-action is order notional and capital is margin, so leverage lets notional exceed it.
  if (per > cap && !m.perps) p.push("Per-action limit is above the capital limit.");
  if (m.limits.maxActionsPerDay < 1 || m.limits.maxActionsPerDay > MANDATE_LIMITS.maxActionsPerDay)
    p.push(`Actions per day must be 1 to ${MANDATE_LIMITS.maxActionsPerDay}.`);
  if (m.limits.maxSlippageBps < 0 || m.limits.maxSlippageBps > 500) p.push("Slippage limit must be 0 to 500 bps.");
  for (const [k, v] of Object.entries(m.concentration)) if (v < 1 || v > 10000) p.push(`${k} must be 1 to 10000 bps.`);
  if (m.freshness.quoteMaxAgeSec < 5 || m.freshness.quoteMaxAgeSec > 600) p.push("Quote freshness must be 5 to 600 seconds.");
  if (m.freshness.evidenceMaxAgeSec < 30 || m.freshness.evidenceMaxAgeSec > 900) p.push("Evidence freshness must be 30 to 900 seconds.");
  if (m.schedule.everyMinutes < MANDATE_LIMITS.minEveryMinutes || m.schedule.everyMinutes > MANDATE_LIMITS.maxEveryMinutes)
    p.push(`Schedule must be every ${MANDATE_LIMITS.minEveryMinutes} minutes to 7 days.`);
  const from = Date.parse(m.validFrom), until = Date.parse(m.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) p.push("Validity window is invalid.");
  else if (until - from > MANDATE_LIMITS.maxValidityDays * 864e5) p.push(`A mandate lasts at most ${MANDATE_LIMITS.maxValidityDays} days; renew it to continue.`);
  if (!m.scope.accounts.length) p.push("Name at least one account the mandate may use.");
  if (!m.scope.actions.length) p.push("Name at least one action the mandate may take.");
  for (const [k, list] of Object.entries(m.scope)) if (Array.isArray(list) && list.length > MANDATE_LIMITS.maxScopeEntries) p.push(`Too many ${k}.`);
  if (m.scope.recipients.some((r) => r !== "$owner") && !m.spending.allowed)
    p.push("Recipients other than your own account need spending to be allowed.");
  if (m.borrowing.allowed && !m.limits.maxStrategyLossUsdcRaw) p.push("Borrowing needs a loss limit.");
  if (!m.borrowing.allowed && BigInt(RAW.test(m.borrowing.maxDebtUsdcRaw) ? m.borrowing.maxDebtUsdcRaw : "0") > 0n)
    p.push("A debt limit without borrowing permission is contradictory; set it to 0.");
  if (m.borrowing.allowed && !/^\d+(\.\d+)?$/.test(m.borrowing.minHealth)) p.push("Borrowing needs a minimum health.");
  const usesPerps = m.scope.actions.some((a) => a === "perp_order" || a === "perp_reduce");
  if (usesPerps && m.authority.kind !== "hyperliquid_agent") p.push("Perpetual actions need a Hyperliquid agent wallet authority.");
  if (usesPerps) {
    if (!m.perps) p.push("Perpetual actions need perp limits (assets, leverage, order size, liquidation cushion).");
    else {
      if (!m.perps.assets.length) p.push("Name the perpetual markets the mandate may trade.");
      if (m.perps.maxLeverage < 1 || m.perps.maxLeverage > 20) p.push("Perp leverage limit must be 1 to 20.");
      if (!RAW.test(m.perps.maxNotionalUsdcRaw) || BigInt(m.perps.maxNotionalUsdcRaw) <= 0n) p.push("Perp order size limit must be above zero.");
      if (m.perps.minLiquidationDistanceBps < 500) p.push("Keep at least a 5% liquidation cushion.");
    }
  }
  for (const id of m.scope.strategies) {
    const s = strategies.find((x) => x.id === id);
    if (!s) p.push(`Unknown strategy ${id}.`);
    else if (s.kind !== "account_strategy") p.push(`${s.title} is not an account strategy.`);
    else if (["paused", "retired", "researched"].includes(s.status)) p.push(`${s.title} is ${s.status}.`);
  }
  if (m.source === "demo" && m.authority.kind !== "owner_signs_each") p.push("Example mandates cannot hold delegated authority.");
  return p;
}

/* ───────────── observation, decision and check ───────────── */

export interface MandateUsage {
  /** Gross USDC moved by actions this mandate committed (reserved at decision; released if nothing happened). */
  cumulativeUsdcRaw: string;
  todayUsdcRaw: string;
  todayActions: number;
  /** Capital currently deployed under this mandate, from confirmed results. */
  deployedUsdcRaw: string;
  realizedLossUsdcRaw: string;
  /** null = the current value of mandate positions is unknown. */
  unrealizedLossUsdcRaw: string | null;
  /** Mandate-created plans still running (no new action while one is open). */
  openPlanIds: string[];
}
export interface MandateObservation {
  now: number;
  /** From capitalView(); the mandate never recomputes these figures. */
  capital: {
    spendableNowUsdcRaw: string;
    holdbackUsdcRaw: string | null;
    surplusUsdcRaw: string | null;
    reserveUsdcRaw: string;
    netWorthUsdcRaw: string | null;
    debtUsdcRaw: string | null;
    blocksAutomation: boolean;
    capturedAt: string;
    reasons: string[];
  };
  horizonDays: number;
  /** Pending obligations and their reservations (reserveUsdcRaw null = unvalued → blocks). */
  obligations: { id: string; dueDate: string; reserveUsdcRaw: string | null }[];
  /** Valued exposure by position, for concentration. usdcRaw null = unknown. */
  exposure: { positionId: string; venue: string; protocol: string; chain: string; usdcRaw: string | null }[];
  /** Mandate positions available to recall (venue → withdrawable USDC). */
  recallable: { venue: string; strategyId: string; usdcRaw: string }[];
  /** Operations whose outcome is not yet known (unknown / partial / awaiting confirmation). Any → freeze. */
  uncertain: { ref: string; state: string }[];
  /** The owner's account-wide stop. */
  killSwitch: boolean;
  usage: MandateUsage;
}
export interface Advice {
  /** A research agent's sourced finding. Without a source URL it is recorded and ignored. */
  claim: string;
  sourceUrl: string | null;
  capturedAt: string;
  /** Advice can only stop new risk or ask for an exit; it cannot size or add exposure. */
  effect: "pause_new_risk" | "propose_exit";
  venue?: string;
}
export interface ProposedAction {
  kind: MandateActionKind;
  strategyId: string | null;
  asset: string;
  chain: string;
  venue: string;
  protocol: string;
  methods: { receiver: string; method: string }[];
  recipient: string;
  amountUsdcRaw: string;
  /** Known only after a quote; null blocks for actions that need it. */
  costUsdcRaw: string | null;
  slippageBps: number | null;
  quoteCapturedAt: string | null;
  borrows: boolean;
  spends: boolean;
  /** Worst-case hours until the funds are spendable again. */
  exitHours: number;
  reason: string;
  deadline?: string;
}

const RISK_REDUCING: MandateActionKind[] = ["recall_for_obligation", "keep_allocation", "protective_exit", "perp_reduce"];
export const reducesRisk = (k: MandateActionKind) => RISK_REDUCING.includes(k);

const big = (s: string | null | undefined) => (s === null || s === undefined ? null : BigInt(s));
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

/** The exact receiver.method pairs each supported step signs (the spec lists venue methods loosely: Rhea supply is
 * USDC.ft_transfer_call with Rhea as the nested receiver; Rhea withdraw is Rhea.execute). */
const EXACT_METHODS: Record<string, Record<"enter" | "exit", { receiver: string; method: string }[]>> = {
  "rhea-usdc-surplus": {
    enter: [{ receiver: SUPPLY_USDC, method: "ft_transfer_call" }],
    exit: [{ receiver: "contract.main.burrow.near", method: "execute" }],
  },
};
/** Strategy wiring for the supported account strategies: venue, protocol and the methods the step uses. */
export function strategyAction(spec: StrategySpec, kind: "enter" | "exit") {
  const v = spec.venues[0];
  const input = spec.assets.find((a) => a.role === "input")!;
  return {
    strategyId: spec.id,
    asset: input.asset,
    chain: input.chain,
    venue: v.id,
    protocol: v.id,
    methods: EXACT_METHODS[spec.id]?.[kind] ?? v.methods.map((method) => ({ receiver: v.id, method })),
    exitHours: kind === "enter" ? spec.liquidity.exitHoursWorstCase : 0,
  };
}

/**
 * Deterministic decision. Order: stop (uncertain operation, kill switch, missing evidence) → protective exit
 * (loss limit, sourced exit advice) → recall for obligations → keep allocation → deploy surplus. At most one
 * new action per run; nothing new while a mandate plan is still open.
 */
export function decide(
  m: AgentMandate,
  o: MandateObservation,
  strategies: StrategySpec[],
  advice: Advice[] = [],
): { actions: ProposedAction[]; stop: string | null; freeze: string | null; notes: string[] } {
  const notes: string[] = [];
  if (o.killSwitch) return { actions: [], stop: "Kill switch is on.", freeze: null, notes };
  if (m.state !== "active") return { actions: [], stop: `Mandate is ${m.state}.`, freeze: null, notes };
  if (m.frozen) return { actions: [], stop: "Frozen: " + m.frozen.reason, freeze: null, notes };
  if (o.uncertain.length)
    return { actions: [], stop: null, freeze: "An operation's outcome is uncertain (" + o.uncertain.map((u) => `${u.ref}: ${u.state}`).join(", ") + "). Check it in your wallet history before anything else runs.", notes };
  if (o.usage.openPlanIds.length) return { actions: [], stop: "A mandate plan is still open: " + o.usage.openPlanIds.join(", "), freeze: null, notes };
  if (o.capital.blocksAutomation || o.capital.holdbackUsdcRaw === null || o.capital.surplusUsdcRaw === null)
    return { actions: [], stop: "Missing evidence: " + (o.capital.reasons.join("; ") || "capital figures unavailable."), freeze: null, notes };
  if (now(o) - Date.parse(o.capital.capturedAt) > m.freshness.evidenceMaxAgeSec * 1000)
    return { actions: [], stop: "Capital evidence is older than the mandate allows.", freeze: null, notes };
  const allowed = (k: MandateActionKind) => m.scope.actions.includes(k);
  const specs = m.scope.strategies.map((id) => strategies.find((s) => s.id === id)).filter((s): s is StrategySpec => !!s);
  const sourced = advice.filter((a) => {
    const ok = !!a.sourceUrl && /^https:\/\//.test(a.sourceUrl);
    if (!ok) notes.push("Ignored unsourced advice: " + a.claim);
    return ok;
  });
  const recall = (kind: MandateActionKind, amount: bigint, reason: string, venue?: string): ProposedAction[] => {
    const out: ProposedAction[] = [];
    let left = amount;
    for (const r of o.recallable) {
      if (left <= 0n) break;
      if (venue && r.venue !== venue) continue;
      const spec = specs.find((s) => s.id === r.strategyId);
      if (!spec) continue;
      const take = min(left, BigInt(r.usdcRaw));
      if (take <= 0n) continue;
      out.push({ ...strategyAction(spec, "exit"), kind, recipient: "$owner", amountUsdcRaw: take.toString(), costUsdcRaw: "0", slippageBps: 0, quoteCapturedAt: o.capital.capturedAt, borrows: false, spends: false, reason });
      left -= take;
    }
    return out.slice(0, 1);
  };

  // 1. Protective exit: loss limit reached or unknown, or sourced advice to exit a venue.
  const loss = big(o.usage.realizedLossUsdcRaw)! + (big(o.usage.unrealizedLossUsdcRaw) ?? 0n);
  const deployed = BigInt(o.usage.deployedUsdcRaw);
  if (deployed > 0n && (o.usage.unrealizedLossUsdcRaw === null || loss >= BigInt(m.limits.maxStrategyLossUsdcRaw))) {
    const why = o.usage.unrealizedLossUsdcRaw === null ? "Position value is unknown, so the loss limit can't be confirmed." : `Loss ${usdc(loss)} USDC reached the mandate's limit.`;
    if (!allowed("protective_exit")) return { actions: [], stop: why + " Protective exits are outside this mandate; pausing.", freeze: null, notes };
    return { actions: recall("protective_exit", deployed, why), stop: null, freeze: null, notes };
  }
  for (const a of sourced.filter((x) => x.effect === "propose_exit"))
    if (allowed("protective_exit")) {
      const acts = recall("protective_exit", deployed, `Sourced advice: ${a.claim} (${a.sourceUrl})`, a.venue);
      if (acts.length) return { actions: acts, stop: null, freeze: null, notes };
    }

  // 2. Recall for dated obligations: holdback above what can be spent now.
  const holdback = BigInt(o.capital.holdbackUsdcRaw);
  const spendable = BigInt(o.capital.spendableNowUsdcRaw);
  if (holdback > spendable && deployed > 0n) {
    if (!allowed("recall_for_obligation")) return { actions: [], stop: "Your reserve and payments need funds the mandate may not recall.", freeze: null, notes };
    const due = o.obligations.map((x) => x.dueDate).sort()[0];
    const acts = recall("recall_for_obligation", holdback - spendable, `Holdback ${usdc(holdback)} exceeds spendable ${usdc(spendable)}.`);
    if (due) for (const x of acts) x.deadline = due;
    if (acts.length) return { actions: acts, stop: null, freeze: null, notes };
  }

  // 3. Keep allocation: deployed above the capital limit (e.g. the owner lowered it).
  const cap = BigInt(m.limits.capitalUsdcRaw);
  if (deployed > cap && allowed("keep_allocation")) {
    const acts = recall("keep_allocation", deployed - cap, `Deployed ${usdc(deployed)} is above the ${usdc(cap)} capital limit.`);
    if (acts.length) return { actions: acts, stop: null, freeze: null, notes };
  }

  // 4. Deploy surplus into the first allowed, enterable strategy.
  if (!allowed("deploy_surplus")) return { actions: [], stop: null, freeze: null, notes: [...notes, "Nothing to do."] };
  if (sourced.some((a) => a.effect === "pause_new_risk")) return { actions: [], stop: "Sourced advice paused new risk.", freeze: null, notes };
  const surplus = BigInt(o.capital.surplusUsdcRaw);
  const room = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
  for (const spec of specs) {
    if (!spec.entry.includes("supply")) {
      notes.push(`${spec.title}: automatic entry is supported for USDC supply strategies only.`);
      continue;
    }
    const amount = min(
      surplus,
      room(cap, deployed),
      BigInt(m.limits.perActionUsdcRaw),
      room(BigInt(m.limits.dailyUsdcRaw), BigInt(o.usage.todayUsdcRaw)),
      room(BigInt(m.limits.cumulativeUsdcRaw), BigInt(o.usage.cumulativeUsdcRaw)),
      BigInt(spec.limits.maxCapitalUsdcRaw),
    );
    if (amount < BigInt(spec.limits.minCapitalUsdcRaw)) {
      notes.push(`${spec.title}: ${usdc(amount)} USDC available is below its ${usdc(spec.limits.minCapitalUsdcRaw)} minimum.`);
      continue;
    }
    return {
      actions: [{ ...strategyAction(spec, "enter"), kind: "deploy_surplus", recipient: "$owner", amountUsdcRaw: amount.toString(), costUsdcRaw: null, slippageBps: spec.limits.maxSlippageBps, quoteCapturedAt: null, borrows: false, spends: false, reason: `Surplus ${usdc(surplus)} above reserve and dated payments.` }],
      stop: null,
      freeze: null,
      notes,
    };
  }
  return { actions: [], stop: null, freeze: null, notes: notes.length ? notes : ["Nothing to do."] };
}
const now = (o: MandateObservation) => o.now;

/**
 * Every check an action must pass before FlowVault prepares it. Risk-reducing actions skip capital, budget,
 * concentration and loss limits (they reduce exposure) but never scope, authority, recipient or freshness.
 */
export function checkAction(m: AgentMandate, o: MandateObservation, a: ProposedAction): { allowed: boolean; checks: MandateCheck[] } {
  const checks: MandateCheck[] = [];
  const c = (id: string, ok: boolean | null, detail: string) => checks.push({ id, ok, detail });
  const at = o.now;
  const reducing = reducesRisk(a.kind);
  const amount = BigInt(a.amountUsdcRaw);

  c("kill_switch", !o.killSwitch, o.killSwitch ? "Kill switch is on." : "Kill switch off.");
  c("state", m.state === "active", `Mandate is ${m.state}.`);
  c("validity", at >= Date.parse(m.validFrom) && at < Date.parse(m.validUntil), `Valid ${m.validFrom} → ${m.validUntil}.`);
  c("frozen", !m.frozen, m.frozen ? "Frozen: " + m.frozen.reason : "Not frozen.");
  c("signed_terms", !!m.approval && m.approval.digest === mandateDigest(m), m.approval ? "Owner signature matches these terms." : "No owner signature.");
  c("uncertain_operations", o.uncertain.length === 0, o.uncertain.length ? `${o.uncertain.length} operation(s) with unknown outcome.` : "No uncertain operations.");
  c("authority", authorityUsable(m.authority), authorityDetail(m.authority));
  c("amount", amount > 0n, `Amount ${usdc(amount)} USDC.`);

  // Scope
  c("scope_action", m.scope.actions.includes(a.kind), `Action ${a.kind}.`);
  c("scope_account", m.scope.accounts.includes("near:" + m.accountId) || m.scope.accounts.includes(m.accountId), `Account ${m.accountId}.`);
  c("scope_asset", m.scope.assets.some((x) => x.asset === a.asset && x.chain === a.chain), `Asset ${a.asset} on ${a.chain}.`);
  c("scope_venue", m.scope.venues.includes(a.venue), `Venue ${a.venue}.`);
  const missing = a.methods.filter((x) => !m.scope.methods.some((y) => y.receiver === x.receiver && y.method === x.method));
  c("scope_methods", missing.length === 0, missing.length ? "Outside scope: " + missing.map((x) => `${x.receiver}.${x.method}`).join(", ") : "All methods in scope.");
  c("scope_recipient", m.scope.recipients.includes(a.recipient), `Recipient ${a.recipient === "$owner" ? "your own account" : a.recipient}.`);
  c("scope_strategy", a.strategyId === null || m.scope.strategies.includes(a.strategyId), `Strategy ${a.strategyId ?? "none"}.`);

  // Permissions: borrowing and spending are separate.
  c("borrowing", !a.borrows || m.borrowing.allowed, a.borrows ? (m.borrowing.allowed ? "Borrowing allowed." : "Borrowing is not allowed by this mandate.") : "No borrowing.");
  if (a.borrows && m.borrowing.allowed) {
    const debt = big(o.capital.debtUsdcRaw);
    c("debt_limit", debt === null ? null : debt + amount <= BigInt(m.borrowing.maxDebtUsdcRaw), debt === null ? "Current debt unknown." : `Debt after ${usdc(debt + amount)} vs limit ${usdc(m.borrowing.maxDebtUsdcRaw)}.`);
  }
  c("spending", !a.spends || m.spending.allowed, a.spends ? (m.spending.allowed ? "Spending allowed." : "Spending is not allowed by this mandate.") : "No spending.");

  // Freshness
  const evAge = at - Date.parse(o.capital.capturedAt);
  c("evidence_fresh", Number.isFinite(evAge) && evAge <= m.freshness.evidenceMaxAgeSec * 1000, `Capital evidence ${Number.isFinite(evAge) ? Math.round(evAge / 1000) + " s" : "unknown"} old (limit ${m.freshness.evidenceMaxAgeSec} s).`);
  if (a.quoteCapturedAt !== null) {
    const qAge = at - Date.parse(a.quoteCapturedAt);
    c("quote_fresh", Number.isFinite(qAge) && qAge <= m.freshness.quoteMaxAgeSec * 1000, `Quote ${Math.round(qAge / 1000)} s old (limit ${m.freshness.quoteMaxAgeSec} s).`);
  } else c("quote_fresh", null, "No executable quote yet; the plan's journal re-quotes before the wallet.");

  // Costs (unknown blocks; the plan journal supplies the exact cost before handoff).
  c("cost", a.costUsdcRaw === null ? null : BigInt(a.costUsdcRaw) <= BigInt(m.limits.maxCostUsdcRaw), a.costUsdcRaw === null ? "Cost not yet quoted." : `Cost ${usdc(a.costUsdcRaw)} vs limit ${usdc(m.limits.maxCostUsdcRaw)}.`);
  c("slippage", a.slippageBps === null ? null : a.slippageBps <= m.limits.maxSlippageBps, a.slippageBps === null ? "Slippage unknown." : `Slippage ${a.slippageBps} bps vs limit ${m.limits.maxSlippageBps}.`);

  if (!reducing) {
    const u = o.usage;
    c("per_action", amount <= BigInt(m.limits.perActionUsdcRaw), `Per action ${usdc(amount)} vs ${usdc(m.limits.perActionUsdcRaw)}.`);
    c("daily", BigInt(u.todayUsdcRaw) + amount <= BigInt(m.limits.dailyUsdcRaw), `Today ${usdc(BigInt(u.todayUsdcRaw) + amount)} vs ${usdc(m.limits.dailyUsdcRaw)}.`);
    c("actions_per_day", u.todayActions + 1 <= m.limits.maxActionsPerDay, `${u.todayActions + 1} of ${m.limits.maxActionsPerDay} actions today.`);
    c("cumulative", BigInt(u.cumulativeUsdcRaw) + amount <= BigInt(m.limits.cumulativeUsdcRaw), `Lifetime ${usdc(BigInt(u.cumulativeUsdcRaw) + amount)} vs ${usdc(m.limits.cumulativeUsdcRaw)}.`);
    c("capital", BigInt(u.deployedUsdcRaw) + amount <= BigInt(m.limits.capitalUsdcRaw), `Deployed after ${usdc(BigInt(u.deployedUsdcRaw) + amount)} vs ${usdc(m.limits.capitalUsdcRaw)}.`);
    const loss = u.unrealizedLossUsdcRaw === null ? null : BigInt(u.realizedLossUsdcRaw) + BigInt(u.unrealizedLossUsdcRaw);
    c("strategy_loss", loss === null ? (BigInt(u.deployedUsdcRaw) === 0n ? true : null) : loss < BigInt(m.limits.maxStrategyLossUsdcRaw), loss === null ? "Position value unknown." : `Loss ${usdc(loss)} vs limit ${usdc(m.limits.maxStrategyLossUsdcRaw)}.`);

    // Reserve and dated obligations: only true surplus may be deployed, and the mandate's own floor holds too.
    const surplus = big(o.capital.surplusUsdcRaw);
    const spendable = BigInt(o.capital.spendableNowUsdcRaw);
    const holdback = big(o.capital.holdbackUsdcRaw);
    c("surplus", surplus === null ? null : amount <= surplus, surplus === null ? "Surplus unknown (reserve or a payment can't be valued)." : `Amount vs surplus ${usdc(surplus)} after reserve and dated payments.`);
    const floor = BigInt(m.protection.reserveFloorUsdcRaw);
    c("reserve_floor", holdback === null ? null : spendable - amount >= (floor > holdback ? floor : holdback), `Spendable after ${usdc(spendable - amount)} vs protected ${usdc(floor > holdback! ? floor : holdback ?? 0n)}.`);
    const unvalued = o.obligations.filter((x) => x.reserveUsdcRaw === null);
    c("obligations_valued", unvalued.length === 0, unvalued.length ? "Unvalued payments: " + unvalued.map((x) => x.id).join(", ") : `${o.obligations.length} dated payment(s) reserved.`);
    // A position that takes longer to exit than the protected horizon could trap money a later payment needs.
    const bufferH = m.protection.obligationBufferDays * 24;
    c("exit_before_obligations", a.exitHours + bufferH <= o.horizonDays * 24, `Exit worst case ${a.exitHours} h + ${bufferH} h buffer vs ${o.horizonDays * 24} h protected horizon.`);

    // Concentration (after the action), denominated in net worth.
    const total = big(o.capital.netWorthUsdcRaw);
    const known = o.exposure.every((x) => x.usdcRaw !== null);
    const sum = (f: (x: MandateObservation["exposure"][number]) => boolean) => o.exposure.filter(f).reduce((n, x) => n + BigInt(x.usdcRaw ?? "0"), 0n) + amount;
    const share = (n: bigint) => (total && total > 0n ? Number((n * 10000n) / total) : null);
    const conc = (id: string, n: bigint, limit: number, label: string) => {
      const s = known ? share(n) : null;
      c(id, s === null ? null : s <= limit, s === null ? "Net worth or exposure unknown." : `${label} ${(s / 100).toFixed(2)}% vs ${(limit / 100).toFixed(2)}%.`);
    };
    conc("concentration_position", sum((x) => x.venue === a.venue), m.concentration.maxPositionBps, "Position");
    conc("concentration_protocol", sum((x) => x.protocol === a.protocol), m.concentration.maxProtocolBps, "Protocol");
    conc("concentration_chain", sum((x) => x.chain === a.chain), m.concentration.maxChainBps, "Chain");
  }
  // Blocking checks: false or unknown. The quote/cost checks may be unknown at decision time ONLY when the
  // execution path re-quotes and re-checks inside the journal (owner-signed plans do), never for delegated keys.
  const deferrable = new Set(m.authority.kind === "owner_signs_each" ? ["quote_fresh", "cost"] : []);
  const allowed = checks.every((x) => x.ok === true || (x.ok === null && deferrable.has(x.id)));
  return { allowed, checks };
}

/* ───────────── authority ───────────── */

export function authorityUsable(a: MandateAuthority) {
  if (a.kind === "owner_signs_each") return true;
  return a.status === "verified";
}
function authorityDetail(a: MandateAuthority) {
  if (a.kind === "owner_signs_each") return "No delegated key: your wallet signs each transaction.";
  return `${a.kind}: ${a.status}.`;
}

/* ───────────── usage accounting ───────────── */

export interface UsageEvent {
  at: string;
  kind: MandateActionKind;
  amountUsdcRaw: string;
  /** committed = reserved at decision; confirmed = verified effect; released = ended without effect. */
  status: "committed" | "confirmed" | "released";
  /** Signed effect on deployed capital once confirmed (+ entry, − exit). */
  deployedDeltaUsdcRaw?: string;
  realizedPnlUsdcRaw?: string;
  planId?: string;
}
/** Usage from the audit's execute/result events; released commitments do not count. */
export function usageFrom(events: UsageEvent[], now: number, unrealizedLossUsdcRaw: string | null, openPlanIds: string[]): MandateUsage {
  const day = new Date(now).toISOString().slice(0, 10);
  let cumulative = 0n, today = 0n, actions = 0, deployed = 0n, realizedLoss = 0n;
  const released = new Set(events.filter((e) => e.status === "released" && e.planId).map((e) => e.planId));
  for (const e of events) {
    if (e.status === "committed" && !(e.planId && released.has(e.planId))) {
      const n = BigInt(e.amountUsdcRaw);
      if (!reducesRisk(e.kind)) {
        cumulative += n;
        if (e.at.slice(0, 10) === day) {
          today += n;
          actions++;
        }
      }
    }
    if (e.status === "confirmed") {
      deployed += BigInt(e.deployedDeltaUsdcRaw ?? "0");
      const pnl = BigInt(e.realizedPnlUsdcRaw ?? "0");
      if (pnl < 0n) realizedLoss += -pnl;
    }
  }
  return {
    cumulativeUsdcRaw: cumulative.toString(),
    todayUsdcRaw: today.toString(),
    todayActions: actions,
    deployedUsdcRaw: (deployed > 0n ? deployed : 0n).toString(),
    realizedLossUsdcRaw: realizedLoss.toString(),
    unrealizedLossUsdcRaw,
    openPlanIds,
  };
}

/**
 * What a mandate-created plan did, from the plan's own journal-verified step states (never from UI state).
 * open: still running (no new mandate action meanwhile). uncertain: a step's outcome is unknown or partial →
 * the mandate freezes. confirmed: verified effect on deployed capital. released: ended with no effect, so the
 * committed budget is returned.
 */
export function planOutcome(plan: Pick<ActionPlan, "state" | "steps" | "ledgerEntryIds">): {
  status: "open" | "uncertain" | "confirmed" | "released";
  deployedDeltaUsdcRaw: string;
  ledgerEntryIds: string[];
  txHashes: string[];
  detail: string;
} {
  const uncertain = plan.steps.filter((x) => x.state === "unknown" || x.state === "partial");
  let delta = 0n;
  const hashes: string[] = [];
  for (const x of plan.steps) {
    if (x.state !== "confirmed" || !x.actual?.usdcRaw) continue;
    if (x.kind === "supply") delta += BigInt(x.actual.usdcRaw);
    if (x.kind === "withdraw") delta -= BigInt(x.actual.usdcRaw);
    const ev = x.actual.evidence as { hashes?: string[] } | string[] | undefined;
    if (Array.isArray(ev)) hashes.push(...ev.filter((h) => typeof h === "string"));
    else if (ev && Array.isArray(ev.hashes)) hashes.push(...ev.hashes);
  }
  const base = { deployedDeltaUsdcRaw: delta.toString(), ledgerEntryIds: plan.ledgerEntryIds, txHashes: hashes };
  if (uncertain.length) return { ...base, status: "uncertain", detail: uncertain.map((x) => `${x.kind} ${x.state}`).join(", ") };
  if (plan.state === "completed") return { ...base, status: "confirmed", detail: "Plan completed and verified." };
  if (["failed", "cancelled", "expired", "superseded", "blocked"].includes(plan.state))
    return plan.steps.some((x) => x.state === "confirmed")
      ? { ...base, status: "confirmed", detail: `Plan ${plan.state} after part of it was confirmed.` }
      : { ...base, status: "released", detail: `Plan ${plan.state} with nothing executed.` };
  return { ...base, status: "open", detail: `Plan ${plan.state}.` };
}

/* ───────────── draft defaults ───────────── */

export function draftMandate(input: {
  id: string;
  accountId: string;
  source: AgentMandate["source"];
  now: number;
  reserveUsdcRaw: string;
  strategy: StrategySpec;
}): AgentMandate {
  const at = new Date(input.now).toISOString();
  const s = input.strategy;
  const enter = strategyAction(s, "enter");
  return {
    id: input.id,
    version: 1,
    source: input.source,
    accountId: input.accountId,
    title: s.title,
    state: "draft",
    createdAt: at,
    updatedAt: at,
    validFrom: at,
    validUntil: new Date(input.now + 30 * 864e5).toISOString(),
    approval: null,
    frozen: null,
    scope: {
      accounts: ["near:" + input.accountId],
      assets: s.assets.filter((a) => a.role === "input").map((a) => ({ asset: a.asset, chain: a.chain })),
      venues: [enter.venue],
      methods: [...enter.methods, ...strategyAction(s, "exit").methods],
      recipients: ["$owner"],
      actions: ["deploy_surplus", "recall_for_obligation", "keep_allocation", "protective_exit"],
      strategies: [s.id],
    },
    limits: {
      capitalUsdcRaw: "100000000", // 100 USDC
      perActionUsdcRaw: "50000000",
      cumulativeUsdcRaw: "1000000000",
      dailyUsdcRaw: "100000000",
      maxActionsPerDay: 2,
      maxCostUsdcRaw: "100000",
      maxSlippageBps: s.limits.maxSlippageBps,
      maxStrategyLossUsdcRaw: "5000000",
    },
    borrowing: { allowed: false, maxDebtUsdcRaw: "0", minHealth: "1.5" },
    spending: { allowed: false },
    protection: { reserveFloorUsdcRaw: input.reserveUsdcRaw, protectObligations: true, obligationBufferDays: 1 },
    freshness: { quoteMaxAgeSec: 60, evidenceMaxAgeSec: 300 },
    concentration: { maxPositionBps: 5000, maxProtocolBps: 5000, maxChainBps: 10000 },
    schedule: { everyMinutes: 60, nextRunAt: null, lastRunAt: null },
    authority: ownerSignsAuthority(),
  };
}

export function ownerSignsAuthority(): MandateAuthority {
  return {
    kind: "owner_signs_each",
    status: "verified",
    bounds: ["Every transaction is signed in your own wallet; FlowVault holds no key and can move nothing."],
    unbounded: ["What FlowVault proposes and prepares is bounded by this mandate's checks, then by your review in the wallet."],
    custody: "Your wallet. Funds never leave your account except through a transaction you sign.",
    upgradeAuthority: "None on-chain. FlowVault's server code decides what it proposes; it cannot sign.",
  };
}

export function usdc(raw: string | bigint) {
  const n = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const whole = a / 1_000000n;
  const frac = (a % 1_000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toString() + (frac ? "." + frac.slice(0, 6) : "");
}
