"use client";
// Per-market order rules from Hyperliquid's listing: the highest leverage it allows and the lot size (szDecimals,
// the decimals a size may have). Read once per page load and shared; BTC, ETH and NEAR have known values so the
// ticket works before the listing arrives.
import { useEffect, useState } from "react";

export interface PerpMeta { maxLeverage: number; szDecimals: number }
const KNOWN: Record<string, PerpMeta> = { BTC: { maxLeverage: 40, szDecimals: 5 }, ETH: { maxLeverage: 25, szDecimals: 4 }, NEAR: { maxLeverage: 10, szDecimals: 1 } };
let rows: Record<string, PerpMeta> | null = null;
let loading: Promise<Record<string, PerpMeta>> | null = null;

function load() {
  loading ??= fetch("/api/markets?list=perps", { cache: "no-store" })
    .then((r) => r.json() as Promise<{ markets?: { coin: string; maxLeverage: number; szDecimals?: number }[] }>)
    .then((b) => {
      const out: Record<string, PerpMeta> = {};
      for (const m of b.markets ?? []) if (typeof m.szDecimals === "number") out[m.coin] = { maxLeverage: m.maxLeverage, szDecimals: m.szDecimals };
      rows = out;
      return out;
    })
    .catch(() => { loading = null; return {}; });
  return loading;
}

/** The market's rules, or null while an unfamiliar market's listing is still loading. */
export function usePerpMeta(coin: string): PerpMeta | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (rows?.[coin]) return;
    let live = true;
    void load().then(() => { if (live) setTick((n) => n + 1); });
    return () => { live = false; };
  }, [coin]);
  return rows?.[coin] ?? KNOWN[coin] ?? null;
}

/** Rounds a size down to the market's lot size, as Hyperliquid will. */
export function lotSize(size: number, szDecimals: number) {
  const f = 10 ** szDecimals;
  return Math.floor(size * f + 1e-9) / f;
}
