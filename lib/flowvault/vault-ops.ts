// Vault operations (owner: Stream A). Pure: builds the exact NEAR transactions the owner's wallet signs for a
// vault deposit, redemption request, cancellation, claim or settlement, verifies finalized receipts against them,
// and recovers an unknown outcome from the contract's own request records. Contract: docs/handoff/vault-interface.md.
//
// FlowVault never signs. Every preparation goes through the wallet_attempts journal (authorize → wallet → attach →
// check). A queued deposit is not shares; a settled redemption is a claim, not wallet cash; a claim counts as cash
// only with the vault's claim_completed event AND the asset contract's NEP-141 transfer of exactly that amount.
import type { PolicyAction } from "./policy.ts";
import type { AccountView, ConfigView, NavView, RequestView } from "./vault-contract.ts";

export type VaultOp = "vault_deposit" | "vault_redeem" | "vault_cancel" | "vault_claim" | "vault_settle";
export const VAULT_OPS: VaultOp[] = ["vault_deposit", "vault_redeem", "vault_cancel", "vault_claim", "vault_settle"];
export type VaultDetail = "deposit" | "redeem" | "cancel_deposit" | "cancel_redemption" | "claim" | "settle_deposit" | "process_redemptions";

export const NEAR_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const PREPARATION_TTL_MS = 10 * 60_000;
/** A NEAR transaction's block-hash validity is 86,400 blocks (≈ 1 day or less); past this, an unseen effect never happened. */
export const VALIDITY_WINDOW_MS = 26 * 3_600_000;
/** Reviewed minimum output as a share of the current preview (rounding and a NAV report in between). */
export const MIN_OUTPUT_BPS = 9_900n;
const TGAS = 1_000_000_000_000n;
export const GAS = {
  storage: (30n * TGAS).toString(),
  depositCall: (150n * TGAS).toString(),
  vaultCall: (50n * TGAS).toString(),
  claim: (120n * TGAS).toString(),
  process: (200n * TGAS).toString(),
};
/** Conservative NEAR fee bound per transaction for the policy's gas budget (300 Tgas at 1e9 yocto/gas). */
const FEE_PER_TX_YOCTO = 300n * TGAS * 1_000_000_000n / 1_000n;

export interface VaultTx {
  receiverId: string;
  actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
}

export interface VaultOpRequest {
  op: VaultOp;
  contractId: string;
  accountId: string;
  /** vault_deposit: USDC raw. */
  amountRaw?: string;
  /** vault_redeem: shares raw. */
  sharesRaw?: string;
  /** vault_cancel / vault_claim / vault_settle (deposit): the request id. vault_settle without it = process_redemptions. */
  requestId?: string;
}

/** Everything a preparation depends on, read at a final block (vault-ops-live.ts). */
export interface VaultChainState {
  config: ConfigView;
  nav: NavView;
  requests: RequestView[];
  account: AccountView | null;
  /** The account's share-token storage registration on the vault, and the vault's minimum. */
  shareRegistered: boolean;
  shareStorageMinYocto: string;
  /** The vault is registered on the USDC contract (else a deposit can't arrive). */
  vaultUsdcRegistered: boolean;
  usdcBalanceRaw: string;
  /** NEAR the account can spend (balance minus storage stake), for attached deposits and gas. */
  nearAvailableYocto: string;
  /** preview_deposit(amount) or preview_redeem(shares); null = NAV unavailable. */
  previewRaw: string | null;
}

export interface VaultPreparation {
  kind: VaultOp;
  accountId: string;
  /** USDC decimal value the policy budgets (deposit amount, redemption preview, claim); "0" when nothing moves. */
  amount: string;
  expiresAt: string;
  transactions: VaultTx[];
  vault: {
    contractId: string;
    detail: VaultDetail;
    assetId: string;
    amountRaw: string | null;
    sharesRaw: string | null;
    requestId: string | null;
    minOutputRaw: string | null;
    previewRaw: string | null;
    attachedYocto: string;
    notes: string[];
  };
  /** Present when the operation moves value; checked against the owner's policy before the wallet opens. */
  vaultPolicy?: PolicyAction;
}

export function isVaultPreparation(p: unknown): p is VaultPreparation {
  return !!p && typeof p === "object" && "vault" in p && VAULT_OPS.includes((p as VaultPreparation).kind);
}
export const isVaultKind = (k: string): k is VaultOp => (VAULT_OPS as string[]).includes(k);

const dec6 = (raw: bigint) => {
  const s = raw.toString().padStart(7, "0");
  return (s.slice(0, -6) + "." + s.slice(-6)).replace(/\.?0+$/, "") || "0";
};
const dec24 = (raw: bigint) => {
  const s = raw.toString().padStart(25, "0");
  return (s.slice(0, -24) + "." + s.slice(-24)).replace(/\.?0+$/, "") || "0";
};
const call = (methodName: string, args: Record<string, unknown>, gas: string, deposit: string) => ({ type: "FunctionCall" as const, params: { methodName, args, gas, deposit } });
const B = (s: string | null | undefined) => BigInt(s ?? "0");

function fail(problems: string[]) {
  if (problems.length) throw new Error(problems.join(" "));
}

/** Builds the exact transactions for one vault operation, refusing anything the contract would reject or that FlowVault can't price. */
export function prepareVaultOp(r: VaultOpRequest, st: VaultChainState, now = Date.now()): VaultPreparation {
  const c = st.config;
  const n = st.nav;
  const p: string[] = [];
  if (c.asset_id !== NEAR_USDC || c.asset_decimals !== 6 || c.share_decimals !== 18) p.push("This vault isn't a native-USDC FlowVault vault (asset or decimals differ).");
  if (n.busy) p.push("The vault has an unresolved external operation; it accepts nothing until that resolves.");
  fail(p);
  const notes: string[] = [];
  const txs: VaultTx[] = [];
  let attached = 0n;
  let detail: VaultDetail;
  let amountRaw: bigint | null = null;
  let sharesRaw: bigint | null = null;
  let requestId: string | null = r.requestId ?? null;
  let minOut: bigint | null = null;
  let policy: { kind: string; usdcRaw: bigint; methods: { receiver: string; method: string; nestedReceiver?: string }[] } | null = null;
  const req = requestId === null ? null : st.requests.find((x) => x.id === requestId) ?? null;
  const ownRequest = () => {
    if (!req) throw new Error(`Request #${requestId} isn't in the vault's retained records.`);
    if (req.owner_id !== r.accountId) throw new Error("That request belongs to another account.");
    return req;
  };

  if (r.op === "vault_deposit") {
    detail = "deposit";
    amountRaw = B(r.amountRaw);
    if (amountRaw <= 0n) p.push("Enter a USDC amount above zero.");
    if (n.status !== "running") p.push(`The vault is ${n.status}; it takes no deposits.`);
    if (n.nav_raw === null || n.reasons.length) p.push("The vault's NAV isn't priced right now (" + (n.reasons.join(", ") || "unavailable") + "); a deposit would be refunded.");
    if (c.single_depositor && c.single_depositor !== r.accountId) p.push("This custody vault takes deposits only from its owner.");
    if (!st.vaultUsdcRegistered) p.push("The vault isn't registered on the USDC contract yet (the owner registers it); a deposit can't arrive.");
    if (amountRaw > B(st.usdcBalanceRaw)) p.push("Your NEAR account holds less USDC than that.");
    if (n.nav_raw !== null && B(n.nav_raw) + B(n.pending_deposits_raw) + amountRaw > B(c.capacity_raw)) p.push("That would take the vault over its capacity.");
    // The contract's cap: the value of the shares you hold (escrowed included) plus this deposit.
    const held = B(st.account?.shares) + B(st.account?.queued_shares_raw);
    const heldValue = n.nav_raw === null ? 0n : (held * (B(n.nav_raw) + B(c.virtual_assets_raw))) / (B(n.total_shares) + B(c.virtual_shares_raw));
    if (heldValue + amountRaw > B(c.per_depositor_cap_raw)) p.push("That would take you over the vault's per-depositor cap.");
    if (st.previewRaw === null || B(st.previewRaw) === 0n) p.push("The vault can't quote shares for that amount right now.");
    fail(p);
    minOut = (B(st.previewRaw) * MIN_OUTPUT_BPS) / 10_000n;
    if (minOut === 0n) minOut = 1n;
    const prereq: VaultTx["actions"] = [];
    if (!st.shareRegistered) {
      prereq.push(call("storage_deposit", { account_id: r.accountId, registration_only: true }, GAS.storage, st.shareStorageMinYocto));
      attached += B(st.shareStorageMinYocto);
      notes.push("Registers your account on the vault's share token (refundable NEAR storage).");
    }
    const credit = B(st.account?.request_storage_credit_yocto);
    if (credit < B(c.queue_storage_yocto)) {
      prereq.push(call("fund_request_storage", {}, GAS.storage, c.queue_storage_yocto));
      attached += B(c.queue_storage_yocto);
      notes.push(`Prepays the vault's request storage (${dec24(B(c.queue_storage_yocto))} NEAR). It is operational storage, not invested and not a fee.`);
    }
    if (prereq.length) txs.push({ receiverId: r.contractId, actions: prereq });
    txs.push({ receiverId: c.asset_id, actions: [call("ft_transfer_call", { receiver_id: r.contractId, amount: amountRaw.toString(), msg: JSON.stringify({ action: "deposit", min_shares: minOut.toString() }) }, GAS.depositCall, "1")] });
    attached += 1n;
    notes.push("The USDC queues outside the vault's NAV; it becomes shares only when the deposit is settled at the then-current price (anyone can settle it).");
    policy = { kind: "supply", usdcRaw: amountRaw, methods: [{ receiver: c.asset_id, method: "ft_transfer_call", nestedReceiver: r.contractId }, ...prereq.map((a) => ({ receiver: r.contractId, method: a.params.methodName }))] };
  } else if (r.op === "vault_redeem") {
    detail = "redeem";
    sharesRaw = B(r.sharesRaw);
    if (sharesRaw <= 0n) p.push("Enter a number of shares above zero.");
    if (sharesRaw > B(st.account?.shares)) p.push("You hold fewer free shares than that (queued shares are already escrowed).");
    // While an operation is unresolved (v1.4) the normal price is null but exits continue at the exit-only NAV.
    const preview = st.previewRaw !== null ? B(st.previewRaw) : n.exit_nav_raw ? (sharesRaw * (B(n.exit_nav_raw) + B(c.virtual_assets_raw))) / (B(n.total_shares) + B(c.virtual_shares_raw)) : null;
    if (preview === null) p.push("The vault's NAV isn't priced right now, so FlowVault can't set a safe minimum payout. Try again when it is.");
    else if (preview === 0n) p.push("Those shares are worth nothing at the current price.");
    fail(p);
    st = { ...st, previewRaw: preview!.toString() };
    if (st.previewRaw !== null && n.nav_raw === null) notes.push("Priced at the vault's exit-only NAV (an external operation is unresolved).");
    minOut = (B(st.previewRaw) * MIN_OUTPUT_BPS) / 10_000n;
    txs.push({ receiverId: r.contractId, actions: [call("request_redeem", { shares: sharesRaw.toString(), min_assets: minOut.toString() }, GAS.vaultCall, c.queue_storage_yocto)] });
    attached += B(c.queue_storage_yocto);
    notes.push(`Escrows the shares in the FIFO queue (${Number(B(c.redemption_notice_ms) / 1000n)} s notice). It settles whole, at the price then, into a fixed USDC claim; claim it afterwards.`);
    notes.push(`Attaches the vault's queue storage charge (${dec24(B(c.queue_storage_yocto))} NEAR).`);
    policy = { kind: "withdraw", usdcRaw: B(st.previewRaw), methods: [{ receiver: r.contractId, method: "request_redeem" }] };
  } else if (r.op === "vault_cancel") {
    const q = ownRequest();
    if (q.status !== "queued") throw new Error(`Request #${q.id} is ${q.status}; only a queued request can be cancelled.`);
    detail = q.kind === "deposit" ? "cancel_deposit" : "cancel_redemption";
    if (q.kind === "deposit") amountRaw = B(q.amount_raw);
    else sharesRaw = B(q.amount_raw);
    txs.push({ receiverId: r.contractId, actions: [call(detail, { id: q.id }, GAS.vaultCall, "1")] });
    attached += 1n;
    notes.push(q.kind === "deposit" ? "The queued USDC becomes a fixed claim; claim it to get the USDC back." : "The escrowed shares return to your balance.");
    if (q.kind === "deposit") policy = { kind: "withdraw", usdcRaw: amountRaw!, methods: [{ receiver: r.contractId, method: "cancel_deposit" }] };
  } else if (r.op === "vault_claim") {
    const q = ownRequest();
    if (q.status !== "claimable") throw new Error(q.status === "claiming" ? `Claim #${q.id} is already being paid; check it instead of claiming again.` : `Request #${q.id} is ${q.status}, not claimable.`);
    detail = "claim";
    amountRaw = B(q.claimable_raw);
    if (amountRaw === 0n) throw new Error("Nothing to claim on that request.");
    txs.push({ receiverId: r.contractId, actions: [call("claim", { id: q.id }, GAS.claim, "0")] });
    notes.push("The vault pays the fixed claim to the request's owner (always you). It counts as cash only after the USDC transfer to you is verified.");
    policy = { kind: "withdraw", usdcRaw: amountRaw, methods: [{ receiver: r.contractId, method: "claim" }] };
  } else {
    if (requestId !== null) {
      const q = ownRequest();
      if (q.kind !== "deposit" || q.status !== "queued") throw new Error(`Request #${q.id} isn't a queued deposit.`);
      if (n.status !== "running") throw new Error(`The vault is ${n.status}; deposits don't settle.`);
      if (n.nav_raw === null || n.reasons.length) throw new Error("The vault's NAV isn't priced right now; settlement waits for a fresh report.");
      if (B(q.min_output_raw) > 0n && st.previewRaw !== null && B(st.previewRaw) < B(q.min_output_raw)) throw new Error("At the current price the deposit would mint fewer shares than its minimum; it waits (or cancel it).");
      detail = "settle_deposit";
      amountRaw = B(q.amount_raw);
      txs.push({ receiverId: r.contractId, actions: [call("settle_deposit", { id: q.id }, GAS.vaultCall, "0")] });
      notes.push("Mints your shares at the current price. Anyone may call this; it moves no money out of your wallet.");
    } else {
      const due = st.requests.filter((x) => x.kind === "redemption" && x.status === "queued" && Number(x.not_before_ms) <= now);
      if (!due.length) throw new Error("No redemption in the queue is past its notice.");
      if ((n.nav_raw === null || n.reasons.length) && !n.exit_nav_raw) throw new Error("The vault's NAV isn't priced right now; redemptions settle only at a fresh price (or the exit-only price after the owner's sync and report).");
      detail = "process_redemptions";
      requestId = due.find((x) => x.owner_id === r.accountId)?.id ?? null;
      txs.push({ receiverId: r.contractId, actions: [call("process_redemptions", { limit: 20 }, GAS.process, "0")] });
      notes.push("Settles due redemptions first in, first out while the vault holds enough USDC. Anyone may call this; it moves no money out of your wallet.");
    }
  }
  const fees = BigInt(txs.length) * FEE_PER_TX_YOCTO;
  if (attached + fees > B(st.nearAvailableYocto)) throw new Error(`Your account needs about ${dec24(attached + fees)} NEAR available for storage and fees.`);
  const usdcValue = policy?.usdcRaw ?? 0n;
  return {
    kind: r.op,
    accountId: r.accountId,
    amount: dec6(usdcValue),
    expiresAt: new Date(now + PREPARATION_TTL_MS).toISOString(),
    transactions: txs,
    vault: {
      contractId: r.contractId, detail, assetId: c.asset_id, amountRaw: amountRaw?.toString() ?? null, sharesRaw: sharesRaw?.toString() ?? null, requestId,
      minOutputRaw: minOut?.toString() ?? null, previewRaw: st.previewRaw, attachedYocto: attached.toString(), notes,
    },
    vaultPolicy: policy
      ? {
          kind: policy.kind, asset: "USDC", amount: dec6(policy.usdcRaw), recipient: r.accountId, venue: r.contractId, movingCost: "0",
          gasNear: dec24(attached + fees), source: "live", accountId: r.accountId, chain: "near", methods: policy.methods,
        }
      : undefined,
  };
}

/** Same operation, same transactions: the authorize-time rebuild must match the reviewed preparation exactly. */
export function sameVaultPreparation(a: VaultPreparation, b: VaultPreparation) {
  return a.kind === b.kind && a.accountId === b.accountId && a.vault.contractId === b.vault.contractId && JSON.stringify(a.transactions) === JSON.stringify(b.transactions);
}

/** Methods and venue a vault needs in the owner's policy (added only by the owner's explicit choice). */
export function vaultPolicyEntries(contractId: string) {
  return {
    venue: contractId,
    methods: [
      { receiver: NEAR_USDC, method: "ft_transfer_call" },
      ...["storage_deposit", "fund_request_storage", "request_redeem", "cancel_deposit", "claim"].map((method) => ({ receiver: contractId, method })),
    ],
  };
}
export function withVaultInPolicy<P extends { venues: string[]; methods: { receiver: string; method: string }[] }>(policy: P, contractId: string): P {
  const e = vaultPolicyEntries(contractId);
  const has = (m: { receiver: string; method: string }) => policy.methods.some((x) => x.receiver === m.receiver && x.method === m.method);
  return { ...policy, venues: policy.venues.includes(e.venue) ? policy.venues : [...policy.venues, e.venue], methods: [...policy.methods, ...e.methods.filter((m) => !has(m))] };
}
export function vaultInPolicy(policy: { venues: string[]; methods: { receiver: string; method: string }[] } | undefined, contractId: string) {
  if (!policy) return false;
  const e = vaultPolicyEntries(contractId);
  return policy.venues.includes(contractId) && e.methods.every((m) => policy.methods.some((x) => x.receiver === m.receiver && x.method === m.method));
}

/* ───────────── receipt verification ───────────── */

const stable = (v: unknown): string =>
  Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(v);
const b64json = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));

/* eslint-disable @typescript-eslint/no-explicit-any -- NEAR RPC tx_status JSON */
/** Index of the reviewed transaction this finalized result is; throws when it matches none. */
export function matchVaultTx(result: any, p: VaultPreparation): number {
  const tx = result?.transaction;
  if (!tx || tx.signer_id !== p.accountId) throw new Error("Transaction signer does not match this request.");
  const i = p.transactions.findIndex(
    (want) =>
      want.receiverId === tx.receiver_id &&
      want.actions.length === tx.actions?.length &&
      want.actions.every((a, k) => {
        const got = tx.actions[k]?.FunctionCall;
        if (!got) return false;
        try {
          return got.method_name === a.params.methodName && String(got.deposit) === a.params.deposit && String(got.gas) === a.params.gas && stable(b64json(got.args)) === stable(a.params.args);
        } catch {
          return false;
        }
      }),
  );
  if (i < 0) throw new Error(`Transaction payload does not match the reviewed vault ${p.vault.detail}.`);
  return i;
}

export interface VaultEvent {
  event: string;
  data: Record<string, unknown>;
  receiptId: string;
}
/** flowvault_vault events logged by the vault contract in successful receipts of this transaction. */
export function vaultEvents(result: any, contractId: string): VaultEvent[] {
  const out: VaultEvent[] = [];
  for (const r of result?.receipts_outcome ?? []) {
    if (r?.outcome?.executor_id !== contractId || typeof r.outcome?.status?.SuccessValue !== "string") continue;
    for (const l of r.outcome.logs ?? []) {
      if (typeof l !== "string" || !l.startsWith("EVENT_JSON:")) continue;
      let e: any;
      try {
        e = JSON.parse(l.slice(11));
      } catch {
        continue;
      }
      if (e?.standard !== "flowvault_vault" || !Array.isArray(e.data)) continue;
      for (const d of e.data) out.push({ event: String(e.event), data: d ?? {}, receiptId: String(r.id) });
    }
  }
  return out;
}
/** NEP-141 ft_transfer events logged by the token contract in successful receipts. */
export function tokenTransfers(result: any, tokenId: string): { from: string; to: string; amount: bigint }[] {
  const out: { from: string; to: string; amount: bigint }[] = [];
  for (const r of result?.receipts_outcome ?? []) {
    if (r?.outcome?.executor_id !== tokenId || typeof r.outcome?.status?.SuccessValue !== "string") continue;
    for (const l of r.outcome.logs ?? []) {
      if (typeof l !== "string" || !l.startsWith("EVENT_JSON:")) continue;
      try {
        const e = JSON.parse(l.slice(11));
        if (e?.standard === "nep141" && e.event === "ft_transfer" && Array.isArray(e.data))
          for (const d of e.data) if (/^\d+$/.test(String(d.amount))) out.push({ from: String(d.old_owner_id), to: String(d.new_owner_id), amount: BigInt(d.amount) });
      } catch {
        /* not an event */
      }
    }
  }
  return out;
}

export interface VaultEffect {
  detail: VaultDetail;
  contractId: string;
  requestId: string | null;
  assetsRaw: string | null;
  sharesRaw: string | null;
  /** "receipt" = verified from a finalized transaction; "contract_state" = matched in the vault's request records. */
  evidence: "receipt" | "contract_state";
  hash: string | null;
  summary: string;
}
export interface VaultOutcome {
  index: number;
  state: "pending" | "confirmed" | "failed";
  message: string;
  effect?: VaultEffect;
}

/** Verifies one finalized transaction's economic effect for the reviewed operation. */
export function verifyVaultTx(result: any, p: VaultPreparation, index: number): VaultOutcome {
  const v = p.vault;
  if (result?.final_execution_status !== "FINAL") return { index, state: "pending", message: "Waiting for finalized receipts." };
  if (!Array.isArray(result.receipts_outcome) || !result.receipts_outcome.length) return { index, state: "pending", message: "Receipt details are unavailable; success is not verified." };
  const status = result.status;
  const hash = String(result.transaction?.hash ?? "");
  const tx = p.transactions[index];
  // The deposit's prerequisite transaction (registration / request storage) only has to succeed.
  const isPrereq = v.detail === "deposit" && tx.receiverId === v.contractId;
  const failedReceipt = result.receipts_outcome.find((r: any) => r.outcome?.status?.Failure);
  if (status?.Failure || (failedReceipt && v.detail !== "claim"))
    return { index, state: "failed", message: "A finalized transaction or receipt failed (the vault refused it). Nothing beyond the failed call happened; inspect the explorer before retrying." };
  if (!status || typeof status.SuccessValue !== "string") return { index, state: "pending", message: "Final outcome is unavailable." };
  if (isPrereq) return { index, state: "confirmed", message: "Vault share registration and request storage confirmed." };
  const ev = vaultEvents(result, v.contractId);
  const mine = (name: string) => ev.filter((e) => e.event === name && (e.data.owner_id === undefined || e.data.owner_id === p.accountId));
  const effect = (detail: VaultDetail, requestId: string | null, assetsRaw: string | null, sharesRaw: string | null, summary: string): VaultEffect => ({ detail, contractId: v.contractId, requestId, assetsRaw, sharesRaw, evidence: "receipt", hash, summary });

  if (v.detail === "deposit") {
    let used: string;
    try {
      used = String(b64json(status.SuccessValue));
    } catch {
      return { index, state: "failed", message: "Couldn't read how much USDC the vault accepted." };
    }
    if (used !== v.amountRaw) return { index, state: "failed", message: used === "0" ? "The vault refused the deposit and the USDC was returned to you (NAV, capacity, cap, storage credit or registration). Refresh and review again." : `The vault accepted ${used} instead of ${v.amountRaw} raw USDC; the rest was returned. Inspect before retrying.` };
    const q = mine("deposit_queued").find((e) => String(e.data.assets_raw) === v.amountRaw);
    const moved = tokenTransfers(result, v.assetId).filter((t) => t.from === p.accountId && t.to === v.contractId).reduce((s, t) => s + t.amount, 0n);
    if (!q) return { index, state: "failed", message: "The USDC transfer finalized but the vault logged no queued deposit for you." };
    if (moved < BigInt(v.amountRaw!)) return { index, state: "pending", message: "The vault logged the deposit but the USDC transfer event wasn't found; waiting for full receipts." };
    return { index, state: "confirmed", message: `Deposit request #${q.data.id} queued: ${v.amountRaw} raw USDC outside NAV, no shares yet.`, effect: effect("deposit", String(q.data.id), v.amountRaw, null, "USDC queued, waiting to be settled into shares") };
  }
  if (v.detail === "redeem") {
    const q = mine("redemption_requested").find((e) => String(e.data.shares_raw) === v.sharesRaw);
    if (!q) return { index, state: "failed", message: "The call finalized but the vault logged no redemption request for these shares." };
    return { index, state: "confirmed", message: `Redemption request #${q.data.id} queued; notice ends ${new Date(Number(q.data.not_before_ms)).toISOString()}.`, effect: effect("redeem", String(q.data.id), null, v.sharesRaw, "Shares escrowed in the redemption queue") };
  }
  if (v.detail === "cancel_deposit") {
    const q = mine("deposit_cancelled").find((e) => String(e.data.id) === v.requestId);
    if (!q) return { index, state: "failed", message: "No deposit_cancelled event for this request." };
    return { index, state: "confirmed", message: `Deposit #${v.requestId} cancelled: ${q.data.claimable_raw} raw USDC is now a fixed claim.`, effect: effect("cancel_deposit", v.requestId, String(q.data.claimable_raw), null, "Queued USDC turned into a claim") };
  }
  if (v.detail === "cancel_redemption") {
    const q = mine("redemption_cancelled").find((e) => String(e.data.id) === v.requestId);
    if (!q) return { index, state: "failed", message: "No redemption_cancelled event for this request." };
    return { index, state: "confirmed", message: `Redemption #${v.requestId} cancelled; shares returned.`, effect: effect("cancel_redemption", v.requestId, null, String(q.data.shares_raw), "Escrowed shares returned") };
  }
  if (v.detail === "settle_deposit") {
    const q = mine("deposit_settled").find((e) => String(e.data.id) === v.requestId);
    if (!q) return { index, state: "failed", message: "No deposit_settled event for this request." };
    return { index, state: "confirmed", message: `Deposit #${v.requestId} settled into ${q.data.shares_raw} raw shares.`, effect: effect("settle_deposit", v.requestId, String(q.data.assets_raw), String(q.data.shares_raw), "Deposit settled into shares") };
  }
  if (v.detail === "process_redemptions") {
    const settled = ev.filter((e) => e.event === "redemption_settled");
    const minePart = settled.find((e) => e.data.owner_id === p.accountId);
    return {
      index, state: "confirmed",
      message: settled.length ? `${settled.length} redemption${settled.length === 1 ? "" : "s"} settled into claims${minePart ? `, including yours (#${minePart.data.id})` : ""}.` : "The queue was processed; nothing was due with enough USDC held.",
      effect: effect("process_redemptions", minePart ? String(minePart.data.id) : null, minePart ? String(minePart.data.claimable_assets_raw) : null, minePart ? String(minePart.data.shares_burned_raw) : null, minePart ? "Your redemption became a fixed claim" : "Queue processed"),
    };
  }
  // claim: the vault must log claim_completed AND the asset contract must log the exact transfer to you.
  const started = mine("claim_started").find((e) => String(e.data.id) === v.requestId);
  const done = mine("claim_completed").find((e) => String(e.data.id) === v.requestId);
  const failedClaim = mine("claim_failed").find((e) => String(e.data.id) === v.requestId);
  if (failedClaim) return { index, state: "failed", message: `The USDC payout failed; the vault restored claim #${v.requestId} unchanged. You can claim again.` };
  if (!started) return { index, state: "failed", message: "The vault didn't start this claim." };
  if (!done) return { index, state: "pending", message: "The claim started; waiting for the vault's payout callback." };
  const paid = tokenTransfers(result, v.assetId).filter((t) => t.from === v.contractId && t.to === p.accountId).reduce((s, t) => s + t.amount, 0n);
  if (String(done.data.assets_raw) !== v.amountRaw || paid !== BigInt(v.amountRaw!)) return { index, state: "pending", message: "The vault reports the claim paid, but the exact USDC transfer to you isn't verified yet. Not counted as cash." };
  return { index, state: "confirmed", message: `Claim #${v.requestId} paid: ${v.amountRaw} raw USDC verified in your wallet.`, effect: effect("claim", v.requestId, v.amountRaw, null, "USDC paid to your wallet (verified transfer)") };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Combines per-transaction outcomes: confirmed only when every reviewed transaction is confirmed. */
export function summarizeVault(p: VaultPreparation, outcomes: VaultOutcome[], hashCount: number): { state: "submitted" | "confirmed" | "failed" | "partial"; message: string; effects: VaultEffect[] } {
  const effects = outcomes.flatMap((o) => (o.effect ? [o.effect] : []));
  const failed = outcomes.find((o) => o.state === "failed");
  const confirmed = new Set(outcomes.filter((o) => o.state === "confirmed").map((o) => o.index));
  if (failed) return { state: confirmed.size ? "partial" : "failed", message: failed.message + (confirmed.size ? " An earlier transaction (registration or storage) did go through." : ""), effects };
  if (confirmed.size === p.transactions.length) return { state: "confirmed", message: outcomes.find((o) => o.effect)?.message ?? outcomes.at(-1)!.message, effects };
  void hashCount;
  return { state: "submitted", message: outcomes.find((o) => o.state === "pending")?.message ?? (confirmed.size ? "Part of the request is confirmed; attach the other transaction hash from your wallet history." : "Waiting for finalized receipts."), effects };
}

/**
 * An unknown wallet outcome (no hash returned), recovered from the vault's request records. A matching effect
 * created after the request counts (evidence "contract_state"); a claim needs its transaction hash for the payout
 * proof; nothing matching after the transaction validity window means nothing executed.
 */
export function recoverFromRequests(p: VaultPreparation, createdAtMs: number, requests: RequestView[], now = Date.now()): { state: "confirmed" | "failed" | "unknown"; message: string; effect?: VaultEffect } {
  const v = p.vault;
  const after = (r: RequestView) => Number(r.created_at_ms) >= createdAtMs - 1000;
  const fx = (detail: VaultDetail, r: RequestView, assets: string | null, shares: string | null, summary: string): VaultEffect => ({ detail, contractId: v.contractId, requestId: r.id, assetsRaw: assets, sharesRaw: shares, evidence: "contract_state", hash: null, summary });
  const expired = now - createdAtMs > VALIDITY_WINDOW_MS;
  const none = expired
    ? { state: "failed" as const, message: "No matching effect in the vault after the transaction validity window; nothing was executed. You can prepare it again." }
    : { state: "unknown" as const, message: "The vault shows no matching effect yet. If you signed, attach the transaction hash from your wallet history; otherwise this resolves as not executed after about a day." };
  const byId = v.requestId ? requests.find((r) => r.id === v.requestId) : undefined;
  if (v.detail === "deposit") {
    const r = requests.find((x) => x.kind === "deposit" && x.owner_id === p.accountId && x.amount_raw === v.amountRaw && after(x));
    return r ? { state: "confirmed", message: `Found deposit request #${r.id} in the vault (matched by contract state; no transaction hash).`, effect: fx("deposit", r, r.amount_raw, null, "USDC queued (matched in vault records)") } : none;
  }
  if (v.detail === "redeem") {
    const r = requests.find((x) => x.kind === "redemption" && x.owner_id === p.accountId && x.amount_raw === v.sharesRaw && after(x));
    return r ? { state: "confirmed", message: `Found redemption request #${r.id} in the vault (matched by contract state).`, effect: fx("redeem", r, null, r.amount_raw, "Shares escrowed (matched in vault records)") } : none;
  }
  if (!byId) return none;
  if (v.detail === "cancel_deposit") return byId.status === "claimable" || byId.status === "claiming" || byId.status === "completed" ? { state: "confirmed", message: `Deposit #${byId.id} is cancelled in the vault.`, effect: fx("cancel_deposit", byId, byId.claimable_raw, null, "Queued USDC turned into a claim (vault records)") } : byId.status === "settled" ? { state: "failed", message: `Deposit #${byId.id} was settled into shares before any cancellation.` } : none;
  if (v.detail === "cancel_redemption") return byId.status === "cancelled" ? { state: "confirmed", message: `Redemption #${byId.id} is cancelled in the vault.`, effect: fx("cancel_redemption", byId, null, byId.amount_raw, "Escrowed shares returned (vault records)") } : byId.status !== "queued" ? { state: "failed", message: `Redemption #${byId.id} is ${byId.status}; it can't be cancelled any more.` } : none;
  if (v.detail === "settle_deposit") return byId.status === "settled" ? { state: "confirmed", message: `Deposit #${byId.id} is settled into ${byId.shares_minted_raw} raw shares.`, effect: fx("settle_deposit", byId, byId.amount_raw, byId.shares_minted_raw, "Deposit settled into shares (vault records)") } : byId.status === "cancelled" || byId.status === "claimable" ? { state: "failed", message: `Deposit #${byId.id} was cancelled, not settled.` } : none;
  if (v.detail === "process_redemptions") return byId.status === "claimable" || byId.status === "claiming" || byId.status === "completed" ? { state: "confirmed", message: `Your redemption #${byId.id} is settled into a claim.`, effect: fx("process_redemptions", byId, byId.claimable_raw, byId.shares_burned_raw, "Redemption became a fixed claim (vault records)") } : none;
  // claim
  if (byId.status === "completed") return { state: "unknown", message: `The vault records claim #${byId.id} as paid. Attach the transaction hash so FlowVault can verify the USDC transfer to you before counting it as cash.` };
  if (byId.status === "claiming") return { state: "unknown", message: `Claim #${byId.id} is being paid (callback pending). Check again shortly; don't claim twice.` };
  if (byId.status === "claimable") return expired ? { state: "failed", message: `Claim #${byId.id} is still claimable: no payout happened. You can claim again.` } : { state: "unknown", message: `Claim #${byId.id} is still claimable. If you signed, attach the hash; if the payout failed the claim was restored unchanged.` };
  return none;
}
