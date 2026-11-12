// Pooled strategy vaults — off-chain accounting (owner: Stream A, reassigned from Stream C on 13 Nov 01:45 IST).
// Pure: no network, D1 or wallet access. This is FlowVault's reference model of a vault's book; the NEAR contract
// (contracts/vault, Codex) holds custody and the real share token, and the adapter reconciles this model with the
// contract's views. Where they disagree, the contract is the truth and the difference is surfaced, never hidden.
//
// Units: assets are USDC base units (6 dp); shares are integer base units of the vault's NEP-141 share token.
// Share price uses a virtual offset (ERC-4626 style) so the first depositor can't be diluted by a donation.
// The arithmetic mirrors contracts/vault v1 (docs/handoff/vault-interface.md) exactly, so a holder view computed
// here equals the contract's share balances: no management fee, performance fee rounded up in assets and in shares,
// high-water mark rounded up, fees crystallized only when the owner reports NAV (a curator report never mints fees),
// deposits that fail a cap wait in the queue, and redemptions settle whole requests strictly first in, first out.
// Every conversion rounds against the person acting (deposits get fewer shares, redemptions get fewer assets), so
// rounding dust always stays with the remaining holders. Unknown values block: a NAV with any unvalued position or
// unknown liability is null, and nothing is priced against a null NAV.
import type { LedgerEntry, Valuation } from "./contracts.ts";

export const YEAR_SECONDS = 365n * 86_400n;
export const E18 = 10n ** 18n;
const BPS = 10_000n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Constants of the v1 vault contract (contracts/vault/src/math.rs and get_config). */
export const CONTRACT_V1 = { virtualShares: 1_000_000_000_000n, virtualAssets: 1n, shareDecimals: 18, managementBps: 0, maxPerformanceBps: 3000 } as const;

export interface VaultTerms {
  id: string;
  specId: string;
  specVersion: number;
  asset: "USDC";
  assetDecimals: 6;
  shareDecimals: number;
  /** Virtual shares/assets added to the totals in every conversion (inflation-attack defense). */
  virtualShares: bigint;
  virtualAssets: bigint;
  /** "single_depositor": one owner's own funds in custody (the mandate's bounded execution authority). */
  mode: "pooled" | "single_depositor";
  fees: {
    /** Annual management fee. Must be 0 while the vault contract (v1) has none. */
    managementBps: number;
    /** On gains above the high-water mark per share; losses must be recovered before it is charged again. */
    performanceBps: number;
    /** How crystallized fees are split; must sum to 10,000. */
    curatorShareBps: number;
    platformShareBps: number;
  };
  capacityRaw: bigint;
  perDepositorCapRaw: bigint | null;
  maxPositionBps: number;
  redemption: { noticeSeconds: number; /** Fraction of NAV the curator keeps liquid for redemptions. */ liquidityTargetBps: number };
  /** Disclosed authority: who can do what. Shown to every depositor before they deposit. */
  admin: { owner: string; curator: string; pauseGuardian: string | null; upgradeAuthority: string | null; feeRecipients: { curator: string; platform: string } };
}

export interface VaultRequest {
  id: string;
  account: string;
  /** Deposit: USDC raw received and held outside NAV until settlement. Redemption: shares escrowed. */
  amountRaw: bigint;
  requestedAt: number;
  /** Redemptions: earliest settlement (notice period). */
  notBefore?: number;
  /** Deposit: minimum shares; redemption: minimum USDC. The request waits (never settles below it). */
  minOutputRaw?: bigint;
}

export interface VaultBook {
  totalShares: bigint;
  holders: Record<string, bigint>;
  /** USDC in the vault counted in NAV (excludes pending deposits and settled-but-unclaimed redemptions). */
  idleRaw: bigint;
  /** Strategy positions held by the vault, valued by the shared valuation layer. */
  positions: { positionId: string; usdcRaw: bigint | null; basis: string }[];
  /** Debt or other obligations of the vault (null = unknown, which makes NAV unknown). */
  liabilitiesRaw: bigint | null;
  pendingDeposits: VaultRequest[];
  pendingRedemptions: VaultRequest[];
  /** Redeemed USDC owed to accounts after settlement (outside NAV until claimed). */
  claimable: Record<string, bigint>;
  /** High-water mark: price per share × 1e18, in assets per share unit. */
  hwmE18: bigint;
  lastFeeAt: number;
  paused: boolean;
  shutdown: boolean;
  /** Whether the current NAV report was filed by the owner (only those crystallize fees; contract v1.3). */
  reportByOwner?: boolean;
  /** Set when the contract itself reports NAV unavailable (stale or missing report, unresolved operation, sync needed). */
  navUnavailable?: string[];
}

export function emptyBook(terms: VaultTerms, now: number): VaultBook {
  return {
    totalShares: 0n, holders: {}, idleRaw: 0n, positions: [], liabilitiesRaw: 0n, pendingDeposits: [], pendingRedemptions: [], claimable: {},
    hwmE18: ppsCeilE18(terms, 0n, 0n), lastFeeAt: now, paused: false, shutdown: false,
  };
}

/** Assets the vault's positions are worth, from the shared valuation layer (executable when present, else observed). */
export function positionsFromValuations(vals: Valuation[]): VaultBook["positions"] {
  const byPos = new Map<string, Valuation>();
  for (const v of vals) {
    if (v.countedVia) continue;
    const cur = byPos.get(v.positionId);
    if (!cur || (v.kind === "executable" && cur.kind !== "executable")) byPos.set(v.positionId, v);
  }
  return [...byPos.values()].map((v) => ({ positionId: v.positionId, usdcRaw: v.usdcRaw === null ? null : BigInt(v.usdcRaw), basis: v.basis + (v.unavailableReason ? " — " + v.unavailableReason : "") }));
}

export interface Nav {
  navRaw: bigint | null;
  grossRaw: bigint | null;
  reasons: string[];
}
export function nav(book: VaultBook): Nav {
  const reasons: string[] = [...(book.navUnavailable ?? [])];
  let gross = book.idleRaw;
  for (const p of book.positions) {
    if (p.usdcRaw === null) reasons.push(`POSITION_UNVALUED: ${p.positionId} (${p.basis})`);
    else gross += p.usdcRaw;
  }
  if (book.liabilitiesRaw === null) reasons.push("LIABILITIES_UNKNOWN");
  if (reasons.length) return { navRaw: null, grossRaw: null, reasons };
  const n = gross - book.liabilitiesRaw!;
  if (n < 0n) return { navRaw: null, grossRaw: gross, reasons: ["NAV_NEGATIVE: liabilities exceed assets"] };
  return { navRaw: n, grossRaw: gross, reasons };
}

export const ppsE18 = (t: VaultTerms, navRaw: bigint, shares: bigint) => ((navRaw + t.virtualAssets) * E18) / (shares + t.virtualShares);
/** Price rounded up: the contract's high-water mark is never rounded down. */
export const ppsCeilE18 = (t: VaultTerms, navRaw: bigint, shares: bigint) => ceilDiv((navRaw + t.virtualAssets) * E18, shares + t.virtualShares);
/** Shares for a deposit (rounded down: the depositor never gets more than they paid for). */
export const sharesFor = (t: VaultTerms, assetsRaw: bigint, navRaw: bigint, shares: bigint) => (assetsRaw * (shares + t.virtualShares)) / (navRaw + t.virtualAssets);
/** Assets for shares (rounded down: the redeemer never takes more than their share). */
export const assetsFor = (t: VaultTerms, sharesRaw: bigint, navRaw: bigint, shares: bigint) => (sharesRaw * (navRaw + t.virtualAssets)) / (shares + t.virtualShares);

export function validateTerms(t: VaultTerms): string[] {
  const p: string[] = [];
  if (t.fees.curatorShareBps + t.fees.platformShareBps !== 10_000) p.push("Fee split must add up to 100%.");
  if (t.fees.managementBps !== CONTRACT_V1.managementBps) p.push("The vault contract (v1) charges no management fee: set it to 0.");
  if (t.fees.performanceBps < 0 || t.fees.performanceBps > CONTRACT_V1.maxPerformanceBps) p.push("Performance fee must be 0–30%.");
  if (t.virtualShares <= 0n || t.virtualAssets <= 0n) p.push("A virtual share offset is required (protects the first depositor).");
  else if (t.virtualShares !== CONTRACT_V1.virtualShares || t.virtualAssets !== CONTRACT_V1.virtualAssets) p.push(`The share offset must match the vault contract (${CONTRACT_V1.virtualShares} virtual shares, ${CONTRACT_V1.virtualAssets} virtual asset).`);
  if (t.shareDecimals !== CONTRACT_V1.shareDecimals) p.push(`Vault shares have ${CONTRACT_V1.shareDecimals} decimals.`);
  if (t.admin.feeRecipients.curator !== t.admin.curator) p.push("The contract mints the curator's fee shares to the curator account itself.");
  if (t.redemption.liquidityTargetBps < 0 || t.redemption.liquidityTargetBps > 10_000) p.push("Liquidity target must be 0–100%.");
  if (t.capacityRaw <= 0n) p.push("Capacity must be above zero.");
  if (t.maxPositionBps <= 0 || t.maxPositionBps > 10_000) p.push("Position concentration cap must be 1–100%.");
  if (t.redemption.noticeSeconds < 0) p.push("Notice period can't be negative.");
  if (!t.admin.owner || !t.admin.curator) p.push("Owner and curator accounts must be disclosed.");
  if (t.mode === "single_depositor" && t.fees.performanceBps + t.fees.managementBps > 0) p.push("A single-depositor custody vault charges its owner no fees.");
  return p;
}

/* ───────────── fees ───────────── */

export interface FeeCrystallization {
  at: number;
  navBeforeRaw: string;
  ppsBeforeE18: string;
  hwmBeforeE18: string;
  managementFeeRaw: string;
  performanceFeeRaw: string;
  sharesMinted: { curator: string; platform: string };
  ppsAfterE18: string;
  hwmAfterE18: string;
  basis: string;
}

/**
 * The contract's performance fee (math.rs fee_shares): profit = floor((price − mark) × shares / 1e18) at the floored
 * price, fee = ceil(profit × bps / 10,000) in assets, minted as ceil(fee × (shares + virtual) / (NAV − fee + virtual))
 * shares. Curator gets floor(minted × curator bps / 10,000), the platform the rest. The mark moves only up, to the
 * post-fee price rounded up; losses below it are recovered before any new fee. No management fee (contract v1).
 */
export function crystallize(t: VaultTerms, book: VaultBook, navRaw: bigint, now: number): { book: VaultBook; record: FeeCrystallization | null } {
  const at = Math.max(now, book.lastFeeAt);
  const supply = book.totalShares;
  const ppsBefore = ppsE18(t, navRaw, supply);
  if (supply === 0n || t.fees.performanceBps === 0 || ppsBefore <= book.hwmE18) return { book: { ...book, lastFeeAt: at }, record: null };
  const profit = ((ppsBefore - book.hwmE18) * supply) / E18;
  const fee = ceilDiv(profit * BigInt(t.fees.performanceBps), BPS);
  if (fee >= navRaw) throw new Error("FEE_EXCEEDS_NAV");
  const minted = ceilDiv(fee * (supply + t.virtualShares), navRaw - fee + t.virtualAssets);
  if (minted === 0n) return { book: { ...book, lastFeeAt: at }, record: null };
  const toCurator = (minted * BigInt(t.fees.curatorShareBps)) / BPS;
  const toPlatform = minted - toCurator;
  const holders = { ...book.holders };
  holders[t.admin.curator] = (holders[t.admin.curator] ?? 0n) + toCurator;
  holders[t.admin.feeRecipients.platform] = (holders[t.admin.feeRecipients.platform] ?? 0n) + toPlatform;
  const total = supply + minted;
  const ppsAfter = ppsE18(t, navRaw, total);
  const mark = ppsCeilE18(t, navRaw, total);
  const hwm = mark > book.hwmE18 ? mark : book.hwmE18;
  return {
    book: { ...book, holders, totalShares: total, hwmE18: hwm, lastFeeAt: at },
    record: {
      at, navBeforeRaw: navRaw.toString(), ppsBeforeE18: ppsBefore.toString(), hwmBeforeE18: book.hwmE18.toString(), managementFeeRaw: "0", performanceFeeRaw: fee.toString(),
      sharesMinted: { curator: toCurator.toString(), platform: toPlatform.toString() }, ppsAfterE18: ppsAfter.toString(), hwmAfterE18: hwm.toString(),
      basis: `performance ${t.fees.performanceBps} bps on the gain above the high-water mark, crystallized on the owner's NAV report`,
    },
  };
}

export interface NavReportInput {
  positions: VaultBook["positions"];
  liabilitiesRaw: bigint | null;
  /** Who attested the values. Only an owner report crystallizes fees (contract rule); a curator report can't mint its own fee. */
  by: "owner" | "curator";
  at: number;
}
/** Applies a trusted NAV report (positions and liabilities) and, for an owner report, crystallizes the performance fee. */
export function applyReport(t: VaultTerms, book: VaultBook, r: NavReportInput): { book: VaultBook; fees: FeeCrystallization | null } {
  const b: VaultBook = { ...book, positions: r.positions, liabilitiesRaw: r.liabilitiesRaw, reportByOwner: r.by === "owner" };
  const n = nav(b);
  if (r.by !== "owner" || n.navRaw === null) return { book: b, fees: null };
  const c = crystallize(t, b, n.navRaw, r.at);
  return { book: c.book, fees: c.record };
}

/* ───────────── requests and settlement ───────────── */

export function requestDeposit(t: VaultTerms, book: VaultBook, r: VaultRequest): VaultBook {
  if (book.paused || book.shutdown) throw new Error("The vault isn't accepting deposits.");
  if (r.amountRaw <= 0n) throw new Error("Deposit must be above zero.");
  if (t.mode === "single_depositor" && r.account !== t.admin.owner) throw new Error("This custody vault takes deposits only from its owner.");
  return { ...book, pendingDeposits: [...book.pendingDeposits, r] };
}

export function requestRedemption(t: VaultTerms, book: VaultBook, r: VaultRequest): VaultBook {
  const held = book.holders[r.account] ?? 0n;
  const escrowed = book.pendingRedemptions.filter((x) => x.account === r.account).reduce((n, x) => n + x.amountRaw, 0n);
  if (r.amountRaw <= 0n || r.amountRaw > held - escrowed) throw new Error("You can redeem at most the shares you hold and haven't already queued.");
  return { ...book, pendingRedemptions: [...book.pendingRedemptions, { ...r, notBefore: r.requestedAt + t.redemption.noticeSeconds * 1000 }] };
}

export interface SettlementEvent {
  kind: "deposit_settled" | "deposit_waiting" | "redemption_settled" | "redemption_waiting";
  requestId: string;
  account: string;
  assetsRaw: string;
  sharesRaw: string;
  ppsE18: string;
  reason?: string;
}

/** Cancelling a queued deposit turns it into a fixed refundable claim (outside NAV); no admin can redirect it. */
export function cancelDeposit(book: VaultBook, id: string, account: string): VaultBook {
  const d = book.pendingDeposits.find((x) => x.id === id);
  if (!d || d.account !== account) throw new Error("Only the depositor can cancel a queued deposit.");
  return { ...book, pendingDeposits: book.pendingDeposits.filter((x) => x !== d), claimable: { ...book.claimable, [account]: (book.claimable[account] ?? 0n) + d.amountRaw } };
}

/**
 * Settles what the contract would settle now (settle_deposit per request, then process_redemptions), without
 * crystallizing fees (only an owner NAV report does). Deposits mint at the current price; one that would exceed
 * capacity or the depositor cap, mint zero or below its minimum, or arrive above the high-water mark while the
 * current report is a curator's, waits in the queue (its owner may cancel it).
 * Redemptions settle whole requests strictly first in, first out: the head waits for its notice, its minimum and
 * enough idle USDC, and nothing behind it skips ahead. Settled redemptions become fixed claims. Refuses when NAV is
 * unknown.
 */
export function settle(t: VaultTerms, book0: VaultBook, now: number): { book: VaultBook; events: SettlementEvent[]; fees: FeeCrystallization | null; reasons: string[] } {
  const n = nav(book0);
  if (n.navRaw === null) return { book: book0, events: [], fees: null, reasons: ["NAV_UNKNOWN", ...n.reasons] };
  const book = { ...book0, holders: { ...book0.holders }, claimable: { ...book0.claimable } };
  let navRaw = n.navRaw;
  const events: SettlementEvent[] = [];
  const waiting: VaultRequest[] = [];
  for (const d of book.pendingDeposits) {
    const price = ppsE18(t, navRaw, book.totalShares).toString();
    const s = sharesFor(t, d.amountRaw, navRaw, book.totalShares);
    const held = assetsFor(t, book.holders[d.account] ?? 0n, navRaw, book.totalShares);
    const reason =
      book.paused || book.shutdown ? "DEPOSITS_PAUSED"
      : book.totalShares > 0n && navRaw === 0n ? "ZERO_NAV_WITH_SHARES"
      // Above the mark on a curator's report the depositor would later pay a fee on gains made before it joined.
      : t.fees.performanceBps > 0 && !book.reportByOwner && ppsE18(t, navRaw, book.totalShares) > book.hwmE18 ? "OWNER_REPORT_REQUIRED_ABOVE_HWM"
      : navRaw + d.amountRaw > t.capacityRaw ? "CAPACITY"
      : s === 0n || s < (d.minOutputRaw ?? 0n) ? "MIN_SHARES"
      : t.perDepositorCapRaw !== null && held + d.amountRaw > t.perDepositorCapRaw ? "DEPOSITOR_CAP"
      : null;
    if (reason) {
      events.push({ kind: "deposit_waiting", requestId: d.id, account: d.account, assetsRaw: d.amountRaw.toString(), sharesRaw: "0", ppsE18: price, reason });
      waiting.push(d);
      continue;
    }
    book.holders[d.account] = (book.holders[d.account] ?? 0n) + s;
    book.totalShares += s;
    book.idleRaw += d.amountRaw;
    navRaw += d.amountRaw;
    events.push({ kind: "deposit_settled", requestId: d.id, account: d.account, assetsRaw: d.amountRaw.toString(), sharesRaw: s.toString(), ppsE18: price });
  }
  book.pendingDeposits = waiting;
  let i = 0;
  for (; i < book.pendingRedemptions.length; i++) {
    const r = book.pendingRedemptions[i];
    const price = ppsE18(t, navRaw, book.totalShares).toString();
    const assets = assetsFor(t, r.amountRaw, navRaw, book.totalShares);
    const reason = (r.notBefore ?? 0) > now ? "NOTICE" : assets === 0n ? "ZERO_ASSETS" : assets < (r.minOutputRaw ?? 0n) ? "BELOW_MINIMUM" : assets > book.idleRaw ? "LIQUIDITY" : null;
    if (reason) {
      events.push({ kind: "redemption_waiting", requestId: r.id, account: r.account, assetsRaw: assets.toString(), sharesRaw: r.amountRaw.toString(), ppsE18: price, reason });
      break;
    }
    book.holders[r.account] -= r.amountRaw;
    book.totalShares -= r.amountRaw;
    book.idleRaw -= assets;
    navRaw -= assets;
    book.claimable[r.account] = (book.claimable[r.account] ?? 0n) + assets;
    events.push({ kind: "redemption_settled", requestId: r.id, account: r.account, assetsRaw: assets.toString(), sharesRaw: r.amountRaw.toString(), ppsE18: price });
  }
  book.pendingRedemptions = book.pendingRedemptions.slice(i);
  return { book, events, fees: null, reasons: [] };
}

/* ───────────── holder view, monitoring, ledger ───────────── */

export interface HolderView {
  account: string;
  sharesRaw: string;
  valueRaw: string | null;
  ownershipBps: number | null;
  /** The holder's share of each vault position (what their money is actually exposed to). */
  exposure: { positionId: string; usdcRaw: string | null; basis: string }[];
  queued: { redemptionSharesRaw: string; earliestAt: number | null; positionInQueueRaw: string };
  pendingDepositRaw: string;
  claimableRaw: string;
  costs: { managementBps: number; performanceBps: number; hwmE18: string; ppsE18: string | null; aboveHwm: boolean | null };
  exit: { noticeSeconds: number; idleRaw: string; liquidityShortRaw: string | null; terms: string };
}

export function holderView(t: VaultTerms, book: VaultBook, account: string, now: number): HolderView {
  const n = nav(book);
  const shares = book.holders[account] ?? 0n;
  const value = n.navRaw === null ? null : assetsFor(t, shares, n.navRaw, book.totalShares);
  const frac = (x: bigint | null) => (x === null || book.totalShares === 0n ? null : (x * shares) / book.totalShares);
  const mineQ = book.pendingRedemptions.filter((r) => r.account === account);
  const firstIdx = book.pendingRedemptions.findIndex((r) => r.account === account);
  const ahead = firstIdx < 0 ? 0n : book.pendingRedemptions.slice(0, firstIdx).reduce((s, r) => s + r.amountRaw, 0n);
  const queuedAssets = n.navRaw === null ? null : book.pendingRedemptions.reduce((s, r) => s + assetsFor(t, r.amountRaw, n.navRaw!, book.totalShares), 0n);
  const pps = n.navRaw === null ? null : ppsE18(t, n.navRaw, book.totalShares);
  void now;
  return {
    account,
    sharesRaw: shares.toString(),
    valueRaw: value === null ? null : value.toString(),
    ownershipBps: book.totalShares === 0n ? null : Number((shares * BPS) / book.totalShares),
    exposure: book.positions.map((p) => ({ positionId: p.positionId, usdcRaw: frac(p.usdcRaw)?.toString() ?? null, basis: p.basis })).concat([{ positionId: "idle-usdc", usdcRaw: frac(book.idleRaw)?.toString() ?? null, basis: "USDC held by the vault" }]),
    queued: { redemptionSharesRaw: mineQ.reduce((s, r) => s + r.amountRaw, 0n).toString(), earliestAt: mineQ.length ? Math.min(...mineQ.map((r) => r.notBefore ?? r.requestedAt)) : null, positionInQueueRaw: ahead.toString() },
    pendingDepositRaw: book.pendingDeposits.filter((d) => d.account === account).reduce((s, d) => s + d.amountRaw, 0n).toString(),
    claimableRaw: (book.claimable[account] ?? 0n).toString(),
    costs: { managementBps: t.fees.managementBps, performanceBps: t.fees.performanceBps, hwmE18: book.hwmE18.toString(), ppsE18: pps?.toString() ?? null, aboveHwm: pps === null ? null : pps > book.hwmE18 },
    exit: {
      noticeSeconds: t.redemption.noticeSeconds,
      idleRaw: book.idleRaw.toString(),
      liquidityShortRaw: queuedAssets === null ? null : (queuedAssets > book.idleRaw ? queuedAssets - book.idleRaw : 0n).toString(),
      terms: `A redemption escrows your shares and settles after ${t.redemption.noticeSeconds >= 3600 ? Math.round(t.redemption.noticeSeconds / 3600) + " h" : t.redemption.noticeSeconds + " s"} notice, whole requests only, first in, first out, at the price when it settles; it then becomes a fixed USDC claim you collect with claim. It is paid only from USDC the vault holds: when that is too little for the request at the head of the queue, every request behind it waits until the curator exits positions or the head is cancelled or its minimum lowered.${book.shutdown ? " The vault is shut down: no new deposits, positions are being exited and exits stay open." : ""}`,
    },
  };
}

export interface VaultAlert {
  severity: "info" | "warn" | "urgent";
  code: string;
  message: string;
}
export function vaultAlerts(t: VaultTerms, book: VaultBook, now: number): VaultAlert[] {
  const out: VaultAlert[] = [];
  const n = nav(book);
  if (n.navRaw === null) out.push({ severity: "urgent", code: "NAV_UNKNOWN", message: "NAV can't be computed: " + n.reasons.join("; ") + ". Deposits and redemptions wait until it can." });
  if (book.paused) out.push({ severity: "warn", code: "PAUSED", message: "The vault is paused." });
  if (n.navRaw !== null) {
    const due = book.pendingRedemptions.filter((r) => (r.notBefore ?? 0) <= now).reduce((s, r) => s + assetsFor(t, r.amountRaw, n.navRaw!, book.totalShares), 0n);
    if (due > book.idleRaw) out.push({ severity: "urgent", code: "REDEMPTION_SHORTFALL", message: `Due redemptions need ${due - book.idleRaw} more USDC raw than the vault holds idle; the curator must exit positions.` });
    const target = (n.navRaw * BigInt(t.redemption.liquidityTargetBps)) / BPS;
    if (book.idleRaw < target) out.push({ severity: "info", code: "LIQUIDITY_BELOW_TARGET", message: "Idle USDC is below the vault's liquidity target." });
    for (const p of book.positions)
      if (p.usdcRaw !== null && n.navRaw > 0n && p.usdcRaw * BPS > n.navRaw * BigInt(t.maxPositionBps))
        out.push({ severity: "warn", code: "CONCENTRATION", message: `${p.positionId} is above the vault's ${t.maxPositionBps / 100}% position cap.` });
    if (n.navRaw * 10n >= t.capacityRaw * 9n) out.push({ severity: "info", code: "NEAR_CAPACITY", message: "The vault is above 90% of its capacity." });
  }
  return out;
}

/**
 * The holder's personal ledger for vault events: a deposit or redemption moves principal between the wallet and the
 * vault position (internal: net worth unchanged); the holder's pro-rata share of crystallized fees is a fee.
 * Unrealized NAV moves are not booked here (valuation only).
 */
export function holderLedger(t: VaultTerms, account: string, events: SettlementEvent[], fees: FeeCrystallization | null, holderSharesBefore: bigint, totalSharesBefore: bigint, at: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const common = { at, asset: "USDC", decimals: 6, liabilityEffectUsdcRaw: "0", realized: true, status: "confirmed" as const, txHashes: [], source: "live" as const, positionId: "vault:" + t.id };
  for (const e of events.filter((x) => x.account === account && (x.kind === "deposit_settled" || x.kind === "redemption_settled")))
    out.push({
      ...common, id: `vault:${t.id}:${e.requestId}:${e.kind}`, kind: e.kind === "deposit_settled" ? "position_entry" : "position_exit", amountRaw: e.assetsRaw, usdcRaw: e.assetsRaw, netWorthEffectUsdcRaw: "0",
      basis: `${e.kind === "deposit_settled" ? "Deposited into" : "Redeemed from"} vault ${t.id}: ${e.sharesRaw} shares at ${e.ppsE18} assets per 1e18 shares`,
    });
  if (fees && totalSharesBefore > 0n && holderSharesBefore > 0n) {
    const total = BigInt(fees.managementFeeRaw) + BigInt(fees.performanceFeeRaw);
    const mine = (total * holderSharesBefore) / totalSharesBefore;
    if (mine > 0n)
      out.push({ ...common, id: `vault:${t.id}:fee:${fees.at}`, kind: "fee", amountRaw: mine.toString(), usdcRaw: mine.toString(), netWorthEffectUsdcRaw: "-" + mine, basis: "Your pro-rata share of crystallized vault fees: " + fees.basis });
  }
  return out;
}
