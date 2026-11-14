"use client";
// What automations produced: the brief as a card where every line has its own next step, and alerts and notes as a
// feed that slides new items in. Dismissing animates out. Nothing here executes; actions open the existing flows.
import { useState } from "react";
import { ArrowRight, Bell, CalendarClock, Info, RefreshCw, X } from "lucide-react";
import { ago } from "../swap-format";
import type { AutomationEvent } from "@/lib/flowvault/automations";
import type { BriefAction } from "@/lib/flowvault/brief";

export type Go = (a: BriefAction | NonNullable<AutomationEvent["action"]>) => void;

/** Briefs saved before items existed only have lines. A short "Label: text" prefix becomes the label; anything else
 * stays whole as the text, so an old sentence never lands in the narrow label column. */
function legacyItems(lines: string[]) {
  return lines.map((l) => {
    const at = l.indexOf(":"), head = at > 0 ? l.slice(0, at) : "";
    return head && head.length <= 16 && !/[.≈$]/.test(head) ? { label: head, text: l.slice(at + 1).trim(), tone: "info" as const } : { label: "", text: l, tone: "info" as const };
  });
}

export function BriefCard({ event, go, refresh, busy, example }: { event: AutomationEvent | null; go: Go; refresh: () => void; busy: boolean; example: boolean }) {
  return <section className={"fv-panel fv-brief" + (event ? "" : " is-empty")} aria-label="Your brief">
    <div className="fv-brief-head">
      <span className="fv-brief-icon"><CalendarClock size={17} /></span>
      <div><h2>{event ? "Your brief" : "Get your brief"}</h2><small>{event ? `${new Date(event.createdAt).toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })} · ${ago(event.createdAt)}${example ? " · example" : ""}` : "What you hold, what's idle, the best rates and what needs you, in five lines."}</small></div>
      <button type="button" className={"fv-button" + (event ? "" : " fv-primary")} disabled={busy} onClick={refresh}><RefreshCw size={14} className={busy ? "fv-spin" : ""} /> {busy ? "Reading your wallets…" : event ? "Refresh" : "Brief me now"}</button>
    </div>
    {busy && !event && <div className="fv-brief-items">{[0, 1, 2, 3].map((i) => <div key={i} className="fv-brief-item"><div className="fv-skel" style={{ width: 90, height: 12 }} /><div className="fv-skel fv-skel-line" style={{ flex: 1 }} /></div>)}</div>}
    {event && <ol className="fv-brief-items" key={event.id}>{(event.items ?? legacyItems(event.lines)).map((it, i) => <li key={i} className={"fv-brief-item fv-rise is-" + (it.tone ?? "info") + (it.label ? "" : " is-plain")} style={{ ["--i" as string]: i }}>
      {it.label ? <span className="fv-brief-label">{it.label}</span> : null}<span className="fv-brief-text">{it.text}</span>
      {"action" in it && it.action ? <button type="button" className="fv-text-button" onClick={() => go(it.action!.to)}>{it.action.label} <ArrowRight size={13} /></button> : <span />}
    </li>)}</ol>}
  </section>;
}

export function EventFeed({ events, go, dismiss }: { events: AutomationEvent[]; go: Go; dismiss: (id: string) => void }) {
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  if (!events.length) return null;
  const leave = (id: string) => { setLeaving((s) => new Set(s).add(id)); setTimeout(() => dismiss(id), 300); };
  return <div className="fv-auto-feed">
    <h3>From your automations</h3>
    <ul>{events.map((e, i) => { const Icon = e.kind === "alert" ? Bell : e.kind === "brief" ? CalendarClock : Info; return <li key={e.id} className={"fv-feed-item fv-rise is-" + e.kind + (leaving.has(e.id) ? " fv-leave" : "")} style={{ ["--i" as string]: Math.min(i, 6), maxHeight: 220 }}>
      <span className={"fv-feed-icon is-" + e.kind}><Icon size={14} /></span>
      <div><strong>{e.status === "new" && <span className="fv-unread" aria-label="New" />}{e.title}</strong><small>{e.lines[0]}</small><em>{ago(e.createdAt)}</em></div>
      {e.action && e.kind !== "brief" ? <button type="button" className="fv-text-button" onClick={() => go(e.action!)}>{e.action.kind === "supply" ? "Put it to work" : e.action.kind === "swap" ? "Review a swap" : "Open"} <ArrowRight size={13} /></button> : <span />}
      <button type="button" className="fv-icon-button" aria-label="Dismiss" onClick={() => leave(e.id)}><X size={14} /></button>
    </li>; })}</ul>
  </div>;
}
