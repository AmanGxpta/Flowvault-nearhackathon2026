// Live side of in-app Rhea Lending for every market: finalized reads (markets, the owner's positions, wallet and
// storage, Rhea's own Pyth prices), the policy check and the wallet_attempts journal (authorize → wallet →
// attach/check). FlowVault never signs; the owner approves the exact reviewed transactions in their own wallet.
import { session } from "./store.ts";
import { createAttempt, readAttempt, saveAttempt, listActiveAttempts, listAttempts } from "./attempts.ts";
import { assertSignable } from "./execution.ts";
import { evaluatePolicy, hazardChecks, defaultPolicy } from "./policy.ts";
import { checkPolicy, readLedger, reservePolicy, releasePolicy } from "./policy-store.ts";
import { networkRpc, view } from "./near.ts";
import { appendStep } from "./timeline.ts";
import { decimal, units } from "./money.ts";
import { holdback } from "./obligations.ts";
import { availableLiquidity } from "./withdraw.ts";
import { pythToE12, PRICE_MAX_AGE_MS } from "./valuation-evidence.ts";
import { nearFeeBound } from "./swap-exec.ts";
import {
  RHEA, WRAP, NEAR_RESERVE, noncesMoved, buildRheaAction, rheaPolicyAction, rheaPolicyEntries, verifyRheaReceipts,
  type RheaAccount, type RheaKind, type RheaMarket, type RheaWallet,
} from "./rhea-markets.ts";
import type { SwapTx } from "./swap-exec.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const STABLE = /^(USDC|USDT|USDt|DAI|FRAX|USDC\.e|USDT\.e|USDC\.E|USDT\.E)$/;
const PREP_TTL_MS = 120_000;
/** Liquid-staking tokens Rhea prices as NEAR × the token's own exchange rate (yocto per token, 24 decimals). */
const RATE_CALLS = ["ft_price", "get_st_near_price", "get_nearx_price"];

export interface RheaPreparation {
  kind: "lend"; action: RheaKind; accountId: string; tokenId: string; symbol: string; decimals: number; native: boolean;
  amount: string; amountRaw: string; innerAmount: string; expiresAt: string; capturedAt: string;
  healthBefore: string; healthAfter: string; stressedAfter: string | null; newDebt: boolean; approvedNewDebt: boolean;
  usdValue: string; gasNearBound: string; transactions: SwapTx[]; policyAction: ReturnType<typeof rheaPolicyAction>;
  evidence: string; result?: { movedInner: string; hashes: string[] };
  /** When the wallet was asked, and every access key's nonce then: if none moves, nothing left the wallet. */
  walletAskedAt?: string; keyNonces?: Record<string, string>;
  /** Closed as not sent while the wallet prompt might still be open; watched for a late approval for a day. */
  closedUnsentAt?: string;
}

type Bal = { token_id: string; balance: string };
type Asset = { token_id: string; supplied: { balance: string }; borrowed: { balance: string }; reserved: string; prot_fee: string; margin_debt: { balance: string }; margin_pending_debt: string; config: Record<string, unknown> };
const big = (v: unknown, what: string) => { if (typeof v !== "string" || !/^\d{1,40}$/.test(v)) throw new Error(what + " is unverified."); return BigInt(v); };

/** Rhea's price for one token through its own oracle path (get_all_token_pyth_infos → Pyth get_price, times the
 * LST rate where Rhea uses one). Null when unverified or stale. */
async function rheaPrice(tokenId: string, info: Record<string, unknown> | undefined, oracle: string, now: number): Promise<bigint | null> {
  try {
    const id = info?.price_identifier;
    if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id) || /^0+$/.test(id)) return null;
    const r = await view<{ price: string; conf: string; expo: number; publish_time: number } | null>(oracle, "get_price", { price_identifier: id });
    if (!r.data || now - Number(r.data.publish_time) * 1000 > PRICE_MAX_AGE_MS) return null;
    let { usdE12 } = pythToE12(r.data);
    const extra = info?.extra_call;
    if (extra) {
      if (typeof extra !== "string" || !RATE_CALLS.includes(extra) || info?.decimals !== 24) return null;
      const rate = await view<string>(tokenId, extra);
      usdE12 = usdE12 * big(rate.data, tokenId + " exchange rate") / 10n ** 24n;
    }
    return usdE12 > 0n ? usdE12 : null;
  } catch { return null; }
}

/** Every finalized read one Rhea action needs, priced for the token and every position that affects health. */
export async function readRheaContext(accountId: string, tokenId: string, now = Date.now()) {
  const [config, assets, account, reg, bounds, acct, infos, meta, refMeta, tokBal, tokReg, tokBounds, wrapReg, wrapBounds] = await Promise.all([
    view<Record<string, unknown>>(RHEA, "get_config"),
    view<Asset[]>(RHEA, "get_assets_paged_detailed", { from_index: 0, limit: 100 }),
    view<{ supplied?: Bal[]; positions?: Record<string, { collateral?: Bal[]; borrowed?: Bal[] }> } | null>(RHEA, "get_account_all_positions", { account_id: accountId }),
    view<unknown>(RHEA, "storage_balance_of", { account_id: accountId }),
    view<{ min?: string }>(RHEA, "storage_balance_bounds"),
    networkRpc("query", { request_type: "view_account", finality: "final", account_id: accountId }) as Promise<{ amount?: string; storage_usage?: number }>,
    view<Record<string, Record<string, unknown>>>(RHEA, "get_all_token_pyth_infos"),
    view<{ decimals?: number; symbol?: string }>(tokenId, "ft_metadata"),
    import("./research-service.ts").then(m => m.refMetadata()).catch(() => ({} as Record<string, { symbol: string; decimals: number }>)),
    view<string>(tokenId, "ft_balance_of", { account_id: accountId }),
    view<unknown>(tokenId, "storage_balance_of", { account_id: accountId }),
    view<{ min?: string }>(tokenId, "storage_balance_bounds").catch(() => ({ data: { min: undefined } })),
    view<unknown>(WRAP, "storage_balance_of", { account_id: accountId }),
    view<{ min?: string }>(WRAP, "storage_balance_bounds"),
  ]);
  if (config.data.contract_mode !== "Running") throw new Error("Rhea isn't Running right now.");
  const oracle = String(config.data.pyth_oracle_account_id ?? "");
  if (config.data.enable_pyth_oracle !== true || !/^[a-z\d._-]+\.near$/.test(oracle)) throw new Error("Rhea's oracle path is unverified.");

  const a: RheaAccount = { registered: reg.data !== null, supplied: {}, collateral: {}, borrowed: {}, otherPositions: [] };
  const put = (m: Record<string, bigint>, b: Bal) => { m[b.token_id] = (m[b.token_id] ?? 0n) + big(b.balance, "Rhea position"); };
  if (account.data) {
    if (!Array.isArray(account.data.supplied) || !account.data.positions) throw new Error("Rhea account positions could not be verified.");
    account.data.supplied.forEach(b => put(a.supplied, b));
    for (const [key, p] of Object.entries(account.data.positions)) {
      if (!Array.isArray(p?.collateral) || !Array.isArray(p?.borrowed)) throw new Error("Rhea position shape is unverified.");
      if (key !== "REGULAR") { if (p.collateral.length || p.borrowed.length) a.otherPositions.push(key); continue; }
      p.collateral.forEach(b => put(a.collateral, b));
      p.borrowed.forEach(b => put(a.borrowed, b));
    }
  }
  const relevant = new Set([tokenId, ...Object.keys(a.collateral), ...Object.keys(a.borrowed)]);
  const markets: Record<string, RheaMarket> = {};
  await Promise.all(assets.data.filter(x => relevant.has(x.token_id)).map(async x => {
    const c = x.config, info = infos.data[x.token_id];
    const decimals = x.token_id === tokenId ? meta.data.decimals : (info?.decimals as number | undefined) ?? refMeta[x.token_id]?.decimals;
    if (!Number.isInteger(decimals) || !Number.isInteger(c.extra_decimals) || !Number.isInteger(c.volatility_ratio) || (c.volatility_ratio as number) <= 0 || (c.volatility_ratio as number) > 10000)
      throw new Error(x.token_id + " market terms are unverified.");
    if (x.token_id === tokenId && Number.isInteger(info?.decimals) && info.decimals !== decimals) throw new Error("Token decimals disagree with Rhea's config.");
    const symbol = x.token_id === WRAP ? "NEAR" : refMeta[x.token_id]?.symbol ?? (x.token_id === tokenId ? meta.data.symbol : undefined) ?? x.token_id;
    markets[x.token_id] = {
      tokenId: x.token_id, symbol: String(symbol).slice(0, 24), decimals: decimals as number, extraDecimals: c.extra_decimals as number, volatilityRatio: c.volatility_ratio as number,
      canDeposit: c.can_deposit === true, canWithdraw: c.can_withdraw === true, canCollateral: c.can_use_as_collateral === true, canBorrow: c.can_borrow === true,
      availableInner: availableLiquidity(x), totalBorrowedInner: big(x.borrowed?.balance, "Rhea borrowed total"),
      borrowedLimitInner: typeof c.borrowed_limit === "string" ? big(c.borrowed_limit, "Rhea borrow cap") : null,
      minBorrowedInner: typeof c.min_borrowed_amount === "string" ? big(c.min_borrowed_amount, "Rhea minimum borrow") : 0n,
      priceE12: await rheaPrice(x.token_id, info, oracle, now), stable: STABLE.test(String(symbol)),
    };
  }));
  if (!markets[tokenId]) throw new Error("This token isn't a Rhea market.");
  const nativeRaw = big(acct.amount, "NEAR balance") - BigInt(acct.storage_usage ?? 0) * 10n ** 19n;
  const w: RheaWallet = {
    tokenRaw: big(tokBal.data, "Wallet balance"), nativeRaw: nativeRaw > 0n ? nativeRaw : 0n,
    tokenRegistered: tokReg.data !== null, tokenStorageMin: typeof tokBounds.data?.min === "string" ? big(tokBounds.data.min, "Token storage") : null,
    wrapRegistered: wrapReg.data !== null, wrapStorageMin: typeof wrapBounds.data?.min === "string" ? big(wrapBounds.data.min, "wNEAR storage") : null,
    rheaStorageMin: big(bounds.data?.min, "Rhea storage minimum"),
  };
  return { markets, account: a, wallet: w, blockHeight: assets.blockHeight, oracle };
}

function owner(s: Awaited<ReturnType<typeof session>>) {
  const accountId = s.workspace.accountId;
  if (s.workspace.mode !== "live" || !accountId || s.slot !== "personal" || s.account !== accountId) throw new Error("Connect and sign in with your NEAR wallet to use Rhea inside FlowVault.");
  return accountId;
}

/** Owner's Rhea positions with values, for the Earn/Borrow tables and the action sheet. Read-only. */
export async function rheaPositions(request: Request, tokenId: string) {
  const s = await session(request), accountId = owner(s);
  const ctx = await readRheaContext(accountId, tokenId);
  const m = ctx.markets[tokenId], n = (v?: bigint, up = false) => v === undefined ? "0" : decimal(up ? (v + 10n ** BigInt(m.extraDecimals) - 1n) / 10n ** BigInt(m.extraDecimals) : v / 10n ** BigInt(m.extraDecimals), m.decimals);
  const { rheaHealth, healthLabel } = await import("./rhea-markets.ts");
  return {
    symbol: m.symbol, decimals: m.decimals, priced: m.priceE12 !== null,
    wallet: decimal(ctx.wallet.tokenRaw, m.decimals), nativeNear: decimal(ctx.wallet.nativeRaw > NEAR_RESERVE ? ctx.wallet.nativeRaw - NEAR_RESERVE : 0n, 24),
    supplied: n(ctx.account.supplied[tokenId]), collateral: n(ctx.account.collateral[tokenId]), borrowed: n(ctx.account.borrowed[tokenId], true),
    available: n(m.availableInner), canDeposit: m.canDeposit, canWithdraw: m.canWithdraw, canCollateral: m.canCollateral, canBorrow: m.canBorrow,
    health: healthLabel(rheaHealth(ctx.markets, ctx.account)), otherPositions: ctx.account.otherPositions,
  };
}

export async function prepareRhea(request: Request, body: { action: RheaKind; tokenId: string; amount: string; native?: boolean; approveNewDebt?: boolean }) {
  const s = await session(request), accountId = owner(s), now = Date.now();
  const ctx = await readRheaContext(accountId, body.tokenId, now);
  const m = ctx.markets[body.tokenId];
  const amountRaw = units(body.amount, m.decimals);
  const policy = s.workspace.policy ?? defaultPolicy();
  const keepRaw = body.tokenId === USDC ? holdback(s.workspace.mandate, now) : 0n;
  // Your credit rows set the floor: the strictest minimum health and the largest drawdown among them apply.
  const rows = policy.creditRows ?? [];
  const minHealthE6 = rows.length ? rows.reduce((x, r) => { const h = units(r.minHealth); return h > x ? h : x; }, 0n) : undefined;
  const drawdownBps = rows.length ? Math.max(...rows.map(r => r.drawdownBps)) : undefined;
  const b = buildRheaAction({ kind: body.action, tokenId: body.tokenId, amountRaw, accountId, native: body.native === true, approveNewDebt: body.approveNewDebt, keepRaw,
    minHealthE6: minHealthE6 && minHealthE6 > 1_500000n ? minHealthE6 : undefined, drawdownBps: drawdownBps && drawdownBps > 3000 ? drawdownBps : undefined }, ctx.markets, ctx.account, ctx.wallet);
  const fee = nearFeeBound(b.transactions, b.nativeInRaw);
  if (ctx.wallet.nativeRaw < fee.totalNativeRaw + NEAR_RESERVE)
    throw new Error(`Not enough NEAR. This needs up to ${decimal(fee.totalNativeRaw, 24).slice(0, 8)} NEAR including fees and storage, and FlowVault keeps 0.25 NEAR for future fees.`);
  const policyAction = rheaPolicyAction(body.action, accountId, m.symbol, b.usdE12, b.transactions, fee.feeRaw);
  const preparation: RheaPreparation = {
    kind: "lend", action: body.action, accountId, tokenId: body.tokenId, symbol: m.symbol, decimals: m.decimals, native: body.native === true,
    amount: decimal(amountRaw, m.decimals), amountRaw: amountRaw.toString(), innerAmount: b.innerAmount,
    expiresAt: new Date(now + PREP_TTL_MS).toISOString(), capturedAt: new Date(now).toISOString(),
    healthBefore: b.healthBefore, healthAfter: b.healthAfter, stressedAfter: b.stressedAfter, newDebt: b.newDebt, approvedNewDebt: b.newDebt && body.approveNewDebt === true,
    usdValue: decimal(b.usdE12 / 1000000n), gasNearBound: decimal(fee.feeRaw, 24), transactions: b.transactions, policyAction,
    evidence: `Rhea finalized block ${ctx.blockHeight}; prices from Rhea's Pyth oracle (${ctx.oracle}).`,
  };
  const check = evaluatePolicy(policyAction, policy, await readLedger(s.id), now);
  const missing = rheaPolicyEntries(b.transactions, m.symbol).filter(e => e.type === "venue" ? !policy.venues.includes(e.venue) : !policy.methods.some(x => x.receiver === e.receiver && x.method === e.method));
  const closed = await recentlyClosed(s.id, accountId);
  const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation as never, "lend");
  return {
    attempt,
    review: { action: body.action, symbol: m.symbol, amount: preparation.amount, usdValue: preparation.usdValue, healthBefore: b.healthBefore, healthAfter: b.healthAfter, stressedAfter: b.stressedAfter, gasNearBound: preparation.gasNearBound, steps: b.transactions.map(t => ({ receiver: t.receiverId, methods: t.actions.map(x => x.params.methodName) })), expiresAt: preparation.expiresAt, newDebt: b.newDebt,
      ...(closed.length ? { warning: `An earlier Rhea request from this account (${ago(closed[0].createdAt)}) was closed as not sent, but its wallet prompt may still be open. Reject it in your wallet before approving this one.` } : {}) },
    policy: { allowed: check.allowed, violations: check.violations, missingEntries: missing, revision: s.revision, version: policy.version, checks: hazardChecks(policyAction, policy, check, [{ id: "health", label: b.healthAfter === "no debt" ? "No debt: nothing can be liquidated" : `Health after ${b.healthAfter}${b.stressedAfter && b.stressedAfter !== "no debt" ? ` (${b.stressedAfter} after a price drop)` : ""}`, ok: b.healthAfter === "no debt" || Number(b.healthAfter) >= 1.2 }, { id: "debt", label: b.newDebt ? (body.approveNewDebt ? "New debt, confirmed by you" : "New debt needs your confirmation") : "No new debt", ok: !b.newDebt || body.approveNewDebt === true }, { id: "oracle", label: "Priced by Rhea's own oracle", ok: true }]) },
  };
}

/** "Allow in Policy" for one prepared Rhea action: a new policy revision adding exactly its missing venue and
 * method entries (and the asset's use when asset rows are in use). Nothing else changes. */
export async function allowRheaInPolicy(request: Request, id: string, revision: number) {
  const s = await session(request);
  owner(s);
  if (s.revision !== revision) throw new Error("Workspace changed. Review again.");
  const { attempt } = await readAttempt(s.id, id);
  if (attempt.kind !== "lend" || attempt.state !== "prepared") throw new Error("Only a prepared Rhea action can add its policy entries.");
  const p = attempt.preparation as unknown as RheaPreparation;
  const policy = structuredClone(s.workspace.policy ?? defaultPolicy());
  const added: string[] = [];
  for (const e of rheaPolicyEntries(p.transactions, p.symbol)) {
    if (e.type === "venue" && !policy.venues.includes(e.venue)) { policy.venues.push(e.venue); added.push(e.label); }
    if (e.type === "method" && !policy.methods.some(m => m.receiver === e.receiver && m.method === e.method)) { policy.methods.push({ receiver: e.receiver, method: e.method }); added.push(e.label); }
  }
  if (policy.assetRows) {
    const use = (p.policyAction.kind === "withdraw" || p.policyAction.kind === "repay" ? "hold" : p.policyAction.kind) as "hold";
    const row = policy.assetRows.find(r => r.asset.toLowerCase() === p.symbol.toLowerCase() && (!r.chain || r.chain === "near"));
    if (!row) { policy.assetRows.push({ asset: p.symbol, chain: "near", priority: "P3", uses: [...new Set(["hold", use])] as never }); added.push(`${p.symbol} on Rhea`); }
    else if (!row.uses.includes(use)) { row.uses.push(use); added.push(`${p.symbol} for ${use}`); }
  }
  if (!added.length) return { added, revision: s.revision };
  const { save } = await import("./store.ts");
  const { invalidatePlan } = await import("./obligations.ts");
  policy.version = (s.workspace.policy?.version ?? 0) + 1;
  s.workspace.policy = policy;
  s.workspace.policyHistory = [...(s.workspace.policyHistory ?? []), { version: policy.version, savedAt: new Date().toISOString(), summary: "Allowed Rhea Lending: " + added.join("; ") }];
  invalidatePlan(s.workspace);
  return { added, revision: await save(s.id, s.workspace, s.revision) };
}

const VERB: Record<RheaKind, string> = { supply: "Supplied", withdraw: "Withdrew", collateral_add: "Added collateral:", collateral_release: "Released collateral:", borrow: "Borrowed", repay: "Repaid" };
type Attempt = import("./execution.ts").WalletAttempt;
const NONCE_GRACE_MS = 20_000, LATE_WATCH_MS = 24 * 3600_000;
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m === 0 ? "just now" : m === 1 ? "a minute ago" : `${m} minutes ago`; };

/** Every access key's nonce now. A NEAR transaction always advances its signing key's nonce, so an unchanged set
 * proves nothing has been sent since the snapshot. */
async function keyNonces(accountId: string) {
  const r = await networkRpc("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: accountId }) as { keys?: { public_key: string; access_key: { nonce: number | string } }[] };
  if (!Array.isArray(r?.keys)) throw new Error("Access keys unreadable.");
  return Object.fromEntries(r.keys.map(k => [k.public_key, String(k.access_key.nonce)]));
}


/** Transactions this account signed since the wallet was asked, to the prepared receivers in the prepared order,
 * found through NearBlocks and then confirmed against the chain itself (signer, receiver, methods). */
async function findSent(p: RheaPreparation) {
  const since = BigInt(Date.parse(p.walletAskedAt ?? p.capturedAt) - 2000) * 1_000_000n;
  const body = await fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(p.accountId)}/txns?per_page=25`, { signal: AbortSignal.timeout(10_000) }).then(r => r.ok ? r.json() : null).catch(() => null) as { txns?: { transaction_hash?: string; predecessor_account_id?: string; receiver_account_id?: string; block_timestamp?: string }[] } | null;
  const receivers = new Set(p.transactions.map(t => t.receiverId));
  const seen = new Map<string, bigint>();
  for (const t of body?.txns ?? []) {
    if (t.predecessor_account_id !== p.accountId || !receivers.has(String(t.receiver_account_id)) || !/^\d+$/.test(String(t.block_timestamp)) || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(String(t.transaction_hash))) continue;
    const at = BigInt(t.block_timestamp!);
    if (at >= since && !seen.has(t.transaction_hash!)) seen.set(t.transaction_hash!, at);
  }
  const hashes = [...seen.entries()].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([h]) => h);
  const out: string[] = [];
  for (const h of hashes) {
    const want = p.transactions[out.length];
    if (!want) break;
    const r = await networkRpc("EXPERIMENTAL_tx_status", { tx_hash: h, sender_account_id: p.accountId, wait_until: "NONE" }).catch(() => null) as { transaction?: { signer_id?: string; receiver_id?: string; actions?: { FunctionCall?: { method_name?: string } }[] } } | null;
    const tx = r?.transaction;
    const methods = (tx?.actions ?? []).map(x => x.FunctionCall?.method_name);
    if (tx?.signer_id === p.accountId && tx.receiver_id === want.receiverId && methods.join() === want.actions.map(x => x.params.methodName).join()) out.push(h);
  }
  return out;
}

/** An unanswered or closed request: nonce unchanged → nothing sent (close, or keep closed); nonce moved → find the
 * transactions and hand them to verification. Returns hashes found, or "closed" when it was closed now. */
async function resolveRhea(a: Attempt, p: RheaPreparation): Promise<string[] | "closed" | null> {
  if (a.hashes.length || !p.keyNonces) return null;
  const open = ["awaiting_wallet", "unknown"].includes(a.state);
  const watched = a.state === "failed" && !!p.closedUnsentAt && Date.now() - Date.parse(p.closedUnsentAt) < LATE_WATCH_MS;
  if (!open && !watched) return null;
  const now = await keyNonces(p.accountId).catch(() => null);
  if (!now) return null;
  if (!noncesMoved(p.keyNonces, now)) {
    if (!open || Date.now() - Date.parse(p.walletAskedAt ?? a.createdAt) < NONCE_GRACE_MS) return null;
    a.state = "failed"; p.closedUnsentAt = new Date().toISOString();
    a.message = "Not sent. No transaction left your account, so the request was closed. If its wallet prompt is still open, reject it there; if it's approved later, FlowVault picks it up and tracks it.";
    return "closed";
  }
  const found = await findSent(p);
  if (found.length) return found;
  // The nonce moved but no matching transaction shows up (something else was sent, or the indexer lags). After
  // 10 minutes close it; the 24-hour watch still finds a late match.
  if (open && Date.now() - Date.parse(p.walletAskedAt ?? a.createdAt) > 10 * 60_000) {
    a.state = "failed"; p.closedUnsentAt = new Date().toISOString();
    a.message = "Not sent. Your account sent other transactions, but none of this action's, so the request was closed. If its wallet prompt is still open, reject it there.";
    return "closed";
  }
  if (open) a.message = "A transaction left your account. Looking for this action's transactions on NEAR…";
  return null;
}
async function recentlyClosed(sessionId: string, accountId: string) {
  return (await listAttempts(sessionId)).filter(o => o.kind === "lend" && o.accountId === accountId && o.state === "failed" && !o.hashes.length
    && (o.preparation as unknown as RheaPreparation).closedUnsentAt && Date.now() - Date.parse((o.preparation as unknown as RheaPreparation).closedUnsentAt!) < 30 * 60_000);
}

/** Verify attached hashes from finalized receipts and set the outcome. */
async function settle(sessionId: string, a: Attempt, p: RheaPreparation, all: string[]) {
  a.hashes = all;
  const results = await Promise.all(all.map(h => networkRpc("EXPERIMENTAL_tx_status", { tx_hash: h, sender_account_id: p.accountId, wait_until: "FINAL" }).catch(() => null)));
  for (const r of results) {
    if (!r?.transaction_outcome?.block_hash) continue;
    const block = await networkRpc("block", { block_id: r.transaction_outcome.block_hash });
    if (BigInt(block.header.timestamp_nanosec) / 1000000n < BigInt(Date.parse(a.createdAt)) - 1000n) throw new Error("A transaction predates this action.");
  }
  const proof = results.every(Boolean) && all.length === p.transactions.length ? verifyRheaReceipts(results, { kind: p.action, accountId: p.accountId, tokenId: p.tokenId, native: p.native, transactions: p.transactions }) : null;
  if (["awaiting_wallet", "unknown", "failed"].includes(a.state)) a.state = "submitted";
  if (!proof) { a.message = "Submitted. Waiting for the network to finalize every transaction."; return; }
  p.result = { movedInner: "movedInner" in proof ? String(proof.movedInner) : "0", hashes: all };
  a.verificationEvidence = [proof];
  appendStep(a, "receipt:" + all.at(-1), proof.state, "Rhea " + proof.state, { evidence: proof });
  a.state = proof.state;
  a.message = proof.state === "confirmed" ? `${VERB[p.action]} ${p.amount} ${p.symbol} on Rhea. ${proof.message}` : proof.message;
  if (proof.state === "failed") await releasePolicy(sessionId, a.id);
}

export async function rheaJournalAction(request: Request, id: string, action: string, hashes: string[] = []) {
  const s = await session(request), { attempt: a, previous } = await readAttempt(s.id, id), p = a.preparation as unknown as RheaPreparation;
  if (a.kind !== "lend" || s.workspace.mode !== "live") throw new Error("Rhea action not in this live workspace.");
  // A closed request may have been approved late: look before reporting it as final.
  if ((action === "check" || action === "attach") && a.state === "failed" && !a.hashes.length && p.closedUnsentAt) {
    const r = await resolveRhea(a, p).catch(() => null);
    if (Array.isArray(r)) { a.message = "The wallet request was approved after FlowVault closed it. Tracking it now."; await settle(s.id, a, p, r); await saveAttempt(s.id, a, previous); }
    return a;
  }
  if ((action === "check" || action === "attach") && ["confirmed", "failed"].includes(a.state)) return a;
  let revision: number | undefined;
  if (action === "authorize") {
    assertSignable(a, s.workspace.accountId, s.workspace.mode, s.workspace.mandate.version);
    if (s.account !== p.accountId) throw new Error("Sign in with the wallet that prepared this.");
    // Late approvals of closed requests first, then one outgoing request per account (resolve what provably sent nothing).
    for (const other of await recentlyClosed(s.id, p.accountId)) {
      const op = other.preparation as unknown as RheaPreparation, before = JSON.stringify(other);
      const r = await resolveRhea(other, op).catch(() => null);
      if (Array.isArray(r)) { await settle(s.id, other, op, r); await saveAttempt(s.id, other, before); throw new Error(`An earlier Rhea request (started ${ago(other.createdAt)}) was approved in your wallet after it was closed. FlowVault is tracking it now; check Activity before sending another.`); }
    }
    for (const other of await listActiveAttempts(s.id)) {
      if (other.id === a.id || other.accountId !== p.accountId) continue;
      if (other.kind === "lend") {
        const op = other.preparation as unknown as RheaPreparation, before = JSON.stringify(other);
        const r = await resolveRhea(other, op).catch(() => null);
        if (r === "closed") { await releasePolicy(s.id, other.id); await saveAttempt(s.id, other, before); continue; }
        if (Array.isArray(r)) { await settle(s.id, other, op, r); await saveAttempt(s.id, other, before); }
      }
      throw new Error(`An earlier ${other.kind === "lend" ? "Rhea action" : other.kind} from this account (started ${ago(other.createdAt)}) is still unresolved, so FlowVault won't send another yet. Check it in Activity; if nothing left your wallet it clears within a minute.`);
    }
    const policy = s.workspace.policy ?? defaultPolicy();
    const policyAction = { ...p.policyAction, id: a.id };
    await checkPolicy(s.id, policyAction, policy);
    await reservePolicy(s.id, policyAction, policy, s.revision);
    revision = s.revision;
    p.walletAskedAt = new Date().toISOString();
    p.keyNonces = await keyNonces(p.accountId);
    a.state = "awaiting_wallet";
    a.message = "Waiting for your wallet. Approve the reviewed Rhea transactions there. If the result is unclear, check its status before trying again.";
  } else if (action === "declined") {
    if (a.state === "awaiting_wallet" && !a.hashes.length) { a.state = "failed"; a.message = "Not sent. The wallet request was declined or never opened."; await releasePolicy(s.id, a.id); }
  } else if (action === "uncertain") {
    if (a.state === "awaiting_wallet") { a.state = "unknown"; a.message = "The wallet did not report a result. FlowVault checks your account for the transactions; if none left your wallet it clears within a minute."; }
  } else if (action === "check" && !hashes.length && !a.hashes.length) {
    const r = await resolveRhea(a, p);
    if (r === "closed") await releasePolicy(s.id, a.id);
    else if (Array.isArray(r)) await settle(s.id, a, p, r);
  } else {
    if (a.state === "prepared") throw new Error("This hasn't reached your wallet.");
    const all = [...new Set([...a.hashes, ...hashes])];
    if (all.length > p.transactions.length) throw new Error("More transactions than this action prepared.");
    if (all.some(h => !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h))) throw new Error("Invalid NEAR transaction hash.");
    if (all.length) await settle(s.id, a, p, all);
  }
  await saveAttempt(s.id, a, previous, revision);
  return a;
}
