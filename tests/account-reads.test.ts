/* eslint-disable @typescript-eslint/no-explicit-any -- fake RPC adapters */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvmNetwork, readSolana, readProvenAccounts, usdcTokenAccount, SOLANA } from "../lib/flowvault/account-reads.ts";
import { applyAccountAction } from "../lib/flowvault/account-registry.ts";
import { capitalView } from "../lib/flowvault/valuation.ts";
import type { Portfolio, Workspace } from "../lib/flowvault/types.ts";

const EVM = "0x32E54827dca55754ea9Cc1Cc8455B2b6A7BE004A";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const hex = (n: bigint) => "0x" + n.toString(16);

function fakeEvm(balances: { eth: bigint; usdc: bigint }, chainId = 1n) {
  return async (_chain: string, method: string, params: any[]) => {
    if (method === "eth_chainId") return hex(chainId);
    if (method === "eth_getBlockByNumber") return { number: "0x10", hash: "0xabc" };
    if (method === "eth_getBalance") return hex(balances.eth);
    if (method === "eth_call") return params[0].data === "0x313ce567" ? hex(6n) : hex(balances.usdc);
    throw new Error("unexpected " + method);
  };
}

test("EVM network read: ETH and USDC at a finalized block, raw units kept", async () => {
  const rows = await readEvmNetwork("eth", EVM, false, fakeEvm({ eth: 8_960_000_000_000_000n, usdc: 15_400_000n }) as any);
  assert.deepEqual(rows.map((r) => [r.id, r.asset, r.amount, r.rawAmount, r.accountId]), [
    ["eth-eth-" + EVM.toLowerCase(), "ETH", "0.00896", "8960000000000000", EVM.toLowerCase()],
    ["eth-usdc-" + EVM.toLowerCase(), "USDC", "15.4", "15400000", EVM.toLowerCase()],
  ]);
  const skip = await readEvmNetwork("eth", EVM, true, fakeEvm({ eth: 1n, usdc: 5n }) as any);
  assert.equal(skip.length, 1, "USDC skipped when the older reader covers it");
  await assert.rejects(readEvmNetwork("eth", EVM, false, fakeEvm({ eth: 0n, usdc: 0n }, 8453n) as any), /wrong chain/);
});

test("Solana read: mainnet only, SOL plus every owned USDC token account", async () => {
  const rpc = async (method: string) => {
    if (method === "getGenesisHash") return SOLANA.genesis;
    if (method === "getBalance") return { context: { slot: 5 }, value: 2_500_000_000 };
    if (method === "getTokenAccountsByOwner")
      return {
        value: [1_000_000n, 2_500_000n].map((a) => ({ account: { data: { parsed: { info: { mint: SOLANA.usdcMint, owner: SOL, tokenAmount: { amount: a.toString(), decimals: 6 } } } } } })),
      };
    throw new Error(method);
  };
  const rows = await readSolana(SOL, rpc as any, true);
  assert.deepEqual(rows.map((r) => [r.asset, r.amount, r.chain]), [
    ["SOL", "2.5", "solana"],
    ["USDC", "3.5", "solana"],
  ]);
  await assert.rejects(readSolana(SOL, (async (m: string) => (m === "getGenesisHash" ? "devnet" : null)) as any), /not mainnet/);
});

test("Solana without a keyed RPC: USDC from the derived associated token account; no account yet is 0", async () => {
  const ata = usdcTokenAccount(SOL);
  assert.match(ata, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.notEqual(ata, SOL);
  const asked: string[] = [];
  const rpc = (exists: boolean) => async (method: string, params: any[]) => {
    asked.push(method);
    if (method === "getGenesisHash") return SOLANA.genesis;
    if (method === "getBalance") return { context: { slot: 9 }, value: 1_000_000_000 };
    if (method === "getAccountInfo") {
      assert.equal(params[0], ata);
      return { value: exists ? { data: { parsed: { info: { mint: SOLANA.usdcMint, owner: SOL, tokenAmount: { amount: "7250000", decimals: 6 } } } } } : null };
    }
    throw new Error("indexed call not allowed: " + method);
  };
  const rows = await readSolana(SOL, rpc(true) as any, false);
  assert.deepEqual(rows.map((r) => r.amount), ["1", "7.25"]);
  assert.ok(!asked.includes("getTokenAccountsByOwner"));
  assert.equal((await readSolana(SOL, rpc(false) as any, false))[1].amount, "0");
});

function workspace(): Workspace {
  const w = { mode: "live", accountId: null, obligations: [], operations: [], mandate: { version: 1 } } as unknown as Workspace;
  for (const [chain, address] of [["near", "main.near"], ["near", "second.near"], ["evm", EVM], ["solana", SOL]] as const)
    applyAccountAction(w, { action: "proven", chain, address, method: chain === "near" ? "nep413" : chain === "evm" ? "siwe" : "siws" });
  applyAccountAction(w, { action: "proven", chain: "near", address: "main.near", method: "nep413" });
  return w;
}

test("every proven account is read per network; a failure is an unavailable section, never zero", async () => {
  const w = workspace();
  const seen: string[] = [];
  const r = await readProvenAccounts(w, {
    evm: async (chain, address, skipUsdc) => {
      seen.push(chain + (skipUsdc ? ":eth-only" : ""));
      if (chain === "arb") throw new Error("rate limited");
      return [{ id: chain + "-eth-" + address, label: "x", asset: "ETH", amount: "1", kind: "wallet", chain, accountId: address }];
    },
    solana: async () => [],
    near: async (account) => ({ source: "live", accountId: account, capturedAt: "", errors: [], positions: [{ id: "usdc-wallet", label: "Wallet USDC", asset: "USDC", amount: "40", kind: "wallet", chain: "near" }] }) as Portfolio,
  });
  // The first EVM account's Base/Arbitrum USDC is already read by portfolio-service.
  assert.deepEqual(seen.sort(), ["arb:eth-only", "base:eth-only", "eth"]);
  const arb = r.sections.find((s) => s.id.endsWith(":arb"))!;
  assert.equal(arb.status, "unavailable");
  assert.match(arb.reasons[0], /Arbitrum: rate limited/);
  assert.deepEqual(arb.affects, ["netWorth"]);
  // The main NEAR account is not read here; the second one is, with its own ids and accountId.
  const near = r.positions.find((p) => p.id === "acct:second.near:usdc-wallet")!;
  assert.equal(near.accountId, "second.near");
  assert.ok(!r.positions.some((p) => p.accountId === "main.near"));
});

test("another account's USDC is never spendable from the main NEAR account", () => {
  const w = workspace();
  const now = Date.now();
  const p: Portfolio = {
    source: "live",
    accountId: "main.near",
    capturedAt: new Date(now).toISOString(),
    errors: [],
    positions: [
      { id: "usdc-wallet", label: "Wallet USDC", asset: "USDC", amount: "10", kind: "wallet", chain: "near", accountId: "main.near", ownership: "owner" },
      { id: "acct:second.near:usdc-wallet", label: "second", asset: "USDC", amount: "40", kind: "wallet", chain: "near", accountId: "second.near", ownership: "owner" },
      { id: "solana-usdc-" + SOL, label: "sol", asset: "USDC", amount: "3.5", kind: "wallet", chain: "solana", accountId: SOL, ownership: "owner" },
    ],
  };
  w.mandate = { ...w.mandate, reserve: "0", horizon: 30 } as Workspace["mandate"];
  const c = capitalView(w, p, undefined, { now });
  assert.equal(c.spendableNowUsdcRaw, "10000000");
  assert.equal(c.netWorthUsdcRaw, "53500000");
});
