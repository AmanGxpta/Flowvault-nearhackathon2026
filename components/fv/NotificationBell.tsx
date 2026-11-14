"use client";
// Notifications in the header instead of banners on the page: the plan's "needs attention" step and any part of the
// portfolio that isn't fully read, one row each. An orange dot means there's something you haven't seen; opening the
// bell marks everything seen. Each row has → (act on it) and × (clear it); "Clear all" clears every row. Seen and
// cleared are remembered in this browser per notification text, so a changed notification shows up again.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bell, X } from "lucide-react";

export interface Note { id: string; title: string; detail: string; tone: "attention" | "info"; actLabel: string; act: () => void }
const KEY = "fv-notifications-v1";
type Memory = { seen: string[]; cleared: string[] };
const load = (): Memory => { try { const m = JSON.parse(localStorage.getItem(KEY) ?? "{}"); return { seen: Array.isArray(m.seen) ? m.seen : [], cleared: Array.isArray(m.cleared) ? m.cleared : [] }; } catch { return { seen: [], cleared: [] }; } };
const save = (m: Memory) => { try { localStorage.setItem(KEY, JSON.stringify({ seen: m.seen.slice(-200), cleared: m.cleared.slice(-200) })); } catch { /* storage blocked: memory lasts for this page */ } };
/** A notification's identity includes its text, so new or changed content counts as unseen again. */
const sig = (n: { id: string; title: string; detail: string }) => { let h = 0; for (const c of n.id + "|" + n.title + "|" + n.detail) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return n.id + ":" + (h >>> 0).toString(36); };

/** The view model's notifications: the plan step that needs attention, then each read gap. */
export function notesFrom(v: any): Note[] { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const out: Note[] = [];
  const rec = v.rec;
  if (rec && !["READING", "IDLE", "LIQUID"].includes(rec.tag)) out.push({ id: "plan", title: rec.title, detail: rec.body ?? "", tone: "attention", actLabel: rec.cta ?? "Review", act: () => rec.onClick?.() });
  for (const g of (v.pfRows ?? []).filter((r: any) => r.status && r.ownership !== "watched")) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const connect = /not connected/i.test(g.tag ?? "");
    out.push({ id: "read:" + g.name, title: g.name, detail: g.tag === "PARTIAL" ? `${g.sub} · the total shows what's read so far` : `${g.sub} · not counted until it reads`, tone: "info",
      actLabel: connect ? "Connect a wallet" : "Read balances again", act: () => (connect ? (v.openConnect ?? v.connectFirst)?.() : v.refreshPortfolio?.()) });
  }
  return out;
}

export function NotificationBell({ notes }: { notes: Note[] }) {
  const [open, setOpen] = useState(false), [mem, setMem] = useState<Memory>({ seen: [], cleared: [] });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setMem(load()), 0); return () => clearTimeout(t); }, []);
  const shown = notes.filter((n) => !mem.cleared.includes(sig(n)));
  const unseen = shown.some((n) => !mem.seen.includes(sig(n)));
  const update = (m: Memory) => { setMem(m); save(m); };
  const toggle = () => {
    const next = !open; setOpen(next);
    if (next && unseen) update({ ...mem, seen: [...new Set([...mem.seen, ...shown.map(sig)])] });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const clear = (ids: string[]) => update({ seen: [...new Set([...mem.seen, ...ids])], cleared: [...new Set([...mem.cleared, ...ids])] });

  return <div className="fv-bell" ref={box}>
    <button type="button" className="fv-bell-button fvh5" aria-label={shown.length ? `Notifications, ${shown.length}${unseen ? " new" : ""}` : "Notifications"} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      <Bell size={18} />{unseen && <span className="fv-bell-dot" aria-hidden />}
    </button>
    {open && <div className="fv-bell-panel" role="dialog" aria-label="Notifications">
      <div className="fv-bell-head"><strong>Notifications</strong><small>{shown.length ? `${shown.length} to look at` : "You're all caught up"}</small></div>
      <div className="fv-bell-list">
        {shown.length ? shown.map((n) => <div key={sig(n)} className={"fv-bell-row is-" + n.tone}>
          <span className="fv-status-dot" aria-hidden />
          <div className="fv-bell-text"><strong>{n.title}</strong>{n.detail && <small>{n.detail}</small>}</div>
          <button type="button" className="fv-icon-button" aria-label={n.actLabel} title={n.actLabel} onClick={() => { setOpen(false); n.act(); }}><ArrowRight size={15} /></button>
          <button type="button" className="fv-icon-button" aria-label={"Clear: " + n.title} title="Clear" onClick={() => clear([sig(n)])}><X size={15} /></button>
        </div>) : <p className="fv-bell-empty">Nothing needs you right now.</p>}
      </div>
      {shown.length > 0 && <button type="button" className="fv-text-button fv-bell-clear" onClick={() => clear(shown.map(sig))}>Clear all</button>}
    </div>}
  </div>;
}
