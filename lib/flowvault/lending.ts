// Engines E2: executable credit on Rhea Lending, one verified collateral family (NEAR liquid staking:
// LiNEAR, rNEAR) and USDC debt. Pure: live reads are in lending-live.ts. Builds owner-inspectable
// payloads only; nothing here signs or sends. All amounts bigint base units.
// Call formats verified against finalized mainnet transactions (12 Nov 2026) and AllPilot (MIT):
//  collateral_add     LST.ft_transfer_call(RHEA, amount, {"Execute":{"actions":[{"IncreaseCollateral":{token_id,max_amount}}]}})
//  borrow             RHEA.execute_with_pyth({actions:[{Borrow:{token_id,amount}},{Withdraw:{token_id,max_amount}}]})
//  repay              USDC.ft_transfer_call(RHEA, amount, {"Execute":{"actions":[{"Repay":{token_id,max_amount}}]}})
//  collateral_release RHEA.execute_with_pyth({actions:[{DecreaseCollateral:{token_id,max_amount}},{Withdraw:{token_id,max_amount}}]})
// Rhea runs in Pyth mode (get_config.enable_pyth_oracle, enable_price_oracle false): execute_with_pyth makes
// the contract fetch Pyth prices itself; the caller supplies no price data. Deposits/repays need no prices.
import { stressCapacity } from "./credit.ts";
import { carry, decimal, units } from "./money.ts";
import { usdcValue } from "./valuation.ts";
import type { FundingChoice } from "./contracts.ts";
import type { PriceEvidence } from "./valuation-evidence.ts";
import type { Policy } from "./policy.ts";
import type { PolicyAction } from "./policy.ts";

export const RHEA = "contract.main.burrow.near";
export const LENDING_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const COLLATERAL_FAMILY = {
  LiNEAR: "linear-protocol.near",
  rNEAR: "lst.rhealab.near",
} as const;
export type CollateralAsset = keyof typeof COLLATERAL_FAMILY;
export type LendingKind = "collateral_add" | "borrow" | "repay" | "collateral_release";
export const LENDING_KINDS: LendingKind[] = ["collateral_add", "borrow", "repay", "collateral_release"];
export const isLendingKind = (k: string): k is LendingKind => (LENDING_KINDS as string[]).includes(k);
const TOKEN_SYMBOL: Record<string, string> = {
  [LENDING_USDC]: "USDC",
  [COLLATERAL_FAMILY.LiNEAR]: "LiNEAR",
  [COLLATERAL_FAMILY.rNEAR]: "rNEAR",
};
const GAS_RESERVE_YOCTO = 250_000000000000000000000n; // 0.25 NEAR
const FT_CALL_GAS = "250000000000000";
const PYTH_GAS = "300000000000000";
const STORAGE_GAS = "30000000000000";
/** Default minimum health after any action, unless the policy credit row sets a stricter one. */
export const DEFAULT_MIN_HEALTH_E6 = 1_500000n;
export const DEFAULT_DRAWDOWN_BPS = 3000;
const PREP_TTL_MS = 180_000;

export interface RheaAsset {
  tokenId: string;
  decimals: number;
  extraDecimals: number;
  volatilityRatio: number;
  canDeposit: boolean;
  canWithdraw: boolean;
  canUseAsCollateral: boolean;
  canBorrow: boolean;
  /** Inner units (decimals + extraDecimals). */
  suppliedInner: bigint;
  reservedInner: bigint;
  borrowedInner: bigint;
  borrowedLimitInner: bigint | null;
  minBorrowedInner: bigint;
  borrowApr: string;
  /** E3: Rhea supply APR (decimal fraction text) for statement forecasts. */
  supplyApr?: string;
}
export interface LendingState {
  source: "live";
  accountId: string;
  capturedAt: string;
  blockHeight: number;
  contractMode: string;
  pythMode: boolean;
  registered: boolean;
  registrationMinimum: bigint;
  /** NEP-145 registration of the account on the tokens it would receive. */
  tokenRegistered: Record<string, boolean>;
  tokenStorageMinimum: Record<string, bigint>;
  nativeAvailableYocto: bigint;
  assets: Record<string, RheaAsset>;
  /** REGULAR position only; inner units. */
  supplied: Record<string, bigint>;
  collateral: Record<string, bigint>;
  borrowed: Record<string, bigint>;
  /** Other Rhea positions (LP/margin) make health unverifiable here. */
  otherPositions: string[];
  wallet: Record<string, bigint>;
  prices: PriceEvidence | null;
}

/* ───────────── valuation of Rhea balances ───────────── */

function toNative(inner: bigint, a: RheaAsset, roundUp: boolean) {
  const s = 10n ** BigInt(a.extraDecimals);
  return roundUp ? (inner + s - 1n) / s : inner / s;
}
/** USDC raw value of a Rhea balance; null when no verified price. Debt uses the oracle upper bound. */
export function rheaValue(
  tokenId: string,
  inner: bigint,
  st: LendingState,
  side: "asset" | "liability",
): bigint | null {
  const a = st.assets[tokenId];
  if (!a || !st.prices) return null;
  const native = toNative(inner, a, side === "liability");
  try {
    if (tokenId === LENDING_USDC) return native;
    const lst = TOKEN_SYMBOL[tokenId] as CollateralAsset | undefined;
    if (lst && lst !== ("USDC" as never)) {
      const rate = st.prices.lstNearPerToken[lst];
      if (!rate) return null;
      const near =
        side === "asset"
          ? (native * BigInt(rate)) / 10n ** 24n
          : (native * BigInt(rate) + 10n ** 24n - 1n) / 10n ** 24n;
      return usdcValue(near, 24, "NEAR", st.prices, side);
    }
    if (tokenId === "wrap.near") return usdcValue(native, 24, "NEAR", st.prices, side);
    if (tokenId === "usdt.tether-token.near") return usdcValue(native, 6, "USDT", st.prices, side);
  } catch {
    return null;
  }
  return null;
}

export interface Health {
  /** health × 10^6; null = no debt (infinite) handled by `noDebt`. */
  healthE6: bigint | null;
  stressedHealthE6: bigint | null;
  noDebt: boolean;
  adjustedCollateralUsdcRaw: string;
  adjustedDebtUsdcRaw: string;
  collateralUsdcRaw: string;
  debtUsdcRaw: string;
  /** Collateral Rhea counts but FlowVault cannot price is valued at zero (conservative). */
  unpricedCollateral: string[];
  /** Debt that cannot be priced makes health unknown. */
  unknown: string[];
}
/** Rhea health = Σ collateral × volatility_ratio / Σ debt ÷ volatility_ratio (liquidation below 1.0). */
export function health(
  st: LendingState,
  delta: { collateral?: Record<string, bigint>; borrowed?: Record<string, bigint> } = {},
  drawdownBps: Record<string, number> = {},
): Health {
  const coll = { ...st.collateral },
    debt = { ...st.borrowed };
  for (const [t, d] of Object.entries(delta.collateral ?? {})) coll[t] = (coll[t] ?? 0n) + d;
  for (const [t, d] of Object.entries(delta.borrowed ?? {})) debt[t] = (debt[t] ?? 0n) + d;
  let adjC = 0n,
    adjS = 0n,
    adjD = 0n,
    rawC = 0n,
    rawD = 0n;
  const unpricedCollateral: string[] = [],
    unknown: string[] = [];
  for (const [t, inner] of Object.entries(coll)) {
    if (inner < 0n) unknown.push(t + ": negative collateral");
    if (inner <= 0n) continue;
    const a = st.assets[t];
    const v = a ? rheaValue(t, inner, st, "asset") : null;
    if (v === null || !a) {
      unpricedCollateral.push(t);
      continue;
    }
    const sym = TOKEN_SYMBOL[t];
    const dd = BigInt(t === LENDING_USDC ? 0 : (drawdownBps[sym] ?? DEFAULT_DRAWDOWN_BPS));
    rawC += v;
    adjC += (v * BigInt(a.volatilityRatio)) / 10000n;
    adjS += (((v * (10000n - dd)) / 10000n) * BigInt(a.volatilityRatio)) / 10000n;
  }
  for (const [t, inner] of Object.entries(debt)) {
    if (inner < 0n) unknown.push(t + ": negative debt");
    if (inner <= 0n) continue;
    const a = st.assets[t];
    const v = a ? rheaValue(t, inner, st, "liability") : null;
    if (v === null || !a || a.volatilityRatio <= 0) {
      unknown.push(t);
      continue;
    }
    rawD += v;
    adjD += (v * 10000n + BigInt(a.volatilityRatio) - 1n) / BigInt(a.volatilityRatio);
  }
  const noDebt = adjD === 0n && unknown.length === 0;
  return {
    healthE6: unknown.length || noDebt ? null : (adjC * 1_000000n) / adjD,
    stressedHealthE6: unknown.length || noDebt ? null : (adjS * 1_000000n) / adjD,
    noDebt,
    adjustedCollateralUsdcRaw: adjC.toString(),
    adjustedDebtUsdcRaw: adjD.toString(),
    collateralUsdcRaw: rawC.toString(),
    debtUsdcRaw: rawD.toString(),
    unpricedCollateral,
    unknown,
  };
}
export const healthText = (h: Health) =>
  h.unknown.length ? null : h.noDebt ? "no debt" : decimal(h.healthE6!, 6);

/* ───────────── policy rows ───────────── */

function creditRow(policy: Policy | undefined, sym: string) {
  return policy?.creditRows?.find((r) => r.assetId.toLowerCase() === sym.toLowerCase());
}
function minHealthE6(policy: Policy | undefined) {
  let m = DEFAULT_MIN_HEALTH_E6;
  for (const r of policy?.creditRows ?? []) {
    const v = units(r.minHealth);
    if (v > m) m = v;
  }
  return m;
}
function drawdowns(policy: Policy | undefined) {
  return Object.fromEntries(
    Object.keys(COLLATERAL_FAMILY).map((s) => [s, creditRow(policy, s)?.drawdownBps ?? DEFAULT_DRAWDOWN_BPS]),
  );
}
/** Collateral use is permitted only with a saved credit row allowing pledge+borrow, a matching asset row
 * (when asset rows exist) and the asset not protected. */
export function collateralPermission(policy: Policy | undefined, sym: CollateralAsset) {
  const reasons: string[] = [];
  if (policy?.protectedAssets.some((a) => a.toLowerCase() === sym.toLowerCase())) reasons.push("PROTECTED_ASSET:" + sym);
  const row = creditRow(policy, sym);
  if (!row) reasons.push("NO_CREDIT_POLICY:" + sym);
  else {
    if (!row.eligible) reasons.push("INELIGIBLE_COLLATERAL:" + sym);
    if (!row.permissions.includes("pledge") || !row.permissions.includes("borrow"))
      reasons.push("PERMISSION_DENIED:" + sym);
  }
  const asset = policy?.assetRows?.find((r) => r.asset.toLowerCase() === sym.toLowerCase() && (!r.chain || r.chain === "near"));
  if (policy?.assetRows && (!asset || !asset.uses.includes("pledge") || !asset.uses.includes("borrow")))
    reasons.push("ASSET_USE_NOT_ALLOWED:" + sym);
  return { allowed: reasons.length === 0, reasons, row };
}

/* ───────────── capacity ───────────── */

export function lendingFreshness(st: LendingState, now = Date.now()) {
  const reasons: string[] = [];
  if (st.contractMode !== "Running") reasons.push("RHEA_NOT_RUNNING");
  if (!st.pythMode) reasons.push("RHEA_ORACLE_MODE_UNVERIFIED");
  if (!Number.isFinite(Date.parse(st.capturedAt)) || Math.abs(now - Date.parse(st.capturedAt)) > PREP_TTL_MS)
    reasons.push("STALE_LENDING_STATE");
  if (!st.prices) reasons.push("PRICE_EVIDENCE_UNAVAILABLE");
  else if (!(now <= Date.parse(st.prices.freshUntil))) reasons.push("PRICE_EVIDENCE_STALE");
  if (st.otherPositions.length) reasons.push("OTHER_RHEA_POSITIONS:" + st.otherPositions.join(","));
  return reasons;
}

/** USDC borrow capacity on Rhea from the account's real collateral and debt. Respects protected assets,
 * permitted uses, the policy LTV cap and minimum stressed health, Rhea's volatility ratios, the asset's
 * borrowed_limit and liquidity, the per-action cap and existing debt. Each collateral position is assigned
 * to one candidate only (stressCapacity), so it is never counted twice. Floors in base units. */
export function borrowCapacity(st: LendingState, policy: Policy | undefined, now = Date.now()) {
  const usdc = st.assets[LENDING_USDC];
  const reasons = lendingFreshness(st, now);
  if (!usdc) reasons.push("USDC_MARKET_UNAVAILABLE");
  else if (!usdc.canBorrow) reasons.push("USDC_BORROW_DISABLED");
  const h = health(st, {}, drawdowns(policy));
  if (h.unknown.length) reasons.push("UNPRICED_DEBT:" + h.unknown.join(","));
  const minH = minHealthE6(policy);
  const rows = (Object.keys(COLLATERAL_FAMILY) as CollateralAsset[]).map((sym) => {
    const token = COLLATERAL_FAMILY[sym];
    const inner = st.collateral[token] ?? 0n;
    const perm = collateralPermission(policy, sym);
    const value = inner > 0n ? rheaValue(token, inner, st, "asset") : 0n;
    const a = st.assets[token];
    return {
      assetId: sym,
      collateralId: `${st.accountId}:rhea:${token}`,
      value: value === null ? null : decimal(value),
      drawdownBps: perm.row?.drawdownBps ?? DEFAULT_DRAWDOWN_BPS,
      ltvCapBps: perm.row?.ltvCapBps ?? 0,
      liquidationThresholdBps: a && a.canUseAsCollateral ? a.volatilityRatio : null,
      protocolLtvBps: a ? Math.floor((a.volatilityRatio * (usdc?.volatilityRatio ?? 0)) / 10000) : null,
      minHealth: decimal(minH),
      priority: perm.row?.priority ?? ("P3" as const),
      permissions: perm.allowed ? (["pledge", "borrow"] as ("pledge" | "borrow")[]) : [],
      eligible: perm.allowed && inner > 0n,
      excludedReasons: perm.reasons,
    };
  });
  // Existing debt in USDC terms at USDC's risk weight (Rhea health uses debt ÷ volatility_ratio).
  const debtUsdc =
    usdc && !h.unknown.length ? (BigInt(h.adjustedDebtUsdcRaw) * BigInt(usdc.volatilityRatio)) / 10000n : null;
  // Other priced collateral (e.g. supplied USDC as collateral) supports health but is outside this family.
  const otherAdj = usdc
    ? Object.entries(st.collateral)
        .filter(([t, v]) => v > 0n && !Object.values(COLLATERAL_FAMILY).includes(t as never))
        .reduce((n, [t, v]) => {
          const val = rheaValue(t, v, st, "asset");
          return val === null ? n : n + (val * BigInt(st.assets[t].volatilityRatio)) / 10000n;
        }, 0n)
    : 0n;
  const scale = usdc ? 10n ** BigInt(usdc.extraDecimals) : 1n;
  const liquidity =
    usdc ? (usdc.suppliedInner + usdc.reservedInner > usdc.borrowedInner ? (usdc.suppliedInner + usdc.reservedInner - usdc.borrowedInner) / scale : 0n) : null;
  const protocolRemaining =
    usdc && usdc.borrowedLimitInner !== null
      ? usdc.borrowedLimitInner > usdc.borrowedInner
        ? (usdc.borrowedLimitInner - usdc.borrowedInner) / scale
        : 0n
      : null;
  const preview = stressCapacity(
    [
      {
        id: "rhea-near-lst",
        source: "live",
        capturedAt: st.capturedAt,
        existingDebt: debtUsdc === null ? null : decimal(debtUsdc),
        protocolLimit: protocolRemaining === null || debtUsdc === null ? null : decimal(protocolRemaining + debtUsdc),
        liquidity: liquidity === null ? null : decimal(liquidity),
        debtRiskBps: usdc?.volatilityRatio,
        assets: rows.map(({ excludedReasons: _x, ...r }) => r),
      },
    ],
    now,
  );
  let capacity = preview.capacity === null || reasons.length ? null : units(preview.capacity);
  // Collateral outside the family only ever helps; it is not counted toward capacity (conservative).
  void otherAdj;
  let binding = preview.markets[0]?.bindingConstraint ?? "unverified";
  if (capacity !== null && policy) {
    const cap = units(policy.perActionCap);
    if (cap < capacity) {
      capacity = cap;
      binding = "per_action_cap";
    }
  }
  return {
    source: "live" as const,
    accountId: st.accountId,
    capturedAt: st.capturedAt,
    asset: "USDC",
    capacityUsdcRaw: capacity === null ? null : capacity.toString(),
    capacity: capacity === null ? null : decimal(capacity),
    bindingConstraint: capacity === null ? "unverified" : binding,
    minBorrowUsdcRaw: usdc ? toNative(usdc.minBorrowedInner, usdc, true).toString() : null,
    borrowApr: usdc?.borrowApr ?? null,
    minHealth: decimal(minH),
    health: healthText(h),
    stressedHealth: h.unknown.length ? null : h.noDebt ? "no debt" : decimal(h.stressedHealthE6!, 6),
    healthDetail: h,
    reasons: [...reasons, ...(preview.markets[0]?.reasons ?? [])],
    collateral: rows.map((r) => ({
      asset: r.assetId,
      collateralRaw: (st.collateral[COLLATERAL_FAMILY[r.assetId as CollateralAsset]] ?? 0n).toString(),
      walletRaw: (st.wallet[COLLATERAL_FAMILY[r.assetId as CollateralAsset]] ?? 0n).toString(),
      valueUsdcRaw: r.value === null ? null : units(r.value).toString(),
      eligible: r.eligible,
      reasons: r.excludedReasons,
    })),
    debt: Object.entries(st.borrowed)
      .filter(([, v]) => v > 0n)
      .map(([t, v]) => ({
        tokenId: t,
        asset: TOKEN_SYMBOL[t] ?? t,
        raw: st.assets[t] ? toNative(v, st.assets[t], true).toString() : null,
      })),
    collateralAssignments: preview.collateralAssignments,
  };
}

/* ───────────── payloads ───────────── */

type Action = {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
};
type Tx = { receiverId: string; actions: Action[] };
const call = (methodName: string, args: Record<string, unknown>, gas: string, deposit: string): Action => ({
  type: "FunctionCall",
  params: { methodName, args, gas, deposit },
});
export interface LendingPreparation {
  kind: LendingKind;
  accountId: string;
  asset: string;
  tokenId: string;
  /** Decimal text in the asset's own decimals (wallet attempt amount). */
  amount: string;
  amountRaw: string;
  decimals: number;
  usdcValueRaw: string;
  transactions: Tx[];
  expiresAt: string;
  healthBefore: string | null;
  healthAfter: string | null;
  stressedHealthAfter: string | null;
  newDebt: boolean;
  approvedNewDebt: boolean;
  /** Policy action evaluated by policy-store (amount = USDC value). */
  policyAction: PolicyAction;
  /** What the owner asked for; wallet handoff re-prepares from it and compares payloads. */
  request: { asset: string; amountRaw: string; approveNewDebt: boolean };
  evidence: string;
  warning: string;
  /** E3: USDC debt (native raw, rounded up) observed at preparation, so the ledger can separate accrued
   * interest from journaled principal only when the debt baseline is proven. */
  debtBeforeUsdcRaw?: string;
}
export interface PrepareRequest {
  kind: LendingKind;
  /** LiNEAR/rNEAR for collateral steps, USDC for borrow/repay. */
  asset: string;
  amountRaw: bigint;
  /** Explicit owner approval of new debt (borrow only). */
  approveNewDebt?: boolean;
  /** Wallet USDC the plan must keep (holdback) — repay may not spend it. */
  holdbackRaw?: bigint;
}

function registration(st: LendingState, txs: Tx[]) {
  if (st.registered) return 0n;
  if (st.registrationMinimum <= 0n) throw new Error("Rhea registration requirement is unverified.");
  txs.push({
    receiverId: RHEA,
    actions: [call("storage_deposit", { account_id: st.accountId, registration_only: false }, STORAGE_GAS, st.registrationMinimum.toString())],
  });
  return st.registrationMinimum;
}
function tokenRegistration(st: LendingState, token: string, txs: Tx[]) {
  if (st.tokenRegistered[token]) return 0n;
  const min = st.tokenStorageMinimum[token];
  if (min === undefined || min <= 0n) throw new Error("Token storage requirement is unverified.");
  txs.push({
    receiverId: token,
    actions: [call("storage_deposit", { account_id: st.accountId, registration_only: true }, STORAGE_GAS, min.toString())],
  });
  return min;
}

/** Builds the owner-signed transactions for one lending step, refusing anything unsafe. */
export function prepareLending(
  st: LendingState,
  policy: Policy | undefined,
  req: PrepareRequest,
  now = Date.now(),
): LendingPreparation {
  const stale = lendingFreshness(st, now);
  if (stale.length) throw new Error("Lending evidence is not usable: " + stale.join(", "));
  if (req.amountRaw <= 0n) throw new Error("Amount must be greater than zero.");
  const collateralStep = req.kind === "collateral_add" || req.kind === "collateral_release";
  const sym = req.asset as CollateralAsset;
  const token = collateralStep ? COLLATERAL_FAMILY[sym] : LENDING_USDC;
  if (!token || (!collateralStep && req.asset !== "USDC"))
    throw new Error(
      collateralStep ? "Only LiNEAR and rNEAR collateral is supported." : "Only USDC borrowing and repayment are supported.",
    );
  const a = st.assets[token];
  if (!a) throw new Error(req.asset + " Rhea market is unavailable.");
  const inner = req.amountRaw * 10n ** BigInt(a.extraDecimals);
  const dd = drawdowns(policy);
  const minH = minHealthE6(policy);
  const before = health(st, {}, dd);
  if (before.unknown.length) throw new Error("Existing debt cannot be priced; health is unknown.");
  const txs: Tx[] = [];
  let storage = 0n;
  let after = before;
  let methods: PolicyAction["methods"] = [];
  let policyKind = "";
  if (req.kind === "collateral_add") {
    const perm = collateralPermission(policy, sym);
    if (!perm.allowed) throw new Error("Policy blocked: " + perm.reasons.join(", "));
    if (!a.canDeposit || !a.canUseAsCollateral) throw new Error(sym + " is not accepted as Rhea collateral now.");
    if ((st.wallet[token] ?? 0n) < req.amountRaw) throw new Error("Wallet " + sym + " is below the requested amount.");
    storage += registration(st, txs);
    txs.push({
      receiverId: token,
      actions: [
        call(
          "ft_transfer_call",
          {
            receiver_id: RHEA,
            amount: req.amountRaw.toString(),
            msg: JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: token, max_amount: inner.toString() } }] } }),
          },
          FT_CALL_GAS,
          "1",
        ),
      ],
    });
    after = health(st, { collateral: { [token]: inner } }, dd);
    methods = [{ receiver: token, method: "ft_transfer_call", nestedReceiver: RHEA }];
    policyKind = "pledge";
  } else if (req.kind === "borrow") {
    if (!req.approveNewDebt) throw new Error("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL: approve the new debt before preparing a borrow.");
    if (!st.registered) throw new Error("Add collateral on Rhea before borrowing.");
    const cap = borrowCapacity(st, policy, now);
    if (cap.capacityUsdcRaw === null) throw new Error("Borrow capacity is unverified: " + cap.reasons.join(", "));
    if (req.amountRaw > BigInt(cap.capacityUsdcRaw))
      throw new Error(`Borrow exceeds verified capacity (${cap.capacity} USDC, bound by ${cap.bindingConstraint}).`);
    if (inner < a.minBorrowedInner) throw new Error("Amount is below Rhea's minimum borrow.");
    storage += tokenRegistration(st, token, txs);
    txs.push({
      receiverId: RHEA,
      actions: [
        call(
          "execute_with_pyth",
          { actions: [{ Borrow: { token_id: token, amount: inner.toString() } }, { Withdraw: { token_id: token, max_amount: inner.toString() } }] },
          PYTH_GAS,
          "1",
        ),
      ],
    });
    after = health(st, { borrowed: { [token]: inner } }, dd);
    methods = [{ receiver: RHEA, method: "execute_with_pyth" }];
    policyKind = "borrow";
  } else if (req.kind === "repay") {
    const owed = st.borrowed[token] ?? 0n;
    if (owed <= 0n) throw new Error("There is no USDC debt on Rhea to repay.");
    const wallet = st.wallet[token] ?? 0n;
    if (wallet < req.amountRaw) throw new Error("Wallet USDC is below the repayment amount.");
    if (req.holdbackRaw === undefined) throw new Error("Holdback is unknown; repayment cannot protect reserved cash.");
    if (wallet - req.amountRaw < req.holdbackRaw)
      throw new Error("This repayment would spend cash reserved for your reserve and obligations.");
    // Interest accrues until the receipt lands: up to 0.2 % over the debt is allowed; any excess stays supplied.
    const owedNative = toNative(owed, a, true);
    if (req.amountRaw > owedNative + owedNative / 500n + 1n)
      throw new Error("Repayment is larger than the debt plus a small interest buffer.");
    txs.push({
      receiverId: token,
      actions: [
        call(
          "ft_transfer_call",
          {
            receiver_id: RHEA,
            amount: req.amountRaw.toString(),
            msg: JSON.stringify({ Execute: { actions: [{ Repay: { token_id: token, max_amount: inner.toString() } }] } }),
          },
          FT_CALL_GAS,
          "1",
        ),
      ],
    });
    const paid = inner > owed ? owed : inner;
    after = health(st, { borrowed: { [token]: -paid } }, dd);
    methods = [{ receiver: token, method: "ft_transfer_call", nestedReceiver: RHEA }];
    policyKind = "repay";
  } else {
    const held = st.collateral[token] ?? 0n;
    if (held < inner) throw new Error("Rhea holds less " + sym + " collateral than requested.");
    if (!a.canWithdraw) throw new Error(sym + " withdrawals are disabled on Rhea now.");
    after = health(st, { collateral: { [token]: -inner } }, dd);
    if (!after.noDebt && (after.unknown.length || after.stressedHealthE6! < minH))
      throw new Error(
        `Releasing this collateral would leave stressed health at ${after.unknown.length ? "unknown" : decimal(after.stressedHealthE6!, 6)}, below your minimum ${decimal(minH)}.`,
      );
    storage += tokenRegistration(st, token, txs);
    txs.push({
      receiverId: RHEA,
      actions: [
        call(
          "execute_with_pyth",
          { actions: [{ DecreaseCollateral: { token_id: token, max_amount: inner.toString() } }, { Withdraw: { token_id: token, max_amount: inner.toString() } }] },
          PYTH_GAS,
          "1",
        ),
      ],
    });
    methods = [{ receiver: RHEA, method: "execute_with_pyth" }];
    policyKind = "withdraw";
  }
  if (req.kind === "borrow" && !after.noDebt && (after.unknown.length || after.stressedHealthE6! < minH))
    throw new Error("Borrowing this much would breach your minimum stressed health.");
  if (txs.length > 2) throw new Error("This step needs more than two transactions; register storage first.");
  if (st.nativeAvailableYocto < storage + GAS_RESERVE_YOCTO)
    throw new Error("Insufficient spendable NEAR for storage and a conservative gas reserve.");
  const value = rheaValue(token, inner, st, req.kind === "borrow" || req.kind === "repay" ? "liability" : "liability");
  if (value === null) throw new Error(req.asset + " valuation is unavailable; policy caps cannot be checked.");
  const attached = txs.reduce((n, t) => n + t.actions.reduce((m, x) => m + BigInt(x.params.deposit), 0n), 0n);
  const decimals = a.decimals;
  const hb = healthText(before),
    ha = healthText(after);
  return {
    kind: req.kind,
    accountId: st.accountId,
    asset: req.asset,
    tokenId: token,
    amount: decimal(req.amountRaw, decimals),
    amountRaw: req.amountRaw.toString(),
    decimals,
    usdcValueRaw: value.toString(),
    transactions: txs,
    expiresAt: new Date(now + PREP_TTL_MS).toISOString(),
    healthBefore: hb,
    healthAfter: ha,
    stressedHealthAfter: after.unknown.length ? null : after.noDebt ? "no debt" : decimal(after.stressedHealthE6!, 6),
    request: { asset: req.asset, amountRaw: req.amountRaw.toString(), approveNewDebt: req.approveNewDebt === true },
    newDebt: req.kind === "borrow",
    approvedNewDebt: req.kind === "borrow" && req.approveNewDebt === true,
    policyAction: {
      kind: policyKind,
      asset: req.asset,
      amount: decimal(value),
      recipient: st.accountId,
      venue: RHEA,
      movingCost: "0",
      gasNear: decimal(GAS_RESERVE_YOCTO + attached, 24),
      source: "live",
      accountId: st.accountId,
      chain: "near",
      methods,
    },
    evidence: `Rhea finalized block ${st.blockHeight}; ${st.prices?.basis ?? "no prices"}`,
    debtBeforeUsdcRaw: st.assets[LENDING_USDC]
      ? toNative(st.borrowed[LENDING_USDC] ?? 0n, st.assets[LENDING_USDC], true).toString()
      : undefined,
    warning:
      "Prepared transactions only. Nothing has been submitted. Review the amount, health and gas, then approve in your connected wallet." +
      (req.kind === "borrow" ? " This creates new debt that accrues interest and can be liquidated if collateral falls." : ""),
  };
}

/* ───────────── finalized-receipt verification ───────────── */

type Outcome = { index: number; state: "pending" | "confirmed" | "failed"; message: string; effect?: LendingEffect };
export interface LendingEffect {
  kind: LendingKind;
  tokenId: string;
  /** Inner units Rhea reported for the effect (collateral moved, debt created/repaid). */
  rheaInner: string;
  /** Native token units transferred to the owner (borrow / release). */
  paidOutRaw?: string;
}
function events(result: any) {
  const out: { executor: string; standard: string; event: string; data: any[] }[] = [];
  for (const r of result.receipts_outcome ?? []) {
    const executor = r.outcome?.executor_id;
    for (const log of r.outcome?.logs ?? []) {
      if (typeof log !== "string" || !log.trimStart().startsWith("EVENT_JSON:")) continue;
      let e: any;
      try {
        e = JSON.parse(log.trimStart().slice(11));
      } catch {
        throw new Error("Malformed event log.");
      }
      if (Array.isArray(e?.data)) out.push({ executor, standard: e.standard, event: e.event, data: e.data });
    }
  }
  return out;
}
function receiptsComplete(result: any) {
  return (result.receipts_outcome ?? []).every(
    (r: any) =>
      r.outcome?.status &&
      (typeof r.outcome.status.SuccessValue === "string" || typeof r.outcome.status.SuccessReceiptId === "string") &&
      Array.isArray(r.outcome.logs),
  );
}
/** Verifies the final (economic) transaction of a lending preparation from finalized receipts only. */
export function verifyLendingOutcome(result: any, prep: LendingPreparation, index: number): Outcome {
  const failed = (message: string): Outcome => ({ index, state: "failed", message });
  if (index !== prep.transactions.length - 1)
    return { index, state: "confirmed", message: "Storage registration finalized." };
  if (!receiptsComplete(result)) return { index, state: "pending", message: "Receipt status or logs are incomplete; the effect is unverified." };
  let ev;
  try {
    ev = events(result);
  } catch {
    return failed("A receipt event is malformed; the effect is unverified.");
  }
  const rhea = (name: string) =>
    ev.filter(
      (e) =>
        e.executor === RHEA &&
        e.standard === "burrow" &&
        e.event === name &&
        e.data.some((d) => d?.account_id === prep.accountId && d?.token_id === prep.tokenId),
    );
  const amountOf = (name: string) =>
    rhea(name).flatMap((e) => e.data.filter((d) => d?.account_id === prep.accountId && d?.token_id === prep.tokenId).map((d) => String(d.amount)));
  if (rhea("withdraw_failed").length)
    return failed("Rhea reported withdraw_failed; funds stayed in the lending position. Inspect Rhea before retrying.");
  const a = BigInt(prep.amountRaw);
  const tx = prep.transactions.at(-1)!;
  const innerArg =
    tx.receiverId === RHEA
      ? String((tx.actions[0].params.args as any).actions[0][Object.keys((tx.actions[0].params.args as any).actions[0])[0]][
          prep.kind === "borrow" ? "amount" : "max_amount"
        ])
      : String(JSON.parse(String(tx.actions[0].params.args.msg)).Execute.actions[0][prep.kind === "repay" ? "Repay" : "IncreaseCollateral"].max_amount);
  if (prep.kind === "collateral_add" || prep.kind === "repay") {
    // ft_transfer_call resolves to the amount actually used by Rhea.
    let used: unknown;
    try {
      used = JSON.parse(atob(result.status.SuccessValue));
    } catch {
      return failed("Could not verify the resolved token transfer amount.");
    }
    if (used !== prep.amountRaw) return failed("The transfer was partly or fully refunded. Refresh balances and inspect the transaction.");
    const name = prep.kind === "repay" ? "repay" : "increase_collateral";
    const amounts = amountOf(name);
    if (amounts.length !== 1) return failed(`Rhea's ${name} event for this account and token could not be verified.`);
    if (prep.kind === "collateral_add" && amounts[0] !== innerArg)
      return failed("Rhea added a different collateral amount than reviewed.");
    if (prep.kind === "repay" && !(BigInt(amounts[0]) > 0n && BigInt(amounts[0]) <= BigInt(innerArg)))
      return failed("Rhea's repaid amount is outside the reviewed bounds.");
    return {
      index,
      state: "confirmed",
      message: prep.kind === "repay" ? "Repayment finalized; Rhea's repay event verified." : "Collateral added; Rhea's increase_collateral event verified.",
      effect: { kind: prep.kind, tokenId: prep.tokenId, rheaInner: amounts[0] },
    };
  }
  // borrow / release: Rhea event + withdraw_succeeded + exact NEP-141 transfer to the owner.
  if (result.status?.SuccessValue === btoa("false")) return failed("Rhea's callback reported failure or refund.");
  const name = prep.kind === "borrow" ? "borrow" : "decrease_collateral";
  const moved = amountOf(name);
  if (moved.length !== 1 || moved[0] !== innerArg) return failed(`Rhea's ${name} event does not match the reviewed amount.`);
  const done = amountOf("withdraw_succeeded");
  if (done.length !== 1 || done[0] !== innerArg) return failed("Rhea's withdraw_succeeded event could not be verified.");
  let transfers = 0;
  for (const e of ev)
    if (e.executor === prep.tokenId && e.standard === "nep141" && e.event === "ft_transfer")
      for (const d of e.data)
        if (d?.old_owner_id === RHEA && d?.new_owner_id === prep.accountId) {
          if (String(d.amount) !== a.toString()) return failed("A different token amount was paid out than reviewed.");
          transfers++;
        }
  if (transfers !== 1) return failed("The exact payout from Rhea to your account could not be verified.");
  return {
    index,
    state: "confirmed",
    message: prep.kind === "borrow" ? "Borrow finalized; USDC payout to your wallet verified." : "Collateral released to your wallet; payout verified.",
    effect: { kind: prep.kind, tokenId: prep.tokenId, rheaInner: moved[0], paidOutRaw: a.toString() },
  };
}

/* ───────────── funding choice for payments ───────────── */

/** Borrowing as a payment funding source, comparable with idle cash and withdrawal. Never eligible
 * without explicit new-debt approval; interest is estimated to the due date at the current variable APR. */
export function borrowFundingChoice(
  cap: ReturnType<typeof borrowCapacity> | null,
  amountUsdcRaw: bigint,
  dueDate: string | null,
  approvedNewDebt: boolean,
  now = Date.now(),
): FundingChoice {
  const reasons: string[] = [];
  if (!cap) reasons.push("CREDIT_UNAVAILABLE");
  else {
    reasons.push(...cap.reasons);
    if (cap.capacityUsdcRaw === null) reasons.push("CAPACITY_UNVERIFIED");
    else if (amountUsdcRaw > BigInt(cap.capacityUsdcRaw)) reasons.push("CAPACITY_SHORT:" + cap.bindingConstraint);
    if (cap.minBorrowUsdcRaw && amountUsdcRaw < BigInt(cap.minBorrowUsdcRaw)) reasons.push("BELOW_MIN_BORROW");
  }
  if (!approvedNewDebt) reasons.push("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL");
  let interest: bigint | null = null;
  if (cap?.borrowApr && dueDate) {
    const days = Math.max(1, Math.ceil((Date.parse(dueDate + "T23:59:59Z") - now) / 86400000));
    try {
      interest = carry(amountUsdcRaw, cap.borrowApr, Math.min(days, 3650));
    } catch {
      interest = null;
    }
  }
  return {
    id: "borrow",
    kind: "borrow",
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    amountUsdcRaw: amountUsdcRaw.toString(),
    costsUsdcRaw: interest === null ? null : interest.toString(),
    foregoneUsdcRaw: "0",
    interestUsdcRaw: interest === null ? null : interest.toString(),
    healthAfter: cap?.stressedHealth ?? null,
    availableAt: new Date(now).toISOString().slice(0, 10),
    steps: ["borrow", "pay_quote", "pay_deposit", "verify_payout"],
  };
}
