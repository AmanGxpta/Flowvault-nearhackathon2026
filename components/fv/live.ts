"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- adapters between untyped design view-model data and API JSON */
// Live data layer for the redesigned interface. Every figure shown in the personal (live)
// workspace comes from these API reads; nothing here invents a balance, rate or status.
// Amounts stay decimal strings from the API; Number() is used only for display formatting.
import type { Workspace, Portfolio } from "@/lib/flowvault/types";
import type { WalletAttempt } from "@/lib/flowvault/execution";

/**
 * Workspace slot for every request (BACKEND_API §10). "example" is the server's fictional seed, selected with
 * the X-FlowVault-Workspace header; it is a separate record, so Judge mode never reads or writes the personal one.
 */
export type Scope = "personal" | "example";
let currentScope: Scope = "personal";
export const getScope = () => currentScope;
export const setScope = (s: Scope) => {
  currentScope = s;
};

export async function api(path: string, body?: unknown, method = "POST", scope: Scope = currentScope): Promise<any> {
  const headers: Record<string, string> = { "X-FlowVault-Workspace": scope };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, body !== undefined ? { method, headers, body: JSON.stringify(body) } : { headers });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
}

export interface Usable {
  amount: string | null;
  knownSubtotal: string;
  coverage: "complete" | "partial" | "unknown";
  reasons: string[];
  capturedAt: string;
  fresh: boolean;
  date?: string;
}
export interface LivePortfolio extends Portfolio {
  usable?: {
    netWorth: Usable;
    cashNow: Usable;
    withdrawableByDate: Usable[];
    borrowingHeadroom: Usable;
    committedCapital: Usable;
    unvaluedAssets: { id: string; asset: string; amount: string }[];
    committedInFlight: string;
  };
  staking?: any;
  coverage?: Record<string, string>;
}
export interface TimelineAttempt {
  id: string;
  kind: string;
  accountId: string;
  state: string;
  timeline: {
    id: string;
    sequence: number;
    at: string;
    phase: string;
    status: string;
    message: string;
    explorerLinks: string[];
    fees: { unit: string; amount: string | null; verified: boolean }[];
  }[];
  retainedSignedQuote: unknown;
  verificationEvidence: unknown[];
}
export interface LiveSnapshot {
  /** Which workspace slot these reads came from; a snapshot is never shown under the other slot. */
  scope: Scope;
  status: "loading" | "ready" | "error";
  error: string;
  workspace: Workspace | null;
  revision: number;
  obligations: {
    holdback: string | null;
    obligationsInHorizon: string | null;
    horizonDays: number;
    error: string | null;
  } | null;
  portfolio: LivePortfolio | null;
  portfolioError: string;
  /** Per-section read errors (obligations, policy, strategies, plan); a failed section stays null. */
  errors: Record<string, string>;
  policy: { policy: any; ledger: { amount: string; createdAt: string; state: string; source: string }[] } | null;
  strategies: any | null;
  plan: any | null;
  attempts: WalletAttempt[];
  payments: any[];
  replays: any[];
  timeline: TimelineAttempt[];
  /** Staking options with rate source and exit fit (GET /api/staking/options). */
  staking: any | null;
  evm: { base: string; arb: string };
  /** Wallet account connected in this browser (can approve). */
  walletAccount: string | null;
  walletName: string;
  walletError: string;
  /** Multi-wallet (A3): Ethereum and Solana wallets connected in this browser, and the ones it can connect. */
  walletSessions?: import("@/lib/flowvault/wallets").WalletSession[];
  walletsFound?: import("@/lib/flowvault/wallets").DiscoveredWallet[];
  /** The connected NEAR wallet's account still needs its NEP-413 proof (declined or pending). */
  nearProof?: { account: string; state: "signing" | "declined"; error?: string } | null;
  readingAt: string;
}

export const emptySnapshot = (scope: Scope = currentScope): LiveSnapshot => ({
  scope,
  status: "loading",
  error: "",
  workspace: null,
  revision: 0,
  obligations: null,
  portfolio: null,
  portfolioError: "",
  errors: {},
  policy: null,
  strategies: null,
  plan: null,
  attempts: [],
  payments: [],
  replays: [],
  timeline: [],
  staking: null,
  evm: { base: "", arb: "" },
  walletAccount: null,
  walletName: "",
  walletError: "",
  readingAt: "",
});

const EVM_KEY = "fv-evm-addresses";
/** EVM addresses saved in this browser before the workspace held them (R7); read once to migrate, then removed. */
export function takeLegacyEvm(): { base?: string; arb?: string } | null {
  try {
    const raw = localStorage.getItem(EVM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const out: { base?: string; arb?: string } = {};
    if (typeof v.base === "string" && v.base) out.base = v.base;
    if (typeof v.arb === "string" && v.arb) out.arb = v.arb;
    return out.base || out.arb ? out : null;
  } catch {
    return null;
  }
}
export const clearLegacyEvm = () => {
  try {
    localStorage.removeItem(EVM_KEY);
  } catch {}
};

/** Reads every live section. A failed section stays null with its error; it is never zeroed. */
export async function loadSnapshot(
  prev: LiveSnapshot,
  onPartial?: (p: Partial<LiveSnapshot>) => void,
  scope: Scope = currentScope,
): Promise<Partial<LiveSnapshot>> {
  const get = (path: string) => api(path, undefined, "GET", scope);
  const ws = await get("/api/workspace");
  const workspace: Workspace = ws.workspace;
  const saved = (workspace as any).evmAddresses ?? {};
  const evm = { base: saved.base ?? "", arb: saved.arb ?? "" };
  const base: Partial<LiveSnapshot> = { scope, workspace, revision: ws.revision, evm, readingAt: new Date().toISOString() };
  onPartial?.(base);
  const example = scope === "example";
  // No main NEAR account and no other wallet proven yet: nothing to read. A proven Ethereum or Solana wallet
  // alone is still read (Portfolio shows it); plans need the main NEAR account.
  const provenOther = ((workspace as any).accounts ?? []).some((a: any) => a.proof && ["nep413", "siwe", "siws"].includes(a.proof.method));
  if (!example && !workspace.accountId && !provenOther) {
    return { ...base, status: "ready", error: "", obligations: null, portfolio: null, policy: null, strategies: null, plan: null, staking: null };
  }
  // EVM addresses and watched accounts are persisted on the workspace (R7/R10); the portfolio reads them itself.
  const q = new URLSearchParams();
  q.append("date", new Date().toISOString().slice(0, 10));
  for (const o of workspace.obligations ?? []) if (o.status === "pending" || o.status === "processing") q.append("date", o.dueDate);
  // Each section is applied as soon as it arrives; slow chain reads don't hold back the rest.
  const part = <T,>(p: Promise<T>, apply: (v: T) => Partial<LiveSnapshot>) => {
    p.then((v) => onPartial?.({ ...apply(v), scope, workspace, revision: ws.revision })).catch(() => {});
    return p;
  };
  const [ob, pf, pol, st, pl, tx, tl, pays, reps, stk] = await Promise.allSettled([
    part(get("/api/obligations"), (v) => ({ obligations: v })),
    part(get("/api/portfolio?" + q.toString()), (v) => ({ portfolio: v, portfolioError: "" })),
    part(get("/api/policy"), (v) => ({ policy: v })),
    part(get("/api/strategies"), (v) => ({ strategies: v })),
    part(get("/api/plan"), (v) => ({ plan: v })),
    part(get("/api/transactions"), (v) => ({ attempts: v.attempts })),
    part(get("/api/timeline"), (v) => ({ timeline: v.attempts })),
    part(get("/api/payments"), (v) => ({ payments: v.payments ?? [] })),
    part(get("/api/replays"), (v) => ({ replays: v.replays ?? [] })),
    part(get("/api/staking/options"), (v) => ({ staking: v })),
  ]);
  const val = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" ? r.value : null);
  const err = (r: PromiseSettledResult<any>) => (r.status === "rejected" ? (r.reason as Error).message : "");
  return {
    ...base,
    status: "ready",
    error: [ob, pol, st, pl].map(err).filter(Boolean)[0] ?? "",
    obligations: val(ob),
    portfolio: val(pf),
    portfolioError: err(pf),
    errors: { obligations: err(ob), policy: err(pol), strategies: err(st), plan: err(pl), staking: err(stk) },
    policy: val(pol),
    strategies: val(st),
    plan: val(pl),
    staking: val(stk),
    attempts: val(tx)?.attempts ?? (prev.scope === scope ? prev.attempts : []),
    timeline: val(tl)?.attempts ?? (prev.scope === scope ? prev.timeline : []),
    payments: val(pays)?.payments ?? (prev.scope === scope ? prev.payments : []),
    replays: val(reps)?.replays ?? prev.replays,
  };
}

/** True for reads from the server's fictional example slot (workspace.exampleSeed, BACKEND_API §10). */
export function isSeededExample(snap: LiveSnapshot | undefined): boolean {
  return snap?.scope === "example" && !!snap.workspace?.exampleSeed;
}
