// Vault operations on the existing wallet_attempts journal (owner: Stream A). Same state machine as every other
// NEAR wallet request: prepared → (authorize: fresh rebuild must match, policy checked and reserved) awaiting_wallet
// → the owner's wallet signs → attach hashes → finalized receipts verified → confirmed / failed / partial; a wallet
// that returns nothing becomes unknown and is recovered from the vault's own request records. FlowVault never signs.
import { attemptsDb, createAttempt, readAttempt, saveAttempt } from "./attempts";
import { assertSignable, type PreparationKind, type WalletAttempt, type WalletPreparation } from "./execution";
import { networkRpc, rpc, view } from "./near";
import { checkPolicy, reservePolicy } from "./policy-store";
import { defaultPolicy, preparationAction } from "./policy";
import { session } from "./store";
import { appendStep } from "./timeline";
import { vaultConfig } from "./vault-live";
import type { AccountView, NavView, RequestView } from "./vault-contract";
import type { Workspace } from "./types";
import {
  NEAR_USDC, isVaultPreparation, matchVaultTx, prepareVaultOp, recoverFromRequests, sameVaultPreparation, summarizeVault, verifyVaultTx,
  type VaultChainState, type VaultEffect, type VaultOpRequest, type VaultOutcome, type VaultPreparation,
} from "./vault-ops";

const STORAGE_PRICE_PER_BYTE = 10_000_000_000_000_000_000n; // 1e19 yocto

async function requests(contractId: string): Promise<RequestView[]> {
  const out: RequestView[] = [];
  let from = "0";
  for (let i = 0; i < 5; i++) {
    const page = (await view<RequestView[]>(contractId, "get_requests", { from_index: from, limit: 100 })).data ?? [];
    out.push(...page);
    if (page.length < 100) break;
    from = (BigInt(page[page.length - 1].id) + 1n).toString();
  }
  return out;
}

/** Everything prepareVaultOp needs, from final views. */
export async function vaultChainState(r: VaultOpRequest): Promise<VaultChainState> {
  const c = await vaultConfig(r.contractId);
  const [nav, reqs, account, reg, bounds, vaultReg, usdc, acct] = await Promise.all([
    view<NavView>(r.contractId, "get_nav").then((x) => x.data),
    requests(r.contractId),
    view<AccountView>(r.contractId, "get_account", { account_id: r.accountId }).then((x) => x.data).catch(() => null),
    view<{ total: string } | null>(r.contractId, "storage_balance_of", { account_id: r.accountId }).then((x) => x.data),
    view<{ min: string }>(r.contractId, "storage_balance_bounds").then((x) => x.data),
    view<{ total: string } | null>(NEAR_USDC, "storage_balance_of", { account_id: r.contractId }).then((x) => x.data),
    view<string>(NEAR_USDC, "ft_balance_of", { account_id: r.accountId }).then((x) => x.data),
    rpc({ request_type: "view_account", account_id: r.accountId }),
  ]);
  let preview: string | null = null;
  const q = r.requestId ? reqs.find((x) => x.id === r.requestId) : undefined;
  if (r.op === "vault_deposit" && r.amountRaw) preview = (await view<string | null>(r.contractId, "preview_deposit", { amount: r.amountRaw })).data;
  if (r.op === "vault_redeem" && r.sharesRaw) preview = (await view<string | null>(r.contractId, "preview_redeem", { shares: r.sharesRaw })).data;
  if (r.op === "vault_settle" && q?.kind === "deposit") preview = (await view<string | null>(r.contractId, "preview_deposit", { amount: q.amount_raw })).data;
  const available = BigInt(acct.amount) - BigInt(acct.storage_usage) * STORAGE_PRICE_PER_BYTE;
  return {
    config: c, nav, requests: reqs, account, shareRegistered: !!reg, shareStorageMinYocto: bounds.min, vaultUsdcRegistered: !!vaultReg,
    usdcBalanceRaw: String(usdc ?? "0"), nearAvailableYocto: (available > 0n ? available : 0n).toString(), previewRaw: preview === null ? null : String(preview),
  };
}

export async function freshVaultPreparation(r: VaultOpRequest) {
  return prepareVaultOp(r, await vaultChainState(r));
}

export const requestOf = (p: VaultPreparation): VaultOpRequest => ({
  op: p.kind, contractId: p.vault.contractId, accountId: p.accountId,
  ...(p.kind === "vault_deposit" ? { amountRaw: p.vault.amountRaw! } : {}),
  ...(p.kind === "vault_redeem" ? { sharesRaw: p.vault.sharesRaw! } : {}),
  ...(p.kind === "vault_cancel" || p.kind === "vault_claim" || (p.kind === "vault_settle" && p.vault.detail === "settle_deposit") ? { requestId: p.vault.requestId! } : {}),
});

/** Writes the journal record before any wallet handoff (idempotent on the step key). */
export async function prepareVaultAttempt(sessionId: string, w: Workspace, r: VaultOpRequest, key: string) {
  if (w.mode !== "live" || !w.accountId || w.accountId !== r.accountId) throw new Error("Vault operations are signed by your signed-in NEAR account in your own workspace.");
  const prep = await freshVaultPreparation(r);
  return createAttempt(sessionId, w.mandate.version, prep as unknown as WalletPreparation, prep.kind as PreparationKind, key);
}

export interface VaultEvidence {
  hash: string | null;
  index: number | null;
  state: VaultOutcome["state"] | "recovered";
  message: string;
  effect: VaultEffect | null;
}
export const effectsOf = (a: WalletAttempt): VaultEffect[] => ((a.verificationEvidence ?? []) as VaultEvidence[]).flatMap((e) => (e?.effect ? [e.effect] : []));

/** /api/transactions delegates vault attempts here (one line in that route). */
export async function vaultJournalAction(request: Request, id: string, action: string, hashes: string[] = []): Promise<WalletAttempt> {
  const s = await session(request);
  const { attempt: a, previous } = await readAttempt(s.id, id);
  const p = a.preparation as unknown as VaultPreparation;
  if (!isVaultPreparation(p) || s.workspace.mode !== "live") throw new Error("That vault request isn't available in this live workspace.");
  if (hashes.some((h) => h.startsWith("0x"))) throw new Error("Vault requests take NEAR transaction hashes.");
  let revision: number | undefined;
  if (action === "authorize") {
    assertSignable(a, s.workspace.accountId, s.workspace.mode, s.workspace.mandate.version);
    const fresh = await freshVaultPreparation(requestOf(p));
    if (!sameVaultPreparation(p, fresh)) throw new Error("The vault's state changed (price, registration, storage or queue). Prepare and review again.");
    const current = await session(request);
    assertSignable(a, current.workspace.accountId, current.workspace.mode, current.workspace.mandate.version);
    if (fresh.vaultPolicy) {
      const policy = current.workspace.policy ?? defaultPolicy(current.workspace.mandate.maxMoveCost);
      // preparationAction uses a preparation's own policyAction when present (as lending does).
      const act = preparationAction({ ...fresh, policyAction: fresh.vaultPolicy } as unknown as WalletPreparation, a.kind, a.id);
      await checkPolicy(s.id, act, policy);
      await reservePolicy(s.id, act, policy, current.revision);
    }
    revision = current.revision;
    a.state = "awaiting_wallet";
    a.message = "Wallet approval requested. If the wallet closes without a result, check this request before trying again.";
  } else if (action === "uncertain") {
    if (a.state === "awaiting_wallet") {
      a.state = "unknown";
      a.message = "The wallet didn't return a complete result. FlowVault will look for the effect in the vault's records; attach any hash from your wallet history.";
    }
  } else {
    if (a.state === "prepared") throw new Error("This request hasn't been opened in the wallet.");
    const all = [...new Set([...a.hashes, ...hashes])];
    if (all.length > p.transactions.length) throw new Error("Too many transaction hashes for this request.");
    if (all.length) {
      const db = await attemptsDb();
      const outcomes: VaultOutcome[] = [];
      const evidence: VaultEvidence[] = [];
      for (const hash of all) {
        const result = await networkRpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: a.accountId, wait_until: "FINAL" });
        if (result.transaction?.hash !== hash) throw new Error("RPC returned a different transaction hash.");
        const index = matchVaultTx(result, p);
        if (outcomes.some((o) => o.index === index)) throw new Error("Two hashes match the same reviewed transaction.");
        const block = await networkRpc("block", { block_id: result.transaction_outcome.block_hash });
        if (BigInt(block.header.timestamp_nanosec) / 1_000_000n < BigInt(Date.parse(a.createdAt))) throw new Error("This transaction predates the reviewed request.");
        await db.prepare("INSERT OR IGNORE INTO wallet_hashes (hash,attempt_id) VALUES (?,?)").bind(hash, a.id).run();
        const claim = await db.prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?").bind(hash).first<{ attempt_id: string }>();
        if (claim?.attempt_id !== a.id) throw new Error("This hash belongs to a different request.");
        const o = verifyVaultTx(result, p, index);
        outcomes.push(o);
        evidence.push({ hash, index, state: o.state, message: o.message, effect: o.effect ?? null });
        appendStep(a, "receipt:" + hash, o.state, o.message, { explorerLinks: ["https://nearblocks.io/txns/" + hash], evidence: { hash, blockHeight: block.header.height, effect: o.effect ?? null } });
      }
      const sum = summarizeVault(p, outcomes, all.length);
      a.hashes = all;
      a.verificationEvidence = evidence;
      a.state = sum.state;
      a.message = sum.message;
    } else if (["awaiting_wallet", "unknown", "submitted"].includes(a.state)) {
      // No hash: recover from the vault's request records.
      const rec = recoverFromRequests(p, Date.parse(a.createdAt), await requests(p.vault.contractId));
      if (rec.state === "confirmed") {
        a.state = "confirmed";
        a.verificationEvidence = [{ hash: null, index: null, state: "recovered", message: rec.message, effect: rec.effect ?? null }];
        appendStep(a, "recovered:" + (rec.effect?.requestId ?? "state"), "confirmed", rec.message, { evidence: rec.effect ?? null });
      } else if (rec.state === "failed") {
        a.state = "failed";
        appendStep(a, "recovered:none", "failed", rec.message, {});
      } else if (a.state !== "awaiting_wallet") a.state = "unknown";
      a.message = rec.message;
    }
  }
  await saveAttempt(s.id, a, previous, revision);
  return a;
}
