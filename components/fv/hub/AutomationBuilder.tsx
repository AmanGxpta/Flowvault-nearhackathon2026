"use client";
// Build or edit an automation: choose what it does, set the details (time, day, amount, asset, share), and see in a
// sentence what will happen and when it next runs before saving. Nothing here signs or moves funds.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Bell, CalendarClock, Check, Repeat, Scale, TrendingUp, X } from "lucide-react";
import { checkAutomation, DAYS, describe, nextRun, template, type Automation, type AutomationKind } from "@/lib/flowvault/automations";

export const KIND_ICON: Record<AutomationKind, typeof Bell> = { brief: CalendarClock, sweep: Repeat, idle_alert: Bell, allocation_alert: Scale, price_alert: TrendingUp };
const KINDS: { kind: AutomationKind; name: string; blurb: string }[] = [
  { kind: "brief", name: "Daily brief", blurb: "A summary of your money each morning, with what to do next." },
  { kind: "sweep", name: "Weekly surplus sweep", blurb: "Proposes supplying spare USDC to Rhea, for your approval." },
  { kind: "idle_alert", name: "Idle cash alert", blurb: "Tells you when stablecoins pile up doing nothing." },
  { kind: "allocation_alert", name: "Allocation alert", blurb: "Tells you when one asset gets too big a share." },
  { kind: "price_alert", name: "Price move alert", blurb: "Tells you when an asset moves a lot in a day." },
];
const tz = () => -new Date().getTimezoneOffset();
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AutomationBuilder({ editing, assets, close, save }: {
  editing?: Automation | null;
  /** Assets the owner holds, offered for allocation and price alerts. */
  assets: string[];
  close: () => void;
  save: (draft: Pick<Automation, "kind" | "schedule" | "params">, id?: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<AutomationKind | null>(editing?.kind ?? null);
  const [draft, setDraft] = useState<Pick<Automation, "kind" | "schedule" | "params"> | null>(editing ? { kind: editing.kind, schedule: editing.schedule, params: editing.params } : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [now] = useState(() => Date.now());
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) close(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [busy, close]);
  const pick = (k: AutomationKind) => { setKind(k); setDraft(template(k, tz())); setError(""); };
  const set = (patch: Partial<Automation["schedule"]> | null, params?: Partial<Automation["params"]>) => setDraft((d) => d && ({ ...d, schedule: { ...d.schedule, ...(patch ?? {}) }, params: { ...d.params, ...(params ?? {}) } }));
  const problem = draft ? checkAutomation(draft) : null;
  const d = draft ? describe(draft) : null;
  const next = draft && !problem ? nextRun(draft, now) : null;
  const assetList = [...new Set(["ETH", "NEAR", "SOL", "BTC", ...assets.map((a) => a.toUpperCase())])].slice(0, 16);
  async function submit() {
    if (!draft || problem) return;
    setBusy(true); setError("");
    try { await save(draft, editing?.id); close(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return createPortal(<div className="fv-dialog-backdrop fv-fadein" onClick={() => { if (!busy) close(); }}>
    <div className="fv-dialog fv-auto-builder fv-pop" role="dialog" aria-modal="true" aria-label={editing ? "Edit automation" : "New automation"} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>
      {!kind || !draft ? <>
        <h2>New automation</h2>
        <p className="fv-muted">Automations watch your money on a schedule and tell you what&apos;s worth doing. They never sign or move funds.</p>
        <div className="fv-auto-kinds">{KINDS.map((k, i) => { const Icon = KIND_ICON[k.kind]; return <button type="button" key={k.kind} className="fv-rise" style={{ ["--i" as string]: i }} onClick={() => pick(k.kind)}><span className="fv-auto-icon"><Icon size={17} /></span><span><strong>{k.name}</strong><small>{k.blurb}</small></span></button>; })}</div>
      </> : <div className="fv-fadein" key={kind}>
        {!editing && <button type="button" className="fv-text-button" onClick={() => { setKind(null); setDraft(null); }}><ArrowLeft size={14} /> All automations</button>}
        <h2>{KINDS.find((k) => k.kind === kind)!.name}</h2>
        <div className="fv-auto-fields">
          {draft.schedule.every === "week" && <label>Day<span className="fv-day-chips">{DAYS.map((name, i) => <button type="button" key={name} aria-pressed={draft.schedule.day === i} onClick={() => set({ day: i })}>{name.slice(0, 3)}</button>)}</span></label>}
          {draft.schedule.every !== "always" && <label>Time<input type="time" value={draft.schedule.at ?? "08:00"} onChange={(e) => set({ at: e.target.value })} /></label>}
          {kind === "idle_alert" && <label>When idle stablecoins exceed<span className="fv-money-input">$<input inputMode="decimal" value={String(draft.params.thresholdUsd ?? "")} onChange={(e) => set(null, { thresholdUsd: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></span></label>}
          {(kind === "allocation_alert" || kind === "price_alert") && <label>Asset<select value={draft.params.asset ?? "ETH"} onChange={(e) => set(null, { asset: e.target.value })}>{assetList.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>}
          {(kind === "allocation_alert" || kind === "price_alert") && <label>{kind === "allocation_alert" ? "More than this share of my portfolio" : "Moves at least this much in a day"}<span className="fv-range"><input type="range" min={kind === "allocation_alert" ? 5 : 1} max={kind === "allocation_alert" ? 95 : 30} value={Number(draft.params.pct ?? 0)} onChange={(e) => set(null, { pct: Number(e.target.value) })} /><b>{draft.params.pct}%</b></span></label>}
        </div>
        <div className="fv-auto-preview" aria-live="polite">
          <strong>{d!.title}</strong><span>{d!.sub}</span>
          <small>{problem ?? (draft.schedule.every === "always" ? "Checked every 30 minutes; it speaks at most once a day." : `First run ${when(next!)}.`)}</small>
        </div>
        {error && <p className="fv-notice" role="alert">{error}</p>}
        <div className="fv-confirm-actions"><button type="button" className="fv-button fv-primary fv-wide-button" disabled={!!problem || busy} onClick={() => void submit()}><Check size={15} /> {busy ? "Saving…" : editing ? "Save changes" : "Turn it on"}</button></div>
      </div>}
    </div>
  </div>, document.body);
}
