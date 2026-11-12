// P2: finalized public reads for native validator staking and the optional policy contract. Read-only;
// no keys or send capability. Used at evaluation, at prepare and again at wallet handoff.
import { rpc, view, networkRpc, validAccount, USDC } from "./near.ts";
import { readValuationEvidence } from "./valuation-evidence.ts";
import { workspacePortfolio } from "./portfolio-service.ts";
import { actionValuation, capitalView } from "./valuation.ts";
import { withDeadline, READ_BUDGET } from "./deadline.ts";
import {
  POOL_WHITELIST,
  NOT_DEPLOYED,
  acceptProposal,
  buildNativePreparation,
  evaluateValidator,
  gasBudgetYocto,
  isNativeKind,
} from "./staking-native.ts";
import type { NativeKind, NativeRequest, NativeStakingPreparation, OnChainAcceptance, ProposalView, ValidatorEvidence } from "./staking-native.ts";
import type { Workspace } from "./types.ts";

const settle = <T,>(p: Promise<T>, label: string, errors: string[]) =>
  withDeadline(p, READ_BUDGET.section, label).catch((e) => {
    errors.push(label + ": " + (e as Error).message);
    return null;
  });

export async function readValidatorEvidence(poolId: string, accountId: string | null): Promise<ValidatorEvidence> {
  if (!validAccount(poolId)) throw new Error("Enter a valid staking pool account.");
  if (accountId !== null && !validAccount(accountId)) throw new Error("Enter a valid public NEAR account.");
  const errors: string[] = [];
  const [white, acct, validators, fee, paused, owner, total, mine] = await Promise.all([
    settle(view<boolean>(POOL_WHITELIST, "is_whitelisted", { staking_pool_account_id: poolId }), "whitelist", errors),
    settle(rpc({ request_type: "view_account", account_id: poolId }), "pool account", errors),
    settle(networkRpc("validators", [null] as unknown as Record<string, unknown>), "validators", errors),
    settle(view<{ numerator: number; denominator: number }>(poolId, "get_reward_fee_fraction"), "reward fee", errors),
    settle(view<boolean>(poolId, "is_staking_paused"), "pause state", errors),
    settle(view<string>(poolId, "get_owner_id"), "pool owner", errors),
    settle(view<string>(poolId, "get_total_staked_balance"), "total stake", errors),
    accountId
      ? settle(view<{ staked_balance: string; unstaked_balance: string; can_withdraw: boolean }>(poolId, "get_account", { account_id: accountId }), "your pool balance", errors)
      : Promise.resolve(null),
  ]);
  const cur = validators?.current_validators?.find((x: any) => x.account_id === poolId);
  const num = (x: unknown) => (Number.isSafeInteger(x) ? (x as number) : 0);
  const digits = (x: unknown) => typeof x === "string" && /^\d+$/.test(x);
  const f = fee?.data;
  const a = mine?.data;
  return {
    poolId,
    capturedAt: new Date().toISOString(),
    whitelisted: typeof white?.data === "boolean" ? white.data : null,
    codeHash: typeof acct?.code_hash === "string" ? acct.code_hash : null,
    epochHeight: Number.isSafeInteger(validators?.epoch_height) ? validators.epoch_height : null,
    current: cur
      ? {
          stake: String(cur.stake),
          slashed: cur.is_slashed === true,
          producedBlocks: num(cur.num_produced_blocks),
          expectedBlocks: num(cur.num_expected_blocks),
          producedChunks: num(cur.num_produced_chunks),
          expectedChunks: num(cur.num_expected_chunks),
        }
      : null,
    inNextEpoch: Array.isArray(validators?.next_validators) ? validators.next_validators.some((x: any) => x.account_id === poolId) : null,
    fee: f && Number.isSafeInteger(f.numerator) && Number.isSafeInteger(f.denominator) && f.denominator > 0 ? f : null,
    paused: typeof paused?.data === "boolean" ? paused.data : null,
    ownerId: typeof owner?.data === "string" ? owner.data : null,
    totalStaked: digits(total?.data) ? (total!.data as string) : null,
    account:
      a && digits(a.staked_balance) && digits(a.unstaked_balance) && typeof a.can_withdraw === "boolean"
        ? { staked: a.staked_balance, unstaked: a.unstaked_balance, canWithdraw: a.can_withdraw }
        : null,
    errors,
  };
}

export async function evaluatePool(poolId: string, accountId: string | null) {
  return evaluateValidator(await readValidatorEvidence(poolId, accountId));
}

/** Reads the configured policy contract and checks the owner-approved proposal. `null` → not deployed. */
export async function onChainAcceptance(
  contractId: string | null | undefined,
  proposalId: string | null | undefined,
  expected: Parameters<typeof acceptProposal>[2],
): Promise<OnChainAcceptance> {
  if (!contractId) return NOT_DEPLOYED;
  if (!validAccount(contractId) || contractId.endsWith(".testnet"))
    throw new Error("ON_CHAIN_PROPOSAL_NOT_ACCEPTED: the configured policy contract must be a mainnet account to govern mainnet staking.");
  if (!proposalId || !/^\d+$/.test(proposalId))
    throw new Error("ON_CHAIN_PROPOSAL_NOT_ACCEPTED: a policy contract is configured; give the id of your approved proposal.");
  const [owner, plan, proposal] = await Promise.all([
    view<string>(contractId, "get_owner"),
    view<{ version: string; asset_id: string } | null>(contractId, "get_plan"),
    view<ProposalView | null>(contractId, "get_proposal", { op_id: proposalId }),
  ]);
  return acceptProposal(
    contractId,
    { owner: owner.data ?? null, planVersion: plan.data?.version ?? null, settlementAsset: plan.data?.asset_id ?? null, proposal: proposal.data },
    expected,
    USDC,
  );
}

const METHOD: Record<NativeKind, string> = { native_stake: "deposit_and_stake", native_unstake: "unstake", native_withdraw: "withdraw" };

/** Re-reads everything and rebuilds the payload (prepare and wallet handoff both use this). */
export async function freshNative(w: Workspace, revision: number, req: NativeRequest, policyContract: string | null) {
  if (w.mode !== "live" || !w.accountId) throw new Error("Open a live account for native staking.");
  if (!isNativeKind(req.kind)) throw new Error("Unknown native staking step.");
  const accountId = w.accountId;
  const [validator, evidence, { portfolio }, native] = await Promise.all([
    evaluatePool(req.pool, accountId),
    readValuationEvidence(w),
    workspacePortfolio(w, { staking: false, watch: false }),
    rpc({ request_type: "view_account", account_id: accountId }),
  ]);
  const value = actionValuation(req.amountRaw, "NEAR", evidence.prices);
  const fee = actionValuation(gasBudgetYocto(), "NEAR", evidence.prices);
  const onChain = await onChainAcceptance(policyContract, req.proposalId, {
    kind: req.kind,
    accountId,
    pool: req.pool,
    method: METHOD[req.kind],
    usdcValueRaw: value.usdcRaw ?? "0",
    gasYocto: gasBudgetYocto().toString(),
  });
  if (!/^\d+$/.test(String(native.amount))) throw new Error("NEAR balance is unverified.");
  const available = BigInt(native.amount) - BigInt(native.storage_usage ?? 0) * 10n ** 19n;
  return buildNativePreparation({
    accountId,
    revision,
    mandateVersion: w.mandate.version,
    policyVersion: w.policy?.version ?? 0,
    req,
    validator,
    onChain,
    value,
    fee,
    capital: capitalView(w, portfolio, evidence),
    nativeAvailableYocto: available > 0n ? available : 0n,
  });
}

export function assertNativeContext(p: NativeStakingPreparation, w: Workspace, revision: number) {
  if (
    w.mode !== "live" ||
    w.accountId !== p.accountId ||
    revision !== p.workspaceRevision ||
    w.mandate.version !== p.mandateVersion ||
    (w.policy?.version ?? 0) !== p.policyVersion
  )
    throw new Error("Staking account, workspace or policy changed. Prepare again.");
}

/** Wallet-handoff re-preparation for a journaled native attempt (transactions route, authorize). */
export async function freshNativeAttempt(p: NativeStakingPreparation, w: Workspace, revision: number, policyContract: string | null) {
  assertNativeContext(p, w, revision);
  const next = await freshNative(
    w,
    revision,
    { kind: p.kind, pool: p.request.pool, amountRaw: BigInt(p.request.amountRaw), approveStake: p.request.approveStake, proposalId: p.request.proposalId },
    policyContract,
  );
  if (next.onChain.status !== p.onChain.status) throw new Error("On-chain policy status changed. Review again.");
  return next;
}
