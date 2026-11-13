"use client";
import { useCallback, useEffect, useState } from "react";
import type { Holding } from "./TokenPicker";

/** Balances of one NEAR account keyed by catalog id ("near:<contract>" / "near:native"), from the public
 * research read (FastNEAR inventory + Ref prices). Read-only; an empty map means "not read", never "zero". */
export function useNearHoldings(account: string) {
  const [balances, setBalances] = useState<Record<string, Holding>>({});
  const [state, setState] = useState<"idle" | "reading" | "ready" | "error">("idle");
  const [readAt, setReadAt] = useState<string | null>(null);
  const read = useCallback(async () => {
    if (!account) { setBalances({}); setState("idle"); return; }
    setState("reading");
    try {
      const r = await fetch("/api/research?network=near&address=" + encodeURIComponent(account), { cache: "no-store" });
      const b = await r.json() as { holdings?: { contract: string; raw: string; amount: string | null; usd: string | null }[]; capturedAt?: string; error?: string };
      if (!r.ok || !Array.isArray(b.holdings)) throw new Error(b.error ?? "Balances unavailable");
      const next: Record<string, Holding> = {};
      for (const h of b.holdings) if (h.amount !== null) next["near:" + h.contract] = { amount: h.amount, usd: h.usd, raw: h.raw };
      setBalances(next); setReadAt(b.capturedAt ?? new Date().toISOString()); setState("ready");
    } catch { setState("error"); }
  }, [account]);
  useEffect(() => { const t = setTimeout(() => void read(), 0); return () => clearTimeout(t); }, [read]);
  return { balances, state, readAt, refresh: read };
}
