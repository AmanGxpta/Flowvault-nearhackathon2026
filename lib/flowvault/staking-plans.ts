// Engines: staking in action plans. Sizes stake and exit steps in raw NEAR / LiNEAR (never USDC), binds each
// step to its venue (LiNEAR or one native validator pool), and maps every staking position to the steps that
// actually exit it. All figures come from engines: price evidence (Rhea Pyth), capitalView surplus, the
// validator evaluation and the policy engine. Nothing here prepares or signs.
import type { FundingChoice, StepKind } from "./contracts";
import type { Portfolio, Position, Workspace } from "./types";
import type { PriceEvidence } from "./valuation-evidence";
import type { StepSpec } from "./plans";
import type { PolicyAction, Policy } from "./policy";
import { evaluatePolicy } from "./policy.ts";
import { usdcValue } from "./valuation.ts";
import { decimal, units } from "./money.ts";
import { LINEAR_CONTRACT, RNEAR_CONTRACT } from "./staking-lifecycle.ts";
import { UNSTAKE_EPOCHS } from "./staking-native.ts";
import type { ValidatorEvaluation } from "./staking-native.ts";

/** NEAR kept back for gas and the later exit (matches both LiNEAR and native preparation guards, plus storage margin). */
export const STAKE_NEAR_RESERVE = 750_000_000_000_000_000_000_000n; // 0.75 NEAR
/** USDC kept aside for the network fee when a stake is sized from surplus. */
export const STAKE_FEE_ALLOWANCE_RAW = 1_000_000n; // 1 USDC
/** Conservative unbonding estimate: 4 epochs at up to ~15 h each, plus margin. */
export const UNBONDING_HOURS = 72;

/** Largest raw NEAR amount whose conservative USDC value (oracle lower bound) is ≤ usdcRaw. */
export function nearForUsdc(usdcRaw: bigint, prices: PriceEvidence): bigint {
  if (usdcRaw <= 0n) return 0n;
  const p = prices.prices.NEAR,
    u = prices.prices.USDC;
  if (!p || !u) throw new Error("NEAR or USDC price evidence unavailable.");
  const price = BigInt(p.usdE12) - BigInt(p.confE12);
  const usdc = BigInt(u.usdE12) + BigInt(u.confE12);
  if (price <= 0n) throw new Error("NEAR price confidence too wide.");
  let n = (usdcRaw * 10n ** 24n * usdc) / (price * 1_000_000n);
  while (n > 0n && usdcValue(n, 24, "NEAR", prices, "asset") > usdcRaw) n -= n / 10_000n + 1n;
  return n;
}

/** Spendable NEAR in the owner's wallet before the gas/exit reserve (portfolio "near-wallet" row). */
export function walletNear(p: Portfolio): bigint | null {
  const row = p.positions.find((x) => x.id === "near-wallet" && x.ownership !== "watched");
  return row ? units(row.amount, 24) : null;
}

export interface StakeSizing {
  amountRaw: bigint;
  usdcRaw: bigint;
  reasons: string[];
}

/** Stake sized in NEAR: never more than idle wallet NEAR minus the reserve, nor more than verified surplus. */
export function sizeStake(input: { requestedRaw?: bigint | null; walletRaw: bigint | null; surplusUsdcRaw: string | null; prices: PriceEvidence | null }): StakeSizing {
  const reasons: string[] = [];
  if (!input.prices) return { amountRaw: 0n, usdcRaw: 0n, reasons: ["NEAR_VALUATION_UNAVAILABLE"] };
  if (input.walletRaw === null) reasons.push("NEAR_BALANCE_UNKNOWN");
  if (input.surplusUsdcRaw === null) reasons.push("SURPLUS_UNAVAILABLE");
  const idle = input.walletRaw !== null && input.walletRaw > STAKE_NEAR_RESERVE ? input.walletRaw - STAKE_NEAR_RESERVE : 0n;
  const bySurplus = input.surplusUsdcRaw === null ? 0n : nearForUsdc(BigInt(input.surplusUsdcRaw) - STAKE_FEE_ALLOWANCE_RAW, input.prices);
  let amount = idle < bySurplus ? idle : bySurplus;
  if (input.requestedRaw != null) {
    if (input.requestedRaw > idle) reasons.push("NOT_ENOUGH_IDLE_NEAR");
    if (input.requestedRaw > bySurplus) reasons.push("EXCEEDS_VERIFIED_SURPLUS");
    amount = input.requestedRaw;
  }
  if (amount <= 0n) reasons.push(idle <= 0n ? "NO_IDLE_NEAR" : "NO_ELIGIBLE_SURPLUS");
  let usdc = 0n;
  try {
    usdc = amount > 0n ? usdcValue(amount, 24, "NEAR", input.prices, "asset") : 0n;
  } catch {
    reasons.push("NEAR_VALUATION_UNAVAILABLE");
  }
  return { amountRaw: amount > 0n ? amount : 0n, usdcRaw: usdc, reasons: [...new Set(reasons)] };
}

export function stakePolicyAction(w: Workspace, venue: string, method: string, usdcRaw: bigint, kind = "stake"): PolicyAction {
  const account = w.accountId ?? "fictional-example";
  return {
    kind,
    asset: "NEAR",
    chain: "near",
    amount: decimal(usdcRaw),
    recipient: account,
    venue,
    movingCost: "0",
    gasNear: "0.125",
    source: w.mode,
    accountId: account,
    methods: [{ receiver: venue, method }],
  };
}

export interface StakingSizing {
  /** Per alternative id: the venue and raw quantities each step uses. */
  [choiceId: string]: { venue: string; steps: { kind: StepKind; amountRaw: string; asset: "NEAR" | "LiNEAR" | "rNEAR"; usdcRaw: string; note?: string }[] };
}

/** Stake alternatives for a NEAR amount: LiNEAR, and a native validator when one is named and evaluated. */
export function stakeAlternatives(input: {
  w: Workspace;
  policy: Policy;
  ledger: Parameters<typeof evaluatePolicy>[2];
  sizing: StakeSizing;
  validator: ValidatorEvaluation | null;
  pool: string | null;
  linearExitDays: number | null;
  adapterReasons: (steps: StepKind[]) => string[];
}): { alternatives: FundingChoice[]; staking: StakingSizing } {
  const { w, sizing } = input;
  const staking: StakingSizing = {};
  const alternatives: FundingChoice[] = [];
  const common = sizing.reasons;
  const linearSteps: StepKind[] = ["stake"];
  // Nothing sized means nothing to evaluate: the sizing reason is the honest answer, not a policy refusal.
  const check = (venue: string) => (sizing.usdcRaw > 0n ? evaluatePolicy(stakePolicyAction(w, venue, "deposit_and_stake", sizing.usdcRaw), input.policy, input.ledger).violations : []);
  const linearPolicy = { violations: check(LINEAR_CONTRACT) };
  alternatives.push({
    id: "linear",
    kind: "idle_cash",
    eligible: false,
    reasons: [...common, ...linearPolicy.violations.map((v) => v.code), ...input.adapterReasons(linearSteps)],
    amountUsdcRaw: sizing.usdcRaw.toString(),
    costsUsdcRaw: null,
    foregoneUsdcRaw: null,
    interestUsdcRaw: null,
    healthAfter: null,
    availableAt: input.linearExitDays != null ? new Date(Date.now() + input.linearExitDays * 86_400_000).toISOString().slice(0, 10) : null,
    steps: linearSteps,
  });
  staking.linear = { venue: LINEAR_CONTRACT, steps: [{ kind: "stake", amountRaw: sizing.amountRaw.toString(), asset: "NEAR", usdcRaw: sizing.usdcRaw.toString(), note: "LiNEAR liquid staking · stays yours as LiNEAR" }] };
  if (input.pool) {
    const v = input.validator;
    const nativeSteps: StepKind[] = ["native_stake"];
    const nativePolicy = { violations: check(input.pool) };
    const id = "native:" + input.pool;
    alternatives.push({
      id,
      kind: "idle_cash",
      eligible: false,
      reasons: [
        ...common,
        ...(v ? (v.eligible ? [] : ["VALIDATOR_NOT_ELIGIBLE: " + v.reasons.join("; ")]) : ["VALIDATOR_UNREAD"]),
        ...nativePolicy.violations.map((x) => x.code),
        ...input.adapterReasons(nativeSteps),
      ],
      amountUsdcRaw: sizing.usdcRaw.toString(),
      costsUsdcRaw: null,
      foregoneUsdcRaw: null,
      interestUsdcRaw: null,
      healthAfter: null,
      availableAt: new Date(Date.now() + UNBONDING_HOURS * 3_600_000).toISOString().slice(0, 10),
      steps: nativeSteps,
    });
    staking[id] = {
      venue: input.pool,
      steps: [{ kind: "native_stake", amountRaw: sizing.amountRaw.toString(), asset: "NEAR", usdcRaw: sizing.usdcRaw.toString(), note: "Validator " + input.pool + (v?.feeBps != null ? " · fee " + (v.feeBps / 100).toFixed(2) + "%" : "") }] };
  }
  for (const a of alternatives) {
    a.reasons = [...new Set(a.reasons)];
    a.eligible = a.reasons.length === 0;
  }
  return { alternatives, staking };
}

/** The steps that exit one staking position, sized in its own units. Null when the row is not exitable. */
export function exitSteps(p: Position, prices: PriceEvidence | null, requestedRaw?: bigint | null): { steps: StakingSizing[string]["steps"] & object; venue: string; kinds: StepKind[]; reasons: string[] } | null {
  const reasons: string[] = [];
  const amount = units(p.amount, 24);
  const take = requestedRaw != null && requestedRaw > 0n ? requestedRaw : amount;
  if (take > amount) reasons.push("EXCEEDS_POSITION");
  const value = (raw: bigint, asset: "NEAR" | "LiNEAR" | "rNEAR") => {
    if (!prices) return "0";
    try {
      if (asset === "NEAR") return usdcValue(raw, 24, "NEAR", prices, "asset").toString();
      const per = prices.lstNearPerToken[asset];
      return per ? usdcValue((raw * BigInt(per)) / 10n ** 24n, 24, "NEAR", prices, "asset").toString() : "0";
    } catch {
      return "0";
    }
  };
  const until = new Date(Date.now() + UNBONDING_HOURS * 3_600_000).toISOString();
  if (p.id.startsWith("native-stake-")) {
    const pool = p.id.slice("native-stake-".length);
    return {
      venue: pool,
      kinds: ["native_unstake", "wait_until", "native_withdraw"],
      reasons,
      steps: [
        { kind: "native_unstake", amountRaw: take.toString(), asset: "NEAR", usdcRaw: value(take, "NEAR"), note: "Stops earning now" },
        { kind: "wait_until", amountRaw: "0", asset: "NEAR", usdcRaw: "0", note: until },
        { kind: "native_withdraw", amountRaw: take.toString(), asset: "NEAR", usdcRaw: value(take, "NEAR"), note: "Only once the pool reports it withdrawable (about " + UNSTAKE_EPOCHS + " epochs)" },
      ],
    };
  }
  if (p.id.startsWith("native-unstaking-")) {
    const pool = p.id.slice("native-unstaking-".length);
    const ready = !!p.availableAt;
    return {
      venue: pool,
      kinds: ready ? ["native_withdraw"] : ["wait_until", "native_withdraw"],
      reasons,
      steps: [
        ...(ready ? [] : [{ kind: "wait_until" as StepKind, amountRaw: "0", asset: "NEAR" as const, usdcRaw: "0", note: until }]),
        { kind: "native_withdraw", amountRaw: take.toString(), asset: "NEAR", usdcRaw: value(take, "NEAR"), note: "Withdraw unstaked NEAR to your wallet" },
      ],
    };
  }
  if (p.id === "linear-shares" || p.id === "rnear-shares") {
    const symbol = p.id === "rnear-shares" ? "rNEAR" : "LiNEAR";
    const per = prices?.lstNearPerToken[symbol];
    const nearOut = per ? (take * BigInt(per)) / 10n ** 24n : null;
    if (nearOut === null) reasons.push(symbol === "rNEAR" ? "RNEAR_PRICE_UNAVAILABLE" : "LINEAR_PRICE_UNAVAILABLE");
    return {
      venue: p.id === "rnear-shares" ? RNEAR_CONTRACT : LINEAR_CONTRACT,
      kinds: ["unstake", "wait_until", "withdraw_unstaked"],
      reasons,
      steps: [
        { kind: "unstake", amountRaw: take.toString(), asset: symbol, usdcRaw: value(take, symbol), note: "Delayed unstake; no instant swap" },
        { kind: "wait_until", amountRaw: "0", asset: "NEAR", usdcRaw: "0", note: until },
        { kind: "withdraw_unstaked", amountRaw: (nearOut ?? 0n).toString(), asset: "NEAR", usdcRaw: nearOut ? value(nearOut, "NEAR") : "0", note: "Claim the unstaked NEAR (about " + UNSTAKE_EPOCHS + " epochs later)" },
      ],
    };
  }
  if (p.id === "linear-unstaking" || p.id === "rnear-unstaking") {
    const ready = !!p.availableAt;
    return {
      venue: p.id === "rnear-unstaking" ? RNEAR_CONTRACT : LINEAR_CONTRACT,
      kinds: ready ? ["withdraw_unstaked"] : ["wait_until", "withdraw_unstaked"],
      reasons,
      steps: [
        ...(ready ? [] : [{ kind: "wait_until" as StepKind, amountRaw: "0", asset: "NEAR" as const, usdcRaw: "0", note: until }]),
        { kind: "withdraw_unstaked", amountRaw: take.toString(), asset: "NEAR", usdcRaw: value(take, "NEAR"), note: "Claim the unstaked NEAR" },
      ],
    };
  }
  return null;
}

/** Plan steps for a reviewed staking alternative, from the stored sizing (raw NEAR / LiNEAR, venue bound). */
export function stakingSpecs(sizing: StakingSizing[string]): StepSpec[] {
  return sizing.steps.map((s) =>
    s.kind === "wait_until"
      ? { kind: s.kind, expected: { note: s.note } }
      : { kind: s.kind, expected: { amountRaw: s.amountRaw, asset: s.asset, usdcRaw: s.usdcRaw, venue: sizing.venue, note: s.note } },
  );
}

const STAKING_KINDS: StepKind[] = ["stake", "unstake", "withdraw_unstaked", "native_stake", "native_unstake", "native_withdraw"];
/** Review specs for a staking alternative from its stored sizing; null for non-staking alternatives. Throws when a
 * staking alternative has no NEAR sizing, so a stake can never be sized as USDC. */
export function stakingReviewSpecs(plan: { staking?: StakingSizing; alternatives: FundingChoice[] }, choiceId: string): StepSpec[] | null {
  const sized = plan.staking?.[choiceId];
  if (sized) return stakingSpecs(sized);
  const choice = plan.alternatives.find((a) => a.id === choiceId);
  if (choice?.steps.some((k) => STAKING_KINDS.includes(k))) throw new Error("This staking alternative has no NEAR sizing. Ask again for a fresh plan.");
  return null;
}
