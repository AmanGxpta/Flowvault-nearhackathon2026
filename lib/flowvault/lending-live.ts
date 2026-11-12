// Engines E2: finalized public reads for Rhea credit. Read-only; no keys or send capability. Used at
// preview, at prepare, and again at wallet handoff (authorize re-prepares and compares payloads).
import { rheaLendingVenue } from "./lending-venue-rhea.ts";
import { rpc, view, validAccount } from "./near.ts";
import { readPriceEvidence } from "./valuation-evidence.ts";
import { COLLATERAL_FAMILY, LENDING_USDC, RHEA, prepareLending, borrowCapacity } from "./lending.ts";
import type { LendingState, PrepareRequest, RheaAsset } from "./lending.ts";
import type { Policy } from "./policy.ts";

const raw = (v: unknown, what: string) => {
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error(what + " is unverified.");
  return BigInt(v);
};
type Bal = { token_id: string; balance: string };

export async function readLendingState(accountId: string): Promise<LendingState> {
  if (!validAccount(accountId)) throw new Error("Enter a valid public NEAR account.");
  const tokens = [LENDING_USDC, ...Object.values(COLLATERAL_FAMILY)];
  const [config, assets, account, reg, bounds, native, prices, ...perToken] = await Promise.all([
    view<any>(RHEA, "get_config"),
    view<any[]>(RHEA, "get_assets_paged_detailed", { from_index: 0, limit: 100 }),
    view<any>(RHEA, "get_account_all_positions", { account_id: accountId }),
    view<any>(RHEA, "storage_balance_of", { account_id: accountId }),
    view<any>(RHEA, "storage_balance_bounds"),
    rpc({ request_type: "view_account", account_id: accountId }),
    readPriceEvidence().catch(() => null),
    ...tokens.map((t) =>
      Promise.all([
        view<any>(t, "ft_metadata"),
        view<string>(t, "ft_balance_of", { account_id: accountId }),
        view<any>(t, "storage_balance_of", { account_id: accountId }),
        view<any>(t, "storage_balance_bounds"),
      ]),
    ),
  ]);
  const byId: Record<string, RheaAsset> = {};
  const decimals: Record<string, number> = {};
  tokens.forEach((t, i) => {
    const d = perToken[i][0].data?.decimals;
    if (!Number.isInteger(d)) throw new Error(t + " decimals are unverified.");
    decimals[t] = d;
  });
  for (const a of assets.data) {
    const c = a?.config;
    if (!c || typeof a.token_id !== "string") continue;
    const relevant = a.token_id in decimals || a.token_id === "wrap.near" || a.token_id === "usdt.tether-token.near";
    if (!relevant) continue;
    if (!Number.isInteger(c.extra_decimals) || c.extra_decimals < 0 || c.extra_decimals > 32)
      throw new Error("Rhea extra_decimals are unverified.");
    if (!Number.isInteger(c.volatility_ratio) || c.volatility_ratio <= 0 || c.volatility_ratio > 10000)
      throw new Error("Rhea volatility ratio is unverified.");
    byId[a.token_id] = {
      tokenId: a.token_id,
      decimals: decimals[a.token_id] ?? (a.token_id === "wrap.near" ? 24 : 6),
      extraDecimals: c.extra_decimals,
      volatilityRatio: c.volatility_ratio,
      canDeposit: c.can_deposit === true,
      canWithdraw: c.can_withdraw === true,
      canUseAsCollateral: c.can_use_as_collateral === true,
      canBorrow: c.can_borrow === true,
      suppliedInner: raw(a.supplied?.balance, "Rhea supplied balance"),
      reservedInner: raw(a.reserved, "Rhea reserve"),
      borrowedInner: raw(a.borrowed?.balance, "Rhea borrowed balance"),
      borrowedLimitInner: typeof c.borrowed_limit === "string" ? raw(c.borrowed_limit, "Rhea borrowed limit") : null,
      minBorrowedInner: typeof c.min_borrowed_amount === "string" ? raw(c.min_borrowed_amount, "Rhea minimum borrow") : 0n,
      borrowApr: String(a.borrow_apr),
      supplyApr: String(a.supply_apr),
    };
  }
  for (const t of tokens) if (!byId[t]) throw new Error(t + " is not a Rhea market.");
  const acc = account.data;
  const supplied: Record<string, bigint> = {},
    collateral: Record<string, bigint> = {},
    borrowed: Record<string, bigint> = {};
  const otherPositions: string[] = [];
  const add = (m: Record<string, bigint>, b: Bal) => (m[b.token_id] = (m[b.token_id] ?? 0n) + raw(b.balance, "Rhea account balance"));
  if (acc) {
    if (!Array.isArray(acc.supplied) || !acc.positions || typeof acc.positions !== "object")
      throw new Error("Rhea account positions could not be verified.");
    acc.supplied.forEach((b: Bal) => add(supplied, b));
    for (const [key, p] of Object.entries<any>(acc.positions)) {
      if (!Array.isArray(p?.collateral) || !Array.isArray(p?.borrowed)) throw new Error("Rhea position shape is unverified.");
      if (key !== "REGULAR") {
        if (p.collateral.length || p.borrowed.length) otherPositions.push(key);
        continue;
      }
      p.collateral.forEach((b: Bal) => add(collateral, b));
      p.borrowed.forEach((b: Bal) => add(borrowed, b));
    }
  }
  const tokenRegistered: Record<string, boolean> = {},
    tokenStorageMinimum: Record<string, bigint> = {},
    wallet: Record<string, bigint> = {};
  tokens.forEach((t, i) => {
    wallet[t] = raw(perToken[i][1].data, t + " wallet balance");
    tokenRegistered[t] = perToken[i][2].data !== null;
    tokenStorageMinimum[t] = raw(perToken[i][3].data?.min, t + " storage minimum");
  });
  const usable = raw(native.amount, "NEAR balance") - BigInt(native.storage_usage ?? 0) * 10n ** 19n;
  return {
    source: "live",
    accountId,
    capturedAt: new Date().toISOString(),
    blockHeight: assets.blockHeight,
    contractMode: String(config.data?.contract_mode),
    pythMode: config.data?.enable_pyth_oracle === true,
    registered: reg.data !== null,
    registrationMinimum: raw(bounds.data?.min, "Rhea storage minimum"),
    tokenRegistered,
    tokenStorageMinimum,
    nativeAvailableYocto: usable > 0n ? usable : 0n,
    assets: byId,
    supplied,
    collateral,
    borrowed,
    otherPositions,
    wallet,
    prices,
  };
}

export async function lendingPreview(accountId: string, policy?: Policy) {
  const st = await readLendingState(accountId);
  return { state: st, capacity: borrowCapacity(st, policy) };
}

/** Re-reads everything and rebuilds the payload (prepare and wallet handoff both use this). */
export async function freshLending(accountId: string, policy: Policy | undefined, req: PrepareRequest) {
  return rheaLendingVenue.prepareOperation(await rheaLendingVenue.read(accountId), policy, req);
}

/** JSON-safe view of the state (bigints as strings). */
export function serializeLending<T>(value: T): any {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Wallet-handoff re-preparation for a journaled lending attempt (transactions route, authorize). */
export async function freshLendingAttempt(
  prep: import("./lending.ts").LendingPreparation,
  policy: Policy | undefined,
  holdbackRaw: bigint | undefined,
) {
  return freshLending(prep.accountId, policy, {
    kind: prep.kind,
    asset: prep.request.asset,
    amountRaw: BigInt(prep.request.amountRaw),
    approveNewDebt: prep.request.approveNewDebt,
    holdbackRaw,
  });
}

/** Payment funding: the 'borrow' FundingChoice for a live workspace, compared with idle cash and
 * withdrawal. Fails closed to an ineligible choice with reasons; never throws. */
export async function borrowChoice(
  w: import("./types.ts").Workspace,
  amountUsdcRaw: bigint,
  dueDate: string | null,
  approvedNewDebt = false,
) {
  const { borrowFundingChoice } = await import("./lending.ts");
  if (w.mode !== "live" || !w.accountId) return borrowFundingChoice(null, amountUsdcRaw, dueDate, approvedNewDebt);
  try {
    const { capacity } = await lendingPreview(w.accountId, w.policy);
    return borrowFundingChoice(capacity, amountUsdcRaw, dueDate, approvedNewDebt);
  } catch (e) {
    const c = borrowFundingChoice(null, amountUsdcRaw, dueDate, approvedNewDebt);
    c.reasons.push("CREDIT_READ_FAILED: " + (e as Error).message);
    return c;
  }
}
