"use client";
// The watchlist as the screens use it. Connected: saved with the account on the server (so it follows the account to
// every device), changed by small operations shown at once and confirmed by the server, re-read when the window
// regains focus. A list this browser kept for the account before then is imported once and removed from the browser.
// Demo Mode keeps the example's list in this browser. Locked (no wallet): empty, and nothing is saved.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./live";
import { applyWatchOp, cleanWatchlist, emptyWatchlist, type Watchlist, type WatchOp } from "@/lib/flowvault/watchlist";

const SYNC = "fv:watchlist";
const LEGACY = (owner: string) => "fv-research-v1:personal:" + owner;
const EXAMPLE = "fv-research-v1:example";
type Sync = CustomEvent<{ scope: string; data: Watchlist }>;

export function useWatchlist({ owner, example, locked }: { owner: string; example: boolean; locked: boolean }) {
  const scope = example ? "example" : locked ? "locked" : "account:" + owner;
  const [data, setData] = useState<Watchlist>(emptyWatchlist);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const pending = useRef(0), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const publish = useCallback((d: Watchlist) => { setData(d); window.dispatchEvent(new CustomEvent(SYNC, { detail: { scope, data: d } })); }, [scope]);

  const read = useCallback(async () => {
    if (example) { let d = emptyWatchlist(); try { d = cleanWatchlist(JSON.parse(localStorage.getItem(EXAMPLE) ?? "{}")); } catch { /* storage blocked */ } setData(d); setLoaded(true); return; }
    if (locked) { setData(emptyWatchlist()); setLoaded(true); return; }
    try {
      let r = (await api("/api/watchlist", undefined, "GET", "personal")) as { watchlist: Watchlist };
      // One-time move of the list this browser kept for this account before watchlists were saved with it.
      let legacy: string | null = null; try { legacy = owner ? localStorage.getItem(LEGACY(owner)) : null; } catch { /* storage blocked */ }
      const old = legacy ? cleanWatchlist(JSON.parse(legacy)) : null;
      if (old && (old.saved.length || old.wallets.length)) r = (await api("/api/watchlist", { op: "import", data: old }, "POST", "personal")) as { watchlist: Watchlist };
      if (legacy) try { localStorage.removeItem(LEGACY(owner)); } catch { /* storage blocked */ }
      if (!pending.current) setData(r.watchlist);
      setError("");
    } catch (e) { setError((e as Error).message); }
    setLoaded(true);
  }, [example, locked, owner]);

  useEffect(() => {
    const t = setTimeout(() => void read(), 0);
    const focus = () => { if (!example && !locked && !pending.current) void read(); };
    const sync = (e: Event) => { const d = (e as Sync).detail; if (d.scope === scope) setData(d.data); };
    window.addEventListener("focus", focus); window.addEventListener(SYNC, sync);
    return () => { clearTimeout(t); window.removeEventListener("focus", focus); window.removeEventListener(SYNC, sync); };
  }, [read, scope, example, locked]);

  /** Shows the change at once, then saves it. `debounce` (a key) waits for typing to pause before saving. */
  const apply = useCallback(async (op: WatchOp, debounce?: string) => {
    if (locked && !example) return;
    let next: Watchlist;
    try { next = applyWatchOp(data, op); } catch (e) { setError((e as Error).message); throw e; }
    publish(next); setError("");
    if (example) { try { localStorage.setItem(EXAMPLE, JSON.stringify(next)); } catch { /* lives for this visit */ } return; }
    const send = async () => {
      pending.current++;
      try { const r = (await api("/api/watchlist", op, "POST", "personal")) as { watchlist: Watchlist }; if (pending.current === 1) publish(r.watchlist); }
      catch (e) { setError((e as Error).message); pending.current--; await read(); return; }
      pending.current--;
    };
    if (!debounce) return send();
    clearTimeout(timers.current.get(debounce));
    timers.current.set(debounce, setTimeout(() => { timers.current.delete(debounce); void send(); }, 600));
  }, [data, example, locked, publish, read]);

  return { data, loaded, error, apply, saved: !example && !locked };
}
