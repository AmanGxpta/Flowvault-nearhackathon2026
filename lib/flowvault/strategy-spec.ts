// Strategy specification (ORCHESTRATOR-OWNED, phase 3 increment toward PRD §7 "strategy-to-vault factory").
// A StrategySpec describes an INDIVIDUAL ACCOUNT strategy: the owner's own funds, executed step by step through
// FlowVault's existing adapters, policy engine, plan executor and ledger. It is NOT a pooled vault: there is no
// custody, share token, NAV, fee crystallization or redemption queue. `kind: "pooled_vault"` is reserved and
// rejected by validateStrategySpec until those mechanics exist.
import type { Chain } from "./types.ts";
import type { LedgerKind, StepKind } from "./contracts.ts";

export interface StrategySpec {
  id: string;
  version: number;
  kind: "account_strategy" | "pooled_vault";
  title: string;
  status: "researched" | "reviewed" | "pilot" | "approved" | "paused" | "retired";
  /** Evidence trail from research (report versions, sources); never marketing copy. */
  research: { reportRef: string | null; reviewedBy: string | null; reviewedAt: string | null };
  assets: { asset: string; chain: Chain; role: "input" | "receipt" | "collateral" | "debt" | "output" }[];
  /** Venue ids exactly as the policy engine knows them (policy.venues / venueIds). */
  venues: { id: string; methods: string[] }[];
  /** Ordered steps; every kind must have a registered StepAdapter before status can pass "reviewed". */
  entry: StepKind[];
  exit: StepKind[];
  limits: {
    maxCapitalUsdcRaw: string;
    minCapitalUsdcRaw: string;
    maxEntryCostUsdcRaw: string;
    maxExitCostUsdcRaw: string;
    maxSlippageBps: number;
    /** Never draws on reserve, obligations, protected assets or existing collateral. */
    surplusOnly: true;
  };
  liquidity: {
    /** Worst-case time from exit start to spendable funds, in hours (e.g. LiNEAR delayed unstake). */
    exitHoursWorstCase: number;
    /** The strategy is ineligible for capital needed before now + exitHoursWorstCase + leadDays. */
    respectsObligationDates: true;
    minVenueLiquidityUsdcRaw: string | null;
  };
  monitoring: {
    condition:
      | "rate_below"
      | "venue_paused"
      | "liquidity_below"
      | "exit_threatens_payment"
      | "health_below"
      | "price_move";
    threshold: string;
    response: "alert" | "propose_exit" | "propose_rebalance";
  }[];
  accounting: {
    /** Ledger kinds this strategy is expected to emit; anything else is flagged for review. */
    emits: LedgerKind[];
    yieldBasis: string;
    forecastSeparateFromRealized: true;
  };
  shutdown: {
    trigger: ("owner_request" | "venue_incident" | "rate_floor" | "retired")[];
    steps: StepKind[];
    /** Funds return to the owner's wallet; no pooled redemption obligations exist. */
    destination: "owner_wallet";
  };
}

export function validateStrategySpec(s: StrategySpec, registeredKinds: StepKind[]): string[] {
  const problems: string[] = [];
  if (s.kind === "pooled_vault")
    problems.push("Pooled vaults need custody, shares, NAV, fees and redemption mechanics that do not exist yet.");
  const missing = [...new Set([...s.entry, ...s.exit, ...s.shutdown.steps])].filter(
    (k) => k !== "wait_until" && !registeredKinds.includes(k),
  );
  if (missing.length && !["researched", "reviewed"].includes(s.status))
    problems.push(`Steps without a registered adapter: ${missing.join(", ")}.`);
  if (BigInt(s.limits.minCapitalUsdcRaw) > BigInt(s.limits.maxCapitalUsdcRaw))
    problems.push("Minimum capital exceeds maximum capital.");
  if (!s.exit.length) problems.push("A strategy must define its exit.");
  if (!s.monitoring.length) problems.push("A strategy must define at least one monitoring condition.");
  return problems;
}

/** First specs, built only from adapters FlowVault already has (or is completing in this phase). */
export const STRATEGY_SPECS: StrategySpec[] = [
  {
    id: "rhea-usdc-surplus",
    version: 1,
    kind: "account_strategy",
    title: "Calendar-aware USDC surplus on Rhea",
    status: "pilot",
    research: { reportRef: null, reviewedBy: null, reviewedAt: null },
    assets: [{ asset: "USDC", chain: "near", role: "input" }],
    venues: [{ id: "contract.main.burrow.near", methods: ["ft_transfer_call", "execute"] }],
    entry: ["supply"],
    exit: ["withdraw"],
    limits: {
      maxCapitalUsdcRaw: "100000000000",
      minCapitalUsdcRaw: "1000000",
      maxEntryCostUsdcRaw: "100000",
      maxExitCostUsdcRaw: "100000",
      maxSlippageBps: 0,
      surplusOnly: true,
    },
    liquidity: { exitHoursWorstCase: 0, respectsObligationDates: true, minVenueLiquidityUsdcRaw: null },
    monitoring: [
      { condition: "exit_threatens_payment", threshold: "leadDays", response: "propose_exit" },
      { condition: "liquidity_below", threshold: "withdrawal amount", response: "alert" },
    ],
    accounting: {
      emits: ["position_entry", "position_exit", "yield", "fee"],
      yieldBasis: "Difference between withdrawn and supplied USDC, attributed per lot; forecast from the variable supply APR only.",
      forecastSeparateFromRealized: true,
    },
    shutdown: { trigger: ["owner_request", "venue_incident", "retired"], steps: ["withdraw"], destination: "owner_wallet" },
  },
  {
    id: "linear-staking-with-exit-reserve",
    version: 1,
    kind: "account_strategy",
    title: "LiNEAR staking with exit reserve",
    status: "reviewed",
    research: { reportRef: null, reviewedBy: null, reviewedAt: null },
    assets: [
      { asset: "NEAR", chain: "near", role: "input" },
      { asset: "LiNEAR", chain: "near", role: "receipt" },
    ],
    venues: [{ id: "linear-protocol.near", methods: ["deposit_and_stake", "unstake", "withdraw_all"] }],
    entry: ["stake"],
    exit: ["unstake", "wait_until", "withdraw_unstaked"],
    limits: {
      maxCapitalUsdcRaw: "50000000000",
      minCapitalUsdcRaw: "1000000",
      maxEntryCostUsdcRaw: "50000",
      maxExitCostUsdcRaw: "50000",
      maxSlippageBps: 0,
      surplusOnly: true,
    },
    liquidity: { exitHoursWorstCase: 72, respectsObligationDates: true, minVenueLiquidityUsdcRaw: null },
    monitoring: [
      { condition: "exit_threatens_payment", threshold: "exitHoursWorstCase + leadDays", response: "propose_exit" },
      { condition: "venue_paused", threshold: "any", response: "alert" },
      { condition: "price_move", threshold: "NEAR -20% vs entry", response: "alert" },
    ],
    accounting: {
      emits: ["position_entry", "position_exit", "yield", "fee", "valuation_change"],
      yieldBasis: "LiNEAR share price change between entry and exit in NEAR; NEAR price exposure reported separately as valuation_change.",
      forecastSeparateFromRealized: true,
    },
    shutdown: { trigger: ["owner_request", "venue_incident"], steps: ["unstake", "wait_until", "withdraw_unstaked"], destination: "owner_wallet" },
  },
];
