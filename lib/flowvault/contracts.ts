// Shared phase-3 contracts. ORCHESTRATOR-OWNED: every workstream imports from here; nobody redefines
// these shapes locally. To change a shape, append a note to docs/PHASE3.md "Contract change log" and
// keep the change additive (new optional fields / new union members). All money is integer base units
// carried as decimal strings ("raw"); USDC values use 6 decimals. Floats are for display only.
import type { Chain, Obligation, Position, Source } from "./types.ts";
import type { ExecutionStep } from "./timeline.ts";

/* ───────────── 1. Valuation (owner: Engines) ───────────── */

export type ValuationKind = "observed" | "stress" | "executable";

export interface Valuation {
  positionId: string;
  kind: ValuationKind;
  asset: string;
  /** "solana" (additive, Interface A2): a connected Solana wallet's position. */
  chain?: Chain | "solana";
  quantityRaw: string;
  decimals: number;
  /** USDC (6 decimals) value; null = unknown/unsupported. Never coerce null to "0". */
  usdcRaw: string | null;
  source: Source;
  /** Human-readable evidence, e.g. "Rhea oracle price block 224067523", "1Click dry quote". */
  basis: string;
  capturedAt: string;
  freshUntil: string | null;
  /** stress only: drawdown applied, in basis points. */
  stressBps?: number;
  /** executable only: costs and refundable buffer already deducted from usdcRaw. */
  costsUsdcRaw?: string;
  bufferUsdcRaw?: string;
  /** Receipt tokens (LiNEAR, rNEAR, Rhea supply shares) resolved to underlying exposure. */
  underlying?: { asset: string; quantityRaw: string; decimals: number };
  /** Set on a receipt/underlying pair so aggregations count the exposure once. */
  countedVia?: string;
  /** Present when usdcRaw is null. */
  unavailableReason?: string;
}

/** Conservative USDC reservation for one obligation (e.g. 1,000 USDT on BNB). */
export interface Reservation {
  obligationId: string;
  payoutRaw: string;
  payoutAsset: string;
  payoutChain: Chain;
  payoutDecimals: number;
  /** Amount the plan must hold back, in USDC raw: conversion + costs + buffer, rounded UP. */
  reserveUsdcRaw: string;
  conversionUsdcRaw: string;
  costsUsdcRaw: string;
  bufferUsdcRaw: string;
  basis: string;
  source: Source;
  capturedAt: string;
  freshUntil: string | null;
  /** When no evidence is available the obligation stays visible and BLOCKS automation; it is never 0. */
  unavailableReason?: string;
}

/** Portfolio value and spendable capital are separate concepts. */
export interface CapitalView {
  netWorthUsdcRaw: string | null;
  spendableNowUsdcRaw: string;
  holdbackUsdcRaw: string | null;
  surplusUsdcRaw: string | null;
  valuations: Valuation[];
  reservations: Reservation[];
  /** Positions excluded from spendable capital and why (watched, no signing authority, unknown value...). */
  excluded: { positionId: string; reason: string }[];
  capturedAt: string;
}

/* ───────────── 2. Action plans (owner: Assistant & interface) ───────────── */

export type PlanObjective =
  | "deploy_surplus"
  | "pay_obligation"
  | "access_cash"
  | "borrow"
  | "repay"
  | "stake"
  | "unstake"
  | "withdraw"
  | "respond_to_change";

export type PlanState =
  | "draft" // understood, not yet evaluated
  | "evaluated" // engines produced alternatives
  | "reviewed" // owner picked a choice and reviewed effects
  | "executing" // at least one step handed to a wallet
  | "partial"
  | "completed" // every step confirmed AND economic result verified
  | "failed"
  | "blocked" // engines refused; blockedReasons + alternatives say why
  | "superseded" // policy/workspace/mandate changed under it
  | "expired"
  | "cancelled";

export type StepKind =
  | "supply"
  | "withdraw"
  | "stake"
  | "unstake"
  | "withdraw_unstaked"
  // Native validator staking (Engines P2): one pool per step, named in expected.venue.
  | "native_stake"
  | "native_unstake"
  | "native_withdraw"
  | "collateral_add"
  | "borrow"
  | "repay"
  | "collateral_release"
  | "pay_quote"
  | "pay_deposit"
  | "verify_payout"
  | "wait_until";

export type StepState =
  | "pending" // dependencies not met
  | "ready"
  | "prepared"
  | "awaiting_wallet"
  | "submitted"
  | "confirmed"
  | "partial"
  | "failed"
  | "unknown"
  | "skipped";

export interface FundingChoice {
  id: string;
  kind: "idle_cash" | "withdraw" | "unstake" | "sell" | "borrow";
  eligible: boolean;
  reasons: string[];
  amountUsdcRaw: string;
  costsUsdcRaw: string | null;
  foregoneUsdcRaw: string | null;
  interestUsdcRaw: string | null;
  healthAfter: string | null;
  availableAt: string | null;
  steps: StepKind[];
}

export interface PlanStep {
  id: string;
  planId: string;
  kind: StepKind;
  dependsOn: string[];
  /** Account that must sign; null for steps with no signature (verify_payout, wait_until). */
  signer: string | null;
  approval: "owner_wallet" | "none";
  state: StepState;
  /** Links into the existing journals; a step never re-implements signing or verification. */
  attemptId?: string;
  paymentPlanId?: string;
  expiresAt?: string;
  expected: { amountRaw?: string; asset?: string; usdcRaw?: string; note?: string; /** Staking pool or venue for venue-specific steps (native_*). */ venue?: string };
  actual?: { amountRaw?: string; asset?: string; usdcRaw?: string; evidence?: unknown };
  timeline: ExecutionStep[];
}

export interface ActionPlan {
  id: string;
  /** Idempotency key: the same key never creates a second plan. */
  key: string;
  source: Source;
  accountId: string | null;
  objective: PlanObjective;
  createdBy: "assistant" | "user" | "monitor";
  request: {
    text?: string;
    amountRaw?: string;
    asset?: string;
    chain?: Chain;
    recipient?: string;
    deadline?: string;
    obligationId?: string;
    positionId?: string;
    /** Staking venue: "linear" or a native staking pool account. */
    venue?: string;
  };
  /** Fencing: any change invalidates prepared steps (state -> superseded). */
  context: { workspaceRevision: number; mandateVersion: number; policyVersion: number };
  alternatives: FundingChoice[];
  selectedChoiceId?: string;
  steps: PlanStep[];
  effects: {
    reserveAfterUsdcRaw: string | null;
    debtAfterUsdcRaw: string | null;
    costsUsdcRaw: string | null;
    exposure: { asset: string; deltaRaw: string; decimals: number }[];
  };
  approvals: { stepId: string; kind: "new_debt" | "spend" | "stake" | "policy"; grantedAt?: string }[];
  blockedReasons: string[];
  state: PlanState;
  ledgerEntryIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Each execution owner registers an adapter; the plan executor only orchestrates. */
export interface StepAdapter {
  kinds: StepKind[];
  /** Must create/return a durable journal record BEFORE any wallet handoff. */
  prepare(step: PlanStep, plan: ActionPlan): Promise<Partial<PlanStep>>;
  /** Reconcile from finalized evidence only; return ledger entries for confirmed effects. */
  check(step: PlanStep, plan: ActionPlan): Promise<{ patch: Partial<PlanStep>; ledger: LedgerEntry[] }>;
}

/* ───────────── 3. Ledger (owner: Accounting & monitoring) ───────────── */

export type LedgerKind =
  | "contribution"
  | "external_withdrawal"
  | "internal_transfer"
  | "position_entry"
  | "position_exit"
  | "yield"
  | "fee"
  | "refund"
  | "borrow"
  | "interest"
  | "repay"
  | "incentive"
  | "valuation_change"
  | "payment_out";

export interface LedgerEntry {
  id: string;
  at: string;
  kind: LedgerKind;
  asset: string;
  chain?: Chain;
  amountRaw: string;
  decimals: number;
  usdcRaw: string | null;
  /** Principal movement vs profit: a Rhea supply is internal (net worth unchanged); a borrow adds a matching liability. */
  netWorthEffectUsdcRaw: string | null;
  liabilityEffectUsdcRaw: string | null;
  realized: boolean;
  basis: string;
  status: "confirmed" | "pending" | "unresolved";
  planId?: string;
  stepId?: string;
  attemptId?: string;
  positionId?: string;
  txHashes: string[];
  source: Source;
}

export interface Alert {
  id: string;
  dedupeKey: string;
  kind:
    | "obligation_window"
    | "exit_threatens_payment"
    | "reserve_shortfall"
    | "operation_attention"
    | "debt_risk"
    | "recurrence_due";
  severity: "info" | "warn" | "urgent";
  message: string;
  obligationId?: string;
  planId?: string;
  /** A monitor may PROPOSE a plan (createdBy "monitor"); it never authorizes or signs. */
  proposedPlanId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export type { Obligation, Position };

/* Phase 4 — venue-local credit (Stream B). A snapshot is ONE account × chain × pool;
 * neither capacity nor health may be combined across snapshots. */
export interface VenueAsset {
  id: string;
  symbol: string;
  decimals: number;
  chain: Chain;
}
export interface LendingVenueSnapshot {
  venueId: string;
  accountId: string;
  source: Source;
  capturedAt: string;
  freshUntil: string;
  collateralAssets: VenueAsset[];
  debtAssets: VenueAsset[];
  positions: { asset: VenueAsset; suppliedRaw: string; collateralRaw: string; liabilityRaw: string; walletRaw: string | null; valueUsdcRaw: string | null }[];
  pricesAndRisk: { assetId: string; priceUsdcRaw: string | null; ltvBps: number | null; liquidationThresholdBps: number | null; liquidationBonusBps: number | null }[];
  liquidityUsdcRaw: string | null;
  currentCapacityUsdcRaw: string | null;
  stressedCapacityUsdcRaw: string | null;
  debtUsdcRaw: string | null;
  health: string | null;
  stressedHealth: string | null;
  minHealth: string;
  borrowApr: string | null;
  interest: { variable: boolean; accruedIncludedInLiability: boolean; basis: string };
  liquidation: { exposed: boolean; thresholdHealth: string; reasons: string[] };
  exit: { instant: boolean; reasons: string[] };
  reasons: string[];
}
export interface LendingVenueAdapter<State, Request, Preparation, Policy> {
  id: string;
  chain: Chain;
  supportedCollateral: readonly VenueAsset[];
  supportedDebt: readonly VenueAsset[];
  read(accountId: string): Promise<State>;
  inspect(state: State, policy?: Policy, now?: number): LendingVenueSnapshot;
  /** Build only. Caller MUST persist in a fenced journal before owner wallet handoff. */
  prepareOperation(state: State, policy: Policy | undefined, request: Request, now?: number): Preparation;
  fundingChoice(state: State, policy: Policy | undefined, amountUsdcRaw: bigint, dueDate: string | null, approved: boolean, now?: number): FundingChoice;
  /** Monitoring observes risk; it cannot authorize or send operations. */
  monitor(snapshot: LendingVenueSnapshot): { severity: "info" | "warn" | "urgent"; reason: string }[];
}

/* ───────────── Phase 4 — autonomous mandates (owner: Stream C) ─────────────
 * Named AgentMandate because types.ts already exports `Mandate` (the reserve/horizon plan). A mandate bounds what
 * FlowVault may decide and prepare without asking again; the on-chain bound is whatever `authority` really
 * enforces, stated verbatim. The deterministic checker (mandate.ts) decides; research can only advise. */
export type MandateState = "draft" | "approved" | "active" | "paused" | "expired" | "revoked";
export type MandateActionKind =
  | "deploy_surplus" // move surplus above reserve + dated obligations into an allowed strategy
  | "keep_allocation" // bring deployed capital back under the mandate's capital limit
  | "recall_for_obligation" // withdraw from a mandate position when holdback exceeds spendable
  | "protective_exit" // reduce risk: loss limit, venue incident, health
  | "perp_order" // open/modify a perpetual position (Hyperliquid)
  | "perp_reduce"; // reduce-only / close a perpetual position
export type DelegationKind =
  | "owner_signs_each" // no delegated key: FlowVault prepares, the owner's wallet signs every action
  | "hyperliquid_agent" // master-approved API wallet: trades only, cannot withdraw or transfer
  | "near_custody_contract" // funds in a FlowVault custody/vault contract; agent key may call only its bounded method
  | "near_function_call_key" // receiver+methods scoped key; cannot attach deposits (so no ft_transfer_call / Rhea execute)
  | "evm_session_key"; // EIP-7702 / ERC-7710 delegation; wallet-dependent
export interface MandateAuthority {
  kind: DelegationKind;
  status: "not_provisioned" | "prepared" | "verified" | "revoked" | "unsupported";
  /** What the on-chain authority actually bounds, never stronger than the protocol enforces. */
  bounds: string[];
  /** What it does NOT bound: enforced only by FlowVault's checker before it prepares or signs. */
  unbounded: string[];
  custody: string;
  upgradeAuthority: string;
  delegate?: { address: string; chain: "near" | "evm"; name?: string; validUntil?: string };
  verifiedAt?: string;
  evidence?: unknown;
}
export interface AgentMandate {
  id: string;
  /** Any change to terms bumps the version and returns the mandate to draft (needs a new owner signature). */
  version: number;
  source: Source;
  accountId: string;
  title: string;
  state: MandateState;
  createdAt: string;
  updatedAt: string;
  validFrom: string;
  validUntil: string;
  /** Owner's NEP-413 signature over mandateDigest(); a local review is never an approval. */
  approval: { digest: string; signedBy: string; publicKey: string; signedAt: string; method: "nep413" } | null;
  /** Set on an uncertain operation or missing evidence; only the owner clears it. */
  frozen: { at: string; reason: string; ref: string | null } | null;
  scope: {
    /** Account registry ids (`near:alice.near`, `evm:0x…`). */
    accounts: string[];
    assets: { asset: string; chain: Chain | "hyperliquid" }[];
    venues: string[];
    methods: { receiver: string; method: string }[];
    /** "$owner" = the mandate account itself. */
    recipients: string[];
    actions: MandateActionKind[];
    /** StrategySpec ids the mandate may run. */
    strategies: string[];
  };
  limits: {
    capitalUsdcRaw: string;
    perActionUsdcRaw: string;
    cumulativeUsdcRaw: string;
    dailyUsdcRaw: string;
    maxActionsPerDay: number;
    maxCostUsdcRaw: string;
    maxSlippageBps: number;
    maxStrategyLossUsdcRaw: string;
  };
  /** Borrowing is a separate permission from spending; neither is implied by the other. */
  borrowing: { allowed: boolean; maxDebtUsdcRaw: string; minHealth: string };
  spending: { allowed: boolean };
  protection: { reserveFloorUsdcRaw: string; protectObligations: true; obligationBufferDays: number };
  freshness: { quoteMaxAgeSec: number; evidenceMaxAgeSec: number };
  concentration: { maxPositionBps: number; maxProtocolBps: number; maxChainBps: number };
  schedule: { everyMinutes: number; nextRunAt: string | null; lastRunAt: string | null };
  authority: MandateAuthority;
}
/** One deterministic check. ok null = could not be evaluated, which blocks like a failure. */
export interface MandateCheck {
  id: string;
  ok: boolean | null;
  detail: string;
}
/** Append-only audit row linking observation → decision → checks → transactions → results. */
export interface MandateAuditEntry {
  id: string;
  mandateId: string;
  mandateVersion: number;
  runId: string | null;
  at: string;
  phase: "lifecycle" | "observe" | "decide" | "check" | "execute" | "result" | "freeze" | "advice";
  summary: string;
  data?: unknown;
  planId?: string;
  attemptIds?: string[];
  txHashes?: string[];
  ledgerEntryIds?: string[];
}
