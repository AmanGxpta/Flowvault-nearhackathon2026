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
