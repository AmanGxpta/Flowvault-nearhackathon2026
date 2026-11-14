// Live side of in-app swaps: fresh quote, balances, storage and prices for the owner's NEAR account, the policy
// check, and the wallet_attempts journal (authorize → wallet → attach/check). FlowVault never signs: the owner
// approves the exact reviewed transactions in their own wallet.
import { session } from "./store.ts";
import { attemptsDb, createAttempt, readAttempt, saveAttempt, listActiveAttempts, listAttempts } from "./attempts.ts";
import { assertSignable } from "./execution.ts";
import { evaluatePolicy, defaultPolicy } from "./policy.ts";
import { checkPolicy, readLedger, reservePolicy, releasePolicy } from "./policy-store.ts";
import { networkRpc, view } from "./near.ts";
import { appendStep } from "./timeline.ts";
import { decimal } from "./money.ts";
import { publicJson } from "./research-service.ts";
import { pricedValue } from "./wallet-research.ts";
import { swapAmount, type SwapToken } from "./swap-explorer.ts";
import { snapshot } from "./snapshot-cache.ts";
import {
  REF_EXCHANGE, WRAP_NEAR, refActions, buildSwapTransactions, nearFeeBound, swapPolicyAction, swapPolicyEntries,
  verifySwapReceipts, type SwapPreparation, type RefRoute,
} from "./swap-exec.ts";
import { mayRead } from "./account-registry.ts";
import { evmRpc, hexQuantity } from "./evm.ts";
import { units } from "./money.ts";
import { readStatus } from "./funding-mesh-quote.ts";
import { submitLegDeposit } from "./funding-mesh-live.ts";
import { INTENTS_ORIGINS, readIntentsQuote, intentsDeposit, intentsPolicyAction, intentsPolicyEntries, verifyEvmDeposit, verifyNearDeposit, type IntentsPreparation } from "./swap-intents.ts";

const QUOTE_TTL_MS = 60_000;
const NEAR_GAS_RESERVE = 50_000_000_000_000_000_000_000n; // 0.05 NEAR kept for future fees

export async function refPrices() {
  return snapshot("swap:ref-prices", async () => (await publicJson("https://indexer.ref.finance/list-token-price")) as Record<string, unknown>, old => old);
}
const usd = (v: bigint | null) => (v === null ? null : decimal(v / 1000000n));

async function storageOf(contract: string, accountId: string) {
  const [bal, bounds] = await Promise.all([
    view<{ total: string } | null>(contract, "storage_balance_of", { account_id: accountId }),
    view<{ min: string }>(contract, "storage_balance_bounds", {}),
  ]);
  if (bal.data && typeof bal.data.total === "string") return null;
  if (!/^\d{1,40}$/.test(bounds.data?.min ?? "")) throw new Error(`Could not read ${contract}'s registration cost.`);
  return bounds.data.min;
}

export async function prepareSwap(request: Request, tokens: SwapToken[], body: { from?: string; to?: string; amount?: string; slippage?: number }) {
  const s = await session(request);
  const accountId = s.workspace.accountId;
  if (s.workspace.mode !== "live" || !accountId || s.slot !== "personal" || s.account !== accountId)
    throw new Error("Connect and sign in with your NEAR wallet to swap inside FlowVault.");
  const from = tokens.find(t => t.id === body.from), to = tokens.find(t => t.id === body.to);
  if (!from || !to || from.network !== "near" || to.network !== "near") throw new Error("In-app swaps cover tokens on NEAR. Use the NEAR Intents route for other networks.");
  const amountRaw = swapAmount(String(body.amount ?? ""), from);
  const bps = Number(body.slippage);
  if (!Number.isInteger(bps) || bps < 10 || bps > 500) throw new Error("Slippage must be between 0.1% and 5%.");
  const side = (t: SwapToken) => ({ contract: t.contract, symbol: t.symbol, decimals: t.decimals });
  const tokenIn = from.contract === "native" ? WRAP_NEAR : from.contract, tokenOut = to.contract === "native" ? WRAP_NEAR : to.contract;
  if (tokenIn === tokenOut) throw new Error("Wrapping and unwrapping NEAR is not a swap.");

  const query = new URLSearchParams({ amountIn: amountRaw, tokenIn, tokenOut, pathDeep: "3", slippage: String(bps / 10000) });
  const [path, account, inBalance, wrapStorage, outStorage, prices, refStorage] = await Promise.all([
    publicJson("https://smartrouter.ref.finance/findPath?" + query) as Promise<{ result_code?: number; result_data?: { amount_out?: string; routes?: RefRoute[] } }>,
    networkRpc("query", { request_type: "view_account", finality: "final", account_id: accountId }) as Promise<{ amount?: string; locked?: string }>,
    from.contract === "native" ? Promise.resolve(null) : view<string>(tokenIn, "ft_balance_of", { account_id: accountId }),
    from.contract === "native" || tokenOut === WRAP_NEAR ? storageOf(WRAP_NEAR, accountId) : Promise.resolve(null),
    tokenOut === WRAP_NEAR ? Promise.resolve(null) : storageOf(tokenOut, accountId),
    refPrices().catch(() => ({} as Record<string, unknown>)),
    storageOf(REF_EXCHANGE, accountId),
  ]);
  const out = path.result_data?.amount_out;
  if (path.result_code !== 0 || typeof out !== "string" || !/^\d{1,80}$/.test(out) || BigInt(out) <= 0n) throw new Error("No liquid Rhea / Ref route for this amount.");
  const { actions, minOutRaw } = refActions(path.result_data?.routes ?? [], tokenIn, tokenOut, amountRaw);
  if (BigInt(minOutRaw) > BigInt(out)) throw new Error("Ref returned inconsistent bounds.");

  const transactions = buildSwapTransactions({ accountId, from: side(from), to: side(to), amountRaw, actions, minOutRaw, wrapStorageRaw: wrapStorage, outStorageRaw: outStorage, refStorageRaw: refStorage });
  const nativeIn = from.contract === "native" ? BigInt(amountRaw) : 0n;
  const fee = nearFeeBound(transactions, nativeIn);
  const nativeBalance = /^\d+$/.test(account.amount ?? "") ? BigInt(account.amount!) : null;
  if (nativeBalance === null) throw new Error("Could not read your NEAR balance.");
  if (nativeBalance < fee.totalNativeRaw + NEAR_GAS_RESERVE)
    throw new Error(`Not enough NEAR. This swap needs up to ${decimal(fee.totalNativeRaw, 24)} NEAR including fees, and FlowVault keeps 0.05 NEAR for future fees.`);
  if (inBalance && (!/^\d+$/.test(inBalance.data) || BigInt(inBalance.data) < BigInt(amountRaw)))
    throw new Error(`Your ${from.symbol} balance is lower than ${body.amount}.`);

  const value = (raw: string, decimals: number, contract: string) => pricedValue(raw, decimals, prices[contract]);
  const inputUsd12 = value(amountRaw, from.decimals, tokenIn), minOutUsd12 = value(minOutRaw, to.decimals, tokenOut);
  const gasUsd12 = pricedValue(fee.feeRaw.toString(), 24, prices[WRAP_NEAR]);
  const now = Date.now();
  const preparation: SwapPreparation = {
    kind: "swap", accountId, amount: String(body.amount), amountRaw, expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    from: side(from), to: side(to), tokenIn, tokenOut, outputRaw: out, minOutRaw, slippageBps: bps,
    inputUsd: usd(inputUsd12), minOutUsd: usd(minOutUsd12), gasNearBound: decimal(fee.feeRaw, 24),
    transactions, venue: "Rhea / Ref", capturedAt: new Date(now).toISOString(),
    policyAction: undefined as never,
    ...(to.contract === "native" ? { unwrapNote: "Ref unwraps the output, so you receive native NEAR." } : {}),
  };
  preparation.policyAction = swapPolicyAction(preparation, fee.feeRaw, gasUsd12 === null ? null : gasUsd12 / 1000000n);
  const policy = s.workspace.policy ?? defaultPolicy();
  const check = evaluatePolicy(preparation.policyAction, policy, await readLedger(s.id), now);
  const missing = swapPolicyEntries(preparation).filter(e => e.type === "venue" ? !policy.venues.includes(e.venue) : !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method));
  const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation as never, "swap");
  return {
    attempt,
    review: {
      output: decimal(BigInt(out), to.decimals), minimum: decimal(BigInt(minOutRaw), to.decimals), inputUsd: preparation.inputUsd, minOutUsd: preparation.minOutUsd,
      gasNearBound: preparation.gasNearBound, steps: transactions.map(t => ({ receiver: t.receiverId, methods: t.actions.map(a => a.params.methodName) })),
      hops: actions.length, expiresAt: preparation.expiresAt, unwrapNote: preparation.unwrapNote,
    },
    policy: { allowed: check.allowed, violations: check.violations, missingEntries: missing, revision: s.revision, version: policy.version },
  };
}

async function claim(key: string, id: string) {
  const db = await attemptsDb();
  await db.prepare("INSERT OR IGNORE INTO wallet_hashes(hash,attempt_id) VALUES (?,?)").bind(key, id).run();
  const r = await db.prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?").bind(key).first<{ attempt_id: string }>();
  if (r?.attempt_id !== id) throw new Error("This transaction is already attached to another operation.");
}

export async function swapJournalAction(request: Request, id: string, action: string, hashes: string[] = []) {
  const s = await session(request), { attempt: a, previous } = await readAttempt(s.id, id), p = a.preparation as unknown as SwapPreparation;
  if ((a.preparation as unknown as { route?: string }).route === "intents") return intentsJournalAction(request, id, action, hashes);
  if (a.kind !== "swap" || s.workspace.mode !== "live") throw new Error("Swap not in this live workspace.");
  if ((action === "check" || action === "attach") && a.state === "confirmed") return a;
  let revision: number | undefined;
  if (action === "authorize") {
    assertSignable(a, s.workspace.accountId, s.workspace.mode, s.workspace.mandate.version);
    if (s.account !== p.accountId) throw new Error("Sign in with the wallet that prepared this swap.");
    const policy = s.workspace.policy ?? defaultPolicy();
    const policyAction = { ...p.policyAction, id: a.id };
    await checkPolicy(s.id, policyAction, policy);
    await reservePolicy(s.id, policyAction, policy, s.revision);
    revision = s.revision;
    a.state = "awaiting_wallet";
    a.message = "Waiting for your wallet. Approve the reviewed swap there. If the result is unclear, check its status before swapping again.";
  } else if (action === "declined") {
    if (a.state === "awaiting_wallet" && !a.hashes.length) { a.state = "failed"; a.message = "Not sent. The wallet request was declined or never opened."; await releasePolicy(s.id, a.id); }
  } else if (action === "uncertain") {
    if (a.state === "awaiting_wallet") { a.state = "unknown"; a.message = "The wallet did not report a result. Check this swap's status before trying again."; }
  } else {
    if (a.state === "prepared") throw new Error("This swap has not reached your wallet.");
    const all = [...new Set([...a.hashes, ...hashes])];
    if (all.length > p.transactions.length) throw new Error("More transactions than this swap prepared.");
    if (all.some(h => !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h))) throw new Error("Invalid NEAR transaction hash.");
    a.hashes = all;
    if (all.length) {
      const results = await Promise.all(all.map(h => networkRpc("EXPERIMENTAL_tx_status", { tx_hash: h, sender_account_id: p.accountId, wait_until: "FINAL" }).catch(() => null)));
      for (const r of results) {
        if (!r?.transaction_outcome?.block_hash) continue;
        const block = await networkRpc("block", { block_id: r.transaction_outcome.block_hash });
        if (BigInt(block.header.timestamp_nanosec) / 1000000n < BigInt(Date.parse(a.createdAt)) - 1000n) throw new Error("A transaction predates this swap.");
      }
      const proof = results.every(Boolean) ? verifySwapReceipts(results, p) : null;
      if (a.state === "awaiting_wallet" || a.state === "unknown") a.state = "submitted";
      if (proof && all.length === p.transactions.length) {
        for (const h of all) await claim("swap:near:" + h, a.id);
        p.result = { receivedRaw: proof.receivedRaw, received: proof.received, refundedRaw: proof.refundedRaw, hashes: all };
        a.verificationEvidence = [proof];
        appendStep(a, "receipt:" + all.at(-1), proof.state, "Swap " + proof.state, { evidence: proof });
        a.state = proof.state;
        a.message = proof.state === "confirmed" ? `Settled ${proof.received} ${p.to.symbol} in your account.`
          : proof.state === "failed" ? `The swap did not go through${proof.refundedRaw ? " and Ref returned your " + p.from.symbol : ""}. Network fees were spent.`
          : "The swap finished with less than the reviewed minimum or without a visible delivery. Check your balances before swapping again.";
      } else a.message = "Submitted. Waiting for the network to finalize every transaction.";
    }
  }
  await saveAttempt(s.id, a, previous, revision);
  return a;
}
export { REF_EXCHANGE };

/** "Allow in Policy" for one prepared swap: a new policy revision that adds exactly this swap's missing venue and
 * method entries (and the input asset's sell permission when asset rows are in use). Nothing else changes. */
export async function allowSwapInPolicy(request: Request, id: string, revision: number) {
  const s = await session(request);
  if (s.slot !== "personal" || s.workspace.mode !== "live" || !s.workspace.accountId || s.account !== s.workspace.accountId)
    throw new Error("Sign in with your workspace's NEAR wallet to change its policy.");
  if (s.revision !== revision) throw new Error("Workspace changed. Review the swap again.");
  const { attempt } = await readAttempt(s.id, id);
  if (attempt.kind !== "swap" || attempt.state !== "prepared") throw new Error("Only a prepared swap can add its policy entries.");
  const p = attempt.preparation as unknown as SwapPreparation;
  const intents = (attempt.preparation as unknown as { route?: string }).route === "intents";
  const policy = structuredClone(s.workspace.policy ?? defaultPolicy());
  const added: string[] = [];
  const rowChain = (intents ? ({ near: "near", eth: "eth", base: "base", arb: "arb" } as Record<string, "near" | "eth" | "base" | "arb">)[(p.from as unknown as { network: string }).network] : "near") ?? "near";
  for (const e of intents ? intentsPolicyEntries(attempt.preparation as unknown as IntentsPreparation) : swapPolicyEntries(p)) {
    if (e.type === "venue" && !policy.venues.includes(e.venue)) { policy.venues.push(e.venue); added.push(e.label); }
    if (e.type === "method" && !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method)) { policy.methods.push({ receiver: e.receiver, method: e.method }); added.push(e.label); }
  }
  if (policy.assetRows) {
    const row = policy.assetRows.find(r => r.asset.toLowerCase() === p.from.symbol.toLowerCase() && (!r.chain || r.chain === rowChain));
    if (!row) { policy.assetRows.push({ asset: p.from.symbol, chain: rowChain, priority: "P3", uses: ["hold", "sell"] }); added.push(`Swap ${p.from.symbol} on ${rowChain}`); }
    else if (!row.uses.includes("sell")) { row.uses.push("sell"); added.push(`Swap ${p.from.symbol} on ${rowChain}`); }
  }
  if (!added.length) return { added, revision: s.revision };
  const { save } = await import("./store.ts");
  const { invalidatePlan } = await import("./obligations.ts");
  policy.version = (s.workspace.policy?.version ?? 0) + 1;
  s.workspace.policy = policy;
  s.workspace.policyHistory = [...(s.workspace.policyHistory ?? []), { version: policy.version, savedAt: new Date().toISOString(), summary: (intents ? "Allowed NEAR Intents swaps: " : "Allowed Rhea / Ref swaps: ") + added.join("; ") }];
  invalidatePlan(s.workspace);
  return { added, revision: await save(s.id, s.workspace, s.revision) };
}

/* ───────────── Cross-chain swaps through NEAR Intents (1Click) ───────────── */

const ONECLICK = "https://1click.chaindefuser.com/v0";
// 1Click networks that use Ethereum addresses (HyperCore = Hyperliquid accounts, hood = Robinhood Chain).
const EVM_FAMILY = ["eth", "base", "arb", "bsc", "op", "pol", "avax", "gnosis", "hypercore", "hood", "abs", "bera", "monad", "scroll", "xlayer", "plasma"];
const usdOf = (amountRaw: string, decimals: number, price?: string) => {
  if (!price || !/^\d+(\.\d+)?$/.test(price)) return null;
  const p = units(Number(price).toFixed(12).replace(/\.?0+$/, "") || "0", 12);
  return decimal(BigInt(amountRaw) * p / 10n ** BigInt(decimals) / 1000000n, 6); // USD with 6 decimals
};

/** Whose wallet on a network: the workspace's own proven accounts only. Fail closed for anything else. */
function ownWallet(w: import("./types.ts").Workspace, network: string, address: string | undefined) {
  if (network === "near") return w.accountId ?? null;
  if (!address) return null;
  // Lowercase: one EVM wallet is one journal account, so the one-request-per-wallet guard matches it exactly.
  if (EVM_FAMILY.includes(network)) return mayRead(w, "evm", address.toLowerCase()) ? address.toLowerCase() : null;
  if (network === "sol") return mayRead(w, "solana", address) ? address : null;
  return null;
}

/** A third-party address on a network, for paying someone directly (collect and send). */
function payeeAddress(network: string, address: string | undefined) {
  const a = (address ?? "").trim();
  if (["eth", "base", "arb", "bsc", "pol", "op", "avax", "gnosis"].includes(network)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null;
  if (network === "near") return /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(a) || /^[0-9a-f]{64}$/.test(a) ? a : null;
  if (network === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
  return null;
}

export async function prepareIntentsSwap(request: Request, tokens: SwapToken[], body: { from?: string; to?: string; amount?: string; slippage?: number; sender?: string; recipient?: string; payTo?: boolean }) {
  const s = await session(request);
  if (s.workspace.mode !== "live" || !s.workspace.accountId || s.slot !== "personal" || s.account !== s.workspace.accountId)
    throw new Error("Connect and sign in with your NEAR wallet to swap inside FlowVault.");
  const from = tokens.find(t => t.id === body.from), to = tokens.find(t => t.id === body.to);
  if (!from?.assetId || !to?.assetId || from.id === to.id) throw new Error("NEAR Intents doesn't list this pair.");
  if (!INTENTS_ORIGINS.includes(from.network)) throw new Error("In-app NEAR Intents swaps start from NEAR, Ethereum, Base or Arbitrum.");
  // Paying someone directly (collect and send) delivers to their address; the recipient is then checked against
  // the policy's recipient allowlist below, like any payment. Otherwise swaps deliver only to your own wallets.
  const sender = ownWallet(s.workspace, from.network, body.sender), recipient = body.payTo ? payeeAddress(to.network, body.recipient) : ownWallet(s.workspace, to.network, body.recipient);
  if (!sender) throw new Error(`Connect and prove the ${from.network} wallet that holds ${from.symbol} first.`);
  if (!recipient) throw new Error(body.payTo ? `That isn't a valid ${to.network} address to pay.` : `Connect and prove a wallet on ${to.network} to receive ${to.symbol}. FlowVault only delivers to your own wallets.`);
  const amountRaw = swapAmount(String(body.amount ?? ""), from);
  const bps = Number(body.slippage);
  if (!Number.isInteger(bps) || bps < 10 || bps > 500) throw new Error("Slippage must be between 0.1% and 5%.");
  const now = Date.now();
  const sent = { dry: false, swapType: "EXACT_INPUT", slippageTolerance: bps, originAsset: from.assetId, destinationAsset: to.assetId, amount: amountRaw, depositType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN", refundTo: sender, refundType: "ORIGIN_CHAIN", deadline: new Date(now + 15 * 60_000).toISOString() };
  const r = await fetch(ONECLICK + "/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent), signal: AbortSignal.timeout(12_000) });
  const qb = await r.json().catch(() => null) as { message?: string } | null;
  if (!r.ok) throw new Error(typeof qb?.message === "string" ? qb.message : "NEAR Intents quote unavailable.");
  const q = readIntentsQuote(qb, sent);
  const side = (t: SwapToken) => ({ network: t.network, contract: t.contract, symbol: t.symbol, decimals: t.decimals, assetId: t.assetId! });
  const deposit = intentsDeposit(side(from), sender, q.depositAddress, amountRaw, q.depositMemo);

  // Balance and fee checks on the origin chain, before anything reaches a wallet.
  let gasUsd6: bigint | null = null, gasNear = 0n;
  const ethPrice = tokens.find(t => t.id === from.network + ":native")?.price;
  if (deposit.evmTx) {
    const chain = from.network as "eth" | "base" | "arb";
    const [balHex, gasPriceHex] = await Promise.all([evmRpc(chain, "eth_getBalance", [sender, "latest"]), evmRpc(chain, "eth_gasPrice", [])]);
    const native = hexQuantity(balHex), gasRaw = hexQuantity(gasPriceHex) * (from.contract === "native" ? 21_000n : 80_000n) * 2n;
    if (from.contract === "native") { if (native < BigInt(amountRaw) + gasRaw) throw new Error(`Not enough ${from.symbol} for this amount plus network fees.`); }
    else {
      const bal = hexQuantity(await evmRpc(chain, "eth_call", [{ to: from.contract, data: "0x70a08231" + sender.slice(2).toLowerCase().padStart(64, "0") }, "latest"]));
      if (bal < BigInt(amountRaw)) throw new Error(`Your ${from.symbol} balance is lower than ${body.amount}.`);
      if (native < gasRaw) throw new Error(`Add a little ETH on ${from.network} for network fees first.`);
    }
    const g = usdOf(gasRaw.toString(), 18, ethPrice); gasUsd6 = g === null ? null : units(g);
  } else {
    const token = from.contract === "native" ? null : from.contract;
    const [acct, bal] = await Promise.all([
      networkRpc("query", { request_type: "view_account", finality: "final", account_id: sender }) as Promise<{ amount?: string }>,
      token ? view<string>(token, "ft_balance_of", { account_id: sender }) : Promise.resolve(null),
    ]);
    gasNear = BigInt(deposit.transactions.length) * 50n * 10n ** 12n * 2n * 10n ** 8n;
    const nativeBal = /^\d+$/.test(acct.amount ?? "") ? BigInt(acct.amount!) : 0n;
    if (nativeBal < (token ? 0n : BigInt(amountRaw)) + gasNear + NEAR_GAS_RESERVE) throw new Error("Not enough NEAR for this amount plus fees (FlowVault keeps 0.05 NEAR).");
    if (bal && BigInt(bal.data) < BigInt(amountRaw)) throw new Error(`Your ${from.symbol} balance is lower than ${body.amount}.`);
    const g = usdOf(gasNear.toString(), 24, tokens.find(t => t.id === "near:native")?.price); gasUsd6 = g === null ? null : units(g);
  }
  const preparation: IntentsPreparation = {
    kind: "swap", route: "intents", accountId: sender, amount: String(body.amount), amountRaw, expiresAt: new Date(Math.min(now + 90_000, Date.parse(q.deadline))).toISOString(),
    from: side(from), to: side(to), recipient, depositAddress: q.depositAddress, depositMemo: q.depositMemo, outputRaw: q.outputRaw, minOutRaw: q.minOutRaw,
    slippageBps: bps, eta: q.eta, quoteDeadline: q.deadline, inputUsd: usdOf(amountRaw, from.decimals, from.price), minOutUsd: usdOf(q.minOutRaw, to.decimals, to.price),
    capturedAt: new Date(now).toISOString(), venue: "NEAR Intents", transactions: deposit.transactions, evmTx: deposit.evmTx, policyAction: undefined as never, quote: qb,
  };
  preparation.policyAction = intentsPolicyAction(preparation, gasUsd6, gasNear);
  const policy = s.workspace.policy ?? defaultPolicy();
  if (body.payTo) preparation.policyAction.recipient = policy.recipients.find((r) => r.toLowerCase() === recipient.toLowerCase()) ?? recipient;
  const check = evaluatePolicy(preparation.policyAction, policy, await readLedger(s.id), now);
  const missing = intentsPolicyEntries(preparation).filter(e => e.type === "venue" ? !policy.venues.includes(e.venue) : !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method));
  const earlierOpen = await closedButWatched(s.id, sender);
  const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation as never, "swap");
  return {
    attempt,
    review: {
      ...(earlierOpen.length ? { warning: `An earlier swap request from this wallet (${earlierOpen[0]}) was closed as not sent, but its wallet prompt may still be open. Reject it in your wallet before approving this one.` } : {}),
      route: "intents", output: decimal(BigInt(q.outputRaw), to.decimals), minimum: decimal(BigInt(q.minOutRaw), to.decimals), inputUsd: preparation.inputUsd, minOutUsd: preparation.minOutUsd,
      gasNearBound: decimal(gasNear, 24), gasUsd: gasUsd6 === null ? null : decimal(gasUsd6), eta: q.eta, expiresAt: preparation.expiresAt, sender, recipient, depositAddress: q.depositAddress,
      fromNetwork: from.network, toNetwork: to.network,
      steps: deposit.evmTx ? [{ receiver: from.contract === "native" ? q.depositAddress : from.contract, methods: [from.contract === "native" ? "send " + from.symbol : "transfer " + from.symbol] }] : deposit.transactions.map(t => ({ receiver: t.receiverId, methods: t.actions.map(a => a.params.methodName) })),
    },
    policy: { allowed: check.allowed, violations: check.violations, missingEntries: missing, revision: s.revision, version: policy.version },
  };
}

async function intentsStatus(p: IntentsPreparation) {
  const q = new URLSearchParams({ depositAddress: p.depositAddress, ...(p.depositMemo ? { depositMemo: p.depositMemo } : {}) });
  const res = await fetch(ONECLICK + "/status?" + q, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error("NEAR Intents status unavailable.");
  return readStatus(body);
}

/** A swap that reached the wallet but has no transaction hash. 1Click's view of its deposit address decides:
 * money seen → keep tracking it; nothing seen UNSENT_AFTER_MS after the wallet was asked → it was never sent, so
 * close it and release its limit reservation. (1Click keeps deposit addresses open for days, so its own deadline
 * is too late to unblock the wallet; a deposit that did land late is still delivered to the owner's own wallet.) */
const UNSENT_AFTER_MS = 10 * 60_000;
const unsentAt = (a: { createdAt: string; preparation: unknown }) => Date.parse((a.preparation as { walletAskedAt?: string }).walletAskedAt ?? a.createdAt) + UNSENT_AFTER_MS;
async function resolveUnhashed(sessionId: string, a: import("./execution.ts").WalletAttempt, p: IntentsPreparation) {
  if (!["awaiting_wallet", "unknown"].includes(a.state) || a.hashes.length) return false;
  const st = await intentsStatus(p).catch(() => null);
  if (!st) return false;
  if (st.status !== "PENDING_DEPOSIT" && st.status !== "UNKNOWN") {
    a.state = "submitted"; a.hashes = st.originHashes.slice(0, 1);
    p.result = { status: st.status, deliveredRaw: st.deliveredRaw, delivered: st.deliveredRaw ? decimal(BigInt(st.deliveredRaw), p.to.decimals) : null, refundedRaw: st.refundedRaw, originHashes: st.originHashes, destinationHashes: st.destinationHashes };
    a.message = "NEAR Intents received a deposit for this swap. Tracking delivery…";
    return true;
  }
  // EVM: the wallet's transaction count (nonce) is the proof. Unchanged since the wallet was asked means nothing
  // left the wallet, so the swap can close at once (after a short grace for a broadcast still propagating).
  if (p.evmTx && p.nonceAtAsk) {
    const pending = await evmRpc(p.from.network as "eth" | "base" | "arb", "eth_getTransactionCount", [p.accountId, "pending"]).then(hexQuantity).catch(() => null);
    const askedAt = Date.parse(p.walletAskedAt ?? a.createdAt);
    if (pending !== null && pending === BigInt(p.nonceAtAsk) && Date.now() - askedAt >= NONCE_GRACE_MS) {
      // Nothing has left the wallet yet, but its prompt may still be open. Close it, and keep watching the
      // deposit address so a late approval is picked up and tracked rather than lost.
      a.state = "failed"; p.closedUnsentAt = new Date().toISOString();
      a.message = "Not sent. No transaction left your wallet, so the request was closed. If its wallet prompt is still open, reject it there; if it's approved later, FlowVault picks up the deposit and tracks it.";
      await releasePolicy(sessionId, a.id);
      return true;
    }
    if (pending !== null && pending > BigInt(p.nonceAtAsk)) { a.message = "A transaction left your wallet. Waiting for NEAR Intents to see the deposit…"; return false; }
  }
  if (unsentAt(a) > Date.now()) return false;
  a.state = "failed"; p.closedUnsentAt = new Date().toISOString();
  a.message = "Not sent. Nothing reached the NEAR Intents deposit address, so the request was closed. If its wallet prompt is still open, reject it there.";
  await releasePolicy(sessionId, a.id);
  return true;
}
const LATE_WATCH_MS = 24 * 3600_000;
const lateWatched = (a: import("./execution.ts").WalletAttempt, p: IntentsPreparation) =>
  a.state === "failed" && !a.hashes.length && !!p.closedUnsentAt && Date.now() - Date.parse(p.closedUnsentAt) < LATE_WATCH_MS;
/** A request closed as not sent whose wallet prompt was approved afterwards: NEAR Intents shows a deposit, so the
 * swap reopens and is tracked to delivery or refund. */
async function lateDeposit(a: import("./execution.ts").WalletAttempt, p: IntentsPreparation) {
  if (!lateWatched(a, p)) return false;
  const st = await intentsStatus(p).catch(() => null);
  if (!st || st.status === "PENDING_DEPOSIT" || st.status === "UNKNOWN") return false;
  a.state = "submitted"; a.hashes = st.originHashes.slice(0, 1);
  p.result = { status: st.status, deliveredRaw: st.deliveredRaw, delivered: st.deliveredRaw ? decimal(BigInt(st.deliveredRaw), p.to.decimals) : null, refundedRaw: st.refundedRaw, originHashes: st.originHashes, destinationHashes: st.destinationHashes };
  a.message = "The wallet request was approved after FlowVault closed it. NEAR Intents received the deposit; tracking delivery…";
  appendStep(a, "late-deposit", "submitted", a.message, { evidence: { depositAddress: p.depositAddress, status: st.status } });
  return true;
}
/** Earlier swaps from this wallet that were closed as not sent but may still have an open wallet prompt. A late
 * deposit reopens them (and the caller blocks); otherwise their age is returned for a warning. */
async function closedButWatched(sessionId: string, sender: string, except?: string) {
  const open: string[] = [];
  for (const other of await listAttempts(sessionId)) {
    const op = other.preparation as unknown as IntentsPreparation;
    if (other.id === except || other.kind !== "swap" || op.route !== "intents" || other.accountId.toLowerCase() !== sender.toLowerCase() || !lateWatched(other, op)) continue;
    const before = JSON.stringify(other);
    if (await lateDeposit(other, op)) { await saveAttempt(sessionId, other, before); throw new Error(`An earlier swap from this wallet (started ${minutesAgo(other.createdAt)}) was approved in your wallet after it was closed. FlowVault is tracking that deposit now; check Activity before swapping again.`); }
    if (Date.now() - Date.parse(op.closedUnsentAt!) < 30 * 60_000) open.push(minutesAgo(other.createdAt));
  }
  return open;
}
const NONCE_GRACE_MS = 20_000;
const minutesFrom = (ms: number) => { const m = Math.round((ms - Date.now()) / 60_000); return m <= 0 ? "now" : m === 1 ? "in about a minute" : `in about ${m} minutes`; };
const minutesAgo = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m === 0 ? "just now" : m === 1 ? "a minute ago" : `${m} minutes ago`; };

export async function intentsJournalAction(request: Request, id: string, action: string, hashes: string[] = []) {
  const s = await session(request), { attempt: a, previous } = await readAttempt(s.id, id), p = a.preparation as unknown as IntentsPreparation;
  if (a.kind !== "swap" || p.route !== "intents" || s.workspace.mode !== "live") throw new Error("Swap not in this live workspace.");
  if ((action === "check" || action === "attach") && a.state === "failed" && lateWatched(a, p)) {
    const before = JSON.stringify(a);
    if (await lateDeposit(a, p)) await saveAttempt(s.id, a, before);
    return a;
  }
  if ((action === "check" || action === "attach") && ["confirmed", "failed"].includes(a.state)) return a;
  let revision: number | undefined;
  const evm = !!p.evmTx;
  if (action === "authorize") {
    if (a.state !== "prepared") throw new Error("This swap already reached your wallet. Check its status before swapping again.");
    if (Date.parse(a.expiresAt) <= Date.now()) throw new Error("The quote expired. Review the swap again.");
    if (a.mandateVersion !== s.workspace.mandate.version) throw new Error("Your cash plan changed. Review the swap again.");
    if (s.account !== s.workspace.accountId || ownWallet(s.workspace, p.from.network, p.accountId) !== p.accountId || ownWallet(s.workspace, p.to.network, p.recipient) !== p.recipient)
      throw new Error("The sending or receiving wallet is no longer connected and proven.");
    // A request closed as not sent may still have a wallet prompt open: pick up any late approval first.
    await closedButWatched(s.id, p.accountId, a.id);
    // One outgoing operation per wallet at a time. Clear earlier swaps that provably never sent anything first.
    for (const other of await listActiveAttempts(s.id)) {
      if (other.id === a.id || other.accountId.toLowerCase() !== p.accountId.toLowerCase()) continue;
      const op = other.preparation as unknown as IntentsPreparation, before = JSON.stringify(other);
      if (op.route === "intents" && await resolveUnhashed(s.id, other, op)) { await saveAttempt(s.id, other, before); if (!["awaiting_wallet", "submitted", "unknown", "partial"].includes(other.state)) continue; }
      const evmOther = !!op.evmTx && !!op.nonceAtAsk && !other.hashes.length;
      const until = op.route === "intents" && !other.hashes.length ? (evmOther ? " If no transaction left your wallet, Check it now clears it." : " If nothing was sent, it clears " + minutesFrom(unsentAt(other)) + ".") : "";
      throw new Error(`An earlier ${other.kind} from this wallet (started ${minutesAgo(other.createdAt)}) is still unresolved, so FlowVault won't send another yet.${until}`);
    }
    const policy = s.workspace.policy ?? defaultPolicy(), policyAction = { ...p.policyAction, id: a.id };
    await checkPolicy(s.id, policyAction, policy);
    await reservePolicy(s.id, policyAction, policy, s.revision);
    revision = s.revision;
    a.state = "awaiting_wallet";
    p.walletAskedAt = new Date().toISOString();
    if (evm) p.nonceAtAsk = String(hexQuantity(await evmRpc(p.from.network as "eth" | "base" | "arb", "eth_getTransactionCount", [p.accountId, "pending"])));
    a.message = "Waiting for your wallet. Approve the deposit there; NEAR Intents delivers after it lands.";
  } else if (action === "declined") {
    if (a.state === "awaiting_wallet" && !a.hashes.length) { a.state = "failed"; a.message = "Not sent. The wallet request was declined or never opened."; await releasePolicy(s.id, a.id); }
  } else if (action === "uncertain") {
    if (a.state === "awaiting_wallet") { a.state = "unknown"; a.message = "The wallet did not report a result. FlowVault checks NEAR Intents for a deposit; nothing sent clears after the quote expires."; }
  } else if (action === "check" && !hashes.length && !a.hashes.length) {
    await resolveUnhashed(s.id, a, p);
  } else {
    if (a.state === "prepared") throw new Error("This swap has not reached your wallet.");
    const all = [...new Set([...a.hashes, ...hashes])];
    if (all.length > (evm ? 1 : p.transactions.length)) throw new Error("More transactions than this swap prepared.");
    if (all.some(h => evm ? !/^0x[0-9a-fA-F]{64}$/.test(h) : !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h))) throw new Error("Invalid transaction hash for this network.");
    a.hashes = all;
    if (a.state === "awaiting_wallet" || a.state === "unknown") a.state = "submitted";
    // 1. Origin deposit: verify once, then hint 1Click.
    if (!p.result && all.length === (evm ? 1 : p.transactions.length)) {
      let origin: { state: "deposited" | "failed" } | null = null;
      if (evm) {
        const chain = p.from.network as "eth" | "base" | "arb";
        const [tx, receipt] = await Promise.all([evmRpc(chain, "eth_getTransactionByHash", [all[0]]), evmRpc(chain, "eth_getTransactionReceipt", [all[0]])]);
        if (receipt?.blockNumber) {
          const block = await evmRpc(chain, "eth_getBlockByNumber", [receipt.blockNumber, false]);
          if (Number(hexQuantity(block.timestamp)) * 1000 < Date.parse(a.createdAt) - 1000) throw new Error("The transaction predates this swap.");
          origin = verifyEvmDeposit(tx, receipt, p);
        }
      } else {
        const results = await Promise.all(all.map(h => networkRpc("EXPERIMENTAL_tx_status", { tx_hash: h, sender_account_id: p.accountId, wait_until: "FINAL" }).catch(() => null)));
        origin = results.every(Boolean) ? verifyNearDeposit(results, p) : null;
      }
      if (origin?.state === "failed") { a.state = "failed"; a.message = "The deposit transaction failed. Nothing reached NEAR Intents; network fees were spent."; }
      if (origin?.state === "deposited") {
        for (const h of all) await claim("intents:" + p.from.network + ":" + h, a.id);
        await submitLegDeposit(p.depositAddress, all.at(-1)!, p.depositMemo);
        p.result = { status: "DEPOSITED", deliveredRaw: null, delivered: null, refundedRaw: null, originHashes: all, destinationHashes: [] };
        appendStep(a, "deposit:" + all.at(-1), "confirmed", "Deposit received by NEAR Intents", { evidence: { depositAddress: p.depositAddress } });
      }
    }
    // 2. Delivery, as reported by 1Click.
    if (p.result) {
      const st = await intentsStatus(p).catch(() => null);
      if (st) {
        p.result = { ...p.result, status: st.status, deliveredRaw: st.deliveredRaw, delivered: st.deliveredRaw ? decimal(BigInt(st.deliveredRaw), p.to.decimals) : null, refundedRaw: st.refundedRaw, destinationHashes: st.destinationHashes };
        if (st.status === "SUCCESS" && st.deliveredRaw) {
          a.state = BigInt(st.deliveredRaw) >= BigInt(p.minOutRaw) ? "confirmed" : "partial";
          a.message = a.state === "confirmed" ? `Delivered ${p.result.delivered} ${p.to.symbol} to your wallet on ${p.to.network}.` : "Delivered below the reviewed minimum. Check your balances.";
          appendStep(a, "delivery", a.state, a.message, { evidence: st });
        } else if (st.status === "REFUNDED" || st.status === "FAILED") {
          a.state = "failed";
          a.message = st.status === "REFUNDED" ? `NEAR Intents couldn't fill the swap and refunded your ${p.from.symbol} on ${p.from.network}.` : "NEAR Intents reports the swap failed. Check your balances before trying again.";
          appendStep(a, "delivery", "failed", a.message, { evidence: st });
        } else if (st.status === "INCOMPLETE_DEPOSIT") { a.state = "partial"; a.message = "NEAR Intents saw less than the reviewed deposit."; }
        else a.message = `Deposit received. NEAR Intents is delivering ${p.to.symbol} on ${p.to.network}…`;
      }
    } else if (a.state === "submitted") a.message = "Submitted. Waiting for the deposit to land on " + p.from.network + "…";
  }
  await saveAttempt(s.id, a, previous, revision);
  return a;
}

/** Restore the exact unsigned Intents payment when reopening a staking journey. Authorization still performs all
 * live ownership, expiry, balance and policy checks. This read never asks a wallet to send funds. */
export async function resumeIntentsSwap(request: Request, id: string) {
  const s = await session(request);
  const { attempt } = await readAttempt(s.id, id);
  const p = attempt.preparation as unknown as IntentsPreparation;
  if (s.workspace.mode !== "live" || attempt.kind !== "swap" || p.route !== "intents" || attempt.state !== "prepared" || p.to.network !== "near" || p.to.contract !== "native" || p.recipient !== s.workspace.accountId || ownWallet(s.workspace, p.from.network, p.accountId) !== p.accountId)
    throw new Error("This payment cannot be resumed as an unsigned staking payment. Check its recorded status.");
  const policy = s.workspace.policy ?? defaultPolicy();
  const check = evaluatePolicy(p.policyAction, policy, await readLedger(s.id));
  const missing = intentsPolicyEntries(p).filter(e => e.type === "venue" ? !policy.venues.includes(e.venue) : !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method));
  const earlier = await closedButWatched(s.id, p.accountId, attempt.id);
  return { attempt, review: {
    route: "intents", output: decimal(BigInt(p.outputRaw), p.to.decimals), minimum: decimal(BigInt(p.minOutRaw), p.to.decimals), inputUsd: p.inputUsd, minOutUsd: p.minOutUsd,
    gasNearBound: p.policyAction.gasNear ?? "0", gasUsd: null, eta: p.eta, expiresAt: p.expiresAt, sender: p.accountId, recipient: p.recipient,
    fromNetwork: p.from.network, toNetwork: p.to.network,
    ...(earlier.length ? {warning: "An earlier wallet prompt may still be open. Reject it before approving this payment."} : {}),
    steps: p.evmTx ? [{receiver: p.from.contract === "native" ? p.depositAddress : p.from.contract, methods: [p.from.contract === "native" ? "send " + p.from.symbol : "transfer " + p.from.symbol]}] : p.transactions.map(t => ({receiver:t.receiverId, methods:t.actions.map(a=>a.params.methodName)})),
  }, policy: {allowed:check.allowed, violations:check.violations, missingEntries:missing, revision:s.revision, version:policy.version} };
}
