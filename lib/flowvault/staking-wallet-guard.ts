import { liquidContract } from "./staking-lifecycle.ts";
import type { StakingPreparation } from "./staking-execution.ts";
import type { WalletAttempt } from "./execution.ts";
export function assertStakingWalletHandoff(
  p: StakingPreparation & { attemptId: string },
  a: WalletAttempt,
  now = Date.now(),
) {
  if (
    !["stake", "unstake", "withdraw_unstaked"].includes(p.kind) ||
    p.transactions.length !== 1 ||
    !["linear", "rnear"].includes((p.quote?.protocol ?? "linear")) ||
    p.transactions[0].receiverId !== liquidContract((p.quote?.protocol ?? "linear")) ||
    !p.signable
  )
    throw new Error("Use a journal-prepared LiNEAR lifecycle payload.");
  const expected = a.preparation as StakingPreparation;
  if (
    a.id !== p.attemptId ||
    a.state !== "awaiting_wallet" ||
    a.kind !== p.kind ||
    a.accountId !== p.accountId ||
    expected.amountRaw !== p.amountRaw ||
    (expected.quote?.protocol ?? "linear") !== (p.quote?.protocol ?? "linear") ||
    expected.workspaceRevision !== p.workspaceRevision ||
    expected.policyVersion !== p.policyVersion ||
    expected.mandateVersion !== p.mandateVersion ||
    JSON.stringify(expected.transactions) !== JSON.stringify(p.transactions)
  )
    throw new Error(
      "Authorize this exact LiNEAR journal attempt before wallet signing.",
    );
  if (
    !Number.isFinite(Date.parse(a.expiresAt)) ||
    Date.parse(a.expiresAt) <= now ||
    p.expiresAt !== a.expiresAt
  )
    throw new Error("LiNEAR wallet preparation expired.");
}

export function consumeStakingWalletHandoff(
  a: WalletAttempt,
  now = Date.now(),
) {
  if (a.state !== "awaiting_wallet" || a.stakingWalletHandoffAt)
    throw new Error(
      "LiNEAR wallet handoff was already consumed or is not authorized. Recover this attempt; do not resend.",
    );
  return { ...a, stakingWalletHandoffAt: new Date(now).toISOString() };
}
