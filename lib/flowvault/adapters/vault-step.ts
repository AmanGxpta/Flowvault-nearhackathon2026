// Stream A: StepAdapter for vault operations (deposit, redemption request, cancel, claim, settle). prepare() writes
// the wallet_attempts journal record from fresh final views (vault-ops-live.ts); the owner's wallet signs through
// the standard /api/transactions authorize → attach path, which delegates vault attempts to vaultJournalAction.
// check() mirrors the journal: receipts when hashes exist, otherwise recovery from the vault's request records.
// Ledger entries for vault receipts are Codex's (holder-vault-ledger); this adapter returns none.
import type { ActionPlan, PlanStep, StepAdapter, StepState } from "../contracts";
import type { WalletAttempt } from "../execution";
import { readAttempt } from "../attempts";
import { journalCall, stepContext, stepKey } from "../step-adapters";
import { effectsOf, prepareVaultAttempt } from "../vault-ops-live";
import { VAULT_OPS, type VaultOpRequest } from "../vault-ops";

const STATE: Record<WalletAttempt["state"], StepState> = {
  prepared: "prepared", awaiting_wallet: "awaiting_wallet", submitted: "submitted", confirmed: "confirmed", failed: "failed", partial: "partial", unknown: "unknown",
};

export function vaultOpOf(plan: ActionPlan, step: PlanStep): VaultOpRequest {
  const op = (plan as ActionPlan & { vaultOp?: VaultOpRequest }).vaultOp;
  if (!op || op.op !== step.kind || op.accountId !== plan.accountId) throw new Error("This vault step has no reviewed operation. Cancel and start it again from the vault.");
  return op;
}

export const vaultStepAdapter: StepAdapter = {
  kinds: VAULT_OPS,
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    if (plan.source !== "live" || plan.accountId !== ctx.workspace.accountId) throw new Error("The vault step's signer changed. Cancel and start again.");
    const a = await prepareVaultAttempt(ctx.sessionId, ctx.workspace, vaultOpOf(plan, step), await stepKey(plan, step));
    return { attemptId: a.id, expiresAt: a.expiresAt, state: STATE[a.state] };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    if (!step.attemptId) return { patch: {}, ledger: [] };
    let { attempt } = await readAttempt(ctx.sessionId, step.attemptId);
    if (["awaiting_wallet", "submitted", "unknown", "partial"].includes(attempt.state))
      attempt = (await journalCall<{ attempt: WalletAttempt }>(ctx, "transactions", "/api/transactions", { id: attempt.id, action: "check" })).attempt;
    const state = STATE[attempt.state];
    const patch: Partial<PlanStep> = { state };
    const effects = effectsOf(attempt);
    if (state === "confirmed") {
      const main = effects.find((e) => e.assetsRaw || e.sharesRaw);
      patch.actual = { amountRaw: main?.assetsRaw ?? main?.sharesRaw ?? undefined, asset: main?.assetsRaw ? "USDC" : main?.sharesRaw ? "vault shares" : undefined, evidence: { effects, hashes: attempt.hashes } };
    }
    return { patch, ledger: [], message: attempt.message };
  },
};
