import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GAS, NEAR_USDC, VALIDITY_WINDOW_MS, matchVaultTx, prepareVaultOp, recoverFromRequests, sameVaultPreparation, summarizeVault, vaultInPolicy, verifyVaultTx, withVaultInPolicy,
  type VaultChainState, type VaultPreparation,
} from "../lib/flowvault/vault-ops.ts";
import { defaultPolicy, evaluatePolicy } from "../lib/flowvault/policy.ts";
import type { ConfigView, NavView, RequestView } from "../lib/flowvault/vault-contract.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/vault/contract-views.json", import.meta.url), "utf8")) as { config: ConfigView; nav: NavView; requests: RequestView[] };
const V = "vault.near";
const ME = "bob.near";
const NOW = 1_800_000_000_000;
const NEAR = 10n ** 24n;
const state = (over: Partial<VaultChainState> = {}): VaultChainState => ({
  config: fx.config, nav: { ...fx.nav, reasons: [] }, requests: fx.requests,
  account: { account_id: ME, shares: "5000000000000000000", queued_shares_raw: "0", pending_deposits_raw: "0", claimable_raw: "0", request_storage_credit_yocto: "0" },
  shareRegistered: false, shareStorageMinYocto: "1250000000000000000000", vaultUsdcRegistered: true, usdcBalanceRaw: "50000000", nearAvailableYocto: (5n * NEAR).toString(), previewRaw: "9216589861751152073",
  ...over,
});
const req = (over: Partial<RequestView>): RequestView => ({ id: "9", owner_id: ME, kind: "deposit", amount_raw: "1000000", min_output_raw: "1", created_at_ms: String(NOW), not_before_ms: String(NOW), status: "queued", claimable_raw: "0", shares_minted_raw: "0", shares_burned_raw: "0", ...over });

/* A finalized EXPERIMENTAL_tx_status result for one reviewed transaction. */
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
const ev = (standard: string, event: string, data: unknown) => "EVENT_JSON:" + JSON.stringify({ standard, version: "1.0.0", event, data: [data] });
function result(p: VaultPreparation, index: number, success: unknown, receipts: { executor: string; logs: string[]; fail?: boolean }[], hash = "H" + index) {
  const tx = p.transactions[index];
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: b64(success) },
    transaction: { hash, signer_id: p.accountId, receiver_id: tx.receiverId, actions: tx.actions.map((a) => ({ FunctionCall: { method_name: a.params.methodName, args: b64(a.params.args), gas: Number(a.params.gas), deposit: a.params.deposit } })) },
    receipts_outcome: receipts.map((r, i) => ({ id: "R" + i, outcome: { executor_id: r.executor, logs: r.logs, status: r.fail ? { Failure: {} } : { SuccessValue: "" } } })),
  };
}

test("deposit: share registration and request storage are prepaid in one vault transaction, then the exact ft_transfer_call with a minimum", () => {
  const p = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state(), NOW);
  assert.equal(p.transactions.length, 2);
  assert.deepEqual(p.transactions[0].actions.map((a) => [a.params.methodName, a.params.deposit]), [["storage_deposit", "1250000000000000000000"], ["fund_request_storage", fx.config.queue_storage_yocto]]);
  const t = p.transactions[1];
  assert.equal(t.receiverId, NEAR_USDC);
  assert.equal(t.actions[0].params.methodName, "ft_transfer_call");
  assert.equal(t.actions[0].params.deposit, "1");
  assert.equal(t.actions[0].params.gas, GAS.depositCall);
  const minShares = (9216589861751152073n * 9900n) / 10000n;
  assert.deepEqual(t.actions[0].params.args, { receiver_id: V, amount: "10000000", msg: JSON.stringify({ action: "deposit", min_shares: minShares.toString() }) });
  assert.equal(p.amount, "10");
  assert.equal(p.vaultPolicy!.kind, "supply");
  assert.equal(p.vaultPolicy!.venue, V);
  assert.deepEqual(p.vaultPolicy!.methods[0], { receiver: NEAR_USDC, method: "ft_transfer_call", nestedReceiver: V });
  assert.match(p.vault.notes.join(" "), /not invested and not a fee/);
  const ready = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state({ shareRegistered: true, account: { ...state().account!, request_storage_credit_yocto: fx.config.queue_storage_yocto } }), NOW);
  assert.equal(ready.transactions.length, 1, "already registered with credit: only the transfer");
  assert.equal(sameVaultPreparation(p, prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state(), NOW + 5)), true, "same state, same transactions");
  assert.equal(sameVaultPreparation(p, prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state({ previewRaw: "9000000000000000000" }), NOW)), false, "a new price changes the minimum, so authorize refuses");
});

test("deposit refusals happen before anything is saved: unpriced NAV, capacity, cap, custody mode, USDC registration, balances", () => {
  const dep = (amountRaw: string, over: Partial<VaultChainState>) => () => prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw }, state(over), NOW);
  assert.throws(dep("1000000", { nav: { ...fx.nav, nav_raw: null, reasons: ["NAV_REPORT_STALE_OR_MISSING"] } }), /isn't priced/);
  assert.throws(dep("1000000", { nav: { ...fx.nav, reasons: [], status: "paused" } }), /paused/);
  assert.throws(dep("1000000", { config: { ...fx.config, capacity_raw: "46000000" } }), /capacity/);
  assert.throws(dep("1000000", { config: { ...fx.config, per_depositor_cap_raw: "5000000" } }), /per-depositor cap/, "5 shares are worth ≈ 5.42 USDC already");
  assert.throws(dep("1000000", { config: { ...fx.config, single_depositor: "owner.near" } }), /only from its owner/);
  assert.throws(dep("1000000", { vaultUsdcRegistered: false }), /isn't registered on the USDC contract/);
  assert.throws(dep("60000000", {}), /less USDC/);
  assert.throws(dep("1000000", { nearAvailableYocto: "1000" }), /NEAR available/);
  assert.throws(dep("1000000", { nav: { ...fx.nav, reasons: [], busy: { kind: "supply" } } }), /unresolved external operation/);
});

test("redeem, cancel, claim and settle build exactly one vault call with the contract's deposits", () => {
  const r = prepareVaultOp({ op: "vault_redeem", contractId: V, accountId: ME, sharesRaw: "1000000000000000000" }, state({ previewRaw: "1085000" }), NOW);
  assert.deepEqual(r.transactions, [{ receiverId: V, actions: [{ type: "FunctionCall", params: { methodName: "request_redeem", args: { shares: "1000000000000000000", min_assets: "1074150" }, gas: GAS.vaultCall, deposit: fx.config.queue_storage_yocto } }] }]);
  assert.equal(r.vaultPolicy!.kind, "withdraw");
  assert.throws(() => prepareVaultOp({ op: "vault_redeem", contractId: V, accountId: ME, sharesRaw: "6000000000000000000" }, state(), NOW), /fewer free shares/);
  assert.throws(() => prepareVaultOp({ op: "vault_redeem", contractId: V, accountId: ME, sharesRaw: "1" }, state({ previewRaw: null }), NOW), /safe minimum/);
  const reqs = [req({ id: "9" }), req({ id: "10", kind: "redemption", amount_raw: "7" }), req({ id: "11", status: "claimable", claimable_raw: "2500000" }), req({ id: "12", status: "claiming", claimable_raw: "1" }), req({ id: "13", owner_id: "zed.near" })];
  const st = state({ requests: reqs, previewRaw: "900000000000000000" });
  const cd = prepareVaultOp({ op: "vault_cancel", contractId: V, accountId: ME, requestId: "9" }, st, NOW);
  assert.deepEqual([cd.vault.detail, cd.transactions[0].actions[0].params.methodName, cd.transactions[0].actions[0].params.deposit], ["cancel_deposit", "cancel_deposit", "1"]);
  const cr = prepareVaultOp({ op: "vault_cancel", contractId: V, accountId: ME, requestId: "10" }, st, NOW);
  assert.equal(cr.vault.detail, "cancel_redemption");
  assert.equal(cr.vaultPolicy, undefined, "returning escrowed shares moves no money");
  const cl = prepareVaultOp({ op: "vault_claim", contractId: V, accountId: ME, requestId: "11" }, st, NOW);
  assert.deepEqual([cl.transactions[0].actions[0].params.methodName, cl.transactions[0].actions[0].params.deposit, cl.amount], ["claim", "0", "2.5"]);
  assert.ok(BigInt(cl.transactions[0].actions[0].params.gas) >= 60_000_000_000_000n, "the contract requires ≥ 60 Tgas");
  assert.throws(() => prepareVaultOp({ op: "vault_claim", contractId: V, accountId: ME, requestId: "12" }, st, NOW), /already being paid/);
  assert.throws(() => prepareVaultOp({ op: "vault_cancel", contractId: V, accountId: ME, requestId: "13" }, st, NOW), /another account/);
  const se = prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME, requestId: "9" }, st, NOW);
  assert.deepEqual([se.vault.detail, se.transactions[0].actions[0].params.deposit, se.vaultPolicy], ["settle_deposit", "0", undefined]);
  assert.throws(() => prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME }, state({ requests: [] }), NOW), /No redemption/);
  assert.equal(prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME }, st, NOW).vault.detail, "process_redemptions");
});

test("deposit receipts: confirmed only with the full amount used, the vault's queued event and the USDC transfer; a refund fails", () => {
  const p = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state(), NOW);
  const pre = result(p, 0, "", [{ executor: V, logs: [] }]);
  assert.equal(matchVaultTx(pre, p), 0);
  const o0 = verifyVaultTx(pre, p, 0);
  assert.equal(o0.state, "confirmed");
  const good = result(p, 1, "10000000", [
    { executor: NEAR_USDC, logs: [ev("nep141", "ft_transfer", { old_owner_id: ME, new_owner_id: V, amount: "10000000" })] },
    { executor: V, logs: [ev("flowvault_vault", "deposit_queued", { id: "4", owner_id: ME, assets_raw: "10000000", min_shares: "1" })] },
  ]);
  const o1 = verifyVaultTx(good, p, matchVaultTx(good, p));
  assert.equal(o1.state, "confirmed");
  assert.deepEqual([o1.effect!.requestId, o1.effect!.assetsRaw, o1.effect!.evidence], ["4", "10000000", "receipt"]);
  assert.equal(summarizeVault(p, [o0, o1], 2).state, "confirmed");
  assert.equal(summarizeVault(p, [o1], 1).state, "submitted", "the prerequisite transaction's hash is still missing");
  const refunded = verifyVaultTx(result(p, 1, "0", [{ executor: V, logs: [] }]), p, 1);
  assert.equal(refunded.state, "failed");
  assert.match(refunded.message, /returned to you/);
  assert.equal(summarizeVault(p, [o0, refunded], 2).state, "partial", "registration went through, the deposit didn't");
  const tampered = structuredClone(good);
  tampered.transaction.actions[0].FunctionCall.args = b64({ receiver_id: "evil.near", amount: "10000000", msg: "" });
  assert.throws(() => matchVaultTx(tampered, p), /does not match/);
  assert.throws(() => matchVaultTx({ ...good, transaction: { ...good.transaction, signer_id: "mallory.near" } }, p), /signer/);
  assert.equal(verifyVaultTx({ ...good, final_execution_status: "EXECUTED_OPTIMISTIC" }, p, 1).state, "pending");
});

test("claim receipts: cash only with claim_completed AND the exact USDC transfer to the owner; a failed payout restores the claim", () => {
  const st = state({ requests: [req({ id: "11", status: "claimable", claimable_raw: "2500000" })] });
  const p = prepareVaultOp({ op: "vault_claim", contractId: V, accountId: ME, requestId: "11" }, st, NOW);
  const started = ev("flowvault_vault", "claim_started", { id: "11", operation_id: "3", owner_id: ME, assets_raw: "2500000" });
  const paid = result(p, 0, "", [
    { executor: V, logs: [started] },
    { executor: NEAR_USDC, logs: [ev("nep141", "ft_transfer", { old_owner_id: V, new_owner_id: ME, amount: "2500000" })] },
    { executor: V, logs: [ev("flowvault_vault", "claim_completed", { id: "11", operation_id: "3", owner_id: ME, assets_raw: "2500000" })] },
  ]);
  const ok = verifyVaultTx(paid, p, 0);
  assert.equal(ok.state, "confirmed");
  assert.match(ok.effect!.summary, /verified transfer/);
  const noTransfer = result(p, 0, "", [{ executor: V, logs: [started] }, { executor: V, logs: [ev("flowvault_vault", "claim_completed", { id: "11", operation_id: "3", owner_id: ME, assets_raw: "2500000" })] }]);
  assert.equal(verifyVaultTx(noTransfer, p, 0).state, "pending", "the vault's word alone isn't cash");
  const failed = result(p, 0, "", [{ executor: V, logs: [started] }, { executor: NEAR_USDC, logs: [], fail: true }, { executor: V, logs: [ev("flowvault_vault", "claim_failed", { id: "11", operation_id: "3", owner_id: ME, claimable_raw: "2500000" })] }]);
  const f = verifyVaultTx(failed, p, 0);
  assert.equal(f.state, "failed");
  assert.match(f.message, /restored/);
});

test("unknown outcome recovery: matched in the vault's records, claims need the hash, nothing after the validity window means not executed", () => {
  const p = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state(), NOW);
  const found = recoverFromRequests(p, NOW, [req({ id: "4", amount_raw: "10000000", created_at_ms: String(NOW + 60_000) })], NOW + 120_000);
  assert.equal(found.state, "confirmed");
  assert.deepEqual([found.effect!.requestId, found.effect!.evidence], ["4", "contract_state"]);
  assert.equal(recoverFromRequests(p, NOW, [req({ id: "3", amount_raw: "10000000", created_at_ms: String(NOW - 3_600_000) })], NOW + 1000).state, "unknown", "an older identical deposit isn't this one");
  assert.equal(recoverFromRequests(p, NOW, [], NOW + VALIDITY_WINDOW_MS + 1).state, "failed");
  const st = state({ requests: [req({ id: "11", status: "claimable", claimable_raw: "2500000" })] });
  const c = prepareVaultOp({ op: "vault_claim", contractId: V, accountId: ME, requestId: "11" }, st, NOW);
  assert.equal(recoverFromRequests(c, NOW, [req({ id: "11", status: "completed", claimable_raw: "2500000" })], NOW + 1000).state, "unknown", "completed in the vault, but the payout needs the receipt");
  assert.equal(recoverFromRequests(c, NOW, [req({ id: "11", status: "claiming", claimable_raw: "2500000" })], NOW + VALIDITY_WINDOW_MS + 1).state, "unknown", "in flight is never declared failed");
  assert.equal(recoverFromRequests(c, NOW, [req({ id: "11", status: "claimable", claimable_raw: "2500000" })], NOW + VALIDITY_WINDOW_MS + 1).state, "failed");
  const s = prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME, requestId: "9" }, state({ requests: [req({ id: "9" })] }), NOW);
  assert.equal(recoverFromRequests(s, NOW, [req({ id: "9", status: "settled", shares_minted_raw: "5" })], NOW + 1000).state, "confirmed");
});

test("policy: a vault is refused until the owner adds it; adding it is idempotent and caps still apply", () => {
  const p = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "10000000" }, state(), NOW);
  const base = defaultPolicy();
  const before = evaluatePolicy({ ...p.vaultPolicy!, id: "a" }, base, [], NOW);
  assert.equal(before.allowed, false);
  assert.ok(before.violations.some((v) => v.code === "VENUE_NOT_ALLOWED"));
  assert.equal(vaultInPolicy(base, V), false);
  const allowed = withVaultInPolicy(base, V);
  assert.deepEqual(withVaultInPolicy(allowed, V), allowed, "idempotent");
  assert.equal(vaultInPolicy(allowed, V), true);
  assert.deepEqual(evaluatePolicy({ ...p.vaultPolicy!, id: "a" }, allowed, [], NOW).violations, []);
  const big = prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "50000000" }, state({ usdcBalanceRaw: "100000000" }), NOW);
  assert.ok(evaluatePolicy({ ...big.vaultPolicy!, id: "b" }, { ...allowed, perActionCap: "20" }, [], NOW).violations.some((v) => v.code === "PER_ACTION_CAP"));
});

test("v1.4 unresolved operation: deposits and settlement stop, exits are priced at the exit-only NAV", () => {
  const nav = { ...fx.nav, nav_raw: null, pps_e18: null, reasons: ["EXTERNAL_OPERATION_UNRESOLVED"], unresolved: { operation: { kind: "supply" }, since_ms: String(NOW - 1000) }, exit_nav_raw: "40000000" };
  assert.throws(() => prepareVaultOp({ op: "vault_deposit", contractId: V, accountId: ME, amountRaw: "1000000" }, state({ nav, previewRaw: null }), NOW), /isn't priced/);
  const r = prepareVaultOp({ op: "vault_redeem", contractId: V, accountId: ME, sharesRaw: "1000000000000000000" }, state({ nav, previewRaw: null }), NOW);
  const exitValue = (10n ** 18n * 40000001n) / (BigInt(fx.nav.total_shares) + 10n ** 12n);
  assert.equal(r.vault.previewRaw, exitValue.toString());
  assert.equal((r.transactions[0].actions[0].params.args as { min_assets: string }).min_assets, ((exitValue * 9900n) / 10000n).toString());
  assert.match(r.vault.notes.join(" "), /exit-only NAV/);
  assert.throws(() => prepareVaultOp({ op: "vault_redeem", contractId: V, accountId: ME, sharesRaw: "1" }, state({ nav: { ...nav, exit_nav_raw: null }, previewRaw: null }), NOW), /safe minimum/);
  const due = [req({ id: "10", kind: "redemption", amount_raw: "7", not_before_ms: String(NOW - 1) })];
  assert.equal(prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME }, state({ nav, requests: due }), NOW).vault.detail, "process_redemptions");
  assert.throws(() => prepareVaultOp({ op: "vault_settle", contractId: V, accountId: ME, requestId: "9" }, state({ nav, requests: [req({ id: "9" })] }), NOW), /isn't priced/);
});
