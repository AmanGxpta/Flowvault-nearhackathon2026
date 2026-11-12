// Account registry (owner: Interface). The accounts you have proven are yours, on any chain, any number per
// chain. An account enters ONLY by its own wallet signing a one-time challenge that the server verifies
// (NEP-413 / SIWE / SIWS, account-proof.ts). FlowVault never reads or counts an address you can't prove, so there is
// no "watched" account. "Connected" is never stored: it is a browser fact (a wallet can sign for the account
// right now), so disconnecting can never leave a stale state behind; the account stays yours until you forget it.
//
// Readers that predate the registry use `Workspace.evmAddresses` (derived here from proven EVM accounts) and
// `Workspace.watchedAccounts` (always empty now).
import type { AccountChain, LinkedAccount, Workspace } from "./types.ts";

export const MAX_ACCOUNTS = 24;
export const NETWORKS: Record<AccountChain, string[]> = {
  near: ["near"],
  evm: ["ethereum", "base", "arbitrum"],
  solana: ["solana"],
};
const NEAR_RE = /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validAddress(chain: AccountChain, address: string) {
  if (chain === "near") return NEAR_RE.test(address);
  if (chain === "evm") return EVM_RE.test(address) && !/^0x0{40}$/i.test(address);
  return SOL_RE.test(address);
}

/** Canonical form: NEAR and EVM compare lowercase; Solana base58 is case-sensitive. */
export function canonical(chain: AccountChain, address: string) {
  const a = address.trim();
  return chain === "solana" ? a : a.toLowerCase();
}
export const accountId = (chain: AccountChain, address: string) => chain + ":" + canonical(chain, address);
export const shortAddress = (a: string) => (a.length > 22 ? a.slice(0, 6) + "…" + a.slice(-4) : a);
export const chainName = (c: AccountChain) => (c === "near" ? "NEAR" : c === "evm" ? "EVM" : "Solana");
/** Only a server-verified signature proves an account. A browser-reported wallet session (A1) doesn't. */
export const VERIFIED = new Set(["nep413", "siwe", "siws"]);
export const proven = (a: LinkedAccount) => !!a.proof && VERIFIED.has(a.proof.method);

function entry(chain: AccountChain, address: string, proof: LinkedAccount["proof"], now: string, label?: string): LinkedAccount {
  if (!validAddress(chain, address.trim())) throw new Error(`That isn’t a valid ${chainName(chain)} address.`);
  const a = canonical(chain, address);
  return {
    id: accountId(chain, a),
    chain,
    address: a,
    // The label keeps the address as given (EVM checksum case); comparisons use the canonical form.
    label: label?.trim() || shortAddress(address.trim()),
    proof,
    networks: [...NETWORKS[chain]],
    addedAt: now,
  };
}

type Legacy = Omit<LinkedAccount, "proof"> & { role?: "watched" | "owned"; proof: LinkedAccount["proof"] | { method: "declared"; at: string } };

/**
 * Idempotent migration. Older workspaces had addresses typed in without proof (the main NEAR account, EVM
 * addresses) and watched addresses (someone else's). Watched ones are dropped. Typed-in ones stay listed as
 * unproven (never read or counted) until their wallet proves them; a wallet session already seen counts.
 */
function migrate(w: Workspace, now: string) {
  if (!Array.isArray(w.accounts)) {
    const out: LinkedAccount[] = [];
    const add = (chain: AccountChain, addr: string | null | undefined) => {
      if (addr && validAddress(chain, addr) && !out.some((x) => x.id === accountId(chain, addr))) out.push(entry(chain, addr, null, now));
    };
    add("near", w.accountId);
    for (const a of [w.evmAddresses?.base, w.evmAddresses?.arb]) add("evm", a);
    w.accounts = out;
    return;
  }
  w.accounts = (w.accounts as unknown as Legacy[])
    .filter((a) => a.role !== "watched")
    .map((a) => {
      const rest: Legacy = { ...a };
      delete rest.role;
      return { ...rest, proof: a.proof && VERIFIED.has(a.proof.method) ? a.proof : null } as LinkedAccount;
    });
}

/** The main NEAR account must be a proven account; otherwise there is no main account. */
function syncPrimary(w: Workspace) {
  const list = w.accounts ?? [];
  const want = w.accountId && validAddress("near", w.accountId) ? accountId("near", w.accountId) : null;
  const main = want ? list.find((a) => a.id === want && proven(a)) : undefined;
  if (!main) w.accountId = null;
  for (const a of list) {
    if (a === main) a.primary = true;
    else delete a.primary;
  }
}

/** The legacy fields, derived. Only the first proven EVM account has a reader until multi-account reads land. */
function deriveLegacy(w: Workspace) {
  const evm = (w.accounts ?? []).find((a) => a.chain === "evm" && proven(a));
  const evmAddresses: NonNullable<Workspace["evmAddresses"]> = {};
  if (evm?.networks.includes("base")) evmAddresses.base = evm.address;
  if (evm?.networks.includes("arbitrum")) evmAddresses.arb = evm.address;
  w.evmAddresses = evmAddresses;
  w.watchedAccounts = [];
}

/** Proven accounts that no reader covers. Every chain and network is read since A2, so this is empty. */
export function unreadAccounts(w: Workspace): LinkedAccount[] {
  void w;
  return [];
}

/** Whether the workspace may read this address: only accounts proven yours. Anyone else's address is refused. */
export function mayRead(w: Workspace, chain: AccountChain, address: string) {
  const id = accountId(chain, address);
  return (w.accounts ?? []).some((a) => a.id === id && proven(a));
}

/** Idempotent: migrate, keep the main account proven and the derived fields in step. Returns whether it changed. */
export function ensureAccounts(w: Workspace, now = new Date().toISOString()) {
  if (w.mode === "demo" || w.fictional) return false;
  const before = JSON.stringify([w.accounts, w.accountId, w.evmAddresses, w.watchedAccounts]);
  migrate(w, now);
  syncPrimary(w);
  deriveLegacy(w);
  return JSON.stringify([w.accounts, w.accountId, w.evmAddresses, w.watchedAccounts]) !== before;
}

export type AccountAction =
  /** Only after the server verified the wallet's signature over its challenge (see app/api/accounts). */
  | { action: "proven"; chain: AccountChain; address: string; method: "nep413" | "siwe" | "siws" }
  | { action: "rename"; id: string; label: string }
  | { action: "forget"; id: string };

/**
 * Apply one registry change. `counted` says whether what counts toward net worth (or the main account)
 * changed, so the caller invalidates drafts the same way every other account change does.
 */
export function applyAccountAction(w: Workspace, act: AccountAction, now = new Date().toISOString()): { counted: boolean; message: string } {
  if (w.mode === "demo" || w.fictional) throw new Error("The example workspace’s accounts are fictional and can’t be changed.");
  ensureAccounts(w, now);
  const list = w.accounts!;
  const find = (id: string) => {
    const a = list.find((x) => x.id === id);
    if (!a) throw new Error("That account isn’t in this workspace.");
    return a;
  };
  let counted = false;
  let message = "";
  switch (act.action) {
    case "proven": {
      const id = accountId(act.chain, act.address);
      const existing = list.find((x) => x.id === id);
      const wasMain = w.accountId;
      if (existing) {
        counted = !proven(existing);
        existing.proof = { method: act.method, at: now };
      } else {
        if (list.length >= MAX_ACCOUNTS) throw new Error(`Up to ${MAX_ACCOUNTS} accounts. Forget one first.`);
        list.push(entry(act.chain, act.address, { method: act.method, at: now }, now));
        counted = true;
      }
      // The NEAR wallet you connect is the account plans run from; your other accounts stay yours.
      if (act.chain === "near") w.accountId = canonical("near", act.address);
      counted ||= wasMain !== w.accountId;
      message = `Connected ${shortAddress(act.address)}. Ownership verified by signature.`;
      break;
    }
    case "rename": {
      const a = find(act.id);
      const label = act.label.trim();
      if (!label || label.length > 60) throw new Error("Use a name of 1 to 60 characters.");
      a.label = label;
      message = "Renamed.";
      break;
    }
    case "forget": {
      const a = find(act.id);
      w.accounts = list.filter((x) => x !== a);
      if (a.primary) w.accountId = null;
      counted = proven(a) || !!a.primary;
      message = `Forgot ${a.label}. Nothing on-chain changed; connect its wallet again any time.`;
      break;
    }
  }
  syncPrimary(w);
  deriveLegacy(w);
  return { counted, message };
}

/** What the browser shows per account; `connected` comes from the live wallet sessions passed in. */
export function accountState(a: LinkedAccount, connected: Set<string>) {
  if (!proven(a)) return "unproven" as const;
  return connected.has(a.id) ? ("connected" as const) : ("yours" as const);
}
