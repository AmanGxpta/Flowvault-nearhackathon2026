// Account registry (owner: Interface). One list of accounts on any chain, each watched (someone else's, read
// only, never counted) or owned (yours, counted). "Connected" is never stored: it is a browser fact (a wallet
// can sign for the account right now), so disconnecting a wallet can never leave a stale state behind.
//
// Readers that predate the registry use `Workspace.evmAddresses` and `Workspace.watchedAccounts`; both are
// DERIVED here from the registry on every write, so the portfolio keeps reading exactly what the registry says.
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

/** Which chain an address belongs to, or null. Dotted names and 64-hex implicit accounts are NEAR. */
export function detectChain(input: string): AccountChain | null {
  const a = input.trim();
  if (EVM_RE.test(a)) return validAddress("evm", a) ? "evm" : null;
  if (/^[0-9a-f]{64}$/.test(a) || (a.includes(".") && NEAR_RE.test(a))) return "near";
  if (SOL_RE.test(a)) return "solana";
  if (NEAR_RE.test(a)) return "near";
  return null;
}

/** Canonical form: NEAR and EVM compare lowercase; Solana base58 is case-sensitive. */
export function canonical(chain: AccountChain, address: string) {
  const a = address.trim();
  return chain === "solana" ? a : a.toLowerCase();
}
export const accountId = (chain: AccountChain, address: string) => chain + ":" + canonical(chain, address);
export const shortAddress = (a: string) => (a.length > 22 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

export function newAccount(
  chain: AccountChain,
  address: string,
  role: LinkedAccount["role"],
  now: string,
  label?: string,
): LinkedAccount {
  if (!validAddress(chain, address.trim())) throw new Error(`That isn’t a valid ${chainName(chain)} address.`);
  const a = canonical(chain, address);
  return {
    id: accountId(chain, a),
    chain,
    address: a,
    // The label keeps the address as typed (EVM checksum case); comparisons use the canonical form.
    label: label?.trim() || shortAddress(address.trim()),
    role,
    proof: role === "owned" ? { method: "declared", at: now } : null,
    networks: [...NETWORKS[chain]],
    addedAt: now,
  };
}
export const chainName = (c: AccountChain) => (c === "near" ? "NEAR" : c === "evm" ? "EVM" : "Solana");

/** Build the registry from the fields that predate it. An address both declared yours and watched is yours. */
export function fromLegacy(w: Workspace, now: string): LinkedAccount[] {
  const out = new Map<string, LinkedAccount>();
  const put = (a: LinkedAccount) => {
    const prior = out.get(a.id);
    if (!prior) return out.set(a.id, a);
    if (a.role === "owned" && prior.role === "watched") out.set(a.id, { ...a, label: prior.label });
  };
  if (w.accountId && validAddress("near", w.accountId))
    put({ ...newAccount("near", w.accountId, "owned", now), primary: true });
  for (const addr of new Set([w.evmAddresses?.base, w.evmAddresses?.arb].filter(Boolean) as string[]))
    if (validAddress("evm", addr)) put(newAccount("evm", addr, "owned", now));
  for (const x of w.watchedAccounts ?? []) {
    const chain: AccountChain = x.chain === "near" ? "near" : "evm";
    if (!validAddress(chain, x.address)) continue;
    // Legacy labels carry the network suffix (" · Base"); one EVM account now covers every network.
    put(newAccount(chain, x.address, "watched", now, x.label.replace(/ · (Base|Arbitrum)$/, "")));
  }
  return [...out.values()];
}

/** Keep the primary entry equal to Workspace.accountId. A replaced primary you only typed in becomes watched. */
export function syncPrimary(w: Workspace, now: string) {
  const list = w.accounts ?? [];
  const want = w.accountId && validAddress("near", w.accountId) ? accountId("near", w.accountId) : null;
  for (const a of list)
    if (a.primary && a.id !== want) {
      delete a.primary;
      if (a.proof?.method === "declared") {
        a.role = "watched";
        a.proof = null;
      }
    }
  if (want && !list.some((a) => a.id === want && a.primary)) {
    const existing = list.find((a) => a.id === want);
    if (existing) {
      existing.primary = true;
      if (existing.role === "watched") {
        existing.role = "owned";
        existing.proof = { method: "declared", at: now };
      }
    } else list.unshift({ ...newAccount("near", w.accountId!, "owned", now), primary: true });
  }
  w.accounts = list;
}

/** The legacy fields, derived. Only the first owned EVM account has a reader until multi-account reads land. */
export function deriveLegacy(w: Workspace) {
  const list = w.accounts ?? [];
  const ownedEvm = list.find((a) => a.chain === "evm" && a.role === "owned");
  const evmAddresses: NonNullable<Workspace["evmAddresses"]> = {};
  if (ownedEvm?.networks.includes("base")) evmAddresses.base = ownedEvm.address;
  if (ownedEvm?.networks.includes("arbitrum")) evmAddresses.arb = ownedEvm.address;
  const watchedAccounts: NonNullable<Workspace["watchedAccounts"]> = [];
  for (const a of list.filter((x) => x.role === "watched")) {
    if (a.chain === "near") watchedAccounts.push({ id: a.id, chain: "near", address: a.address, label: a.label });
    if (a.chain === "evm")
      for (const [net, chain, name] of [["base", "base", "Base"], ["arbitrum", "arb", "Arbitrum"]] as const)
        if (a.networks.includes(net)) watchedAccounts.push({ id: a.id + ":" + chain, chain, address: a.address, label: a.label + " · " + name });
  }
  w.evmAddresses = evmAddresses;
  w.watchedAccounts = watchedAccounts;
}

/** Accounts in the registry that no reader covers yet (shown as "not read yet", never as zero). */
export function unreadAccounts(w: Workspace) {
  const firstEvm = (w.accounts ?? []).find((a) => a.chain === "evm" && a.role === "owned")?.id;
  return (w.accounts ?? []).filter(
    (a) => a.chain === "solana" || (a.chain === "near" && a.role === "owned" && !a.primary) || (a.chain === "evm" && a.role === "owned" && a.id !== firstEvm),
  );
}

/** Idempotent: migrate once, then keep the primary and the derived fields in step. Returns whether it changed. */
export function ensureAccounts(w: Workspace, now = new Date().toISOString()) {
  if (w.mode === "demo" || w.fictional) return false;
  const before = JSON.stringify([w.accounts, w.evmAddresses, w.watchedAccounts]);
  if (!Array.isArray(w.accounts)) w.accounts = fromLegacy(w, now);
  syncPrimary(w, now);
  deriveLegacy(w);
  return JSON.stringify([w.accounts, w.evmAddresses, w.watchedAccounts]) !== before;
}

/** Legacy writers (evmAddresses / watchedAccounts PUT) replace the NEAR and EVM accounts they describe. */
export function adoptLegacy(w: Workspace, now = new Date().toISOString()) {
  const fresh = fromLegacy(w, now);
  const keep = (w.accounts ?? []).filter((a) => a.chain === "solana" || (a.chain === "near" && a.role === "owned" && !a.primary));
  const prior = new Map((w.accounts ?? []).map((a) => [a.id, a]));
  w.accounts = [
    ...fresh.map((a) => {
      const p = prior.get(a.id);
      return p && p.role === a.role ? { ...a, label: p.label, proof: p.proof, addedAt: p.addedAt, networks: p.networks } : a;
    }),
    ...keep.filter((a) => !fresh.some((f) => f.id === a.id)),
  ];
  syncPrimary(w, now);
  deriveLegacy(w);
}

export type AccountAction =
  | { action: "add"; address: string; chain?: AccountChain; role: "watched" | "owned"; label?: string }
  | { action: "set-role"; id: string; role: "watched" | "owned" }
  | { action: "rename"; id: string; label: string }
  | { action: "forget"; id: string }
  | { action: "wallet-session"; chain: AccountChain; address: string };

/**
 * Apply one registry change. Returns whether what counts toward net worth (or the primary) changed, so the
 * caller can invalidate drafts the same way every other account change does.
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
    case "add": {
      const chain = act.chain ?? detectChain(act.address);
      if (!chain) throw new Error("That isn’t a NEAR account, EVM address or Solana address.");
      const a = newAccount(chain, act.address, act.role, now, act.label);
      if (list.some((x) => x.id === a.id)) throw new Error(`${shortAddress(a.address)} is already in your accounts.`);
      if (list.length >= MAX_ACCOUNTS) throw new Error(`Up to ${MAX_ACCOUNTS} accounts. Forget one first.`);
      list.push(a);
      counted = a.role === "owned";
      message = a.role === "owned" ? `Added ${a.label} as yours.` : `Watching ${a.label}. Watching never lets anyone move its funds.`;
      break;
    }
    case "set-role": {
      const a = find(act.id);
      if (a.primary && act.role === "watched") throw new Error("Your main NEAR account is always yours. Forget it instead.");
      if (a.role === act.role) return { counted: false, message: "No change." };
      a.role = act.role;
      a.proof = act.role === "owned" ? { method: "declared", at: now } : null;
      counted = true;
      message = act.role === "owned" ? `${a.label} is now yours and counts toward net worth.` : `${a.label} is now watched: read only and not counted.`;
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
      counted = a.role === "owned" || !!a.primary;
      message = `Forgot ${a.label}. Nothing on-chain changed; add it again any time.`;
      break;
    }
    case "wallet-session": {
      const id = accountId(act.chain, act.address);
      const a = list.find((x) => x.id === id);
      if (!a || a.role !== "owned") return { counted: false, message: "" };
      if (a.proof?.method !== "declared") return { counted: false, message: "" };
      a.proof = { method: "wallet-session", at: now };
      message = "A wallet signed in as " + a.label + ".";
      break;
    }
  }
  syncPrimary(w, now);
  deriveLegacy(w);
  return { counted, message };
}

/** What the browser shows per account; `connected` comes from the live wallet sessions passed in. */
export function accountState(a: LinkedAccount, connected: Set<string>) {
  if (a.role === "watched") return "watched" as const;
  return connected.has(a.id) ? ("connected" as const) : ("owned" as const);
}
