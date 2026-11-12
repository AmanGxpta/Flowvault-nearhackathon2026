"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- adapters between untyped design view-model data and API JSON */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PlanDock } from "./PlanDock";
import { DesignApp } from "./design-logic";
import { api, clearLegacyEvm, emptySnapshot, getScope, loadSnapshot, setScope, takeLegacyEvm, type LiveSnapshot, type Scope } from "./live";
import { useNearWallet, signSupply, signWithdraw, signPayment, signLending, walletClient } from "@/lib/flowvault/wallet";

const noopSubscribe = () => () => {};

export interface LiveActions {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  watch(accountId: string): Promise<void>;
  /** Owner's EVM addresses, persisted on the workspace (R7). Declared ownership, not proof of control. */
  setEvm(v: { base?: string; arb?: string }): Promise<void>;
  /** Watched accounts are read-only and excluded from every engine figure (R10). Full replacement. */
  setWatched(list: { id: string; label: string; chain: "near" | "base" | "arb"; address: string }[]): Promise<void>;
  refresh(): Promise<void>;
  savePlan(changes: { reserve?: string; horizon?: number; leadDays?: number; borrowing?: boolean }): Promise<void>;
  addObligation(o: Record<string, unknown>): Promise<void>;
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
  const snap = useMemo(() => ({ ...raw, walletAccount: wallet.accountId, walletName: wallet.walletName, walletError: wallet.error }), [raw, wallet.accountId, wallet.walletName, wallet.error]);
  const snapRef = useRef(snap);
  useEffect(() => {
    walletRef.current = wallet;
    snapRef.current = snap;
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
  }, [refresh]);

  // EVM addresses typed before R7 lived only in this browser: move them onto the personal workspace once.
  useEffect(() => {
    const w: any = snap.workspace;
    if (migrated.current || snap.scope !== "personal" || !w?.accountId || snap.status !== "ready") return;
    migrated.current = true;
    const legacy = takeLegacyEvm();
    if (!legacy) return;
    if (w.evmAddresses?.base || w.evmAddresses?.arb) return clearLegacyEvm();
    void api("/api/workspace", { revision: snap.revision, evmAddresses: legacy }, "PUT", "personal")
      .then(() => { clearLegacyEvm(); return refresh(); })
      .catch(() => {});
  }, [snap.workspace, snap.scope, snap.status, snap.revision, refresh]);

  // A newly connected wallet becomes the live workspace account (same rule as before the redesign).
  useEffect(() => {
    const id = wallet.accountId;
    if (!id) {
      synced.current = null;
      return;
    }
    if (snap.scope !== "personal" || synced.current === id || snap.status === "loading" || !snap.workspace) return;
    synced.current = id;
    void (async () => {
      const latest = await api("/api/workspace", undefined, "GET", "personal");
      if (!(latest.workspace.mode === "live" && latest.workspace.accountId === id))
        await api("/api/workspace", { revision: latest.revision, mode: "live", accountId: id }, "PUT", "personal");
      await refresh();
    })().catch((e) => setSnap((s) => ({ ...s, error: (e as Error).message })));
  }, [wallet.accountId, snap.status, snap.workspace, snap.scope, refresh]);

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
      disconnect: () => walletRef.current.disconnect(),
      watch: async (accountId: string) => {
        const latest = await api("/api/workspace");
        await api("/api/workspace", { revision: latest.revision, mode: "live", accountId: accountId.trim().toLowerCase() }, "PUT");
        await refresh();
      },
      setEvm: async (v) => {
        const latest = await api("/api/workspace", undefined, "GET");
        const evmAddresses: Record<string, string> = {};
        if (v.base) evmAddresses.base = v.base;
        if (v.arb) evmAddresses.arb = v.arb;
        await api("/api/workspace", { revision: latest.revision, evmAddresses, watchedAccounts: latest.workspace.watchedAccounts ?? [] }, "PUT");
        await refresh();
      },
      setWatched: async (list) => {
        const latest = await api("/api/workspace", undefined, "GET");
        await api("/api/workspace", { revision: latest.revision, evmAddresses: latest.workspace.evmAddresses ?? {}, watchedAccounts: list }, "PUT");
        await refresh();
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
      addObligation: async (obligation) => {
        const latest = await api("/api/workspace");
        await api("/api/obligations", { revision: latest.revision, obligation });
        await refresh();
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
          const lending = ["collateral_add", "borrow", "repay", "collateral_release"].includes(preparation.kind);
          const outcomes = await (lending ? signLending(preparation) : preparation.kind === "withdraw" ? signWithdraw(preparation) : preparation.kind === "pay" ? signPayment(preparation) : signSupply(preparation));
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
    [refresh],
  );

  if (!mounted) return null;
  return (
    <>
      <DesignApp live={snap} actions={actions} />
      <PlanDock key={snap.scope} scope={snap.scope} sign={actions.sign} canSign={snap.scope === "personal" && !!snap.walletAccount && snap.walletAccount === snap.workspace?.accountId} />
    </>
  );
}
