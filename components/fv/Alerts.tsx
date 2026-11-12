"use client";
// Monitoring alerts (Overview and Calendar). Reads /api/alerts, which runs the deterministic monitor on the
// same engine figures every screen uses. An alert's response is a PROPOSED plan opened in the plan panel;
// nothing here approves, prepares or signs anything.
import { useCallback, useEffect, useState } from "react";
import type { Alert } from "@/lib/flowvault/contracts";
import { api, type Scope } from "./live";
import { openPlan } from "./PlanDock";

type MonitorAlert = Alert & {
  figures?: { label: string; value: string | null; engine: string }[];
  proposal?: { objective: string; title?: string };
  proposalNote?: string;
};
interface Run {
  checkedAt: string;
  trigger: "read" | "manual" | "cron";
  evaluated: string[];
  skipped: { group: string; reason: string }[];
}
interface View {
  fictional: boolean;
  alerts: MonitorAlert[];
  resolved: MonitorAlert[];
  run: Run | null;
}

const SEV: Record<Alert["severity"], [string, string, string]> = {
  urgent: ["NEEDS YOU NOW", "var(--fvb-F6E3DE)", "var(--fvc-9A3F32)"],
  warn: ["COMING UP", "var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
  info: ["FOR YOUR RECORD", "var(--fvb-EEF3F9)", "var(--fvc-3F5A7A)"],
};
const KIND: Record<Alert["kind"], string> = {
  obligation_window: "Payment window",
  exit_threatens_payment: "Exit timing",
  reserve_shortfall: "Reserve",
  operation_attention: "Operation",
  debt_risk: "Loan health",
  recurrence_due: "Recurring payment",
};
const GROUP_LABEL: Record<string, string> = { capital: "Balance checks", credit: "Loan health checks", plans: "Operation checks" };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const btn = (primary: boolean): React.CSSProperties => ({
  padding: "8px 12px",
  borderRadius: "9px",
  border: primary ? "none" : "1px solid var(--fvb-E3E6DB)",
  background: primary ? "var(--fvb-2A4034)" : "var(--fvb-FFFFFF)",
  color: primary ? "var(--fvc-FFFFFF)" : "var(--fvc-1E2A22)",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

export function AlertsPanel({ scope, where }: { scope: Scope; where: "overview" | "calendar" }) {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    (check = false) => {
      setBusy(check);
      return api("/api/alerts", check ? { action: "check" } : undefined, check ? "POST" : "GET", scope).then(
        (r: View) => {
          setView(r);
          setErr(null);
          setBusy(false);
        },
        (e) => {
          setErr(e instanceof Error ? e.message : String(e));
          setBusy(false);
        },
      );
    },
    [scope],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const onRefresh = () => void load();
    window.addEventListener("fv:plans-refresh", onRefresh);
    return () => {
      clearTimeout(t);
      window.removeEventListener("fv:plans-refresh", onRefresh);
    };
  }, [load]);

  const dismiss = (id: string) =>
    api("/api/alerts", { action: "dismiss", id }, "POST", scope).then(
      (r: View) => setView((v) => (v ? { ...v, alerts: r.alerts, resolved: r.resolved } : r)),
      (e) => setErr(e instanceof Error ? e.message : String(e)),
    );

  const alerts = view?.alerts ?? [];
  const shown = where === "calendar" ? alerts.filter((a) => a.obligationId || a.kind === "reserve_shortfall") : alerts;
  return (
    <section
      aria-labelledby={"fv-alerts-" + where}
      style={{ marginTop: "28px", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)", borderRadius: "20px", padding: "22px 24px" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px 16px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "220px" }}>
          <h2 id={"fv-alerts-" + where} style={{ margin: 0, fontSize: "12px", letterSpacing: ".2em", fontWeight: 600, color: "var(--fvc-6F786B)" }}>
            {where === "calendar" ? "WATCHING THESE DATES" : "WATCHING YOUR MONEY"}
            {view?.fictional ? <span style={{ marginLeft: "8px", letterSpacing: ".08em", color: "var(--fvc-8A5F25)" }}>· FICTIONAL EXAMPLE</span> : null}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>
            {view?.run ? `Checked ${when(view.run.checkedAt)}${view.run.trigger === "cron" ? " by the scheduled check" : ""}` : err ? "" : "Checking…"} · alerts only propose plans; you review and sign
          </p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={busy} style={btn(false)} aria-busy={busy}>
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>
      {err ? <p style={{ margin: "14px 0 0", fontSize: "13px", color: "var(--fvc-9A3F32)" }}>Alerts couldn’t be checked: {err}</p> : null}
      {view?.run?.skipped.length ? (
        <p style={{ margin: "12px 0 0", fontSize: "12.5px", color: "var(--fvc-8A5F25)" }}>
          {view.run.skipped.map((s) => `${GROUP_LABEL[s.group] ?? s.group} skipped: ${s.reason}`).join(" · ")}. Existing alerts for those checks stay as they were.
        </p>
      ) : null}
      {view && !shown.length && !err ? (
        <p style={{ margin: "14px 0 0", fontSize: "14px", color: "var(--fvc-5B6458)" }}>
          {where === "calendar" ? "No payment needs preparing yet." : "Nothing needs you right now."}
        </p>
      ) : null}
      <ul style={{ listStyle: "none", margin: shown.length ? "14px 0 0" : 0, padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
        {shown.map((a) => {
          const sev = SEV[a.severity];
          const target = a.planId ?? a.proposedPlanId;
          return (
            <li key={a.id} style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "14px", padding: "14px 16px", background: a.severity === "urgent" ? "var(--fvb-F4ECE9)" : "var(--fvb-FFFFFF)" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", background: sev[1], color: sev[2] }}>{sev[0]}</span>
                <span style={{ fontSize: "12px", color: "var(--fvc-6F786B)", fontWeight: 600 }}>{KIND[a.kind]}</span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "14.5px", lineHeight: 1.5, color: "var(--fvc-1E2A22)", textWrap: "pretty" }}>{a.message}</p>
              {a.figures?.length ? (
                <dl style={{ margin: "10px 0 0", display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "12.5px" }}>
                  {a.figures.map((f) => (
                    <div key={f.label} style={{ display: "flex", gap: "6px" }}>
                      <dt style={{ color: "var(--fvc-8A9285)" }}>{f.label}</dt>
                      <dd style={{ margin: 0, fontWeight: 600, color: "var(--fvc-1E2A22)", fontVariantNumeric: "tabular-nums" }} title={"From " + f.engine}>
                        {f.value ?? "unknown"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {a.proposalNote && !target ? <p style={{ margin: "8px 0 0", fontSize: "12.5px", color: "var(--fvc-8A5F25)" }}>{a.proposalNote}</p> : null}
              <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                {target ? (
                  <button
                    type="button"
                    style={btn(true)}
                    onClick={() =>
                      openPlan({
                        planId: target,
                        note: a.planId ? "Your existing plan for this alert." : "Proposed by monitoring from engine figures. Nothing is approved or signed until you review it.",
                      })
                    }
                  >
                    {a.planId ? "Open your plan →" : "Review proposed plan →"}
                  </button>
                ) : a.proposal ? (
                  <span style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>Preparing a proposal… it appears after the next check.</span>
                ) : null}
                <button type="button" style={btn(false)} onClick={() => void dismiss(a.id)} aria-label={"Dismiss: " + a.message}>
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
