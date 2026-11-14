"use client";
// Small motion helpers for the Research page: numbers that count from their last value instead of flashing, and a
// per-tab cache so a revisit opens on the last known state and refreshes quietly (no empty-then-pop).
import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Animates from the previous value to `target` (ease-out). Null stays null. */
export function useCountUp(target: number | null, duration = 650) {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) return;
    const start = from.current ?? 0;
    if (reduced() || start === target) { const t = setTimeout(() => { setShown(target); from.current = target; }, 0); return () => clearTimeout(t); }
    let raf = 0; const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration), e = 1 - Math.pow(1 - k, 3);
      setShown(start + (target - start) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

const PREFIX = "fv-hub-cache:";
export function cacheGet<T>(key: string): T | null { try { const raw = sessionStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; } }
export function cacheSet(key: string, value: unknown) { try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked: no instant revisit */ } }

/** Relative time until a moment: "in 14h", "in 3m", "now". */
export function until(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (ms <= 30_000) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h${m % 60 && h < 10 ? ` ${m % 60}m` : ""}`;
  return `in ${Math.round(h / 24)}d`;
}

/** Daily history of the page's counts, kept in this browser per workspace (14 days). One sample per day: the latest
 * reading of that day wins. The example workspace starts with a fictional fortnight so its trends show at once. */
export type TrendKey = "earning" | "approvals" | "running" | "idle";
type TrendStore = Record<string, Partial<Record<TrendKey, number>>>;
const TREND = "fv-hub-trend:";
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function exampleHistory(now: number): TrendStore {
  const out: TrendStore = {};
  for (let i = 13; i >= 1; i--) {
    const w = Math.sin(i * 1.7) * 0.5 + 0.5;
    out[dayOf(now - i * 86_400_000)] = { earning: 18 - Math.round(i / 4), approvals: i % 4 === 0 ? 2 : i % 3 === 0 ? 0 : 1, running: i > 9 ? 2 : i > 5 ? 3 : 4, idle: Math.round(2400 - i * 140 + w * 520) };
  }
  return out;
}
export function useTrend(scope: string, sample: Partial<Record<TrendKey, number | null>>, ready: boolean, example: boolean) {
  const [store, setStore] = useState<TrendStore>({});
  const sig = JSON.stringify(sample);
  useEffect(() => {
    const t = setTimeout(() => {
      let s: TrendStore = {};
      try { s = JSON.parse(localStorage.getItem(TREND + scope) ?? "null") ?? (example ? exampleHistory(Date.now()) : {}); } catch { s = example ? exampleHistory(Date.now()) : {}; }
      if (ready) {
        const today: Partial<Record<TrendKey, number>> = {};
        for (const [k, v] of Object.entries(JSON.parse(sig) as Record<TrendKey, number | null>)) if (typeof v === "number" && Number.isFinite(v)) today[k as TrendKey] = v;
        s = { ...s, [dayOf(Date.now())]: { ...s[dayOf(Date.now())], ...today } };
        s = Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)).slice(-14));
        try { localStorage.setItem(TREND + scope, JSON.stringify(s)); } catch { /* storage blocked: trend for this visit only */ }
      }
      setStore(s);
    }, 0);
    return () => clearTimeout(t);
  }, [scope, sig, ready, example]);
  const series = (k: TrendKey) => Object.keys(store).sort().map((d) => store[d][k]).filter((v): v is number => typeof v === "number");
  return series;
}
