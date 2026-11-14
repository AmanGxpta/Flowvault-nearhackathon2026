// The example workspace's positions while Demo Mode plays real flows: the NEAR wallet, Rhea supply / collateral /
// debt, liquid staking and a Hyperliquid perps account. Every demo flow (Earn, Borrow, Stake, Trade) reads and changes
// this one ledger, so supplying, adding collateral, borrowing and repaying stay consistent across screens. Pure and
// fictional: nothing here signs or reaches a chain; prices and rates come in from live public reads.

export const USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR_ID = "wrap.near";
/** NEAR kept back for fees, as the real flows do. */
export const GAS_RESERVE_NEAR = 0.5;
/** FlowVault's minimum health for new debt and for releasing collateral, and the price drop it stresses against. */
export const MIN_HEALTH = 1.2, STRESS = 0.3;
/** LiNEAR/rNEAR unstake wait in the demo (the real one is about 2–3 days). */
export const UNSTAKE_DEMO_MS = 45_000;

export type RheaAction = "supply" | "withdraw" | "collateral_add" | "collateral_release" | "borrow" | "repay";
export interface RheaPos { supplied: number; collateral: number; borrowed: number }
export interface DemoPerp { coin: string; side: "long" | "short"; size: number; entry: number; leverage: number; openedAt: number }
export interface DemoLedger {
  v: 1;
  /** NEAR wallet by Rhea token id; wrap.near holds the account's native NEAR. */
  wallet: Record<string, number>;
  rhea: Record<string, RheaPos>;
  staking: { linear: number; rnear: number; unstaking: { venue: "linear" | "rnear"; near: number; readyAt: number }[] };
  perps: { margin: number; positions: DemoPerp[]; realized: number };
  activity: { at: number; text: string }[];
}
/** What a market looks like right now (from the public Rhea read): USD price, volatility ratio 0–1, rates, liquidity. */
export interface MarketInfo { symbol: string; decimals: number; price: number | null; vr: number; supplyApr: number | null; borrowApr: number | null; liquidity: number; stable: boolean }
export type Markets = Record<string, MarketInfo>;

export function seedLedger(): DemoLedger {
  return {
    v: 1,
    wallet: { [WNEAR_ID]: 42, [USDC_ID]: 4 },
    rhea: { [USDC_ID]: { supplied: 7500, collateral: 0, borrowed: 0 } },
    staking: { linear: 60, rnear: 25, unstaking: [] },
    perps: { margin: 2000, positions: [], realized: 0 },
    activity: [],
  };
}

const pos = (l: DemoLedger, t: string): RheaPos => l.rhea[t] ?? { supplied: 0, collateral: 0, borrowed: 0 };
const round = (n: number) => Math.round(n * 1e8) / 1e8;
const clone = (l: DemoLedger): DemoLedger => JSON.parse(JSON.stringify(l));

/** Rhea health: collateral value × volatility ratio over debt value ÷ volatility ratio. Null without debt. */
export function rheaHealth(l: DemoLedger, m: Markets, stress = 0): number | null {
  let coll = 0, debt = 0;
  for (const [t, p] of Object.entries(l.rhea)) {
    const k = m[t]; if (!k?.price) continue;
    const drop = k.stable ? 1 : 1 - stress;
    coll += p.collateral * k.price * drop * k.vr;
    debt += p.borrowed * k.price / k.vr;
  }
  return debt > 0 ? coll / debt : null;
}
/** How much more of `token` can be borrowed keeping MIN_HEALTH after the price stress. */
export function borrowCapacity(l: DemoLedger, m: Markets, token: string): number {
  const k = m[token]; if (!k?.price) return 0;
  let coll = 0, debt = 0;
  for (const [t, p] of Object.entries(l.rhea)) {
    const x = m[t]; if (!x?.price) continue;
    coll += p.collateral * x.price * (x.stable ? 1 : 1 - STRESS) * x.vr;
    debt += p.borrowed * x.price / x.vr;
  }
  const room = coll / MIN_HEALTH - debt;
  return Math.max(0, Math.min(room * k.vr / k.price, k.liquidity));
}
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4 });

/** Applies one Rhea action; throws a plain sentence when it can't be done. */
export function applyRhea(l: DemoLedger, m: Markets, action: RheaAction, token: string, amount: number, now = Date.now()): DemoLedger {
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero.");
  const k = m[token]; if (!k) throw new Error("This market isn't available right now.");
  const n = clone(l), p = { ...pos(n, token) }, wallet = n.wallet[token] ?? 0;
  const spendable = token === WNEAR_ID ? Math.max(0, wallet - GAS_RESERVE_NEAR) : wallet;
  const need = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };
  switch (action) {
    case "supply": case "collateral_add":
      need(amount <= spendable + 1e-9, `You have ${fmt(spendable)} ${k.symbol} to use${token === WNEAR_ID ? " (0.5 NEAR stays for fees)" : ""}.`);
      n.wallet[token] = round(wallet - amount);
      if (action === "supply") p.supplied = round(p.supplied + amount); else p.collateral = round(p.collateral + amount);
      break;
    case "withdraw":
      need(amount <= p.supplied + 1e-9, `You have ${fmt(p.supplied)} ${k.symbol} supplied.`);
      need(amount <= k.liquidity, "Rhea doesn't have that much free liquidity right now.");
      p.supplied = round(p.supplied - amount); n.wallet[token] = round(wallet + amount);
      break;
    case "collateral_release":
      need(amount <= p.collateral + 1e-9, `You have ${fmt(p.collateral)} ${k.symbol} as collateral.`);
      p.collateral = round(p.collateral - amount); n.wallet[token] = round(wallet + amount);
      break;
    case "borrow": {
      const cap = borrowCapacity(l, m, token);
      need(amount <= cap + 1e-9, cap > 0 ? `You can borrow up to ${fmt(cap)} ${k.symbol} and stay above health ${MIN_HEALTH} after a ${STRESS * 100}% price drop.` : "Add collateral first: it's what you borrow against.");
      p.borrowed = round(p.borrowed + amount); n.wallet[token] = round(wallet + amount);
      break;
    }
    case "repay": {
      need(p.borrowed > 0, `You don't owe any ${k.symbol}.`);
      const pay = Math.min(amount, p.borrowed);
      need(pay <= wallet + 1e-9, `You have ${fmt(wallet)} ${k.symbol} in your wallet to repay with.`);
      p.borrowed = round(p.borrowed - pay); n.wallet[token] = round(wallet - pay);
      break;
    }
  }
  n.rhea[token] = p;
  if (action === "collateral_release") {
    const h = rheaHealth(n, m, STRESS);
    if (h !== null && h < MIN_HEALTH) throw new Error(`That would take health below ${MIN_HEALTH} after a ${STRESS * 100}% price drop. Repay first or release less.`);
  }
  n.activity.unshift({ at: now, text: `${{ supply: "Supplied", withdraw: "Withdrew", collateral_add: "Added collateral", collateral_release: "Released collateral", borrow: "Borrowed", repay: "Repaid" }[action]} ${fmt(action === "repay" ? Math.min(amount, pos(l, token).borrowed) : amount)} ${k.symbol} on Rhea` });
  n.activity = n.activity.slice(0, 50);
  return n;
}

/** Liquid staking: NEAR leaves the wallet, shares arrive at the pool's price (NEAR per share). */
export function applyStake(l: DemoLedger, venue: "linear" | "rnear", near: number, nearPerShare: number, now = Date.now()): DemoLedger {
  const n = clone(l), wallet = n.wallet[WNEAR_ID] ?? 0, spendable = Math.max(0, wallet - GAS_RESERVE_NEAR);
  if (!(near > 0)) throw new Error("Enter an amount above zero.");
  if (near > spendable + 1e-9) throw new Error(`You have ${fmt(spendable)} NEAR to stake (0.5 NEAR stays for fees).`);
  const shares = round(near / nearPerShare);
  n.wallet[WNEAR_ID] = round(wallet - near);
  n.staking[venue] = round(n.staking[venue] + shares);
  n.activity.unshift({ at: now, text: `Staked ${fmt(near)} NEAR for ${fmt(shares)} ${venue === "linear" ? "LiNEAR" : "rNEAR"}` });
  return n;
}
/** Delayed unstake: shares burn now, the NEAR is claimable after the wait. */
export function applyUnstake(l: DemoLedger, venue: "linear" | "rnear", shares: number, nearPerShare: number, now = Date.now()): DemoLedger {
  const n = clone(l);
  if (!(shares > 0) || shares > n.staking[venue] + 1e-9) throw new Error(`You hold ${fmt(n.staking[venue])} ${venue === "linear" ? "LiNEAR" : "rNEAR"}.`);
  n.staking[venue] = round(n.staking[venue] - shares);
  const near = round(shares * nearPerShare);
  n.staking.unstaking.push({ venue, near, readyAt: now + UNSTAKE_DEMO_MS });
  n.activity.unshift({ at: now, text: `Requested unstake of ${fmt(shares)} ${venue === "linear" ? "LiNEAR" : "rNEAR"} (≈ ${fmt(near)} NEAR)` });
  return n;
}
export function applyClaim(l: DemoLedger, now = Date.now()): DemoLedger {
  const n = clone(l), ready = n.staking.unstaking.filter((u) => u.readyAt <= now);
  if (!ready.length) throw new Error("Nothing is ready to withdraw yet.");
  const near = ready.reduce((s, u) => s + u.near, 0);
  n.staking.unstaking = n.staking.unstaking.filter((u) => u.readyAt > now);
  n.wallet[WNEAR_ID] = round((n.wallet[WNEAR_ID] ?? 0) + near);
  n.activity.unshift({ at: now, text: `Withdrew ${fmt(near)} NEAR from unstaking` });
  return n;
}

/** Perps: margin locked is notional ÷ leverage; positions mark to the live price. */
export const perpMargin = (p: DemoPerp) => p.size * p.entry / p.leverage;
export const perpPnl = (p: DemoPerp, mark: number) => (mark - p.entry) * p.size * (p.side === "long" ? 1 : -1);
/** Isolated estimate: maintenance ≈ half the initial margin at max leverage. */
export const perpLiq = (p: DemoPerp, maxLev: number) => { const mm = 1 / (2 * maxLev); return p.side === "long" ? p.entry * (1 - 1 / p.leverage + mm) : p.entry * (1 + 1 / p.leverage - mm); };
export function freeMargin(l: DemoLedger) { return round(l.perps.margin - l.perps.positions.reduce((s, p) => s + perpMargin(p), 0)); }
export function applyPerpOpen(l: DemoLedger, o: { coin: string; side: "long" | "short"; notional: number; leverage: number; price: number }, now = Date.now()): DemoLedger {
  if (!(o.notional > 0) || !(o.price > 0)) throw new Error("Enter a size above zero.");
  const n = clone(l), margin = o.notional / o.leverage, free = freeMargin(n);
  if (margin > free + 1e-9) throw new Error(`This needs ${fmt(margin)} USDC of margin; ${fmt(free)} USDC is free.`);
  const size = round(o.notional / o.price), same = n.perps.positions.find((p) => p.coin === o.coin);
  if (same && same.side !== o.side) throw new Error(`Close your ${o.coin} ${same.side} before opening a ${o.side}.`);
  if (same) { const total = same.size + size; same.entry = round((same.entry * same.size + o.price * size) / total); same.size = round(total); same.leverage = o.leverage; }
  else n.perps.positions.push({ coin: o.coin, side: o.side, size, entry: o.price, leverage: o.leverage, openedAt: now });
  n.activity.unshift({ at: now, text: `Opened ${o.side} ${fmt(size)} ${o.coin} at $${fmt(o.price)} (${o.leverage}×)` });
  return n;
}
export function applyPerpClose(l: DemoLedger, coin: string, price: number, now = Date.now()): DemoLedger {
  const n = clone(l), p = n.perps.positions.find((x) => x.coin === coin);
  if (!p) throw new Error(`No open ${coin} position.`);
  const pnl = round(perpPnl(p, price));
  n.perps.positions = n.perps.positions.filter((x) => x.coin !== coin);
  n.perps.margin = round(n.perps.margin + pnl);
  n.perps.realized = round(n.perps.realized + pnl);
  n.activity.unshift({ at: now, text: `Closed ${p.side} ${fmt(p.size)} ${coin} at $${fmt(price)}: ${pnl >= 0 ? "+" : "−"}$${fmt(Math.abs(pnl))}` });
  return n;
}

/** Demo Mode's Rhea account in the same shape the live read returns (LendingVenueSnapshot), for the Borrow page. */
export function demoLendingSnapshot(l: DemoLedger, m: Markets, rows: { token: string; ltv: number | null; canSupply?: boolean }[], accountId: string, now = Date.now()) {
  const raw = (n: number, d: number) => (d >= 6 ? BigInt(Math.max(0, Math.round(n * 1e6))) * 10n ** BigInt(d - 6) : BigInt(Math.max(0, Math.round(n * 10 ** d)))).toString();
  const usdc = (n: number) => raw(n, 6);
  const asset = (t: string) => ({ id: t, symbol: t === WNEAR_ID ? "NEAR" : m[t].symbol, decimals: m[t].decimals, chain: "near" as const });
  const collateral = rows.filter((r) => r.ltv && r.canSupply !== false && m[r.token]?.price).map((r) => asset(r.token));
  // NEAR first: the account's largest wallet asset is the natural first collateral.
  const tokens = [...new Set([WNEAR_ID, ...Object.keys(l.rhea), ...Object.keys(l.wallet)])].filter((t) => m[t]);
  const h = rheaHealth(l, m), hs = rheaHealth(l, m, STRESS), cap = borrowCapacity(l, m, USDC_ID), debt = l.rhea[USDC_ID]?.borrowed ?? 0;
  const text = (x: number | null) => (x === null ? "no debt" : x.toFixed(4));
  return {
    venueId: "rhea", accountId, source: "demo" as const, capturedAt: new Date(now).toISOString(), freshUntil: new Date(now + 10 * 60_000).toISOString(),
    collateralAssets: collateral, debtAssets: [asset(USDC_ID)],
    positions: tokens.map((t) => {
      const p = l.rhea[t] ?? { supplied: 0, collateral: 0, borrowed: 0 }, w = t === WNEAR_ID ? Math.max(0, (l.wallet[t] ?? 0) - GAS_RESERVE_NEAR) : l.wallet[t] ?? 0, d = m[t].decimals;
      return { asset: asset(t), suppliedRaw: raw(p.supplied, d), collateralRaw: raw(p.collateral, d), liabilityRaw: raw(p.borrowed, d), walletRaw: raw(w, d), valueUsdcRaw: m[t].price ? usdc((p.supplied + p.collateral - p.borrowed) * m[t].price!) : null };
    }),
    pricesAndRisk: tokens.map((t) => ({ assetId: t, priceUsdcRaw: m[t].price ? usdc(m[t].price!) : null, ltvBps: Math.round(m[t].vr * 10_000), liquidationThresholdBps: Math.round(m[t].vr * 10_000), liquidationBonusBps: null })),
    liquidityUsdcRaw: usdc(m[USDC_ID]?.liquidity ?? 0), currentCapacityUsdcRaw: usdc(cap), stressedCapacityUsdcRaw: usdc(cap), debtUsdcRaw: usdc(debt),
    health: text(h), stressedHealth: text(hs), minHealth: String(MIN_HEALTH),
    borrowApr: m[USDC_ID]?.borrowApr != null ? String(m[USDC_ID].borrowApr! / 100) : null,
    interest: { variable: true, accruedIncludedInLiability: true, basis: "Rhea variable rate" },
    liquidation: { exposed: debt > 0, thresholdHealth: "1", reasons: [] as string[] },
    exit: { instant: true, reasons: [] as string[] },
    reasons: [] as string[],
  };
}

/** Swap-catalog id ↔ ledger key for the example NEAR account (native NEAR is held as wrap.near). */
export const ledgerKey = (catalogId: string) => (catalogId === "near:native" ? WNEAR_ID : catalogId.startsWith("near:") ? catalogId.slice(5) : null);
/** A demo swap that touches the NEAR account moves the ledger too: what was paid leaves, what was delivered arrives. */
export function applySwap(l: DemoLedger, from: { id: string; symbol: string; amount: number }, to: { id: string; symbol: string; amount: number }, now = Date.now()): DemoLedger {
  const n = clone(l), a = ledgerKey(from.id), b = ledgerKey(to.id);
  if (a) n.wallet[a] = round(Math.max(0, (n.wallet[a] ?? 0) - from.amount));
  if (b) n.wallet[b] = round((n.wallet[b] ?? 0) + to.amount);
  n.activity.unshift({ at: now, text: `Swapped ${fmt(from.amount)} ${from.symbol} for ${fmt(to.amount)} ${to.symbol}` });
  return n;
}
