// LiNEAR journal domain. SDK quotes never send; all policy values come from Engines.
import type { CapitalView } from "./contracts.ts";
import type { Workspace } from "./types.ts";
import type { PolicyAction } from "./policy.ts";
import type { ActionValuation } from "./valuation.ts";
import { actionValuation, capitalView } from "./valuation.ts";
import { readValuationEvidence } from "./valuation-evidence.ts";
import { workspacePortfolio } from "./portfolio-service.ts";
import { rpc } from "./near.ts";
import { decimal } from "./money.ts";
import { linearLifecycleQuote, LINEAR_CONTRACT } from "./staking-lifecycle.ts";
import type { StakingStepKind } from "./staking-lifecycle.ts";
import type { LifecycleQuote } from "./staking-receipts.ts";
export const STAKING_KINDS = ["stake", "unstake", "withdraw_unstaked"] as const;
export const isStakingKind = (kind: string): kind is StakingStepKind =>
  (STAKING_KINDS as readonly string[]).includes(kind);
export interface StakingPreparation {
  kind: StakingStepKind;
  accountId: string;
  asset: "NEAR" | "LiNEAR";
  amount: string;
  amountRaw: string;
  decimals: 24;
  usdcValueRaw: string;
  workspaceRevision: number;
  mandateVersion: number;
  policyVersion: number;
  quote: LifecycleQuote;
  transactions: LifecycleQuote["transactions"];
  policyAction: PolicyAction;
  expiresAt: string;
  collateral: false;
  registrationNear: "0";
  valuationBasis: string;
  signable: true;
}
export function assertStakingContext(
  p: StakingPreparation,
  w: Workspace,
  revision: number,
) {
  if (
    w.mode !== "live" ||
    w.accountId !== p.accountId ||
    revision !== p.workspaceRevision ||
    w.mandate.version !== p.mandateVersion ||
    (w.policy?.version ?? 0) !== p.policyVersion
  )
    throw new Error(
      "Staking account, workspace or policy changed. Prepare again.",
    );
}
export function buildStakingPreparation(
  w: Workspace,
  revision: number,
  q: LifecycleQuote,
  value: ActionValuation,
  fee: ActionValuation,
  capital: CapitalView,
  native: { amount: string; storage_usage: number },
  now = Date.now(),
): StakingPreparation {
  if (w.mode !== "live" || !w.accountId)
    throw new Error("Open a live account for LiNEAR execution.");
  if (
    value.usdcRaw === null ||
    fee.usdcRaw === null ||
    !value.freshUntil ||
    !fee.freshUntil ||
    Date.parse(value.freshUntil) <= now ||
    Date.parse(fee.freshUntil) <= now
  )
    throw new Error("Staking valuation is unavailable or stale.");
  if (
    !/^\d+$/.test(native.amount) ||
    !Number.isSafeInteger(native.storage_usage) ||
    native.storage_usage < 0
  )
    throw new Error("Native gas evidence is unverified.");
  if (
    !/^[1-9]\d*$/.test(value.usdcRaw) ||
    !/^\d+$/.test(fee.usdcRaw) ||
    ![value.freshUntil, fee.freshUntil].every((t) =>
      Number.isFinite(Date.parse(t)),
    )
  )
    throw new Error("Staking valuation is unavailable or stale.");
  const deposit = q.kind === "stake" ? BigInt(q.nearAmountRaw) : 0n;
  if (
    BigInt(native.amount) - BigInt(native.storage_usage) * 10n ** 19n <
    deposit + BigInt(q.upfrontNearRaw) + 500000000000000000000000n
  )
    throw new Error("Preserve at least 0.5 NEAR exit gas after this action.");
  if (
    q.kind === "stake" &&
    (capital.surplusUsdcRaw === null ||
      BigInt(capital.surplusUsdcRaw) <
        BigInt(value.usdcRaw) + BigInt(fee.usdcRaw))
  )
    throw new Error(
      "Staking would exceed verified surplus after reserve and obligations.",
    );
  const asset = q.kind === "unstake" ? "LiNEAR" : "NEAR";
  const amount = decimal(BigInt(value.usdcRaw));
  const policyAction: PolicyAction = {
    kind: q.kind === "stake" ? "stake" : "withdraw",
    asset,
    chain: "near",
    amount,
    recipient: w.accountId,
    venue: LINEAR_CONTRACT,
    movingCost: decimal(BigInt(fee.usdcRaw)),
    gasNear: decimal(BigInt(q.upfrontNearRaw), 24),
    source: "live",
    accountId: w.accountId,
    methods: q.transactions.flatMap((t) =>
      t.actions.map((a) => ({
        receiver: t.receiverId,
        method: a.params.methodName,
      })),
    ),
  };
  return {
    kind: q.kind,
    accountId: w.accountId,
    asset,
    amount,
    amountRaw: q.amountRaw,
    decimals: 24,
    usdcValueRaw: value.usdcRaw,
    workspaceRevision: revision,
    mandateVersion: w.mandate.version,
    policyVersion: w.policy?.version ?? 0,
    quote: q,
    transactions: q.transactions,
    policyAction,
    expiresAt: new Date(
      Math.min(
        now + 180000,
        Date.parse(value.freshUntil),
        Date.parse(fee.freshUntil),
      ),
    ).toISOString(),
    collateral: false,
    registrationNear: "0",
    valuationBasis: value.basis,
    signable: true,
  };
}
export async function freshStaking(
  w: Workspace,
  revision: number,
  kind: StakingStepKind,
  amountRaw: string,
) {
  if (w.mode !== "live" || !w.accountId)
    throw new Error("Open a live account for LiNEAR execution.");
  const [quote, evidence, { portfolio }, native] = await Promise.all([
    linearLifecycleQuote(w.accountId, kind, amountRaw),
    readValuationEvidence(w),
    workspacePortfolio(w, { staking: false, watch: false }),
    rpc({ request_type: "view_account", account_id: w.accountId }),
  ]);
  const asset = kind === "unstake" ? "LiNEAR" : "NEAR";
  return buildStakingPreparation(
    w,
    revision,
    quote,
    actionValuation(BigInt(amountRaw), asset, evidence.prices),
    actionValuation(BigInt(quote.networkFeeNearRaw), "NEAR", evidence.prices),
    capitalView(w, portfolio, evidence),
    native,
  );
}
export async function freshStakingAttempt(
  p: StakingPreparation,
  w: Workspace,
  revision: number,
) {
  assertStakingContext(p, w, revision);
  const next = await freshStaking(w, revision, p.kind, p.amountRaw);
  if (BigInt(next.usdcValueRaw) > BigInt(p.usdcValueRaw))
    throw new Error(
      "Staking cap valuation increased. Review a fresh preparation.",
    );
  if (
    next.quote.kind === "stake" &&
    BigInt(next.quote.sharesRaw!) < BigInt(p.quote.sharesRaw!)
  )
    throw new Error("LiNEAR share quote decreased. Review again.");
  // Journal amount is the reviewed USDC cap, not 24-decimal token units; the fresh policy action still uses live value.
  return { ...next, amount: p.amount };
}
