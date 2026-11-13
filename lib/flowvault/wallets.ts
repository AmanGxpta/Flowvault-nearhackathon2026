"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- EIP-1193 / Wallet Standard objects are untyped wallet-provided JSON */
// Ethereum and Solana wallets in the browser (owner: Interface, multi-wallet A3). No wallet kit: wallets are
// discovered through the two open standards every modern wallet implements,
//   EIP-6963 (MetaMask, Rabby, Coinbase Wallet, Brave… and Ledger accounts inside MetaMask), and
//   Wallet Standard (Phantom, Solflare, Backpack, MetaMask's Solana accounts…).
// Connecting asks the wallet for an account, then for ONE free signature over a server challenge (Sign-In with
// Ethereum / Solana); the server verifies it. FlowVault never asks these wallets to send anything here.
import { useEffect, useState } from "react";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>;
  on?(event: string, fn: (...a: any[]) => void): void;
  removeListener?(event: string, fn: (...a: any[]) => void): void;
}
export interface DiscoveredWallet {
  chain: "evm" | "solana";
  /** EIP-6963 rdns (or uuid) / Wallet Standard name. Stable across reloads. */
  id: string;
  name: string;
  icon?: string;
}
export interface WalletSession {
  chain: "evm" | "solana";
  walletId: string;
  walletName: string;
  icon?: string;
  address: string;
}

const evm = new Map<string, { info: { uuid: string; name: string; icon?: string; rdns?: string }; provider: Eip1193 }>();
const sol = new Map<string, any>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const d = e.detail;
    if (!d?.info || !d?.provider) return;
    evm.set(d.info.rdns || d.info.uuid, d);
    notify();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // A wallet that predates EIP-6963 only injects window.ethereum.
  setTimeout(() => {
    const injected = (window as any).ethereum as Eip1193 | undefined;
    if (!evm.size && injected) {
      evm.set("injected", { info: { uuid: "injected", name: (injected as any).isMetaMask ? "MetaMask" : "Browser wallet", rdns: "injected" }, provider: injected });
      notify();
    }
  }, 600);
  const api = {
    register: (...wallets: any[]) => {
      for (const w of wallets)
        if ((w?.chains ?? []).some((c: string) => c.startsWith("solana:")) && w.features?.["standard:connect"] && w.features?.["solana:signMessage"]) sol.set(w.name, w);
      notify();
      return () => {
        for (const w of wallets) sol.delete(w.name);
        notify();
      };
    },
  };
  window.addEventListener("wallet-standard:register-wallet", (e: any) => {
    try {
      e.detail?.(api);
    } catch {}
  });
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
}

export function discovered(): DiscoveredWallet[] {
  return [
    ...[...evm.entries()].map(([id, d]) => ({ chain: "evm" as const, id, name: d.info.name, icon: d.info.icon })),
    ...[...sol.entries()].map(([id, w]) => ({ chain: "solana" as const, id, name: w.name, icon: w.icon })),
  ];
}

/* ───────────── remembered sessions (this browser only) ───────────── */

const KEY = "fv-wallet-sessions";
function remembered(): WalletSession[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function remember(list: WalletSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

/** Sessions a wallet confirms right now without a prompt (eth_accounts / silent connect). */
async function liveSessions(): Promise<WalletSession[]> {
  const out: WalletSession[] = [];
  for (const s of remembered()) {
    try {
      if (s.chain === "evm") {
        const d = evm.get(s.walletId);
        const accounts: string[] = d ? await d.provider.request({ method: "eth_accounts" }) : [];
        if (accounts.some((a) => a.toLowerCase() === s.address.toLowerCase())) out.push(s);
      } else {
        const w = sol.get(s.walletId);
        if (!w) continue;
        if (!w.accounts?.length) await w.features["standard:connect"].connect({ silent: true }).catch(() => undefined);
        if ((w.accounts ?? []).some((a: any) => a.address === s.address)) out.push(s);
      }
    } catch {}
  }
  return out;
}

/** Discovered wallets and live sessions, kept current as wallets announce themselves or change accounts. */
export function useMultiWallets() {
  const [state, setState] = useState<{ wallets: DiscoveredWallet[]; sessions: WalletSession[] }>({ wallets: [], sessions: [] });
  useEffect(() => {
    let alive = true;
    const refresh = () => void liveSessions().then((sessions) => alive && setState({ wallets: discovered(), sessions }));
    listeners.add(refresh);
    start();
    refresh();
    const onChange = () => refresh();
    window.addEventListener("fv:wallets-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => {
      alive = false;
      listeners.delete(refresh);
      window.removeEventListener("fv:wallets-changed", onChange);
      window.removeEventListener("focus", onChange);
    };
  }, []);
  return state;
}

/* ───────────── connect, prove, disconnect ───────────── */

type Challenge = { challengeId: string; message: string };
type Prove = (body: Record<string, unknown>) => Promise<unknown>;
const utf8Hex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/**
 * Connect one wallet: ask it for an account, have it sign the server's challenge, and let the server verify.
 * `challenge` and `prove` call /api/accounts. Returns the connected address.
 */
export async function connectWallet(w: DiscoveredWallet, challenge: (chain: string, address: string) => Promise<Challenge>, prove: Prove) {
  start();
  let address: string;
  if (w.chain === "evm") {
    const d = evm.get(w.id);
    if (!d) throw new Error(w.name + " isn’t available in this browser any more.");
    const accounts: string[] = await d.provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error(w.name + " didn’t share an account.");
    address = accounts[0];
    const c = await challenge("evm", address);
    const signature: string = await d.provider.request({ method: "personal_sign", params: [utf8Hex(c.message), address] });
    await prove({ action: "prove", challengeId: c.challengeId, signature });
  } else {
    const wallet = sol.get(w.id);
    if (!wallet) throw new Error(w.name + " isn’t available in this browser any more.");
    const { accounts } = await wallet.features["standard:connect"].connect();
    const account = (accounts ?? []).find((a: any) => (a.chains ?? ["solana:mainnet"]).some((c: string) => c === "solana:mainnet")) ?? accounts?.[0];
    if (!account) throw new Error(w.name + " didn’t share a Solana account.");
    address = account.address;
    const c = await challenge("solana", address);
    const [out] = await wallet.features["solana:signMessage"].signMessage({ account, message: new TextEncoder().encode(c.message) });
    if (out?.signedMessage && new TextDecoder().decode(out.signedMessage) !== c.message) throw new Error(w.name + " changed the message before signing.");
    await prove({ action: "prove", challengeId: c.challengeId, signature: toB64(out.signature) });
  }
  const session: WalletSession = { chain: w.chain, walletId: w.id, walletName: w.name, icon: w.icon, address };
  remember([...remembered().filter((s) => !(s.chain === session.chain && s.address.toLowerCase() === address.toLowerCase())), session]);
  window.dispatchEvent(new Event("fv:wallets-changed"));
  return address;
}

/** Disconnect in this browser (and ask the wallet to drop the site's permission where it supports that). */
export async function disconnectWallet(s: WalletSession) {
  remember(remembered().filter((x) => !(x.chain === s.chain && x.address.toLowerCase() === s.address.toLowerCase())));
  try {
    if (s.chain === "evm") await evm.get(s.walletId)?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    else await sol.get(s.walletId)?.features["standard:disconnect"]?.disconnect();
  } catch {}
  window.dispatchEvent(new Event("fv:wallets-changed"));
}

/* ───────────── one prepared USDC transfer (Convert to NEAR) ───────────── */

const USDC_CONTRACTS: Record<string, string> = {
  "0x1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x2105": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xa4b1": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
};

/**
 * Ask the wallet to send exactly the prepared USDC transfer. Only a plain ERC-20 transfer of USDC from the
 * connected address, with no ETH value, is accepted; anything else is refused before the wallet is asked.
 * The owner approves it in the wallet. Returns the transaction hash.
 */
export async function sendUsdcTransfer(s: WalletSession, tx: { chainId: string; from: string; to: string; value: string; data: string }, depositAddress: string, amountRaw: string) {
  start();
  if (s.chain !== "evm") throw new Error("Use the Ethereum wallet that holds the USDC.");
  const d = evm.get(s.walletId);
  if (!d) throw new Error(s.walletName + " isn’t available in this browser. Reconnect it from the wallet menu.");
  const expected = "0xa9059cbb" + depositAddress.slice(2).toLowerCase().padStart(64, "0") + BigInt(amountRaw).toString(16).padStart(64, "0");
  if (
    tx.from.toLowerCase() !== s.address.toLowerCase() ||
    USDC_CONTRACTS[tx.chainId]?.toLowerCase() !== tx.to.toLowerCase() ||
    tx.value !== "0x0" ||
    tx.data.toLowerCase() !== expected
  )
    throw new Error("The prepared transfer doesn’t match the quote. Nothing was sent.");
  const accounts: string[] = await d.provider.request({ method: "eth_requestAccounts" });
  if (!accounts.some((a) => a.toLowerCase() === s.address.toLowerCase()))
    throw new Error("Select " + s.address + " in " + s.walletName + ", then try again.");
  const current: string = await d.provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== tx.chainId) await d.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: tx.chainId }] });
  const hash: string = await d.provider.request({ method: "eth_sendTransaction", params: [{ from: s.address, to: tx.to, value: "0x0", data: tx.data }] });
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(s.walletName + " didn’t return a transaction hash.");
  return hash;
}

/** Aave owner-signed calls use the same discovered EIP-1193 wallet as USDC funding. Each
 * returned hash is saved by the caller before another wallet call; ambiguous calls never retry. */
export async function sendAaveOperation(s: WalletSession, prep: import("./lending").LendingPreparation, onHash: (hash: string) => Promise<void>) {
  start();
  const { validateAaveWallet } = await import("./aave-wallet");
  const exec = validateAaveWallet(prep);
  if(s.chain !== "evm" || s.address.toLowerCase() !== prep.accountId.toLowerCase()) throw new Error("Connect the prepared EVM account.");
  const d = evm.get(s.walletId); if(!d) throw new Error("Wallet unavailable; reconnect it.");
  for (const tx of exec.transactions) {
    const accounts: string[] = await d.provider.request({method:"eth_accounts"});
    if(!accounts.some(a => a.toLowerCase() === prep.accountId.toLowerCase())) throw new Error("Wallet account changed.");
    const current: string = await d.provider.request({method:"eth_chainId"});
    if(current.toLowerCase() !== tx.chainId) await d.provider.request({method:"wallet_switchEthereumChain",params:[{chainId:tx.chainId}]});
    if(BigInt(await d.provider.request({method:"eth_chainId"})) !== BigInt(tx.chainId)) throw new Error("Wallet chain changed.");
    const hash: string = await d.provider.request({method:"eth_sendTransaction",params:[{from:tx.from,to:tx.to,value:tx.value,data:tx.data}]});
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet returned no transaction hash; inspect wallet history.");
    await onHash(hash);
  }
}

/* ───────────── EIP-712 signature (Stream C: Hyperliquid approveAgent / withdraw) ───────────── */

/** The wallet's current chain id; Hyperliquid accepts a signature on any chain (signatureChainId names it). */
export async function evmChainId(s: WalletSession): Promise<number> {
  start();
  const d = evm.get(s.walletId);
  if (s.chain !== "evm" || !d) throw new Error(s.walletName + " isn’t available in this browser. Reconnect it from the wallet menu.");
  return parseInt(String(await d.provider.request({ method: "eth_chainId" })), 16);
}
/** Asks the wallet to sign server-built typed data. Moves nothing by itself; the server verifies the signer. */
export async function signTypedData(s: WalletSession, typed: { domain: { chainId: number }; types: Record<string, unknown>; primaryType: string; message: unknown }) {
  start();
  const d = evm.get(s.walletId);
  if (s.chain !== "evm" || !d) throw new Error(s.walletName + " isn’t available in this browser. Reconnect it from the wallet menu.");
  const chain = parseInt(String(await d.provider.request({ method: "eth_chainId" })), 16);
  if (chain !== typed.domain.chainId) throw new Error("Your wallet switched networks. Start again.");
  const payload = {
    ...typed,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...typed.types,
    },
  };
  return String(await d.provider.request({ method: "eth_signTypedData_v4", params: [s.address, JSON.stringify(payload)] }));
}

/** Stream A: the Wallet Standard wallet object behind a Solana session (for its own transaction checks). */
export function solanaWallet(id: string): any | null {
  start();
  return sol.get(id) ?? null;
}

export async function sendSaleTransfer(s: WalletSession,p: import("./sale").SalePreparation) {
  start(); const {validateSaleWallet}=await import("./sale-wallet"); validateSaleWallet(p);
  const tx=p.sale.evmTx,d=evm.get(s.walletId);
  if(!tx||!d||s.chain!=="evm"||s.address.toLowerCase()!==p.accountId.toLowerCase())throw new Error("Connect the reviewed sale source wallet.");
  const accounts:string[]=await d.provider.request({method:"eth_accounts"});
  if(!accounts.some(x=>x.toLowerCase()===p.accountId.toLowerCase()))throw new Error("Sale wallet account changed.");
  if(BigInt(await d.provider.request({method:"eth_chainId"}))!==BigInt(tx.chainId))await d.provider.request({method:"wallet_switchEthereumChain",params:[{chainId:tx.chainId}]});
  if(BigInt(await d.provider.request({method:"eth_chainId"}))!==BigInt(tx.chainId))throw new Error("Sale wallet chain changed.");
  const hash:string=await d.provider.request({method:"eth_sendTransaction",params:[{from:tx.from,to:tx.to,value:tx.value,data:tx.data}]});
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("Sale wallet returned no hash; inspect wallet history.");
  return hash;
}

/** Stream A: the EIP-1193 provider behind an EVM session (EIP-5792 capability checks and wallet_sendCalls). */
export function evmProvider(id: string): Eip1193 | null {
  start();
  return evm.get(id)?.provider ?? null;
}

/** NEAR Intents swap deposit from an EVM wallet: exactly the prepared native transfer or ERC-20 transfer to the
 * quote's deposit address, on the prepared chain, from the prepared address. Anything else is refused. */
export async function sendIntentsDeposit(s: WalletSession, p: { evmTx: { chainId: string; from: string; to: string; value: string; data: string } | null; depositAddress: string; amountRaw: string; from: { contract: string } }) {
  start();
  const tx = p.evmTx;
  if (!tx || s.chain !== "evm") throw new Error("Use the Ethereum wallet that holds the token.");
  const d = evm.get(s.walletId);
  if (!d) throw new Error(s.walletName + " isn’t available in this browser. Reconnect it from the wallet menu.");
  const native = p.from.contract === "native";
  const ok = tx.from.toLowerCase() === s.address.toLowerCase() && (native
    ? tx.to.toLowerCase() === p.depositAddress.toLowerCase() && BigInt(tx.value) === BigInt(p.amountRaw) && tx.data === "0x"
    : tx.to.toLowerCase() === p.from.contract.toLowerCase() && tx.value === "0x0" && tx.data.toLowerCase() === "0xa9059cbb" + p.depositAddress.slice(2).toLowerCase().padStart(64, "0") + BigInt(p.amountRaw).toString(16).padStart(64, "0"));
  if (!ok) throw new Error("The prepared deposit doesn’t match the quote. Nothing was sent.");
  const accounts: string[] = await d.provider.request({ method: "eth_requestAccounts" });
  if (!accounts.some((a) => a.toLowerCase() === s.address.toLowerCase())) throw new Error("Select " + s.address + " in " + s.walletName + ", then try again.");
  const current: string = await d.provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== tx.chainId) await d.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: tx.chainId }] });
  const hash: string = await d.provider.request({ method: "eth_sendTransaction", params: [{ from: s.address, to: tx.to, value: tx.value, data: tx.data }] });
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(s.walletName + " didn’t return a transaction hash.");
  return hash;
}
