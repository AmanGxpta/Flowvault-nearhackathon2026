"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- adapters between untyped design view-model data and API JSON */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PlanDock } from "./PlanDock";
import { DesignApp } from "./design-logic";
import { api, clearLegacyEvm, emptySnapshot, getScope, loadSnapshot, setScope, takeLegacyEvm, type LiveSnapshot, type Scope } from "./live";
import { useNearWallet, signUnwrap, signWnearRegister, signSupply, signWithdraw, signPayment, signLending, signStaking, signNativeStaking, walletClient } from "@/lib/flowvault/wallet";
import { useMultiWallets, connectWallet, disconnectWallet, sendUsdcTransfer, type DiscoveredWallet, type WalletSession } from "@/lib/flowvault/wallets";

const noopSubscribe = () => () => {};

export interface LiveActions {
  connect(): Promise<void>;
  /** Sign in with one named NEAR wallet (from FlowVault's Connect dialog). */
  connectNear(id: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Multi-wallet (A3): connect an Ethereum or Solana wallet (one free signature the server verifies). */
  connectWallet(w: DiscoveredWallet): Promise<string>;
  disconnectWallet(s: WalletSession): Promise<void>;
  /** Ask the connected NEAR wallet for its NEP-413 ownership signature again. */
  proveNear(): Promise<void>;
  /** Account registry: accounts enter only through their wallet (connect); rename and forget. Never signs. */
  accounts(body: Record<string, unknown>): Promise<any>;
  refresh(): Promise<void>;
  savePlan(changes: { reserve?: string; horizon?: number; leadDays?: number; borrowing?: boolean }): Promise<void>;
  addObligation(o: Record<string, unknown>): Promise<void>;
  /** Change a dated payment that isn't paying or paid (PUT /api/obligations; needs NEAR sign-in). */
  updateObligation(o: Record<string, unknown>): Promise<void>;
  /** Convert to NEAR (POST/GET /api/funding); the wallets sign, FlowVault prepares. */
  fund(body: Record<string, unknown>): Promise<any>;
  fundStatus(id: string): Promise<any>;
  sendUsdc(session: WalletSession, tx: any, depositAddress: string, amountRaw: string): Promise<string>;
  unwrapToNear(): Promise<{ amountRaw: string; near: string }>;
  registerWnear(): Promise<void>;
  /** Remove a dated payment that isn't paying or paid (DELETE /api/obligations). */
  removeObligation(id: string): Promise<void>;
  savePolicy(policy: unknown): Promise<void>;
  policyTest(body: unknown): Promise<any>;
  credit(body: unknown): Promise<any>;
  prepare(kind: "supply" | "withdraw", amount: string, key?: string): Promise<any>;
  sign(preparation: any): Promise<void>;
  check(attemptId: string): Promise<void>;
  /** Pay on a date (BACKEND_API §7): plan, act on and poll a payment plan. */
  payment(obligationId: string, key: string): Promise<any>;
  paymentAction(paymentId: string, action: string): Promise<any>;
  /** Judge mode: reads the separate example slot; the personal workspace is never written. */
  setMode(mode: "demo" | "live"): Promise<void>;
  /** Ranks a custom comparison amount without changing the plan (R13). */
  strategies(amount: string): Promise<any>;
  /** Unsigned staking quote for inspection only (R14); never a wallet handoff. */
  stakeQuote(body: { kind: string; amount: string; pool?: string }): Promise<any>;
  /** Ask FlowVault (BACKEND_API §11): read-only, engine-bound proposal and evaluation. */
  ask(question: string, useModel: boolean): Promise<any>;
  /** Read-only source comparison for one calendar payment, either slot (R16). */
  compare(obligationId: string): Promise<any>;
  /** Restores the example slot's fictional seed (R19). Refused for the personal workspace. */
  resetExample(): Promise<void>;
  /** Verified native validators for staking quotes (R20). */
  validators(): Promise<any>;
  /** Staking options for one validator pool (R14/R20). */
  stakingOptions(pool?: string): Promise<any>;
}

/**
 * Owns the live workspace: wallet connection, API reads and owner-initiated actions.
 * The design view receives a snapshot and these actions; it never signs anything itself.
 */
export function FlowVaultRoot() {
  // Client-only: the layout depends on the viewport width and browser storage.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const wallet = useNearWallet();
  const walletRef = useRef(wallet);
  const [raw, setSnap] = useState<LiveSnapshot>(() => emptySnapshot());
  const multi = useMultiWallets();
  const sessionsRef = useRef(multi.sessions);
  const [nearProof, setNearProof] = useState<LiveSnapshot["nearProof"]>(null);
  const snap = useMemo(
    () => ({ ...raw, walletAccount: wallet.accountId, walletName: wallet.walletName, walletError: wallet.error, walletSessions: multi.sessions, walletsFound: multi.wallets, nearWallets: wallet.options, nearProof }),
    [raw, wallet.accountId, wallet.walletName, wallet.error, wallet.options, multi.sessions, multi.wallets, nearProof],
  );
  const snapRef = useRef(snap);
  useEffect(() => {
    walletRef.current = wallet;
    snapRef.current = snap;
    sessionsRef.current = multi.sessions;
    // Read-only snapshot for debugging in the browser console (no secrets: public reads only).
    (window as unknown as { __flowvault?: LiveSnapshot }).__flowvault = snap;
  });
  const seq = useRef(0);
  const synced = useRef<string | null>(null);
  const migrated = useRef(false);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    const scope: Scope = getScope();
    // A late answer from the other slot is dropped: the sequence number changes on every refresh and switch.
    const apply = (part: Partial<LiveSnapshot>) => {
      if (n === seq.current && getScope() === scope) setSnap((s) => (s.scope === scope ? { ...s, ...part } : s));
    };
    try {
      apply(await loadSnapshot(snapRef.current, apply, scope));
    } catch (e) {
      apply({ status: "error", error: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The plan panel saves policy revisions itself ("Allow in Policy"); reload the snapshot after it does.
    const onRefresh = () => void refresh();
    window.addEventListener("fv:workspace-refresh", onRefresh);
    return () => window.removeEventListener("fv:workspace-refresh", onRefresh);
  }, [refresh]);

  // EVM addresses typed before R7 lived only in this browser. Typed-in addresses are no longer accepted (an
  // account enters only through its wallet), so the old copy is simply discarded.
  useEffect(() => {
    if (migrated.current || !mounted) return;
    migrated.current = true;
    if (takeLegacyEvm()) clearLegacyEvm();
  }, [mounted]);

  // A connected NEAR wallet proves its account with one NEP-413 signature over a server challenge (free, no
  // transaction); the server verifies it and the account becomes the main account. Asked once per account per
  // page; if declined, the account menu offers to ask again.
  const proveNear = useCallback(async (id: string) => {
    setNearProof({ account: id, state: "signing" });
    try {
      const c = await api("/api/accounts", { action: "challenge", chain: "near", address: id }, "POST", "personal");
      const { selector } = await walletClient();
      const w = await selector.wallet();
      const { Buffer } = await import("buffer");
      const signed: any = await (w as any).signMessage({ message: c.message, recipient: c.recipient, nonce: Buffer.from(c.nonce, "base64") });
      if (!signed?.signature) throw new Error("The wallet didn’t return a signature.");
      await api("/api/accounts", { action: "prove", challengeId: c.challengeId, signature: signed.signature, publicKey: signed.publicKey, accountId: signed.accountId }, "POST", "personal");
      setNearProof(null);
      await refresh();
    } catch (e) {
      setNearProof({ account: id, state: "declined", error: (e as Error).message });
    }
  }, [refresh]);
  useEffect(() => {
    const id = wallet.accountId;
    if (!id) {
      synced.current = null;
      return;
    }
    const w: any = snap.workspace;
    if (snap.scope !== "personal" || snap.status === "loading" || !w) return;
    // Signed in to this account on the server already: nothing to ask. Otherwise (a new device, or a different
    // account) the wallet signs one free message and the server signs this browser in to the account.
    if (snap.signedIn === id) return;
    if (synced.current === id) return;
    synced.current = id;
    void proveNear(id);
  }, [wallet.accountId, snap.status, snap.workspace, snap.scope, snap.signedIn, proveNear]);

  // The NEAR wallet was disconnected (here or in the wallet itself): sign this browser out, so your calendar
  // and plans are no longer shown here. They stay saved with your account.
  const signingOut = useRef(false);
  useEffect(() => {
    if (!wallet.ready || wallet.error || wallet.accountId || !snap.signedIn || snap.scope !== "personal" || signingOut.current) return;
    signingOut.current = true;
    void api("/api/accounts", { action: "sign-out" }, "POST", "personal")
      .then(() => refresh())
      .catch(() => undefined)
      .finally(() => {
        signingOut.current = false;
      });
  }, [wallet.ready, wallet.error, wallet.accountId, snap.signedIn, snap.scope, refresh]);

  // Returning from a redirect wallet: attach the hashes (or mark uncertain) to the journal entry.
  useEffect(() => {
    if (!mounted) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get("fv_attempt");
    const hashes = url.searchParams.get("transactionHashes");
    const walletError = url.searchParams.get("errorCode");
    if (!id || (!hashes && !walletError)) return;
    void (async () => {
      try {
        await api("/api/transactions", { id, action: hashes ? "attach" : "uncertain", hashes: hashes ? hashes.split(",") : undefined }, "POST", "personal");
      } finally {
        for (const k of ["fv_attempt", "transactionHashes", "errorCode", "errorMessage"]) url.searchParams.delete(k);
        history.replaceState(null, "", url);
        await refresh();
      }
    })();
  }, [mounted, refresh]);

  const actions: LiveActions = useMemo(
    () => ({
      connect: () => walletRef.current.connect(),
      connectNear: (id) => walletRef.current.connectWith(id),
      // Disconnecting the NEAR wallet signs this browser out of the account, so the Ethereum and Solana
      // wallets connected under it are disconnected here too. Everything stays saved with the account.
      disconnect: async () => {
        await walletRef.current.disconnect();
        for (const x of sessionsRef.current) await disconnectWallet(x).catch(() => undefined);
        await api("/api/accounts", { action: "sign-out" }, "POST", "personal").catch(() => undefined);
        await refresh();
      },
      connectWallet: async (w) => {
        const address = await connectWallet(
          w,
          (chain, address) => api("/api/accounts", { action: "challenge", chain, address }, "POST", "personal"),
          (body) => api("/api/accounts", body, "POST", "personal"),
        );
        await refresh();
        return address;
      },
      disconnectWallet: async (s) => {
        await disconnectWallet(s);
      },
      proveNear: async () => {
        const id = walletRef.current.accountId;
        if (!id) throw new Error("Connect a NEAR wallet first.");
        await proveNear(id);
      },
      accounts: async (body) => {
        const r = await api("/api/accounts", body, "POST");
        await refresh();
        return r;
      },
      refresh,
      savePlan: async (changes) => {
        const latest = await api("/api/workspace", undefined, "GET");
        // The mandate PUT takes the plan fields only; obligations and version are server-owned.
        const rest = { ...latest.workspace.mandate };
        delete rest.obligations;
        delete rest.version;
        await api("/api/workspace", { revision: latest.revision, mandate: { ...rest, ...changes } }, "PUT");
        await refresh();
      },
      removeObligation: async (id) => {
        const latest = await api("/api/workspace");
        await api("/api/obligations", { revision: latest.revision, obligation: { id } }, "DELETE");
        await refresh();
        // The calendar changed: re-run monitoring now instead of waiting out its read throttle.
        await api("/api/alerts", { action: "check" }).catch(() => {});
        window.dispatchEvent(new Event("fv:plans-refresh"));
      },
      addObligation: async (obligation) => {
        const latest = await api("/api/workspace");
        await api("/api/obligations", { revision: latest.revision, obligation });
        await refresh();
        await api("/api/alerts", { action: "check" }).catch(() => {});
        window.dispatchEvent(new Event("fv:plans-refresh"));
      },
      fund: (body) => api("/api/funding", body, "POST", "personal"),
      fundStatus: (id) => api("/api/funding?id=" + encodeURIComponent(id), undefined, "GET", "personal"),
      sendUsdc: (session, tx, depositAddress, amountRaw) => sendUsdcTransfer(session, tx, depositAddress, amountRaw),
      registerWnear: async () => {
        const prep = await api("/api/funding", { action: "register" }, "POST", "personal");
        await signWnearRegister(prep);
      },
      unwrapToNear: async () => {
        const prep = await api("/api/funding", { action: "unwrap" }, "POST", "personal");
        await signUnwrap(prep);
        await refresh();
        const raw = BigInt(prep.amountRaw);
        return { amountRaw: prep.amountRaw, near: (Number(raw / 10n ** 18n) / 1e6).toFixed(4) };
      },
      updateObligation: async (obligation) => {
        const latest = await api("/api/workspace");
        await api("/api/obligations", { revision: latest.revision, obligation }, "PUT");
        await refresh();
        await api("/api/alerts", { action: "check" }).catch(() => {});
        window.dispatchEvent(new Event("fv:plans-refresh"));
      },
      savePolicy: async (policy) => {
        const latest = await api("/api/policy");
        await api("/api/policy", { revision: latest.revision, policy }, "PUT");
        await refresh();
      },
      policyTest: (body) => api("/api/policy/test", body),
      credit: (body) => api("/api/credit", body),
      prepare: async (kind, amount, key) => {
        const r = await api("/api/prepare", kind === "withdraw" ? { kind, amount, key } : { amount });
        void refresh();
        return r;
      },
      sign: async (preparation) => {
        const s = snapRef.current;
        if (getScope() !== "personal" || s.scope !== "personal") throw new Error("The example workspace can’t be signed. Nothing was sent.");
        if (!s.walletAccount || s.walletAccount !== preparation.accountId || s.workspace?.accountId !== preparation.accountId)
          throw new Error("Connect the wallet that owns this prepared account.");
        const { selector } = await walletClient();
        if (selector.store.getState().accounts.find((a) => a.active)?.accountId !== preparation.accountId)
          throw new Error("Wallet account changed. Prepare again.");
        await api("/api/transactions", { id: preparation.attemptId, action: "authorize" });
        // Persist the request before handing control to a wallet, including redirect-based wallets.
        const url = new URL(window.location.href);
        url.searchParams.set("fv_attempt", preparation.attemptId);
        history.replaceState(null, "", url);
        try {
          // One signer per journal kind. Each re-checks its own preparation; none can sign an unauthorized preview.
          const k = preparation.kind;
          const lending = ["collateral_add", "borrow", "repay", "collateral_release"].includes(k);
          const liquidStaking = ["stake", "unstake", "withdraw_unstaked"].includes(k); // LiNEAR: consumes the single-use handoff first
          const nativeStaking = ["native_stake", "native_unstake", "native_withdraw"].includes(k);
          const outcomes = await (lending ? signLending(preparation)
            : liquidStaking ? signStaking({ ...preparation, attemptId: preparation.attemptId })
            : nativeStaking ? signNativeStaking(preparation)
            : k === "withdraw" ? signWithdraw(preparation)
            : k === "pay" ? signPayment(preparation)
            : k === "supply" || !k ? signSupply(preparation)
            : Promise.reject(new Error("No signer for a " + k + " preparation. Nothing was sent.")));
          const hashes = (outcomes ?? []).map((o: { transaction: { hash: string } }) => o.transaction.hash);
          if (hashes.length) localStorage.setItem("fv-hashes-" + preparation.attemptId, JSON.stringify(hashes));
          await api("/api/transactions", { id: preparation.attemptId, action: hashes.length ? "attach" : "uncertain", hashes });
          localStorage.removeItem("fv-hashes-" + preparation.attemptId);
        } catch (e) {
          await api("/api/transactions", { id: preparation.attemptId, action: "uncertain" }).catch(() => {});
          throw e;
        } finally {
          url.searchParams.delete("fv_attempt");
          history.replaceState(null, "", url);
          await refresh();
        }
      },
      setMode: async (mode) => {
        const scope: Scope = mode === "demo" ? "example" : "personal";
        if (getScope() === scope && snapRef.current.scope === scope) return;
        setScope(scope);
        seq.current++;
        setSnap((s) => ({ ...emptySnapshot(scope), walletAccount: s.walletAccount, walletName: s.walletName, walletError: s.walletError, replays: s.replays }));
        await refresh();
      },
      strategies: (amount) => api("/api/strategies?amount=" + encodeURIComponent(amount), undefined, "GET"),
      stakeQuote: (body) => api("/api/staking/prepare", body),
      // Each question carries a fresh idempotency key so its saved plan is never duplicated by a retry.
      ask: (question, useModel) => api("/api/assistant", { question, useModel, planKey: crypto.randomUUID() }),
      compare: (obligationId) => api("/api/payments/compare", { obligationId }),
      resetExample: async () => {
        if (getScope() !== "example") throw new Error("Only the example workspace can be reset.");
        const latest = await api("/api/workspace", undefined, "GET", "example");
        await api("/api/workspace", { reset: true, revision: latest.revision }, "POST", "example");
        await refresh();
      },
      validators: () => api("/api/staking/validators", undefined, "GET"),
      stakingOptions: (pool) => api("/api/staking/options" + (pool ? "?pool=" + encodeURIComponent(pool) : ""), undefined, "GET"),
      payment: async (obligationId, key) => {
        const r = await api("/api/payments", { key, obligationId });
        await refresh();
        return r.payment;
      },
      paymentAction: async (paymentId, action) => {
        const r = await api("/api/payments/" + encodeURIComponent(paymentId), { action });
        await refresh();
        return r;
      },
      check: async (attemptId) => {
        let hashes: string[] | undefined;
        try {
          hashes = JSON.parse(localStorage.getItem("fv-hashes-" + attemptId) || "null") ?? undefined;
        } catch {}
        await api("/api/transactions", { id: attemptId, action: hashes?.length ? "attach" : "check", hashes });
        localStorage.removeItem("fv-hashes-" + attemptId);
        await refresh();
      },
    }),
    [refresh, proveNear],
  );

  if (!mounted) return null;
  return (
    <>
      <DesignApp live={snap} actions={actions} />
      <PlanDock key={snap.scope} scope={snap.scope} sign={actions.sign} canSign={snap.scope === "personal" && !!snap.walletAccount && snap.walletAccount === snap.workspace?.accountId} />
    </>
  );
}
