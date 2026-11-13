// In-app Rhea Lending for every listed market: supply, withdraw, add or release collateral, borrow and repay.
// Pure: Rhea's health formula on Rhea's own oracle prices, the exact owner-signed transactions, the policy view
// and the finalized-receipt check. FlowVault never signs; unknown prices, health, decimals or liquidity fail closed.
import { decimal } from "./money.ts";
import type { PolicyAction } from "./policy.ts";
import type { PolicyEntry } from "./plans-policy.ts";
import type { SwapTx } from "./swap-exec.ts";

export const RHEA = "contract.main.burrow.near";
export const WRAP = "wrap.near";
export type RheaKind = "supply" | "withdraw" | "collateral_add" | "collateral_release" | "borrow" | "repay";
export const RHEA_KINDS: RheaKind[] = ["supply", "withdraw", "collateral_add", "collateral_release", "borrow", "repay"];
const TGAS = 10n ** 12n;
const PYTH_GAS = 300n * TGAS, FT_CALL_GAS = 250n * TGAS, STORAGE_GAS = 30n * TGAS, WRAP_GAS = 10n * TGAS;
/** NEAR kept back for fees after any Rhea action (same conservative reserve as the USDC flows). */
export const NEAR_RESERVE = 250_000000000000000000000n;
export const DEFAULT_MIN_HEALTH_E6 = 1_500000n;
export const DEFAULT_DRAWDOWN_BPS = 3000;

export interface RheaMarket {
  tokenId: string; symbol: string; decimals: number; extraDecimals: number; volatilityRatio: number;
  canDeposit: boolean; canWithdraw: boolean; canCollateral: boolean; canBorrow: boolean;
  /** Inner units (decimals + extraDecimals). */
  availableInner: bigint; totalBorrowedInner: bigint; borrowedLimitInner: bigint | null; minBorrowedInner: bigint;
  /** USD per whole token, 12-decimal fixed point, from Rhea's own Pyth path; null when unverified. */
  priceE12: bigint | null;
  stable: boolean;
}
export interface RheaAccount {
  registered: boolean;
  /** Inner units, REGULAR position only. */
  supplied: Record<string, bigint>; collateral: Record<string, bigint>; borrowed: Record<string, bigint>;
  /** Margin / LP positions make health unverifiable here. */
  otherPositions: string[];
}
export interface RheaWallet {
  /** The token's own wallet balance (wNEAR for wrap.near), native NEAR spendable after storage. */
  tokenRaw: bigint; nativeRaw: bigint;
  tokenRegistered: boolean; tokenStorageMin: bigint | null;
  wrapRegistered: boolean; wrapStorageMin: bigint | null;
  rheaStorageMin: bigint;
}
export interface RheaRequest {
  kind: RheaKind; tokenId: string; amountRaw: bigint; accountId: string;
  /** Native NEAR in or out (wrap.near market only): wrap before depositing, unwrap after withdrawing. */
  native: boolean;
  approveNewDebt?: boolean;
  /** Wallet amount of this token that must stay put (reserve and dated obligations for USDC). */
  keepRaw?: bigint;
  minHealthE6?: bigint; drawdownBps?: number;
}

const inner = (raw: bigint, m: RheaMarket) => raw * 10n ** BigInt(m.extraDecimals);
const native = (v: bigint, m: RheaMarket, up = false) => { const s = 10n ** BigInt(m.extraDecimals); return up ? (v + s - 1n) / s : v / s; };
/** USD (12 dp) of an inner amount at the market price, or null. */
export function innerUsdE12(v: bigint, m: RheaMarket) {
  return m.priceE12 === null ? null : v * m.priceE12 / 10n ** BigInt(m.decimals + m.extraDecimals);
}

export interface RheaHealth { noDebt: boolean; healthE6: bigint | null; stressedE6: bigint | null; unknown: string[]; collateralUsdE12: bigint; debtUsdE12: bigint }
/** Rhea's health: Σ collateral value × volatility ratio ÷ Σ debt value ÷ volatility ratio. Stressed: non-stable
 * collateral falls and non-stable debt rises by the drawdown. Any position without a verified price is unknown. */
export function rheaHealth(markets: Record<string, RheaMarket>, a: Pick<RheaAccount, "collateral" | "borrowed">, ddBps = DEFAULT_DRAWDOWN_BPS): RheaHealth {
  const unknown: string[] = [];
  let col = 0n, debt = 0n, colS = 0n, debtS = 0n, colUsd = 0n, debtUsd = 0n;
  for (const [id, v] of Object.entries(a.collateral)) {
    if (v <= 0n) continue;
    const m = markets[id], usd = m ? innerUsdE12(v, m) : null;
    if (!m || usd === null) { unknown.push(m?.symbol ?? id); continue; }
    const adj = usd * BigInt(m.volatilityRatio) / 10000n;
    col += adj; colUsd += usd; colS += m.stable ? adj : adj * BigInt(10000 - ddBps) / 10000n;
  }
  for (const [id, v] of Object.entries(a.borrowed)) {
    if (v <= 0n) continue;
    const m = markets[id], usd = m ? innerUsdE12(v, m) : null;
    if (!m || usd === null) { unknown.push(m?.symbol ?? id); continue; }
    const adj = usd * 10000n / BigInt(m.volatilityRatio);
    debt += adj; debtUsd += usd; debtS += m.stable ? adj : adj * BigInt(10000 + ddBps) / 10000n;
  }
  const noDebt = !Object.values(a.borrowed).some(v => v > 0n);
  if (noDebt) return { noDebt, healthE6: null, stressedE6: null, unknown, collateralUsdE12: colUsd, debtUsdE12: 0n };
  return { noDebt, unknown, collateralUsdE12: colUsd, debtUsdE12: debtUsd, healthE6: unknown.length || debt === 0n ? null : col * 1000000n / debt, stressedE6: unknown.length || debtS === 0n ? null : colS * 1000000n / debtS };
}
export const healthLabel = (h: RheaHealth) => h.noDebt ? "no debt" : h.unknown.length ? "unknown (" + h.unknown.join(", ") + " unpriced)" : decimal(h.healthE6!, 6).replace(/(\.\d{2})\d*$/, "$1");
const add = (m: Record<string, bigint>, id: string, d: bigint) => ({ ...m, [id]: (m[id] ?? 0n) + d });

const call = (methodName: string, args: Record<string, unknown>, gas: bigint, deposit: bigint) => ({ type: "FunctionCall" as const, params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } });

export interface RheaBuild {
  transactions: SwapTx[]; storageRaw: bigint; nativeInRaw: bigint; innerAmount: string;
  healthBefore: string; healthAfter: string; stressedAfter: string | null; newDebt: boolean; usdE12: bigint;
}

/** The exact transactions for one Rhea action, after every check FlowVault can make from finalized reads. */
export function buildRheaAction(req: RheaRequest, markets: Record<string, RheaMarket>, acct: RheaAccount, w: RheaWallet): RheaBuild {
  const m = markets[req.tokenId];
  if (!m) throw new Error("This Rhea market is unavailable.");
  if (req.amountRaw <= 0n) throw new Error("Enter an amount above zero.");
  if (req.native && m.tokenId !== WRAP) throw new Error("Only the NEAR market can wrap or unwrap native NEAR.");
  const v = inner(req.amountRaw, m), dd = req.drawdownBps ?? DEFAULT_DRAWDOWN_BPS, minH = req.minHealthE6 ?? DEFAULT_MIN_HEALTH_E6;
  const before = rheaHealth(markets, acct, dd);
  const txs: SwapTx[] = [];
  let storage = 0n, nativeIn = 0n, after = before;
  const ft = m.tokenId;
  const rheaReg = () => { if (!acct.registered) { txs.push({ receiverId: RHEA, actions: [call("storage_deposit", { account_id: req.accountId, registration_only: false }, STORAGE_GAS, w.rheaStorageMin)] }); storage += w.rheaStorageMin; } };
  const tokenReg = () => {
    if (w.tokenRegistered) return;
    if (w.tokenStorageMin === null || w.tokenStorageMin <= 0n) throw new Error(m.symbol + " storage requirement is unverified.");
    txs.push({ receiverId: ft, actions: [call("storage_deposit", { account_id: req.accountId, registration_only: true }, STORAGE_GAS, w.tokenStorageMin)] });
    storage += w.tokenStorageMin;
  };
  /** Wallet → Rhea through ft_transfer_call, wrapping native NEAR first in the same transaction. */
  const deposit = (msg: string) => {
    const keep = req.keepRaw ?? 0n;
    if (req.native) {
      nativeIn = req.amountRaw;
      const actions = [];
      if (!w.wrapRegistered) {
        if (w.wrapStorageMin === null || w.wrapStorageMin <= 0n) throw new Error("wNEAR storage requirement is unverified.");
        actions.push(call("storage_deposit", { account_id: req.accountId, registration_only: true }, STORAGE_GAS, w.wrapStorageMin));
        storage += w.wrapStorageMin;
      }
      actions.push(call("near_deposit", {}, WRAP_GAS, req.amountRaw), call("ft_transfer_call", { receiver_id: RHEA, amount: req.amountRaw.toString(), msg }, FT_CALL_GAS, 1n));
      txs.push({ receiverId: WRAP, actions });
    } else {
      if (w.tokenRaw < req.amountRaw) throw new Error(`Your wallet holds less ${m.symbol} than ${decimal(req.amountRaw, m.decimals)}.`);
      if (w.tokenRaw - req.amountRaw < keep) throw new Error(`This would spend ${m.symbol} your reserve and dated obligations need.`);
      txs.push({ receiverId: ft, actions: [call("ft_transfer_call", { receiver_id: RHEA, amount: req.amountRaw.toString(), msg }, FT_CALL_GAS, 1n)] });
    }
  };
  /** Rhea → wallet with Rhea's oracle prices attached; then unwrap when NEAR was asked for. */
  const payout = (actions: Record<string, unknown>[]) => {
    if (!m.canWithdraw) throw new Error(m.symbol + " withdrawals are paused on Rhea.");
    if (!req.native || ft !== WRAP) tokenReg();
    else if (!w.wrapRegistered) throw new Error("Your account isn't registered on wrap.near; withdraw as wNEAR once to register.");
    txs.push({ receiverId: RHEA, actions: [call("execute_with_pyth", { actions }, PYTH_GAS, 1n)] });
    if (req.native) txs.push({ receiverId: WRAP, actions: [call("near_withdraw", { amount: req.amountRaw.toString() }, WRAP_GAS, 1n)] });
  };
  const riskGate = (what: string) => {
    if (acct.otherPositions.length) throw new Error(`Your Rhea account has ${acct.otherPositions.join(", ")} positions; health can't be verified here, so ${what} is blocked.`);
    if (after.noDebt) return;
    if (after.unknown.length || after.stressedE6 === null) throw new Error(`Health after ${what} is unknown (${after.unknown.join(", ") || "no verified prices"}); FlowVault won't prepare it.`);
    if (after.stressedE6 < minH) throw new Error(`After ${what}, health in a ${dd / 100}% price drop would be ${decimal(after.stressedE6, 6).slice(0, 4)}, below your minimum ${decimal(minH, 6).slice(0, 4)}.`);
  };

  switch (req.kind) {
    case "supply":
      if (!m.canDeposit) throw new Error(m.symbol + " deposits are paused on Rhea.");
      rheaReg(); deposit("");
      break;
    case "collateral_add":
      if (!m.canDeposit || !m.canCollateral) throw new Error(m.symbol + " isn't accepted as Rhea collateral now.");
      rheaReg(); deposit(JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: ft, max_amount: v.toString() } }] } }));
      after = rheaHealth(markets, { ...acct, collateral: add(acct.collateral, ft, v) }, dd);
      break;
    case "withdraw":
      if ((acct.supplied[ft] ?? 0n) < v) throw new Error(`You have less ${m.symbol} supplied on Rhea than that. Collateral is released separately.`);
      if (m.availableInner < v) throw new Error(`Rhea has only ${decimal(native(m.availableInner, m), m.decimals)} ${m.symbol} free to withdraw right now.`);
      payout([{ Withdraw: { token_id: ft, max_amount: v.toString() } }]);
      break;
    case "collateral_release":
      if ((acct.collateral[ft] ?? 0n) < v) throw new Error(`Rhea holds less ${m.symbol} collateral than that.`);
      if (m.availableInner < v) throw new Error(`Rhea has only ${decimal(native(m.availableInner, m), m.decimals)} ${m.symbol} free to withdraw right now.`);
      after = rheaHealth(markets, { ...acct, collateral: add(acct.collateral, ft, -v) }, dd);
      riskGate("releasing this collateral");
      payout([{ DecreaseCollateral: { token_id: ft, max_amount: v.toString() } }, { Withdraw: { token_id: ft, max_amount: v.toString() } }]);
      break;
    case "borrow":
      if (!req.approveNewDebt) throw new Error("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL: confirm the new debt before preparing a borrow.");
      if (!m.canBorrow) throw new Error(m.symbol + " borrowing is paused on Rhea.");
      if (!acct.registered || !Object.values(acct.collateral).some(x => x > 0n)) throw new Error("Add collateral on Rhea before borrowing.");
      if (v < m.minBorrowedInner) throw new Error(`Rhea's minimum ${m.symbol} borrow is ${decimal(native(m.minBorrowedInner, m, true), m.decimals)}.`);
      if (m.availableInner < v) throw new Error(`Rhea has only ${decimal(native(m.availableInner, m), m.decimals)} ${m.symbol} available to borrow.`);
      if (m.borrowedLimitInner !== null && m.totalBorrowedInner + v > m.borrowedLimitInner) throw new Error(`This would pass Rhea's ${m.symbol} borrow cap.`);
      after = rheaHealth(markets, { ...acct, borrowed: add(acct.borrowed, ft, v) }, dd);
      riskGate("this borrow");
      payout([{ Borrow: { token_id: ft, amount: v.toString() } }, { Withdraw: { token_id: ft, max_amount: v.toString() } }]);
      break;
    case "repay": {
      const owed = acct.borrowed[ft] ?? 0n;
      if (owed <= 0n) throw new Error(`There's no ${m.symbol} debt on Rhea to repay.`);
      // Interest accrues until the receipt lands: up to 0.2% over the debt is allowed; any excess stays supplied.
      const owedNative = native(owed, m, true);
      if (req.amountRaw > owedNative + owedNative / 500n + 1n) throw new Error(`That's more than your ${m.symbol} debt plus a small interest buffer.`);
      deposit(JSON.stringify({ Execute: { actions: [{ Repay: { token_id: ft, max_amount: v.toString() } }] } }));
      after = rheaHealth(markets, { ...acct, borrowed: add(acct.borrowed, ft, -(v > owed ? owed : v)) }, dd);
      break;
    }
  }
  const usdE12 = innerUsdE12(v, m);
  if (usdE12 === null) throw new Error(`${m.symbol} has no verified price on Rhea's oracle; amount limits can't be checked.`);
  return {
    transactions: txs, storageRaw: storage, nativeInRaw: nativeIn, innerAmount: v.toString(),
    healthBefore: healthLabel(before), healthAfter: healthLabel(after),
    stressedAfter: after.noDebt ? "no debt" : after.stressedE6 === null ? null : decimal(after.stressedE6, 6).slice(0, 4),
    newDebt: req.kind === "borrow", usdE12,
  };
}

const POLICY_KIND: Record<RheaKind, string> = { supply: "supply", collateral_add: "pledge", withdraw: "withdraw", collateral_release: "withdraw", borrow: "borrow", repay: "repay" };
function methods(txs: SwapTx[]) {
  const out: PolicyAction["methods"] = [];
  for (const tx of txs) for (const a of tx.actions) {
    const m = { receiver: tx.receiverId, method: a.params.methodName, ...(a.params.methodName === "ft_transfer_call" ? { nestedReceiver: RHEA } : {}) };
    if (!out.some(x => x.receiver === m.receiver && x.method === m.method)) out.push(m);
  }
  return out;
}
export function rheaPolicyAction(kind: RheaKind, accountId: string, symbol: string, usdE12: bigint, txs: SwapTx[], feeRaw: bigint): PolicyAction {
  const usd6 = usdE12 / 1000000n;
  return { kind: POLICY_KIND[kind], chain: "near", asset: symbol, amount: decimal(usd6 > 0n ? usd6 : 1n), recipient: accountId, venue: RHEA, movingCost: "0", gasNear: decimal(feeRaw, 24), source: "live", accountId, methods: methods(txs) };
}
export function rheaPolicyEntries(txs: SwapTx[], symbol: string): PolicyEntry[] {
  return [{ type: "venue", venue: RHEA, label: "Venue Rhea Lending" }, ...methods(txs).map(m => ({ type: "method" as const, receiver: m.receiver, method: m.method, label: `${m.method} on ${m.receiver} (Rhea ${symbol})` }))];
}

/* ───────────── finalized receipts ───────────── */

type Ev = { executor: string; standard: string; event: string; data: Record<string, unknown>[] };
function events(results: unknown[]): Ev[] {
  const out: Ev[] = [];
  for (const raw of results) for (const r of (raw as { receipts_outcome?: { outcome?: { executor_id?: string; logs?: unknown[] } }[] }).receipts_outcome ?? []) {
    for (const log of r.outcome?.logs ?? []) {
      if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
      try { const e = JSON.parse(log.slice(11)); if (Array.isArray(e?.data)) out.push({ executor: String(r.outcome?.executor_id), standard: e.standard, event: e.event, data: e.data }); } catch { /* not an event */ }
    }
  }
  return out;
}
const EXPECT: Record<RheaKind, string[]> = { supply: ["deposit"], collateral_add: ["increase_collateral"], withdraw: ["withdraw_succeeded"], collateral_release: ["decrease_collateral", "withdraw_succeeded"], borrow: ["borrow", "withdraw_succeeded"], repay: ["repay"] };

/** Confirmed only from FINAL receipts that carry Rhea's own events for this account and token. */
export function verifyRheaReceipts(results: unknown[], p: { kind: RheaKind; accountId: string; tokenId: string; native: boolean; transactions: SwapTx[] }) {
  for (const raw of results) {
    const r = raw as { final_execution_status?: string; status?: Record<string, unknown> };
    if (!r || r.final_execution_status !== "FINAL") return null;
  }
  const ev = events(results);
  const rhea = (name: string) => ev.filter(e => e.executor === RHEA && e.standard === "burrow" && e.event === name).flatMap(e => e.data).filter(d => d.account_id === p.accountId && d.token_id === p.tokenId);
  if (rhea("withdraw_failed").length) return { state: "failed" as const, message: "Rhea reported withdraw_failed; the funds stayed in your Rhea position." };
  const missing = EXPECT[p.kind].filter(n => !rhea(n).length);
  const statusFailed = results.some(raw => { const s = (raw as { status?: Record<string, unknown> }).status; return !!s && "Failure" in s; });
  if (missing.length) return { state: "failed" as const, message: statusFailed ? "The transaction failed on NEAR. Network fees were spent; nothing else moved." : `Rhea didn't record ${missing.join(" and ")} for this account; any tokens sent were refunded.` };
  const moved = rhea(EXPECT[p.kind][0]).reduce((n, d) => n + (/^\d+$/.test(String(d.amount)) ? BigInt(String(d.amount)) : 0n), 0n);
  const unwrapFailed = p.native && (p.kind === "withdraw" || p.kind === "borrow" || p.kind === "collateral_release") && statusFailed;
  return { state: unwrapFailed ? "partial" as const : "confirmed" as const, movedInner: moved.toString(), message: unwrapFailed ? "Rhea paid out wNEAR, but unwrapping to NEAR failed. Your wNEAR is in your wallet." : "Rhea recorded it; finalized on NEAR." };
}
