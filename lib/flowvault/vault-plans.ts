// Vault operation plans (owner: Stream A). One plan per owner action on one vault, with one wallet-signed step.
// The plan is built only after a dry-run preparation against live final views succeeds, so a refusal (NAV not
// priced, capacity, caps, registration, storage, balance) is shown before anything is saved. One active plan per
// vault (lock target "vault_operation:vault:<contract>").
import { newPlan, planContext, review } from "./plans";
import type { FundingChoice } from "./contracts";
import type { StoredPlan } from "./plans-service";
import type { SessionInfo } from "./store";
import { freshVaultPreparation } from "./vault-ops-live";
import type { VaultOpRequest, VaultPreparation } from "./vault-ops";

const usdc = (raw: string) => (Number(BigInt(raw)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });
const shares = (raw: string) => (Number(BigInt(raw) / 10n ** 12n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function vaultTitle(p: VaultPreparation) {
  const v = p.vault;
  switch (v.detail) {
    case "deposit": return `Deposit ${usdc(v.amountRaw!)} USDC into ${v.contractId}`;
    case "redeem": return `Redeem ${shares(v.sharesRaw!)} shares of ${v.contractId}`;
    case "cancel_deposit": return `Cancel deposit #${v.requestId} in ${v.contractId}`;
    case "cancel_redemption": return `Cancel redemption #${v.requestId} in ${v.contractId}`;
    case "claim": return `Claim ${usdc(v.amountRaw!)} USDC from ${v.contractId}`;
    case "settle_deposit": return `Settle deposit #${v.requestId} into shares`;
    default: return `Process due redemptions in ${v.contractId}`;
  }
}

export async function vaultPlan(s: SessionInfo, id: string, key: string, op: VaultOpRequest): Promise<StoredPlan> {
  if (s.workspace.mode !== "live" || !s.workspace.accountId) throw new Error("Sign in with your NEAR account to operate a vault.");
  if (op.accountId !== s.workspace.accountId) throw new Error("Vault operations are signed by your signed-in NEAR account.");
  const prep = await freshVaultPreparation(op);
  const v = prep.vault;
  const choice: FundingChoice = {
    id: "vault-op", kind: "vault_operation", eligible: true, reasons: [], venueId: v.contractId, accountId: op.accountId, chain: "near",
    amountUsdcRaw: v.amountRaw ?? "0", costsUsdcRaw: null, foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps: [op.op],
  };
  const plan = newPlan({
    id, key, source: "live", accountId: op.accountId, objective: "vault_operation", createdBy: "user",
    request: { positionId: "vault:" + v.contractId, venue: v.contractId, ...(v.amountRaw ? { amountRaw: v.amountRaw, asset: "USDC" } : {}), text: vaultTitle(prep) },
    context: planContext(s.workspace, s.revision),
    alternatives: [choice],
    recommendedChoiceId: choice.id,
    effects: { exposure: v.detail === "deposit" ? [{ asset: "USDC · queued in " + v.contractId + " (not shares yet)", deltaRaw: v.amountRaw!, decimals: 6 }] : [] },
  }) as StoredPlan;
  return Object.assign(plan, { title: vaultTitle(prep), vaultOp: op, vaultReview: { notes: v.notes, minOutputRaw: v.minOutputRaw, previewRaw: v.previewRaw, attachedYocto: v.attachedYocto, transactions: prep.transactions } });
}

/** plans-service reviewChoice delegates vault_operation plans here: one step carrying the reviewed operation. */
export function reviewVault(plan: StoredPlan, choiceId: string) {
  const op = (plan as StoredPlan & { vaultOp?: VaultOpRequest }).vaultOp;
  if (!op) throw new Error("This vault plan has no operation. Start it again from the vault.");
  const note = ((plan as StoredPlan & { vaultReview?: { notes: string[] } }).vaultReview?.notes ?? []).join(" ");
  return review(plan, choiceId, [{ kind: op.op, expected: { amountRaw: op.amountRaw ?? op.sharesRaw, asset: op.amountRaw ? "USDC" : op.sharesRaw ? "vault shares" : undefined, venue: op.contractId, note } }]);
}
