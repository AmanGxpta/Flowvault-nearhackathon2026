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
  | "respond_to_change"
  // Stream A: one owner action on a vault (deposit, redeem, cancel, claim, settle).
  | "vault_operation";

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
  | "sell"
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
  | "credit_settlement"
  | "wait_until"
  // Funding mesh (Stream A): one cross-wallet leg, signed by the source account's own wallet.
  | "fund_transfer"
  // Vault operations (Stream A): owner-signed calls on a FlowVault vault contract (vault-ops.ts).
  | "vault_deposit"
  | "vault_redeem"
  | "vault_cancel"
  | "vault_claim"
  | "vault_settle";

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
  saleQuote?: SaleQuote;
  creditSettlement?: { leg: FundingLeg; debtBeforeUsdcRaw: string; borrowApr: string; minHealth: string };
  venueId?: string;
  accountId?: string;
  chain?: Chain;
  id: string;
  /** "multi_source" (Stream A): funded from one or more proven accounts; legs in ActionPlan funding extras. */
  kind: "idle_cash" | "withdraw" | "unstake" | "sell" | "borrow" | "multi_source" | "vault_operation";
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
  expected: { amountRaw?: string; asset?: string; usdcRaw?: string; note?: string; /** Staking pool or venue for venue-specific steps (native_*). */ venue?: string; /** fund_transfer: the MultiSourceFunding leg it moves. */ legId?: string };
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
  acquisitionHistoryMissing?: boolean;
  realizedPnlUsdcRaw?: string | null;
  id: string;
  at: string;
  kind: LedgerKind;
  asset: string;
  /** "solana" (additive, Stream A): a funding leg that left a Solana account. */
  chain?: Chain | "solana";
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
    | "recurrence_due"
    | "vault_attention";
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
  custodyContract?: {contractId:string;operatorId:string;publicKey:string;operatorVersion:string;codeHash:string;configDigest:string};
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
  /** Stream C slice 2 (additive): perpetuals limits; required for perp_order / perp_reduce actions. */
  perps?: { assets: string[]; maxLeverage: number; maxNotionalUsdcRaw: string; minLiquidationDistanceBps: number };
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

/* ───────────── Phase 4 — funding mesh (owner: Stream A) ─────────────
 * Cross-wallet orchestration. Each proven account (account-registry.ts) has an ExecutionCapability: what it holds,
 * what is free after other plans' reservations, how it signs, what gas it needs and which operations FlowVault can
 * build for it. A multi-source plan funds one target (the plan's NEAR account) from several such accounts. Every
 * leg is approved in the wallet that controls its source and settles on its own chain: there is NO cross-chain
 * atomicity, so a plan can complete partially and must always say where the funds are. */
export type ExecutionNetwork = "near" | "ethereum" | "base" | "arbitrum" | "solana";
export type SigningMethod = "near_wallet" | "eip1193" | "wallet_standard";
export type FundingOperation =
  | "hold" // already in the account the plan executes from
  | "rhea_withdraw" // Rhea supply → NEAR wallet (existing withdraw journal)
  | "oneclick_deposit"; // transfer USDC to a 1Click deposit address; 1Click converts and delivers to the target
export interface CapabilityAsset {
  asset: string;
  positionId: string;
  decimals: number;
  /** Observed at finality. */
  quantityRaw: string;
  /** Held by other active plans' funding legs (reservations keyed by account). */
  reservedRaw: string;
  /** quantity − reserved, never negative. */
  availableRaw: string;
}
export interface ExecutionCapability {
  /** Registry id, e.g. "evm:0xabc…" or "solana:9xQ…". One capability per account × network. */
  accountId: string;
  chain: "near" | "evm" | "solana";
  network: ExecutionNetwork;
  address: string;
  label: string;
  /** The NEAR account plans execute from. */
  primary: boolean;
  signing: SigningMethod;
  /** A browser fact (a wallet can sign for it right now). The server never knows it and reports null. */
  connected: boolean | null;
  assets: CapabilityAsset[];
  /** Native gas the operations need; payableInUsdc only where a verified USDC-gas path exists (Phase 4 item 3). */
  gas: { asset: "NEAR" | "ETH" | "SOL"; decimals: number; balanceRaw: string | null; needRaw: string | null; sufficient: boolean | null; payableInUsdc: boolean };
  operations: FundingOperation[];
  /** Why an operation or the whole account is unavailable (never silently dropped). */
  reasons: string[];
  source: Source;
  capturedAt: string;
}
/** A reservation is derived from active plans' unfinished legs; it is released when the leg ends or the plan does. */
export interface AccountReservation {
  accountId: string;
  network: ExecutionNetwork;
  asset: string;
  amountRaw: string;
  planId: string;
  legId: string;
  state: "held" | "in_flight";
}
export interface FundingLeg {
  id: string;
  accountId: string;
  network: ExecutionNetwork;
  address: string;
  label: string;
  asset: "USDC";
  operation: FundingOperation;
  /** Account registry id of the wallet that must approve this leg; null for "hold". */
  signer: string | null;
  signing: SigningMethod | null;
  /** Leaves the source (base units of `asset`). */
  amountRaw: string;
  /** At least this arrives at the target after the leg's known costs (USDC raw). */
  minNetRaw: string;
  /** Route fee + slippage bound + gas valued in USDC; null = a cost is unknown (blocks the leg). */
  costsUsdcRaw: string | null;
  gas: { asset: "NEAR" | "ETH" | "SOL"; amountRaw: string | null; usdcRaw: string | null };
  /** The plan step that moves it (none for hold). */
  stepKind: StepKind | null;
  /** Plain-language reason this source was chosen; kept through review and execution. */
  rationale: string;
  eligible: boolean;
  reasons: string[];
}
export interface MultiSourceFunding {
  target: { accountId: string; network: "near"; asset: "USDC"; amountRaw: string };
  mode: "single" | "mixed";
  legs: FundingLeg[];
  /** Sum of legs' minNetRaw. ≥ target.amountRaw for an eligible plan. */
  netToTargetRaw: string;
  costsUsdcRaw: string | null;
  /** Each funding set the engine considered, after all known costs (single sources and the mixed set). */
  comparison: { choiceId: string; mode: "single" | "mixed"; legs: string[]; costsUsdcRaw: string | null; eligible: boolean; reasons: string[] }[];
  /** Always false: legs on different chains cannot be made all-or-nothing. */
  atomic: false;
  /** Why these sources, in order; shown at review and during execution. */
  explanation: string[];
  capturedAt: string;
}
/** Where one leg's funds are right now, from journal + provider evidence (recovery view). */
export interface FundsLocation {
  legId: string;
  where: "source" | "in_transit" | "target" | "refunded_to_source" | "unknown";
  accountId: string;
  network: ExecutionNetwork;
  amountRaw: string;
  detail: string;
  /** What the owner can do next, if anything. */
  next: string | null;
  evidence: string[];
}

/* Phase 4 — asset sale venues. Discovery/quotes are not execution evidence. */
export interface SaleRequest {
  asset: VenueAsset;
  accountId: string;
  recipient: string;
  netUsdcRaw: string;
  maxInputRaw: string;
  slippageBps: number;
}
export interface SaleQuote {
  venueId: string;
  request: SaleRequest;
  dry: boolean;
  inputRaw: string;
  minInputRaw: string;
  minProceedsUsdcRaw: string;
  inputValueUsdcRaw: string;
  costsUsdcRaw: string;
  refundableBufferUsdcRaw: string;
  capturedAt: string;
  expiresAt: string;
  evidence: unknown;
}
export interface SaleReconciliation {
  soldRaw: string | null;
  proceedsUsdcRaw: string | null;
  leftoversRaw: string | null;
  /** A price quote does not establish acquisition cost. */
  acquisitionHistoryMissing: boolean;
  realizedPnlUsdcRaw: string | null;
  complete: boolean;
  reasons: string[];
}
export interface SaleVenueAdapter<Preparation, Evidence> {
  id: string;
  supports(asset: VenueAsset): boolean;
  /** Validated catalog/market identity, liquidity and exact NET proceeds. No key or spending authority. */
  quoteExactNet(request: SaleRequest, evidence: Evidence, dry: boolean): Promise<SaleQuote>;
  /** Builds only; caller persists to the existing fenced wallet journal before signing. */
  prepareOperation(quote: SaleQuote, evidence: Evidence): Preparation;
  reconcile(quote: SaleQuote, proof: { inputRaw: string; refundRaw: string | null; proceedsUsdcRaw: string | null; finalized: boolean }): SaleReconciliation;
}
