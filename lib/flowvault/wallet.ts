"use client";
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
export function useNearWallet() {
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
        const update = (state: WalletSelectorState) => {
          if (!alive) return;
          setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
          setWalletName(state.selectedWalletId ?? "");
        };
        update(selector.store.getState());
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
