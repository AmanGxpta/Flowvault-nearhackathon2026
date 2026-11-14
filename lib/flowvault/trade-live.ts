// Live side of in-app token trading through LI.FI: chain metadata, balances and allowances read from each chain's
// public RPC, a fresh quote that must echo the request, the policy check and the wallet_attempts journal
// (authorize → wallet → attach/check, with LI.FI's status for delivery). FlowVault never signs or holds funds.
import { session } from "./store.ts";
import { createAttempt, readAttempt, saveAttempt, listActiveAttempts, listAttempts } from "./attempts.ts";
import { assertSignable } from "./execution.ts";
import { evaluatePolicy, hazardChecks, defaultPolicy } from "./policy.ts";
import { checkPolicy, readLedger, reservePolicy, releasePolicy } from "./policy-store.ts";
import { appendStep } from "./timeline.ts";
import { decimal, units } from "./money.ts";
import { snapshot } from "./snapshot-cache.ts";
import { mayRead } from "./account-registry.ts";
import {
  EVM_NATIVE, SOL_NATIVE, SOLANA_ID, addressOk, approveTx, isEvmAddress, readLifiQuote, readLifiStatus, tradePolicyAction,
  tradePolicyEntries, tradeReceivers, type LifiQuote, type TradeRequest, type TradeSide,
} from "./trade-lifi.ts";
import { assertOwnerOnly } from "./trade-solana.ts";

const LIFI = "https://li.quest/v1";
const QUOTE_TTL_MS = 60_000;

export interface ChainInfo { id: number; key: string; name: string; type: "EVM" | "SVM"; native: { address: string; symbol: string; decimals: number }; rpc: string | null; explorer: string | null; logo: string | null; metamask: unknown }
export interface EvmTx { chainId: number; from: string; to: string; value: string; data: string; gasLimit: string | null }
export interface TradePreparation {
  kind: "trade"; route: "lifi"; accountId: string; recipient: string; amount: string; amountRaw: string; expiresAt: string; capturedAt: string;
  from: TradeSide; to: TradeSide; outputRaw: string; minOutRaw: string; slippageBps: number; tool: string; quoteId: string; durationSec: number | null;
  fromUsd: string | null; minOutUsd: string | null; gasUsd: string | null; feesUsd: LifiQuote["feesUsd"];
  fromChainName: string; toChainName: string; explorer: string | null; chainParams: unknown;
  evmTxs: EvmTx[]; solanaTx: string | null; policyAction: ReturnType<typeof tradePolicyAction>;
  /** NEAR transactions: none (the journal's shared shape); the route is signed on its own chain. */
  transactions: never[];
  walletAskedAt?: string; nonceAtAsk?: string; closedUnsentAt?: string; result?: { status: string; receivedRaw: string | null; received: string | null; hashes: string[]; destinationHash: string | null };
}

async function lifi(path: string) {
  const r = await fetch(LIFI + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  const b = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) throw new Error(typeof b?.message === "string" ? b.message.slice(0, 200) : `LI.FI ${r.status}`);
  return b;
}
export async function lifiChains(): Promise<ChainInfo[]> {
  return snapshot("trade:lifi-chains:v1", async () => {
    const b = await lifi("/chains?chainTypes=EVM,SVM") as { chains?: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (b.chains ?? []).filter(c => Number.isSafeInteger(c.id) && c.mainnet !== false).map(c => ({
      id: c.id, key: String(c.key), name: String(c.name), type: c.chainType === "SVM" ? "SVM" as const : "EVM" as const,
      native: { address: String(c.nativeToken?.address ?? (c.chainType === "SVM" ? SOL_NATIVE : EVM_NATIVE)), symbol: String(c.nativeToken?.symbol ?? c.coin ?? ""), decimals: Number(c.nativeToken?.decimals ?? 18) },
      rpc: (c.metamask?.rpcUrls ?? []).find((u: unknown) => typeof u === "string" && /^https:\/\//.test(u)) ?? null,
      explorer: (c.metamask?.blockExplorerUrls ?? []).find((u: unknown) => typeof u === "string" && /^https:\/\//.test(u)) ?? null,
      logo: typeof c.logoURI === "string" ? c.logoURI : null, metamask: c.metamask ?? null,
    }));
  }, old => old);
}
async function chain(id: number) {
  const c = (await lifiChains()).find(x => x.id === id);
  if (!c) throw new Error("This network isn't available for in-app trading.");
  return c;
}

async function evmCall(url: string, method: string, params: unknown[]) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
  const b = await r.json() as { result?: unknown; error?: { message?: string } };
  if (b.error || b.result === undefined) throw new Error(b.error?.message ?? "RPC error");
  return b.result;
}
const hex = (v: unknown) => { if (typeof v !== "string" || !/^0x[0-9a-fA-F]*$/.test(v)) throw new Error("Unexpected RPC value."); return v === "0x" ? 0n : BigInt(v); };
const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Balance of one token for one owner, read from the chain itself. */
export async function tokenBalance(c: ChainInfo, token: string, owner: string): Promise<bigint> {
  if (c.type === "SVM") {
    const { solana } = await import("./solana-funding.ts");
    const { address } = await import("@solana/kit");
    const rpc = await solana();
    if (token === SOL_NATIVE) return BigInt((await rpc.getBalance(address(owner), { commitment: "confirmed" }).send()).value);
    const { value } = await rpc.getTokenAccountsByOwner(address(owner), { mint: address(token) }, { encoding: "jsonParsed", commitment: "confirmed" }).send();
    return value.reduce((n: bigint, a: any) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (!c.rpc) throw new Error(`No public RPC for ${c.name}; balance can't be checked.`);
  if (token === EVM_NATIVE) return hex(await evmCall(c.rpc, "eth_getBalance", [owner, "latest"]));
  return hex(await evmCall(c.rpc, "eth_call", [{ to: token, data: "0x70a08231" + pad(owner) }, "latest"]));
}

async function owner(request: Request) {
  const s = await session(request);
  if (s.workspace.mode !== "live" || !s.workspace.accountId || s.slot !== "personal" || s.account !== s.workspace.accountId)
    throw new Error("Connect and sign in with your NEAR wallet to trade inside FlowVault.");
  return s;
}
function own(s: Awaited<ReturnType<typeof session>>, chainId: number, address: string | undefined) {
  if (!address || !addressOk(chainId, address)) return null;
  // EVM addresses are kept lowercase so one wallet is one journal account (the overlap guard compares exactly).
  const a = chainId === SOLANA_ID ? address : address.toLowerCase();
  return mayRead(s.workspace, chainId === SOLANA_ID ? "solana" : "evm", a) ? a : null;
}

export interface TradeBody { fromChain: number; fromToken: string; toChain: number; toToken: string; amount: string; sender?: string; recipient?: string; slippageBps: number }

/** Token facts from LI.FI (decimals, symbol, USD price), for amounts typed in whole tokens. */
async function tokenInfo(chainId: number, token: string) {
  const b = await lifi(`/token?chain=${chainId}&token=${encodeURIComponent(token)}`) as { decimals?: number; symbol?: string; priceUSD?: string; address?: string; name?: string; logoURI?: string };
  if (!Number.isInteger(b.decimals)) throw new Error("Token decimals are unverified.");
  return { decimals: b.decimals!, symbol: String(b.symbol ?? "").slice(0, 24), priceUsd: b.priceUSD ?? null, address: String(b.address ?? token), name: String(b.name ?? ""), logo: b.logoURI ?? null };
}

async function quote(s: Awaited<ReturnType<typeof session>>, body: TradeBody) {
  if (!Number.isInteger(body.slippageBps) || body.slippageBps < 10 || body.slippageBps > 1000) throw new Error("Slippage must be between 0.1% and 10%.");
  const [from, to] = await Promise.all([chain(body.fromChain), chain(body.toChain)]);
  const sender = own(s, from.id, body.sender), recipient = own(s, to.id, body.recipient);
  if (!sender) throw new Error(`Connect and prove your ${from.name} wallet first (wallet menu). FlowVault only trades from your own wallets.`);
  if (!recipient) throw new Error(`Connect and prove a ${to.name} wallet to receive. FlowVault only delivers to your own wallets.`);
  if (!addressOk(from.id, body.fromToken) || !addressOk(to.id, body.toToken)) throw new Error("Invalid token address.");
  const info = await tokenInfo(from.id, body.fromToken);
  const amountRaw = units(body.amount, info.decimals);
  if (amountRaw <= 0n) throw new Error("Enter an amount above zero.");
  const sent: TradeRequest = { fromChain: from.id, toChain: to.id, fromToken: body.fromToken, toToken: body.toToken, fromAmount: amountRaw.toString(), fromAddress: sender, toAddress: recipient, slippage: body.slippageBps / 10000 };
  const q = new URLSearchParams({ fromChain: String(from.id), toChain: String(to.id), fromToken: sent.fromToken, toToken: sent.toToken, fromAmount: sent.fromAmount, fromAddress: sender, toAddress: recipient, slippage: String(sent.slippage) });
  const lq = readLifiQuote(await lifi("/quote?" + q), sent);
  const balance = await tokenBalance(from, body.fromToken, sender).catch(() => null);
  return { from, to, sender, recipient, amountRaw, lq, balance };
}
const dec = (raw: string | bigint, d: number) => decimal(BigInt(raw), d);
const usdOf = (raw: string, side: TradeSide) => side.priceUsd === null ? null : (Number(raw) / 10 ** side.decimals * Number(side.priceUsd)).toFixed(6);

/** Quote preview (nothing is journaled): output, minimum, fees, time and your balance of the input. */
export async function previewTrade(request: Request, body: TradeBody) {
  const s = await owner(request);
  const { from, to, lq, balance, amountRaw } = await quote(s, body);
  return {
    tool: lq.tool, output: dec(lq.outputRaw, lq.to.decimals), minimum: dec(lq.minOutRaw, lq.to.decimals), fromUsd: lq.fromUsd, toUsd: lq.toUsd, gasUsd: lq.gasUsd, fees: lq.feesUsd,
    durationSec: lq.durationSec, from: lq.from, to: lq.to, fromChain: from.name, toChain: to.name,
    balance: balance === null ? null : dec(balance, lq.from.decimals), enough: balance === null ? null : balance >= amountRaw, capturedAt: new Date().toISOString(),
  };
}

export async function prepareTrade(request: Request, body: TradeBody) {
  const s = await owner(request), now = Date.now();
  const { from, to, sender, recipient, amountRaw, lq, balance } = await quote(s, body);
  if (balance === null) throw new Error(`Couldn't read your ${lq.from.symbol} balance on ${from.name}.`);
  if (balance < amountRaw) throw new Error(`Your ${lq.from.symbol} balance on ${from.name} is lower than ${body.amount}.`);
  const evmTxs: EvmTx[] = [];
  let ownGasUsd: string | null = null;
  if (lq.evmTx) {
    if (!from.rpc) throw new Error(`No public RPC for ${from.name}; fees and allowance can't be checked.`);
    if (body.fromToken !== EVM_NATIVE) {
      if (!lq.approvalAddress) throw new Error("LI.FI returned no approval address.");
      const allowance = hex(await evmCall(from.rpc, "eth_call", [{ to: body.fromToken, data: "0xdd62ed3e" + pad(sender) + pad(lq.approvalAddress) }, "latest"]));
      // Exact-amount approval; tokens like USDT need a zero first when an older allowance exists.
      if (allowance < amountRaw) { if (allowance > 0n) evmTxs.push(approveTx(from.id, sender, body.fromToken, lq.approvalAddress, 0n)); evmTxs.push(approveTx(from.id, sender, body.fromToken, lq.approvalAddress, amountRaw)); }
    }
    evmTxs.push(lq.evmTx);
    const [native, gasPrice] = await Promise.all([evmCall(from.rpc, "eth_getBalance", [sender, "latest"]).then(hex), evmCall(from.rpc, "eth_gasPrice", []).then(hex)]);
    const gas = evmTxs.reduce((n, t) => n + (t.gasLimit ? BigInt(t.gasLimit) : 70_000n), 0n) * gasPrice;
    const value = BigInt(lq.evmTx.value);
    if (native < value + gas) throw new Error(`Add a little ${from.native.symbol} on ${from.name} for network fees first.`);
    // Our own bound for every transaction here (approvals included), at the chain's gas price and LI.FI's native price.
    const nativePrice = await tokenInfo(from.id, from.native.address).then(t => t.priceUsd).catch(() => null);
    if (nativePrice && Number(nativePrice) > 0) ownGasUsd = (Number(gas) / 10 ** from.native.decimals * Number(nativePrice)).toFixed(6);
  } else if (lq.solanaTx) {
    assertOwnerOnly(lq.solanaTx, sender);
    const { solana } = await import("./solana-funding.ts");
    const sim = await (await solana()).simulateTransaction(lq.solanaTx as never, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
    if (sim.value.err) throw new Error("The route fails in simulation on Solana right now (often too little SOL for fees and token accounts). Nothing was sent.");
  }
  const receivers = tradeReceivers(from.id, evmTxs, !!lq.solanaTx);
  const minOutUsd = usdOf(lq.minOutRaw, lq.to);
  // Gas: the larger of our bound and LI.FI's estimate; unknown when neither is known (the policy then refuses).
  const gasUsd = ownGasUsd !== null && lq.gasUsd !== null ? (Number(ownGasUsd) > Number(lq.gasUsd) ? ownGasUsd : lq.gasUsd) : ownGasUsd ?? lq.gasUsd;
  const extraFeesUsd = lq.feesUsd.filter(f => !f.included).map(f => f.usd);
  const preparation: TradePreparation = {
    kind: "trade", route: "lifi", accountId: sender, recipient, amount: dec(amountRaw, lq.from.decimals), amountRaw: amountRaw.toString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(), capturedAt: new Date(now).toISOString(), from: lq.from, to: lq.to,
    outputRaw: lq.outputRaw, minOutRaw: lq.minOutRaw, slippageBps: body.slippageBps, tool: lq.tool, quoteId: lq.id, durationSec: lq.durationSec,
    fromUsd: lq.fromUsd ?? usdOf(amountRaw.toString(), lq.from), minOutUsd, gasUsd, feesUsd: lq.feesUsd,
    fromChainName: from.name, toChainName: to.name, explorer: from.explorer, chainParams: from.metamask,
    evmTxs, solanaTx: lq.solanaTx, policyAction: undefined as never, transactions: [],
  };
  preparation.policyAction = tradePolicyAction({ accountId: sender, recipient, from: lq.from, fromUsd: preparation.fromUsd, minOutUsd, gasUsd, extraFeesUsd, receivers });
  const policy = s.workspace.policy ?? defaultPolicy();
  const check = evaluatePolicy(preparation.policyAction, policy, await readLedger(s.id), now);
  const missing = tradePolicyEntries(receivers, from.name).filter(e => e.type === "venue" ? !policy.venues.includes(e.venue) : !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method));
  const closed = await recentlyClosed(s.id, sender);
  const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation as never, "trade");
  return {
    attempt,
    review: { tool: lq.tool, output: dec(lq.outputRaw, lq.to.decimals), minimum: dec(lq.minOutRaw, lq.to.decimals), fromUsd: preparation.fromUsd, minOutUsd, gasUsd, fees: lq.feesUsd, durationSec: lq.durationSec, approvals: evmTxs.length - (lq.evmTx ? 1 : 0), sender, recipient, fromChain: from.name, toChain: to.name, expiresAt: preparation.expiresAt,
      ...(closed.length ? { warning: `An earlier trade request from this wallet (${ago(closed[0].createdAt)}) was closed as not sent, but its wallet prompt may still be open. Reject it in your wallet before approving this one.` } : {}) },
    policy: { allowed: check.allowed, violations: check.violations, missingEntries: missing, revision: s.revision, version: policy.version, checks: hazardChecks(preparation.policyAction, policy, check, [{ id: "approval", label: "Token approval is for the exact amount, never unlimited", ok: true }]) },
  };
}

/** "Allow in Policy" for one prepared trade: a new policy revision adding exactly its missing venue and router
 * entries (and the input asset's sell permission when asset rows are in use). Nothing else changes. */
export async function allowTradeInPolicy(request: Request, id: string, revision: number) {
  const s = await owner(request);
  if (s.revision !== revision) throw new Error("Workspace changed. Review the trade again.");
  const { attempt } = await readAttempt(s.id, id);
  if (attempt.kind !== "trade" || attempt.state !== "prepared") throw new Error("Only a prepared trade can add its policy entries.");
  const p = attempt.preparation as unknown as TradePreparation;
  const policy = structuredClone(s.workspace.policy ?? defaultPolicy());
  const added: string[] = [];
  for (const e of tradePolicyEntries(p.policyAction.methods, p.fromChainName)) {
    if (e.type === "venue" && !policy.venues.includes(e.venue)) { policy.venues.push(e.venue); added.push(e.label); }
    if (e.type === "method" && !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method)) { policy.methods.push({ receiver: e.receiver, method: e.method }); added.push(e.label); }
  }
  if (policy.assetRows) {
    const row = policy.assetRows.find(r => r.asset.toLowerCase() === p.from.symbol.toLowerCase() && !r.chain);
    if (!row) { policy.assetRows.push({ asset: p.from.symbol, priority: "P3", uses: ["hold", "sell"] }); added.push(`Sell ${p.from.symbol}`); }
    else if (!row.uses.includes("sell")) { row.uses.push("sell"); added.push(`Sell ${p.from.symbol}`); }
  }
  if (!added.length) return { added, revision: s.revision };
  const { save } = await import("./store.ts");
  const { invalidatePlan } = await import("./obligations.ts");
  policy.version = (s.workspace.policy?.version ?? 0) + 1;
  s.workspace.policy = policy;
  s.workspace.policyHistory = [...(s.workspace.policyHistory ?? []), { version: policy.version, savedAt: new Date().toISOString(), summary: "Allowed LI.FI trades: " + added.join("; ") }];
  invalidatePlan(s.workspace);
  return { added, revision: await save(s.id, s.workspace, s.revision) };
}

/** Origin proof: the route transaction succeeded from the owner to the reviewed router (EVM), or finalized without
 * error (Solana). Delivery then comes only from LI.FI's status for that transaction. */
async function origin(p: TradePreparation, hash: string) {
  const c = await chain(p.from.chainId);
  if (c.type === "SVM") {
    const { solanaTxOutcome } = await import("./solana-funding.ts");
    const o = await solanaTxOutcome(hash);
    return o === null ? null : o.failed ? "failed" : "ok";
  }
  if (!c.rpc) return null;
  const [tx, receipt] = await Promise.all([evmCall(c.rpc, "eth_getTransactionByHash", [hash]), evmCall(c.rpc, "eth_getTransactionReceipt", [hash]).catch(() => null)]) as [Record<string, string> | null, Record<string, string> | null];
  if (!tx || !receipt) return null;
  const route = p.evmTxs.at(-1)!;
  if (tx.from?.toLowerCase() !== p.accountId.toLowerCase() || tx.to?.toLowerCase() !== route.to.toLowerCase() || tx.input?.toLowerCase() !== route.data.toLowerCase()) throw new Error("The transaction doesn't match the reviewed route.");
  return receipt.status === "0x1" ? "ok" : "failed";
}

const NONCE_GRACE_MS = 20_000, SOLANA_LAND_MS = 3 * 60_000;
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m === 0 ? "just now" : m === 1 ? "a minute ago" : `${m} minutes ago`; };
/** A trade whose wallet request never reported back. Solana: once the transaction's blockhash is past (a few
 * minutes) it can never land, so it's closed for certain. EVM: the wallet's nonce unchanged since the request
 * means nothing left yet; it closes, but the prompt may still be open, so the next trade warns. */
async function resolveTrade(a: import("./execution.ts").WalletAttempt, p: TradePreparation) {
  if (!["awaiting_wallet", "unknown"].includes(a.state) || a.hashes.length) return false;
  const asked = Date.parse(p.walletAskedAt ?? a.createdAt);
  if (p.solanaTx) {
    if (Date.now() - asked < SOLANA_LAND_MS) return false;
    a.state = "failed"; a.message = "Not sent. The Solana transaction expired unsigned, so it can no longer land.";
    return true;
  }
  if (!p.nonceAtAsk || Date.now() - asked < NONCE_GRACE_MS) return false;
  const c = await chain(p.from.chainId);
  if (!c.rpc) return false;
  const pending = await evmCall(c.rpc, "eth_getTransactionCount", [p.accountId, "pending"]).then(hex).catch(() => null);
  if (pending === null || pending !== BigInt(p.nonceAtAsk)) return false;
  a.state = "failed"; p.closedUnsentAt = new Date().toISOString();
  a.message = "Not sent. No transaction left your wallet, so the request was closed. If its wallet prompt is still open, reject it there.";
  return true;
}
/** Earlier trades from this wallet closed as not sent within the last 30 minutes (their prompt may still be open). */
async function recentlyClosed(sessionId: string, sender: string) {
  return (await listAttempts(sessionId)).filter(o => o.kind === "trade" && o.accountId === sender && o.state === "failed" && !o.hashes.length
    && (o.preparation as unknown as TradePreparation).closedUnsentAt && Date.now() - Date.parse((o.preparation as unknown as TradePreparation).closedUnsentAt!) < 30 * 60_000);
}

export async function tradeJournalAction(request: Request, id: string, action: string, hashes: string[] = []) {
  const s = await session(request), { attempt: a, previous } = await readAttempt(s.id, id), p = a.preparation as unknown as TradePreparation;
  if (a.kind !== "trade" || s.workspace.mode !== "live") throw new Error("Trade not in this live workspace.");
  if ((action === "check" || action === "attach") && ["confirmed", "failed", "partial"].includes(a.state)) return a;
  let revision: number | undefined;
  if (action === "authorize") {
    assertSignable(a, s.workspace.accountId, s.workspace.mode, s.workspace.mandate.version);
    // One outgoing request per wallet: resolve earlier ones that provably sent nothing, else say which one blocks.
    for (const other of await listActiveAttempts(s.id)) {
      if (other.id === a.id || other.accountId !== p.accountId) continue;
      const before = JSON.stringify(other);
      if (other.kind === "trade" && await resolveTrade(other, other.preparation as unknown as TradePreparation)) { await releasePolicy(s.id, other.id); await saveAttempt(s.id, other, before); continue; }
      throw new Error(`An earlier ${other.kind === "trade" ? "trade" : other.kind} from this wallet (started ${ago(other.createdAt)}) is still unresolved, so FlowVault won't send another yet. Check it in Activity first.`);
    }
    const policy = s.workspace.policy ?? defaultPolicy();
    const policyAction = { ...p.policyAction, id: a.id };
    await checkPolicy(s.id, policyAction, policy);
    await reservePolicy(s.id, policyAction, policy, s.revision);
    revision = s.revision;
    p.walletAskedAt = new Date().toISOString();
    if (p.evmTxs.length) { const c = await chain(p.from.chainId); if (c.rpc) p.nonceAtAsk = String(await evmCall(c.rpc, "eth_getTransactionCount", [p.accountId, "pending"]).then(hex)); }
    a.state = "awaiting_wallet";
    a.message = "Waiting for your wallet. Approve the reviewed trade there. If the result is unclear, check its status before trading again.";
  } else if (action === "declined") {
    const routeSent = a.hashes.length >= (p.solanaTx ? 1 : p.evmTxs.length);
    if (a.state === "awaiting_wallet" && !routeSent) {
      a.state = "failed";
      a.message = a.hashes.length ? `Not traded. Your wallet approved spending exactly ${p.amount} ${p.from.symbol} for the LI.FI router, but the trade itself was declined.` : "Not sent. The wallet request was declined or never opened.";
      await releasePolicy(s.id, a.id);
    }
  } else if (action === "uncertain") {
    if (a.state === "awaiting_wallet") { a.state = "unknown"; a.message = "The wallet did not report a result. Check this trade's status before trading again."; }
  } else if (action === "check" && !hashes.length && !a.hashes.length) {
    if (await resolveTrade(a, p)) await releasePolicy(s.id, a.id);
  } else {
    if (a.state === "prepared") throw new Error("This trade has not reached your wallet.");
    const all = [...new Set([...a.hashes, ...hashes])];
    const max = p.solanaTx ? 1 : p.evmTxs.length;
    if (all.length > max) throw new Error("More transactions than this trade prepared.");
    if (all.some(h => p.solanaTx ? !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h) : !/^0x[0-9a-fA-F]{64}$/.test(h))) throw new Error("Invalid transaction hash for this network.");
    a.hashes = all;
    if (all.length === max) {
      const routeHash = all.at(-1)!;
      const o = await origin(p, routeHash);
      if (a.state === "awaiting_wallet" || a.state === "unknown") a.state = "submitted";
      if (o === "failed") {
        a.state = "failed"; a.message = `The trade transaction failed on ${p.fromChainName}. Network fees were spent; the ${p.from.symbol} stayed in your wallet.`;
        await releasePolicy(s.id, a.id);
      } else if (o === "ok") {
        const st = await lifi(`/status?txHash=${encodeURIComponent(routeHash)}&fromChain=${p.from.chainId}&toChain=${p.to.chainId}`).then(b => readLifiStatus(b, { chainId: p.to.chainId, token: p.to.address })).catch(() => null);
        if (st?.state === "unverified") a.message = st.note;
        else if (st) {
          const received = st.receivedRaw ? dec(st.receivedRaw, p.to.decimals) : null;
          p.result = { status: st.state, receivedRaw: st.receivedRaw, received, hashes: all, destinationHash: st.destinationHash };
          appendStep(a, "lifi:" + routeHash, st.state, "Trade " + st.state, { evidence: st });
          a.state = st.state;
          a.message = st.state === "confirmed" ? `Received ${received ?? "the"} ${p.to.symbol} on ${p.toChainName}.` : st.note;
          if (st.state === "confirmed" && BigInt(st.receivedRaw!) < BigInt(p.minOutRaw)) { a.state = "partial"; a.message = `Received ${received} ${p.to.symbol}, below the reviewed minimum.`; }
        } else a.message = p.from.chainId === p.to.chainId ? "Confirmed on chain; waiting for LI.FI to report the delivered amount." : `Sent on ${p.fromChainName}; delivering on ${p.toChainName}.`;
      } else a.message = "Submitted. Waiting for the network to confirm.";
    } else a.message = "Approval sent. Waiting for the trade transaction.";
  }
  await saveAttempt(s.id, a, previous, revision);
  return a;
}

/** Pay-with options for trading one token: the chain's native token and USDC there, plus native and USDC on the
 * chains your proven wallets use (cross-chain routes). Balances are read only for your own proven wallets. */
export async function tradeOptions(request: Request, chainId: number, wallets: { evm: string[]; solana: string[] }) {
  const s = await owner(request);
  const chains = await lifiChains();
  const target = chains.find(c => c.id === chainId);
  if (!target) throw new Error("This network isn't available for in-app trading.");
  const ids = [...new Set([chainId, ...(wallets.evm.length ? [1, 8453, 42161] : []), ...(wallets.solana.length ? [SOLANA_ID] : [])])];
  const out: { chainId: number; chain: string; token: string; symbol: string; decimals: number; logo: string | null; usd: number; balances: { address: string; amount: string }[] }[] = [];
  await Promise.all(ids.map(async id => {
    const c = chains.find(x => x.id === id);
    if (!c) return;
    const owners = (c.type === "SVM" ? wallets.solana : wallets.evm).filter(a => own(s, id, a));
    const [nativeInfo, usdc] = await Promise.all([tokenInfo(id, c.native.address).catch(() => null), tokenInfo(id, "USDC").catch(() => null)]);
    const tokens = [{ token: c.native.address, symbol: c.native.symbol, decimals: c.native.decimals, logo: c.logo, price: Number(nativeInfo?.priceUsd ?? 0) }];
    if (usdc) tokens.push({ token: usdc.address, symbol: usdc.symbol, decimals: usdc.decimals, logo: usdc.logo, price: Number(usdc.priceUsd ?? 1) });
    for (const t of tokens) {
      const balances = (await Promise.all(owners.map(async a => ({ address: a, raw: await tokenBalance(c, t.token, a).catch(() => null) })))).filter(b => b.raw !== null).map(b => ({ address: b.address, amount: dec(b.raw!, t.decimals) }));
      const { price, ...rest } = t;
      out.push({ chainId: id, chain: c.name, ...rest, usd: Math.max(0, ...balances.map(b => Number(b.amount) * (Number.isFinite(price) ? price : 0))), balances });
    }
  }));
  // Largest holding (in USD, dust under $0.50 ignored) first, then the token's own chain, then the rest.
  const worth = (o: (typeof out)[number]) => o.usd >= 0.5 ? o.usd : 0;
  return { chain: { id: target.id, name: target.name, type: target.type, native: target.native, logo: target.logo }, options: out.sort((x, y) => worth(y) - worth(x) || (x.chainId === chainId ? 0 : 1) - (y.chainId === chainId ? 0 : 1)) };
}
export { isEvmAddress };
