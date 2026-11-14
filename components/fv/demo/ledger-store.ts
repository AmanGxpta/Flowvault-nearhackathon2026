"use client";
// Demo Mode's ledger in this browser tab (see lib/flowvault/demo-ledger.ts): read and changed by every demo flow, so
// Earn, Borrow, Stake and Trade agree with each other. Reset example puts it back to the seed. Market prices, volatility
// ratios, rates and liquidity come from the live public Rhea read, so the simulation uses today's numbers.
import { useEffect, useState } from "react";
import { seedLedger, USDC_ID, WNEAR_ID, type DemoLedger, type Markets } from "@/lib/flowvault/demo-ledger";
import { exampleHash } from "@/lib/flowvault/demo-sim";
import { isStableAsset } from "@/lib/flowvault/brief";

const KEY = "fv-demo-ledger-v1", EVENT = "fv:demo-ledger";
let memory: DemoLedger | null = null;

export function demoLedger(): DemoLedger {
  try { const raw = sessionStorage.getItem(KEY); if (raw) return JSON.parse(raw) as DemoLedger; } catch { /* storage blocked */ }
  return memory ?? (memory = seedLedger());
}
export function saveDemoLedger(l: DemoLedger) {
  memory = l;
  try { sessionStorage.setItem(KEY, JSON.stringify(l)); } catch { /* lives for this page */ }
  window.dispatchEvent(new Event(EVENT));
}
export function resetDemoLedger() { memory = null; try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } window.dispatchEvent(new Event(EVENT)); }
export function useDemoLedger(enabled = true) {
  const [l, setL] = useState<DemoLedger | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = () => setL(demoLedger());
    const t = setTimeout(read, 0);
    window.addEventListener(EVENT, read);
    return () => { clearTimeout(t); window.removeEventListener(EVENT, read); };
  }, [enabled]);
  return l;
}

const DECIMALS: Record<string, number> = { [WNEAR_ID]: 24, [USDC_ID]: 6, "usdt.tether-token.near": 6 };
type RateRow = { token: string; symbol: string; supplyApy: number | null; borrowApy: number | null; supplied: number; borrowed: number; suppliedUsd: number | null; ltv: number | null; canSupply?: boolean; canBorrow?: boolean; collateral?: boolean };
let marketsCache: { at: number; m: Markets; rows: RateRow[] } | null = null;
/** Today's Rhea markets as the ledger needs them (cached for a minute). */
export async function demoMarkets(): Promise<{ m: Markets; rows: RateRow[] }> {
  if (marketsCache && Date.now() - marketsCache.at < 60_000) return marketsCache;
  const b = await fetch("/api/rates").then((r) => r.json() as Promise<{ rows?: RateRow[] }>);
  const m: Markets = {};
  for (const r of b.rows ?? []) {
    const price = r.suppliedUsd && r.supplied > 0 ? r.suppliedUsd / r.supplied : null;
    m[r.token] = { symbol: r.symbol, decimals: DECIMALS[r.token] ?? (isStableAsset(r.symbol) ? 6 : 18), price, vr: r.ltv ? r.ltv / 100 : 0.5, supplyApr: r.supplyApy, borrowApr: r.borrowApy, liquidity: Math.max(0, r.supplied - r.borrowed), stable: isStableAsset(r.symbol) };
  }
  marketsCache = { at: Date.now(), m, rows: b.rows ?? [] };
  return marketsCache;
}
export function useDemoMarkets(enabled = true) {
  const [v, setV] = useState<{ m: Markets; rows: RateRow[] } | null>(null);
  useEffect(() => { if (!enabled) return; let live = true; demoMarkets().then((x) => { if (live) setV(x); }).catch(() => {}); return () => { live = false; }; }, [enabled]);
  return v;
}

/** The labelled wallet simulation every demo approval plays: wallet → submitted → landed. */
export function simulateApproval(id: string, on: { wallet?: () => void; submitted: (hash: string) => void; landed: (hash: string) => void }, ms = { wallet: 1600, settle: 4200 }) {
  on.wallet?.();
  const hash = exampleHash(id);
  const a = setTimeout(() => on.submitted(hash), ms.wallet), b = setTimeout(() => on.landed(hash), ms.wallet + ms.settle);
  return () => { clearTimeout(a); clearTimeout(b); };
}
