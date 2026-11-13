"use client";
import { assertStakingWalletHandoff } from "./staking-wallet-guard";
import type { PayPreparation } from "./payments";
import type { WithdrawPreparation } from "./withdraw";
import { useEffect, useState } from "react";
import type {
  WalletSelector,
  WalletSelectorState,
  InternalAction,
} from "@near-wallet-selector/core";
import type { SupplyPreparation, WalletPreparation } from "./execution";
import { assertWalletSigner } from "./wallet-guards";
let initialization: Promise<{
  selector: WalletSelector;
  show: () => void;
}> | null = null;
export function walletClient() {
  if (typeof window === "undefined")
    throw new Error("Wallets are available in the browser.");
  if (!initialization)
    initialization = (async () => {
      // The wallet SDK uses Buffer while encoding transactions for its approval popup.
      const { Buffer } = await import("buffer");
      const browser = window as unknown as { Buffer?: typeof Buffer };
      browser.Buffer ??= Buffer;
      const [
        { setupWalletSelector },
        { setupModal },
        { setupMyNearWallet },
        { setupMeteorWallet },
      ] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
      ]);
      const selector = await setupWalletSelector({
        network: "mainnet",
        modules: [setupMyNearWallet(), setupMeteorWallet()],
      });
      // No application contractId/createAccessKeyFor grant. Wallet SDKs manage their connection state.
      const modal = setupModal(selector, {
        theme: "light",
        description:
          "Connect to view balances. You approve every mainnet transaction in your wallet.",
      });
      return { selector, show: () => modal.show() };
    })().catch((e) => {
      initialization = null;
      throw e;
    });
  return initialization;
}
/** A NEAR wallet FlowVault can offer in its own Connect dialog (instead of the selector's built-in modal). */
export interface NearWalletOption {
  id: string;
  name: string;
  icon?: string;
}
/** Sign in with one NEAR wallet directly. No contract and no function-call key are requested. Meteor opens
 * a popup and resolves when the owner answers; MyNearWallet redirects the page and comes back. */
export async function connectNearWallet(id: string) {
  const { selector } = await walletClient();
  const w = await selector.wallet(id);
  // No contractId: FlowVault asks for no function-call key. Browser (redirect) wallets also take return URLs.
  const extra = w.type === "browser" ? { successUrl: w.metadata.successUrl, failureUrl: w.metadata.failureUrl } : {};
  await (w.signIn as (p: Record<string, unknown>) => Promise<unknown>)({ contractId: undefined, methodNames: undefined, ...extra });
}
export function useNearWallet() {
  const [options, setOptions] = useState<NearWalletOption[]>([]);
  /** True once the selector has restored any saved session (so "no account" really means signed out). */
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState("");
  const [error, setError] = useState("");
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    walletClient()
      .then(({ selector }) => {
        if (!alive) return;
        setError("");
        setOptions(
          (selector.store.getState().modules ?? [])
            .filter((m) => m.metadata.available !== false && !m.metadata.deprecated)
            .map((m) => ({ id: m.id, name: m.metadata.name ?? m.id, icon: m.metadata.iconUrl })),
        );
        const update = (state: WalletSelectorState) => {
          if (!alive) return;
          setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
          setWalletName(state.selectedWalletId ?? "");
        };
        update(selector.store.getState());
        setReady(true);
        const subscription = selector.store.observable.subscribe(update);
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [subscriptionVersion]);
  return {
    accountId,
    walletName,
    error,
    options,
    ready,
    connectWith: async (id: string) => {
      setSubscriptionVersion((v) => v + 1);
      await connectNearWallet(id);
    },
    connect: async () => {
      const client = await walletClient();
      setSubscriptionVersion((v) => v + 1);
      client.show();
    },
    disconnect: async () => {
      const { selector } = await walletClient();
      const wallet = await selector.wallet();
      await wallet.signOut();
    },
  };
}
export async function signSupply(preparation: SupplyPreparation) {
  if ("kind" in preparation && preparation.kind !== "supply")
    throw new Error(
      "Use the matching helper for a withdrawal or payment preparation.",
    );
  return signPrepared(preparation);
}
export async function signWithdraw(preparation: WithdrawPreparation) {
  if (preparation.kind !== "withdraw")
    throw new Error("Use a withdrawal preparation to sign a withdrawal.");
  return signPrepared(preparation);
}
export async function signPayment(preparation: PayPreparation) {
  if (preparation.kind !== "pay")
    throw new Error("Use a payment preparation for payment signing.");
  return signPrepared(preparation);
}
/** Engines E2: owner-signed Rhea credit step (collateral_add, borrow, repay, collateral_release). */
export async function signLending(preparation: import("./lending").LendingPreparation) {
  if (!["collateral_add", "borrow", "repay", "collateral_release"].includes(preparation.kind))
    throw new Error("Use a Rhea credit preparation for credit signing.");
  if (preparation.kind === "borrow" && !preparation.approvedNewDebt)
    throw new Error("New debt needs explicit approval before signing.");
  return signPrepared(preparation);
}
/** P2: owner-signed native validator staking step. Only after /api/transactions authorize; a stake needs
 * the explicit owner approval recorded at preparation. */
export async function signNativeStaking(preparation: import("./staking-native").NativeStakingPreparation) {
  if (!["native_stake", "native_unstake", "native_withdraw"].includes(preparation.kind))
    throw new Error("Use a native staking preparation for native staking signing.");
  if (preparation.kind === "native_stake" && !preparation.ownerApproved)
    throw new Error("Staking needs explicit approval before signing.");
  if (preparation.transactions.length !== 1 || preparation.transactions[0].receiverId !== preparation.pool)
    throw new Error("Native staking must call only the reviewed pool.");
  return signPrepared(preparation);
}
/** Interface (policy contract): an owner-only call to the FlowVault policy contract, prepared unsigned by
 * POST /api/policy-contract. Guarded so only that exact shape reaches the wallet: one transaction to the
 * configured contract, an owner method, 1 yoctoNEAR authentication deposit and the workspace account as signer.
 * It moves no investment funds; it only records rules, agents or decisions in the contract. */
export async function signPolicyOwnerCall(call: {
  kind: string;
  accountId: string;
  contractId: string;
  method: string;
  transactions: { receiverId: string; actions: { type: string; params: { methodName: string; deposit: string; gas: string; args: unknown } }[] }[];
}) {
  const OWNER = ["set_plan", "add_agent", "remove_agent", "approve", "reject"];
  const tx = call.transactions[0];
  const a = tx?.actions[0];
  if (
    call.kind !== "policy_contract_owner_call" ||
    call.transactions.length !== 1 ||
    tx.actions.length !== 1 ||
    tx.receiverId !== call.contractId ||
    a.type !== "FunctionCall" ||
    !OWNER.includes(a.params.methodName) ||
    a.params.methodName !== call.method ||
    a.params.deposit !== "1"
  )
    throw new Error("Only a prepared owner call to your policy contract can be signed here.");
  const { selector } = await walletClient();
  const wallet = await selector.wallet();
  const { internalActionToNaj } = await import("@near-wallet-selector/core");
  const accounts = await wallet.getAccounts();
  assertWalletSigner(
    selector.options.network.networkId,
    selector.store.getState().accounts.find((x) => x.active)?.accountId ?? null,
    accounts,
    call.accountId,
  );
  return wallet.signAndSendTransactions({
    transactions: [{ signerId: call.accountId, receiverId: tx.receiverId, actions: [internalActionToNaj(a as InternalAction)] }],
  });
}

async function signPrepared(preparation: WalletPreparation) {
  if (
    !Number.isFinite(Date.parse(preparation.expiresAt)) ||
    Date.parse(preparation.expiresAt) <= Date.now()
  )
    throw new Error("Preparation expired. Prepare and review again.");
  const { selector } = await walletClient();
  const wallet = await selector.wallet();
  const { internalActionToNaj } = await import("@near-wallet-selector/core");
  const accounts = await wallet.getAccounts();
  // Re-read selector state after the wallet read; account switches must not slip through an await.
  assertWalletSigner(
    selector.options.network.networkId,
    selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null,
    accounts,
    preparation.accountId,
  );
  return wallet.signAndSendTransactions({
    transactions: preparation.transactions.map((tx) => ({
      signerId: preparation.accountId,
      receiverId: tx.receiverId,
      actions: tx.actions.map((action) =>
        internalActionToNaj(action as InternalAction),
      ),
    })),
  });
}

/** Stream A: owner-signed vault operation, only after /api/transactions authorize. Guarded to the reviewed vault
 * contract and the USDC contract (deposit), with the shape vault-ops.ts prepared. */
export async function signVault(preparation: import("./vault-ops").VaultPreparation) {
  if (!preparation.kind?.startsWith("vault_") || !preparation.vault?.contractId) throw new Error("Use a vault preparation for vault signing.");
  if (preparation.transactions.some((tx) => tx.receiverId !== preparation.vault.contractId && tx.receiverId !== preparation.vault.assetId)) throw new Error("A vault operation may call only the vault and its USDC contract.");
  return signPrepared(preparation as unknown as WalletPreparation);
}

/** Owner-only: journal authorization must succeed first; previews cannot reach the signer. */
export async function signStaking(
  preparation: import("./staking-execution").StakingPreparation & {
    attemptId: string;
  },
) {
  const r = await fetch("/api/staking/handoff", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preparation }),
  });
  const body = (await r.json()) as {
    attempt?: import("./execution").WalletAttempt;
    error?: string;
  };
  if (!r.ok || !body.attempt)
    throw new Error(
      body.error ??
        "Read and consume the authorized LiNEAR handoff before signing.",
    );
  assertStakingWalletHandoff(preparation, body.attempt);
  return signPrepared(preparation);
}

/** Convert to NEAR, first time only: register the account with wrap.near so wNEAR can be delivered. */
export async function signWnearRegister(p: { accountId: string; depositRaw: string; transaction: { receiverId: string; actions: { type: "FunctionCall"; params: { methodName: string; args: { account_id: string; registration_only: boolean }; gas: string; deposit: string } }[] } }) {
  const t = p.transaction;
  const a = t.actions[0];
  if (t.receiverId !== "wrap.near" || t.actions.length !== 1 || a.params.methodName !== "storage_deposit" || a.params.args.account_id !== p.accountId || a.params.args.registration_only !== true || a.params.deposit !== p.depositRaw || BigInt(p.depositRaw) > 10n ** 22n)
    throw new Error("The prepared registration doesn’t match. Nothing was signed.");
  const { selector } = await walletClient();
  const wallet = await selector.wallet();
  const accounts = await wallet.getAccounts();
  assertWalletSigner(selector.options.network.networkId, selector.store.getState().accounts.find((x) => x.active)?.accountId ?? null, accounts, p.accountId);
  const { internalActionToNaj } = await import("@near-wallet-selector/core");
  return wallet.signAndSendTransactions({
    transactions: [{ signerId: p.accountId, receiverId: "wrap.near", actions: t.actions.map((x) => internalActionToNaj(x as InternalAction)) }],
  });
}

/** Convert to NEAR, last step: wrap.near near_withdraw (wNEAR → NEAR in the same account). Only that exact
 * call is accepted, signed by the account it was prepared for. */
export async function signUnwrap(p: { accountId: string; amountRaw: string; transaction: { receiverId: string; actions: { type: "FunctionCall"; params: { methodName: string; args: { amount: string }; gas: string; deposit: string } }[] } }) {
  const t = p.transaction;
  const a = t.actions[0];
  if (t.receiverId !== "wrap.near" || t.actions.length !== 1 || a.type !== "FunctionCall" || a.params.methodName !== "near_withdraw" || a.params.deposit !== "1" || a.params.args.amount !== p.amountRaw)
    throw new Error("The prepared unwrap doesn’t match. Nothing was signed.");
  const { selector } = await walletClient();
  const wallet = await selector.wallet();
  const accounts = await wallet.getAccounts();
  assertWalletSigner(selector.options.network.networkId, selector.store.getState().accounts.find((x) => x.active)?.accountId ?? null, accounts, p.accountId);
  const { internalActionToNaj } = await import("@near-wallet-selector/core");
  return wallet.signAndSendTransactions({
    transactions: [{ signerId: p.accountId, receiverId: "wrap.near", actions: t.actions.map((x) => internalActionToNaj(x as InternalAction)) }],
  });
}

/** Existing owner-wallet path; /api/transactions authorization must succeed first. */
export async function signSale(preparation: import("./sale").SalePreparation) {
  const {validateSaleWallet}=await import("./sale-wallet");
  validateSaleWallet(preparation);
  if(preparation.sale.evmTx) throw new Error("Use the prepared EVM account for this sale.");
  return signPrepared(preparation);
}
