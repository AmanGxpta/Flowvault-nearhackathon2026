import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectChain,
  ensureAccounts,
  applyAccountAction,
  adoptLegacy,
  unreadAccounts,
  accountState,
  MAX_ACCOUNTS,
} from "../lib/flowvault/account-registry.ts";
import type { Workspace } from "../lib/flowvault/types.ts";

const EVM = "0x32E54827dca55754ea9Cc1Cc8455B2b6A7BE004A";
const EVM2 = "0x" + "ab".repeat(20);
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const NOW = "2026-11-12T10:00:00.000Z";

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    mode: "live",
    accountId: "datamastr3.near",
    obligations: [],
    operations: [],
    mandate: { version: 1 } as Workspace["mandate"],
    ...over,
  } as Workspace;
}

test("detectChain tells NEAR, EVM and Solana apart", () => {
  assert.equal(detectChain("datamastr3.near"), "near");
  assert.equal(detectChain("a".repeat(64).replace(/a/g, "f")), "near");
  assert.equal(detectChain(EVM), "evm");
  assert.equal(detectChain(SOL), "solana");
  assert.equal(detectChain("0x" + "0".repeat(40)), null);
  assert.equal(detectChain("not an address!"), null);
});

test("migration: the primary is yours, a watched copy of your own EVM address becomes yours", () => {
  const w = ws({
    evmAddresses: { base: EVM, arb: EVM },
    watchedAccounts: [
      { id: "w1-base", chain: "base", address: EVM, label: "0x32E5…004A · Base" },
      { id: "w1-arb", chain: "arb", address: EVM, label: "0x32E5…004A · Arbitrum" },
      { id: "w2", chain: "near", address: "friend.near", label: "Friend" },
    ],
  });
  assert.equal(ensureAccounts(w, NOW), true);
  const byId = Object.fromEntries(w.accounts!.map((a) => [a.id, a]));
  assert.equal(byId["near:datamastr3.near"].primary, true);
  assert.equal(byId["near:datamastr3.near"].role, "owned");
  assert.equal(byId["evm:" + EVM.toLowerCase()].role, "owned");
  assert.equal(byId["near:friend.near"].role, "watched");
  assert.equal(w.accounts!.length, 3);
  // Derived fields: your address is read as yours and never also as watched.
  assert.deepEqual(w.evmAddresses, { base: EVM.toLowerCase(), arb: EVM.toLowerCase() });
  assert.deepEqual(w.watchedAccounts!.map((x) => x.address), ["friend.near"]);
  assert.equal(ensureAccounts(w, NOW), false, "idempotent");
});

test("migration keeps a watched-only EVM address watched, as one account across networks", () => {
  const w = ws({
    watchedAccounts: [
      { id: "a", chain: "base", address: EVM, label: "0x32E5…004A · Base" },
      { id: "b", chain: "arb", address: EVM, label: "0x32E5…004A · Arbitrum" },
    ],
  });
  ensureAccounts(w, NOW);
  const evm = w.accounts!.filter((a) => a.chain === "evm");
  assert.equal(evm.length, 1);
  assert.equal(evm[0].role, "watched");
  assert.equal(evm[0].label, "0x32E5…004A");
  assert.deepEqual(w.watchedAccounts!.map((x) => x.chain), ["base", "arb"]);
});

test("marking a watched address as yours moves it into net worth and out of the watched list", () => {
  const w = ws({ watchedAccounts: [{ id: "a", chain: "base", address: EVM, label: "x" }] });
  ensureAccounts(w, NOW);
  const r = applyAccountAction(w, { action: "set-role", id: "evm:" + EVM.toLowerCase(), role: "owned" }, NOW);
  assert.equal(r.counted, true);
  assert.equal(w.evmAddresses!.base, EVM.toLowerCase());
  assert.equal(w.watchedAccounts!.length, 0);
  assert.equal(w.accounts!.find((a) => a.chain === "evm")!.proof!.method, "declared");
});

test("several accounts per chain; extra ones are reported unread, never zero", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  applyAccountAction(w, { action: "add", address: EVM, role: "owned" }, NOW);
  applyAccountAction(w, { action: "add", address: EVM2, role: "owned" }, NOW);
  applyAccountAction(w, { action: "add", address: SOL, role: "owned" }, NOW);
  applyAccountAction(w, { action: "add", address: "second.near", role: "owned" }, NOW);
  assert.equal(w.accounts!.length, 5);
  assert.deepEqual(
    unreadAccounts(w).map((a) => a.id).sort(),
    ["evm:" + EVM2, "near:second.near", "solana:" + SOL].sort(),
  );
  assert.throws(() => applyAccountAction(w, { action: "add", address: EVM.toLowerCase(), role: "watched" }, NOW), /already/);
});

test("forgetting the primary clears the main account; forgetting others leaves it", () => {
  const w = ws({ evmAddresses: { base: EVM } });
  ensureAccounts(w, NOW);
  applyAccountAction(w, { action: "forget", id: "evm:" + EVM.toLowerCase() }, NOW);
  assert.deepEqual(w.evmAddresses, {});
  assert.equal(w.accountId, "datamastr3.near");
  const r = applyAccountAction(w, { action: "forget", id: "near:datamastr3.near" }, NOW);
  assert.equal(r.counted, true);
  assert.equal(w.accountId, null);
  assert.equal(w.accounts!.length, 0);
});

test("the primary can't be demoted to watched", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  assert.throws(() => applyAccountAction(w, { action: "set-role", id: "near:datamastr3.near", role: "watched" }, NOW), /always yours/);
});

test("switching the main account: a typed-in one becomes watched, a wallet-signed one stays yours", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  w.accountId = "other.near";
  ensureAccounts(w, NOW);
  assert.equal(w.accounts!.find((a) => a.address === "datamastr3.near")!.role, "watched");
  assert.equal(w.accounts!.find((a) => a.address === "other.near")!.primary, true);

  const v = ws();
  ensureAccounts(v, NOW);
  applyAccountAction(v, { action: "wallet-session", chain: "near", address: "datamastr3.near" }, NOW);
  assert.equal(v.accounts![0].proof!.method, "wallet-session");
  v.accountId = "other.near";
  ensureAccounts(v, NOW);
  const old = v.accounts!.find((a) => a.address === "datamastr3.near")!;
  assert.equal(old.role, "owned");
  assert.equal(old.primary, undefined);
});

test("wallet-session never upgrades a watched account and never stores 'connected'", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  applyAccountAction(w, { action: "add", address: "friend.near", role: "watched" }, NOW);
  const r = applyAccountAction(w, { action: "wallet-session", chain: "near", address: "friend.near" }, NOW);
  assert.equal(r.message, "");
  assert.equal(w.accounts!.find((a) => a.address === "friend.near")!.role, "watched");
  assert.ok(!JSON.stringify(w.accounts).includes("connected"));
  const a = w.accounts![0];
  assert.equal(accountState(a, new Set([a.id])), "connected");
  assert.equal(accountState(a, new Set()), "owned");
});

test("legacy writers update the registry and keep Solana accounts", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  applyAccountAction(w, { action: "add", address: SOL, role: "watched" }, NOW);
  w.evmAddresses = { base: EVM, arb: EVM };
  w.watchedAccounts = [];
  adoptLegacy(w, NOW);
  assert.ok(w.accounts!.some((a) => a.chain === "solana"));
  assert.ok(w.accounts!.some((a) => a.chain === "evm" && a.role === "owned"));
  assert.ok(w.accounts!.some((a) => a.primary));
});

test("limits and the example workspace", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  for (let i = 1; i < MAX_ACCOUNTS; i++)
    applyAccountAction(w, { action: "add", address: "0xa" + i.toString(16).padStart(39, "0"), role: "watched" }, NOW);
  assert.throws(() => applyAccountAction(w, { action: "add", address: EVM, role: "watched" }, NOW), /Up to/);
  const ex = ws({ mode: "demo", accountId: null });
  assert.equal(ensureAccounts(ex, NOW), false);
  assert.throws(() => applyAccountAction(ex, { action: "add", address: EVM, role: "owned" }, NOW), /fictional/);
});
