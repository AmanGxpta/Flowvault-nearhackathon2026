// Collect and send, pure planning. Someone needs to send an exact amount (say 3 USDC) but their money is spread across
// many chains and wallets. Each selected holding becomes one leg: a NEAR Intents swap from that holding straight to
// the recipient, in the token and network the recipient wants. This module decides which holdings to use and how much
// of each, keeps a running total against the target, and prices the gas each chain costs, so the owner can see
// "I'm burning this much gas across 6 chains" and change the picks. All figures here are estimates for choosing;
// every leg gets a live quote (with its minimum) before anything reaches a wallet.

export interface CollectSource {
  /** Stable key: catalog token id + holder address. */
  key: string;
  tokenId: string;
  symbol: string;
  network: string;
  account: string;
  decimals: number;
  /** What this wallet holds, in base units. */
  balanceRaw: string;
  /** USD per whole token (catalog price), null when unknown: unpriced holdings can't be planned. */
  price: number | null;
  /** Estimated network fee for one deposit from this chain, in USD. */
  gasUsd: number;
  /** Native coins pay their own gas: keep some back. */
  native: boolean;
}
export interface CollectPick { key: string; amountRaw: string }
export interface CollectLegEstimate { key: string; amountRaw: string; inUsd: number; outUsd: number; gasUsd: number }
export interface CollectSummary {
  legs: CollectLegEstimate[];
  /** Expected value delivered to the recipient (USD), after route costs. */
  deliveredUsd: number;
  gasUsd: number;
  targetUsd: number;
  /** Delivered reaches the target (within a cent). */
  complete: boolean;
  shortUsd: number;
  overUsd: number;
}

/** Route cost assumed for planning (NEAR Intents spread + slippage bound); the live quote replaces it. */
export const ROUTE_COST_BPS = 50;
/** Plans aim this far above the target so slippage below the estimate still delivers the full amount. */
export const TARGET_BUFFER_BPS = 30;
/** Native coins keep this share back for the deposit's own gas. */
export const NATIVE_KEEP_BPS = 1000;
/** Legs below this value aren't worth a network fee and NEAR Intents may refuse them. */
export const MIN_LEG_USD = 0.5;
/** Default per-deposit network fee by chain, USD. Illustrative until a live estimate replaces it. */
export const GAS_USD: Record<string, number> = { near: 0.002, sol: 0.002, base: 0.01, arb: 0.02, op: 0.02, pol: 0.01, bsc: 0.03, avax: 0.05, gnosis: 0.002, eth: 0.8 };

const pow = (d: number) => 10 ** d;
const toNumber = (raw: string, decimals: number) => Number(raw) / pow(decimals);
const toRaw = (amount: number, decimals: number) => {
  const d = Math.min(decimals, 6), scaled = Math.floor(amount * pow(d));
  return (BigInt(scaled) * 10n ** BigInt(decimals - d)).toString();
};

/** Swaps take at most 6 decimal places: amounts are rounded down to that. */
export function floor6(raw: bigint, decimals: number) {
  if (decimals <= 6) return raw;
  const step = 10n ** BigInt(decimals - 6);
  return (raw / step) * step;
}
/** What a source can contribute at most, in base units (native coins keep gas back), at 6 decimal places. */
export function spendableRaw(s: CollectSource) {
  const b = BigInt(s.balanceRaw);
  return floor6(s.native ? (b * BigInt(10_000 - NATIVE_KEEP_BPS)) / 10_000n : b, s.decimals);
}
export const usdOf = (s: CollectSource, raw: string) => (s.price === null ? 0 : toNumber(raw, s.decimals) * s.price);
const netUsd = (inUsd: number) => inUsd * (1 - ROUTE_COST_BPS / 10_000);

/** Cost of using a source for `need` USD: its gas plus the route cost, per dollar delivered. Lower is better. */
export function costPerDollar(s: CollectSource, need: number) {
  const usable = Math.min(usdOf(s, spendableRaw(s).toString()), need / (1 - ROUTE_COST_BPS / 10_000));
  return usable > 0 ? (s.gasUsd + usable * ROUTE_COST_BPS / 10_000) / netUsd(usable) : Infinity;
}

/**
 * Pick holdings to reach `targetUsd` delivered: the owner's priority order first (when given), otherwise cheapest
 * per dollar delivered, skipping excluded sources, unpriced ones and dust. Each source gives what's needed or all it
 * can; the last one is sized to the remainder, so the total lands on the target instead of overshooting.
 */
export function autoPick(sources: CollectSource[], targetUsd: number, o: { exclude?: Set<string>; priority?: string[]; maxLegs?: number } = {}): CollectPick[] {
  const usable = sources.filter((s) => s.price !== null && !o.exclude?.has(s.key) && usdOf(s, spendableRaw(s).toString()) >= MIN_LEG_USD);
  const rank = (s: CollectSource) => { const i = o.priority?.indexOf(s.key) ?? -1; return i < 0 ? Infinity : i; };
  const ordered = [...usable].sort((a, b) => rank(a) - rank(b) || costPerDollar(a, targetUsd) - costPerDollar(b, targetUsd));
  const picks: CollectPick[] = [];
  // Aim a little above the target: deliveries land slightly under estimates, and the recipient must get it all.
  let remaining = targetUsd * (1 + TARGET_BUFFER_BPS / 10_000);
  for (const s of ordered) {
    if (remaining <= 0.005 || picks.length >= (o.maxLegs ?? 12)) break;
    const maxUsd = usdOf(s, spendableRaw(s).toString());
    const wantIn = remaining / (1 - ROUTE_COST_BPS / 10_000);
    const useUsd = Math.min(maxUsd, wantIn);
    if (useUsd < MIN_LEG_USD && maxUsd >= MIN_LEG_USD && picks.length) {
      // A remainder below the minimum leg: round it up to the minimum rather than leave the target short.
      const raw = toRaw(MIN_LEG_USD / s.price!, s.decimals);
      picks.push({ key: s.key, amountRaw: raw });
      remaining -= netUsd(MIN_LEG_USD);
      continue;
    }
    if (useUsd < MIN_LEG_USD) continue;
    const raw = useUsd >= maxUsd - 1e-9 ? spendableRaw(s).toString() : toRaw(useUsd / s.price!, s.decimals);
    picks.push({ key: s.key, amountRaw: raw });
    remaining -= netUsd(usdOf(s, raw));
  }
  return picks;
}

/** The running total for a set of picks against the target: delivered value, gas, and whether the target is met. */
export function summarize(sources: CollectSource[], picks: CollectPick[], targetUsd: number): CollectSummary {
  const legs = picks.flatMap((p) => {
    const s = sources.find((x) => x.key === p.key);
    if (!s || !/^\d+$/.test(p.amountRaw) || BigInt(p.amountRaw) <= 0n) return [];
    const inUsd = usdOf(s, p.amountRaw);
    return [{ key: p.key, amountRaw: p.amountRaw, inUsd, outUsd: netUsd(inUsd), gasUsd: s.gasUsd }];
  });
  const deliveredUsd = legs.reduce((n, l) => n + l.outUsd, 0), gasUsd = legs.reduce((n, l) => n + l.gasUsd, 0);
  const complete = targetUsd > 0 && deliveredUsd >= targetUsd - 0.01;
  return { legs, deliveredUsd, gasUsd, targetUsd, complete, shortUsd: Math.max(0, targetUsd - deliveredUsd), overUsd: Math.max(0, deliveredUsd - targetUsd) };
}

/** Amount (base units) a source must send to deliver `usd` after route costs, capped at what it can spend. */
export function amountForUsd(s: CollectSource, usd: number) {
  if (s.price === null || usd <= 0) return "0";
  const raw = BigInt(toRaw(usd / (1 - ROUTE_COST_BPS / 10_000) / s.price, s.decimals)), cap = spendableRaw(s);
  return (raw > cap ? cap : raw).toString();
}
