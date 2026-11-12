import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureAccounts,
  applyAccountAction,
  unreadAccounts,
  accountState,
  mayRead,
  MAX_ACCOUNTS,
} from "../lib/flowvault/account-registry.ts";
import type { Workspace } from "../lib/flowvault/types.ts";

const EVM = "0x32E54827dca55754ea9Cc1Cc8455B2b6A7BE004A";
const NOW = "2026-11-12T10:00:00.000Z";

function ws(over: Partial<Workspace> = {}): Workspace {
  return {
    mode: "live",
    accountId: null,
    obligations: [],
    operations: [],
    mandate: { version: 1 } as Workspace["mandate"],
    ...over,
  } as Workspace;
}
const connect = (w: Workspace, chain: "near" | "evm" | "solana", address: string) => applyAccountAction(w, { action: "connect", chain, address }, NOW);

test("an account enters only through its wallet; a NEAR wallet becomes the main account", () => {
  const w = ws();
  ensureAccounts(w, NOW);
  assert.equal(w.accounts!.length, 0);
  const r = connect(w, "near", "datamastr3.near");
  assert.equal(r.counted, true);
  assert.equal(w.accountId, "datamastr3.near");
  const a = w.accounts![0];
  assert.equal(a.primary, true);
  assert.equal(a.proof!.method, "wallet-session");
  assert.equal(connect(w, "near", "datamastr3.near").counted, false, "reconnecting changes nothing");
});

test("migration: watched addresses are dropped; typed-in ones are kept unproven and never read", () => {
  const w = ws({
    accountId: "typed.near",
    evmAddresses: { base: EVM, arb: EVM },
    watchedAccounts: [{ id: "w", chain: "near", address: "friend.near", label: "Friend" }],
  });
  assert.equal(ensureAccounts(w, NOW), true);
  assert.deepEqual(w.accounts!.map((a) => [a.id, a.proof]), [
    ["near:typed.near", null],
    ["evm:" + EVM.toLowerCase(), null],
  ]);
  // Nothing unproven is read: no main account, no EVM address, no watched list.
  assert.equal(w.accountId, null);
  assert.deepEqual(w.evmAddresses, {});
  assert.deepEqual(w.watchedAccounts, []);
  assert.equal(mayRead(w, "near", "typed.near"), false);
  assert.equal(mayRead(w, "near", "friend.near"), false);
  assert.equal(ensureAccounts(w, NOW), false, "idempotent");
  // Connecting its wallet proves it and makes it the main account again.
  connect(w, "near", "typed.near");
  assert.equal(w.accountId, "typed.near");
  assert.equal(mayRead(w, "near", "typed.near"), true);
});

test("migration from the first registry: watched entries go, declared proof becomes unproven, wallet sessions stay", () => {
  const w = ws({
    accountId: "datamastr3.near",
    accounts: [
      { id: "near:datamastr3.near", chain: "near", address: "datamastr3.near", label: "datamastr3.near", role: "owned", proof: { method: "wallet-session", at: NOW }, networks: ["near"], primary: true, addedAt: NOW },
      { id: "evm:" + EVM.toLowerCase(), chain: "evm", address: EVM.toLowerCase(), label: "0x32E5…004A", role: "owned", proof: { method: "declared", at: NOW }, networks: ["ethereum", "base", "arbitrum"], addedAt: NOW },
      { id: "near:friend.near", chain: "near", address: "friend.near", label: "Friend", role: "watched", proof: null, networks: ["near"], addedAt: NOW },
    ] as unknown as Workspace["accounts"],
  });
  ensureAccounts(w, NOW);
  assert.equal(w.accounts!.length, 2);
  assert.ok(!JSON.stringify(w.accounts).includes("role"));
  assert.equal(w.accountId, "datamastr3.near");
  assert.equal(w.accounts![1].proof, null);
  assert.deepEqual(w.evmAddresses, {});
});

test("several wallets per chain; proven ones no reader covers yet are reported unread, never zero", () => {
  const w = ws();
  connect(w, "near", "datamastr3.near");
  connect(w, "evm", EVM);
  connect(w, "evm", "0x" + "ab".repeat(20));
  connect(w, "solana", "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV");
  connect(w, "near", "second.near");
  // The NEAR wallet connected last is the main account; the previous one stays yours.
  assert.equal(w.accountId, "second.near");
  assert.equal(w.accounts!.find((a) => a.address === "datamastr3.near")!.proof!.method, "wallet-session");
  assert.deepEqual(w.evmAddresses, { base: EVM.toLowerCase(), arb: EVM.toLowerCase() });
  assert.equal(w.accounts!.find((a) => a.chain === "evm")!.label, "0x32E5…004A", "label keeps checksum case");
  assert.deepEqual(
    unreadAccounts(w).map((a) => a.id).sort(),
    ["evm:0x" + "ab".repeat(20), "near:datamastr3.near", "solana:7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"].sort(),
  );
});

test("forget: the main account clears it; others leave it; nothing else can add an account", () => {
  const w = ws();
  connect(w, "near", "datamastr3.near");
  connect(w, "evm", EVM);
  applyAccountAction(w, { action: "forget", id: "evm:" + EVM.toLowerCase() }, NOW);
  assert.deepEqual(w.evmAddresses, {});
  assert.equal(w.accountId, "datamastr3.near");
  const r = applyAccountAction(w, { action: "forget", id: "near:datamastr3.near" }, NOW);
  assert.equal(r.counted, true);
  assert.equal(w.accountId, null);
  assert.equal(w.accounts!.length, 0);
  // A main account set without its wallet is not kept.
  w.accountId = "someone-else.near";
  ensureAccounts(w, NOW);
  assert.equal(w.accountId, null);
});

test("'connected' is never stored; state comes from live wallet sessions", () => {
  const w = ws();
  connect(w, "near", "datamastr3.near");
  ensureAccounts(w, NOW);
  assert.ok(!JSON.stringify(w.accounts).includes("connected"));
  const a = w.accounts![0];
  assert.equal(accountState(a, new Set([a.id])), "connected");
  assert.equal(accountState(a, new Set()), "yours");
  assert.equal(accountState({ ...a, proof: null }, new Set([a.id])), "unproven");
});

test("limits, invalid addresses and the example workspace", () => {
  const w = ws();
  for (let i = 1; i <= MAX_ACCOUNTS; i++) connect(w, "evm", "0xa" + i.toString(16).padStart(39, "0"));
  assert.throws(() => connect(w, "evm", EVM), /Up to/);
  assert.throws(() => connect(ws(), "evm", "0x" + "0".repeat(40)), /valid/);
  const ex = ws({ mode: "demo" });
  assert.equal(ensureAccounts(ex, NOW), false);
  assert.throws(() => connect(ex, "near", "x.near"), /fictional/);
});
