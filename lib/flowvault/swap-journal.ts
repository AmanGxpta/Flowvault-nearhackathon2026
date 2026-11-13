// Live side of in-app swaps: fresh quote, balances, storage and prices for the owner's NEAR account, the policy
// check, and the wallet_attempts journal (authorize → wallet → attach/check). FlowVault never signs: the owner
// approves the exact reviewed transactions in their own wallet.
import { session } from "./store.ts";
import { attemptsDb, createAttempt, readAttempt, saveAttempt } from "./attempts.ts";
import { assertSignable } from "./execution.ts";
import { evaluatePolicy, defaultPolicy } from "./policy.ts";
import { checkPolicy, readLedger, reservePolicy } from "./policy-store.ts";
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
  const policy = structuredClone(s.workspace.policy ?? defaultPolicy());
  const added: string[] = [];
  for (const e of swapPolicyEntries(p)) {
    if (e.type === "venue" && !policy.venues.includes(e.venue)) { policy.venues.push(e.venue); added.push(e.label); }
    if (e.type === "method" && !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method)) { policy.methods.push({ receiver: e.receiver, method: e.method }); added.push(e.label); }
  }
  if (policy.assetRows) {
    const row = policy.assetRows.find(r => r.asset.toLowerCase() === p.from.symbol.toLowerCase() && (!r.chain || r.chain === "near"));
    if (!row) { policy.assetRows.push({ asset: p.from.symbol, chain: "near", priority: "P3", uses: ["hold", "sell"] }); added.push(`Swap ${p.from.symbol} on NEAR`); }
    else if (!row.uses.includes("sell")) { row.uses.push("sell"); added.push(`Swap ${p.from.symbol} on NEAR`); }
  }
  if (!added.length) return { added, revision: s.revision };
  const { save } = await import("./store.ts");
  const { invalidatePlan } = await import("./obligations.ts");
  policy.version = (s.workspace.policy?.version ?? 0) + 1;
  s.workspace.policy = policy;
  s.workspace.policyHistory = [...(s.workspace.policyHistory ?? []), { version: policy.version, savedAt: new Date().toISOString(), summary: "Allowed Rhea / Ref swaps: " + added.join("; ") }];
  invalidatePlan(s.workspace);
  return { added, revision: await save(s.id, s.workspace, s.revision) };
}
