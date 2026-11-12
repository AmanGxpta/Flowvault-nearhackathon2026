// P2 (taken by Engines): native validator staking on NEAR mainnet staking pools. Pure rules here;
// finalized public reads in staking-native-live.ts. FlowVault prepares unsigned transactions only; the
// owner's wallet signs. Nothing here holds keys or funds.
import type { PolicyAction } from "./policy.ts";
import type { CapitalView } from "./contracts.ts";
import type { ActionValuation } from "./valuation.ts";
import { decimal } from "./money.ts";

export const NATIVE_KINDS = ["native_stake", "native_unstake", "native_withdraw"] as const;
export type NativeKind = (typeof NATIVE_KINDS)[number];
export const isNativeKind = (k: string): k is NativeKind => (NATIVE_KINDS as readonly string[]).includes(k);

/** NEAR's lockup whitelist: the on-chain registry of staking pools created by the official factory. */
export const POOL_WHITELIST = "lockup-whitelist.near";
/** Code hash of the reference staking-pool contract, observed on astro-stakers.poolv1.near and
 * zavodil.poolv1.near (12 Nov 2026). A pool running other code is not evaluated as a reference pool. */
export const REFERENCE_POOL_CODE = ["J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY"];
export const MAX_FEE_BPS = 1000; // 10%
export const MIN_UPTIME_BPS = 9500; // produced / expected blocks and chunks this epoch
export const POOL_GAS = "125000000000000"; // 125 Tgas; mainnet calls burn ≈ 5–28 Tgas
/** Conservative NEAR cost bound: 125 Tgas at 10× NEAR's minimum gas price (1e8 yocto/gas). */
export const gasBudgetYocto = () => BigInt(POOL_GAS) * 1_000_000_000n;
export const EXIT_GAS_RESERVE = 500000000000000000000000n; // keep 0.5 NEAR after staking
/** NEAR unstaked balance becomes withdrawable after 4 epochs (protocol rule); epochs are ≈ 12–14 h. */
export const UNSTAKE_EPOCHS = 4;
/** Pool share arithmetic rounds by a few yocto; anything beyond this is not the reviewed amount. */
export const ROUNDING_YOCTO = 1_000_000n;

export interface ValidatorEvidence {
  poolId: string;
  capturedAt: string;
  whitelisted: boolean | null;
  codeHash: string | null;
  epochHeight: number | null;
  current: { stake: string; slashed: boolean; producedBlocks: number; expectedBlocks: number; producedChunks: number; expectedChunks: number } | null;
  inNextEpoch: boolean | null;
  fee: { numerator: number; denominator: number } | null;
  paused: boolean | null;
  ownerId: string | null;
  totalStaked: string | null;
  account: { staked: string; unstaked: string; canWithdraw: boolean } | null;
  errors: string[];
}

export interface ValidatorEvaluation {
  poolId: string;
  /** Eligible for NEW stake. Exits only need a verified reference pool. */
  eligible: boolean;
  exitsVerified: boolean;
  reasons: string[];
  feeBps: number | null;
  uptimeBps: number | null;
  stake: string | null;
  epochHeight: number | null;
  account: ValidatorEvidence["account"];
  checks: { name: string; ok: boolean | null; detail: string }[];
  capturedAt: string;
}

export function evaluateValidator(e: ValidatorEvidence, maxFeeBps = MAX_FEE_BPS, minUptimeBps = MIN_UPTIME_BPS): ValidatorEvaluation {
  const checks: ValidatorEvaluation["checks"] = [];
  const add = (name: string, ok: boolean | null, detail: string) => checks.push({ name, ok, detail });
  add("whitelisted", e.whitelisted, e.whitelisted === null ? "lockup-whitelist.near read failed" : e.whitelisted ? "Registered in lockup-whitelist.near" : "Not in lockup-whitelist.near");
  const reference = e.codeHash === null ? null : REFERENCE_POOL_CODE.includes(e.codeHash);
  add("reference_code", reference, e.codeHash === null ? "Contract code hash unread" : reference ? "Reference staking-pool code" : "Code hash " + e.codeHash + " is not the reference staking pool");
  const feeBps = e.fee && e.fee.denominator > 0 ? Math.ceil((e.fee.numerator * 10000) / e.fee.denominator) : null;
  add("fee", feeBps === null ? null : feeBps <= maxFeeBps, feeBps === null ? "Reward fee unread" : `Reward fee ${(feeBps / 100).toFixed(2)}% (max ${(maxFeeBps / 100).toFixed(2)}%)`);
  add("not_paused", e.paused === null ? null : !e.paused, e.paused === null ? "Pause state unread" : e.paused ? "Staking is paused by the pool owner" : "Staking is not paused");
  add("active", e.current === null ? false : !e.current.slashed, e.current === null ? "Not in the current validator set" : e.current.slashed ? "Slashed" : "In the current validator set");
  add("next_epoch", e.inNextEpoch, e.inNextEpoch === null ? "Next validator set unread" : e.inNextEpoch ? "Also in the next epoch's set" : "Not in the next epoch's set");
  let uptimeBps: number | null = null;
  if (e.current) {
    const expected = e.current.expectedBlocks + e.current.expectedChunks;
    const produced = e.current.producedBlocks + e.current.producedChunks;
    uptimeBps = expected > 0 ? Math.floor((produced * 10000) / expected) : null;
  }
  add("uptime", uptimeBps === null ? null : uptimeBps >= minUptimeBps, uptimeBps === null ? "No expected blocks or chunks yet this epoch" : `Produced ${(uptimeBps / 100).toFixed(2)}% of expected blocks and chunks (min ${(minUptimeBps / 100).toFixed(2)}%)`);
  const reasons = checks.filter((c) => c.ok !== true).map((c) => c.name.toUpperCase() + ": " + c.detail);
  reasons.push(...e.errors);
  return {
    poolId: e.poolId,
    eligible: checks.every((c) => c.ok === true) && !e.errors.length,
    exitsVerified: e.whitelisted === true && reference === true,
    reasons,
    feeBps,
    uptimeBps,
    stake: e.current?.stake ?? null,
    epochHeight: e.epochHeight,
    account: e.account,
    checks,
    capturedAt: e.capturedAt,
  };
}

/* ───────────── on-chain proposal acceptance (FlowVault policy contract) ───────────── */

export interface ProposalView {
  id: string;
  owner: string;
  agent: string;
  plan_version: string;
  status: "pending" | "approved" | "rejected" | "recorded";
  expires_at_ms: string;
  action: { kind: string; asset_id: string; venue: string; receiver: string; method: string; amount: string; recipient: string; moving_cost: string; gas_yocto: string };
}
export type OnChainAcceptance =
  | { status: "not_deployed"; contractId: null; reason: string }
  | { status: "accepted"; contractId: string; proposalId: string; planVersion: string; agent: string; expiresAt: string; basis: string };

export const NOT_DEPLOYED = {
  status: "not_deployed",
  contractId: null,
  reason:
    "Not deployed: no FlowVault policy contract id is configured (FLOWVAULT_POLICY_CONTRACT). No on-chain proposal records or limits this action; the app's policy check and your wallet signature are the only gates.",
} as const satisfies OnChainAcceptance;

export const KIND_ON_CHAIN: Record<NativeKind, string> = {
  native_stake: "stake",
  native_unstake: "unstake",
  native_withdraw: "withdraw_unstaked",
};

/** Checks an owner-approved proposal against the prepared action. Throws (fail closed) on any mismatch. */
export function acceptProposal(
  contractId: string,
  input: { owner: string | null; planVersion: string | null; settlementAsset: string | null; proposal: ProposalView | null },
  expected: { kind: NativeKind; accountId: string; pool: string; method: string; usdcValueRaw: string; gasYocto: string },
  usdcAsset: string,
  now = Date.now(),
): OnChainAcceptance {
  const p = input.proposal;
  const fail = (m: string): never => {
    throw new Error("ON_CHAIN_PROPOSAL_NOT_ACCEPTED: " + m);
  };
  if (!p) fail("proposal not found on " + contractId);
  if (input.owner !== expected.accountId) fail(`policy contract owner is ${input.owner ?? "unknown"}, not ${expected.accountId}`);
  if (p!.owner !== expected.accountId) fail("proposal owner differs from the signing account");
  if (p!.status !== "approved") fail(`proposal is ${p!.status}; the owner must approve it on-chain first (and a recorded proposal cannot be reused)`);
  if (input.planVersion === null || p!.plan_version !== input.planVersion) fail("proposal was made under an older on-chain plan version");
  if (Number(p!.expires_at_ms) <= now) fail("proposal expired");
  if (input.settlementAsset !== usdcAsset || p!.action.asset_id !== usdcAsset) fail("on-chain settlement asset is not native USDC, so the cap cannot be compared");
  const a = p!.action;
  if (a.kind !== KIND_ON_CHAIN[expected.kind]) fail(`proposal kind ${a.kind} is not ${KIND_ON_CHAIN[expected.kind]}`);
  if (a.receiver !== expected.pool || a.method !== expected.method) fail("proposal receiver or method differs from the prepared call");
  if (a.recipient !== expected.accountId) fail("proposal recipient is not the owner");
  if (!/^\d+$/.test(a.amount) || BigInt(expected.usdcValueRaw) > BigInt(a.amount)) fail("prepared value exceeds the approved proposal amount");
  if (!/^\d+$/.test(a.gas_yocto) || BigInt(expected.gasYocto) > BigInt(a.gas_yocto)) fail("prepared gas budget exceeds the approved proposal");
  return {
    status: "accepted",
    contractId,
    proposalId: p!.id,
    planVersion: p!.plan_version,
    agent: p!.agent,
    expiresAt: new Date(Number(p!.expires_at_ms)).toISOString(),
    basis: `Owner-approved proposal ${p!.id} on ${contractId} (plan v${p!.plan_version}); a record only, it grants no transaction authority`,
  };
}

/* ───────────── fund authority (stated, not implied) ───────────── */

export function fundAuthority(accountId: string, contractId: string | null) {
  return {
    signer: accountId,
    flowvaultSigns: false,
    contractHoldsFunds: false,
    contractCanRestrictWallet: false,
    statement:
      `Only ${accountId}'s wallet can move these funds, and only by signing this transaction. FlowVault never holds keys or signs. ` +
      (contractId
        ? `The policy contract ${contractId} holds no funds; its approved proposal is a record of your decision and cannot stop a wallet with a full-access key from signing anything else.`
        : "No policy contract is deployed, so nothing on-chain records this decision.") +
      " The staking pool holds the staked NEAR under your account; unstaked NEAR is withdrawable to you only, after about 4 epochs.",
  };
}

/* ───────────── preparation ───────────── */

type Action = { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } };
export interface NativeStakingPreparation {
  kind: NativeKind;
  accountId: string;
  pool: string;
  asset: "NEAR";
  amount: string;
  amountRaw: string;
  decimals: 24;
  usdcValueRaw: string;
  transactions: { receiverId: string; actions: Action[] }[];
  expiresAt: string;
  validator: ValidatorEvaluation;
  onChain: OnChainAcceptance;
  authority: ReturnType<typeof fundAuthority>;
  ownerApproved: boolean;
  availability: { withdrawableAfterEpochs: number | null; estimate: boolean; note: string };
  policyAction: PolicyAction;
  request: { pool: string; amountRaw: string; approveStake: boolean; proposalId: string | null };
  workspaceRevision: number;
  mandateVersion: number;
  policyVersion: number;
  valuationBasis: string;
  warning: string;
}

export interface NativeRequest {
  kind: NativeKind;
  pool: string;
  amountRaw: bigint;
  approveStake?: boolean;
  proposalId?: string | null;
}

const METHOD: Record<NativeKind, string> = { native_stake: "deposit_and_stake", native_unstake: "unstake", native_withdraw: "withdraw" };

export function buildNativePreparation(input: {
  accountId: string;
  revision: number;
  mandateVersion: number;
  policyVersion: number;
  req: NativeRequest;
  validator: ValidatorEvaluation;
  onChain: OnChainAcceptance;
  value: ActionValuation;
  fee: ActionValuation;
  capital: CapitalView;
  nativeAvailableYocto: bigint;
  now?: number;
}): NativeStakingPreparation {
  const { req, validator: v, accountId } = input;
  const now = input.now ?? Date.now();
  if (req.amountRaw <= 0n) throw new Error("Enter a positive NEAR amount.");
  if (v.poolId !== req.pool) throw new Error("Validator evidence is for a different pool.");
  if (!v.exitsVerified) throw new Error("POOL_UNVERIFIED: " + v.reasons.join("; "));
  if (req.kind === "native_stake") {
    if (!v.eligible) throw new Error("VALIDATOR_NOT_ELIGIBLE: " + v.reasons.join("; "));
    if (req.approveStake !== true) throw new Error("STAKE_NEEDS_EXPLICIT_APPROVAL: approve staking with this validator before it is prepared.");
  }
  if (!v.account) throw new Error("Your pool balance could not be read.");
  if (req.kind === "native_unstake" && req.amountRaw > BigInt(v.account.staked))
    throw new Error("Unstake exceeds your staked balance in this pool.");
  if (req.kind === "native_withdraw") {
    if (req.amountRaw > BigInt(v.account.unstaked)) throw new Error("Withdraw exceeds your unstaked balance in this pool.");
    if (!v.account.canWithdraw) throw new Error("Unstaked NEAR is not withdrawable yet; it unlocks about 4 epochs after unstaking.");
  }
  const value = input.value, fee = input.fee;
  if (value.usdcRaw === null || fee.usdcRaw === null || !value.freshUntil || !fee.freshUntil || Date.parse(value.freshUntil) <= now || Date.parse(fee.freshUntil) <= now)
    throw new Error("NEAR valuation is unavailable or stale; policy caps cannot be checked.");
  const deposit = req.kind === "native_stake" ? req.amountRaw : 0n;
  if (input.nativeAvailableYocto < deposit + EXIT_GAS_RESERVE)
    throw new Error("Keep at least 0.5 NEAR for gas and the later exit after this action.");
  if (req.kind === "native_stake" && (input.capital.surplusUsdcRaw === null || BigInt(input.capital.surplusUsdcRaw) < BigInt(value.usdcRaw) + BigInt(fee.usdcRaw)))
    throw new Error("Staking would exceed verified surplus after reserve and obligations.");
  const method = METHOD[req.kind];
  const args = req.kind === "native_stake" ? {} : { amount: req.amountRaw.toString() };
  const transactions = [{ receiverId: req.pool, actions: [{ type: "FunctionCall" as const, params: { methodName: method, args, gas: POOL_GAS, deposit: deposit.toString() } }] }];
  const policyAction: PolicyAction = {
    kind: req.kind === "native_stake" ? "stake" : "withdraw",
    asset: "NEAR",
    chain: "near",
    amount: decimal(BigInt(value.usdcRaw)),
    recipient: accountId,
    venue: req.pool,
    movingCost: decimal(BigInt(fee.usdcRaw)),
    gasNear: decimal(gasBudgetYocto(), 24),
    source: "live",
    accountId,
    methods: [{ receiver: req.pool, method }],
  };
  return {
    kind: req.kind,
    accountId,
    pool: req.pool,
    asset: "NEAR",
    amount: decimal(req.amountRaw, 24),
    amountRaw: req.amountRaw.toString(),
    decimals: 24,
    usdcValueRaw: value.usdcRaw,
    transactions,
    expiresAt: new Date(Math.min(now + 180_000, Date.parse(value.freshUntil), Date.parse(fee.freshUntil))).toISOString(),
    validator: v,
    onChain: input.onChain,
    authority: fundAuthority(accountId, input.onChain.contractId),
    ownerApproved: req.kind !== "native_stake" || req.approveStake === true,
    availability:
      req.kind === "native_unstake"
        ? { withdrawableAfterEpochs: UNSTAKE_EPOCHS, estimate: true, note: "Unstaked NEAR stops earning now and is withdrawable after about 4 epochs (≈ 2–3 days); the pool reports can_withdraw when it is." }
        : req.kind === "native_stake"
          ? { withdrawableAfterEpochs: null, estimate: true, note: "Staked NEAR earns rewards from the next epoch. Getting it back takes an unstake, then about 4 epochs, then a withdraw." }
          : { withdrawableAfterEpochs: 0, estimate: false, note: "The pool reports this NEAR as withdrawable now." },
    policyAction,
    request: { pool: req.pool, amountRaw: req.amountRaw.toString(), approveStake: req.approveStake === true, proposalId: req.proposalId ?? null },
    workspaceRevision: input.revision,
    mandateVersion: input.mandateVersion,
    policyVersion: input.policyVersion,
    valuationBasis: value.basis,
    warning:
      "Prepared transaction only. Nothing has been submitted. Review the validator, amount and gas, then approve in your connected wallet." +
      (req.kind === "native_stake" ? " Staked NEAR is locked: unstaking takes about 4 epochs before it can be withdrawn." : ""),
  };
}

/* ───────────── finalized-receipt verification ───────────── */

export interface NativeEffect {
  kind: NativeKind;
  pool: string;
  depositedRaw?: string;
  stakedRaw?: string;
  sharesRaw?: string;
  unstakedRaw?: string;
  withdrawnRaw?: string;
  receiptId: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Verifies the pool's own finalized receipt logs for this account (format observed on mainnet). */
export function verifyNativeOutcome(result: any, p: NativeStakingPreparation, index: number) {
  const pending = (message: string) => ({ index, state: "pending" as const, message });
  const failed = (message: string) => ({ index, state: "failed" as const, message });
  if (result?.final_execution_status !== "FINAL") return pending("Waiting for finality.");
  const receipts: any[] = result.receipts_outcome ?? [];
  if (receipts.some((r) => r?.outcome?.status && "Failure" in r.outcome.status))
    return failed("A staking-pool receipt failed. Inspect the explorer; do not blindly retry.");
  const tx = result.transaction;
  if (tx?.signer_id !== p.accountId || tx?.receiver_id !== p.pool)
    return failed("The finalized transaction is not from this account to this pool.");
  const acct = esc(p.accountId);
  const amount = BigInt(p.amountRaw);
  for (const r of receipts) {
    if (r?.outcome?.executor_id !== p.pool || !("SuccessValue" in (r.outcome.status ?? {}))) continue;
    const logs: string[] = r.outcome.logs ?? [];
    const find = (re: RegExp) => logs.map((l) => l.match(re)).find(Boolean) ?? null;
    if (p.kind === "native_stake") {
      const dep = find(new RegExp(`^@${acct} deposited (\\d+)\\. New unstaked balance is (\\d+)$`));
      const st = find(new RegExp(`^@${acct} staking (\\d+)\\. Received (\\d+) new staking shares\\.`));
      if (!dep || !st) continue;
      const d = BigInt(dep[1]), s = BigInt(st[1]);
      if (d !== amount) return failed(`The pool recorded a deposit of ${dep[1]} yocto, not the reviewed ${p.amountRaw}.`);
      if (s > d || d - s > ROUNDING_YOCTO) return failed("The staked amount differs from the deposit by more than share rounding.");
      const effect: NativeEffect = { kind: p.kind, pool: p.pool, depositedRaw: dep[1], stakedRaw: st[1], sharesRaw: st[2], receiptId: r.id };
      return { index, state: "confirmed" as const, message: `Staked ${decimal(s, 24)} NEAR with ${p.pool}; verified from the pool's finalized receipt.`, effect };
    }
    if (p.kind === "native_unstake") {
      const u = find(new RegExp(`^@${acct} unstaking (\\d+)\\. Spent (\\d+) staking shares\\.`));
      if (!u) continue;
      const got = BigInt(u[1]);
      const diff = got > amount ? got - amount : amount - got;
      if (diff > ROUNDING_YOCTO) return failed(`The pool unstaked ${u[1]} yocto, not the reviewed ${p.amountRaw}.`);
      const effect: NativeEffect = { kind: p.kind, pool: p.pool, unstakedRaw: u[1], sharesRaw: u[2], receiptId: r.id };
      return { index, state: "confirmed" as const, message: `Unstake of ${decimal(got, 24)} NEAR verified. It becomes withdrawable after about 4 epochs.`, effect };
    }
    const w = find(new RegExp(`^@${acct} withdrawing (\\d+)\\. New unstaked balance is (\\d+)$`));
    if (!w) continue;
    if (BigInt(w[1]) !== amount) return failed(`The pool withdrew ${w[1]} yocto, not the reviewed ${p.amountRaw}.`);
    const effect: NativeEffect = { kind: p.kind, pool: p.pool, withdrawnRaw: w[1], receiptId: r.id };
    return { index, state: "confirmed" as const, message: `Withdrew ${decimal(BigInt(w[1]), 24)} NEAR from ${p.pool} to your wallet; verified from the pool's finalized receipt.`, effect };
  }
  return failed("The pool's finalized receipt does not record this account's expected staking event.");
}
