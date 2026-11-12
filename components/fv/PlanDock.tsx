"use client";
// Persistent action-plan surface. One plan follows the owner across Assistant, Pay, Strategies, Credit,
// the wallet handoff and Activity. Every figure comes from the saved plan (engine output); this component
// only reviews, prepares through /api/plans, hands prepared journal records to the existing wallet flow,
// and reconciles. It never signs, and an example plan can never be prepared.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionPlan, FundingChoice, PlanStep } from "@/lib/flowvault/contracts";
import { api, type Scope } from "./live";
import { reasonText } from "./live-adapt";
import { dlabel, money } from "./format";
import { missingEntries, planPolicySteps, stepEntries, withEntries, type PolicyEntry } from "@/lib/flowvault/plans-policy";

type Plan = ActionPlan & {
  title?: string;
  evidence?: string;
  recommendedChoiceId?: string;
  figures?: { label: string; value: string | null; engine: string }[];
  collateral?: { asset: string; amountRaw: string }[];
};
type PolicyRead = { policy: { venues: string[]; methods: { receiver: string; method: string }[]; version?: number }; revision: number };
const ENDED = ["completed", "cancelled", "expired", "superseded", "failed"];
type Preparation = { attemptId: string; kind: string; accountId: string };
export interface PlanDockProps {
  scope: Scope;
  sign: (preparation: Preparation) => Promise<unknown>;
  canSign: boolean;
}

/** Other screens open a plan without re-entering anything: dispatch fv:plan-open with {planId} or {plan}. */
export function openPlan(detail: { planId?: string; plan?: unknown; note?: string }) {
  window.dispatchEvent(new CustomEvent("fv:plan-open", { detail }));
}
/** Creates (idempotently) and opens a plan for an objective, e.g. from Pay, Strategies or Credit. */
export async function startPlan(body: { objective: string; obligationId?: string; venue?: string; amountRaw?: string; positionId?: string }) {
  const key = crypto.randomUUID();
  try {
    const r = await api("/api/plans", { key, ...body });
    openPlan({ plan: r.plan });
    return r.plan as Plan;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    window.dispatchEvent(new CustomEvent("fv:plan-error", { detail: m }));
    throw e;
  }
}

const IN_FLIGHT = ["awaiting_wallet", "submitted", "unknown", "partial"];
const STEP_LABEL: Record<string, string> = {
  supply: "Supply to Rhea", withdraw: "Withdraw from Rhea", stake: "Stake NEAR for LiNEAR", unstake: "Unstake LiNEAR",
  withdraw_unstaked: "Claim unstaked NEAR from LiNEAR", native_stake: "Stake with a validator", native_unstake: "Unstake from the validator",
  native_withdraw: "Withdraw unstaked NEAR from the validator", collateral_add: "Add collateral", borrow: "Borrow", repay: "Repay",
  collateral_release: "Release collateral", pay_quote: "Get a live exact-output quote", pay_deposit: "Deposit to the 1Click address",
  verify_payout: "Verify the payout on the destination chain", wait_until: "Wait",
};
const STATE_LABEL: Record<string, string> = {
  pending: "waiting for the step before", ready: "ready", prepared: "prepared · not signed", awaiting_wallet: "in your wallet",
  submitted: "submitted · verifying", confirmed: "confirmed", partial: "partial", failed: "failed", unknown: "status unknown", skipped: "skipped",
};
const PLAN_STATE: Record<string, [string, string, string]> = {
  draft: ["DRAFT", "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  evaluated: ["READY TO REVIEW", "var(--fvb-E2EAD6)", "var(--fvc-3F6B3C)"],
  reviewed: ["REVIEWED", "var(--fvb-E2EAD6)", "var(--fvc-3F6B3C)"],
  executing: ["IN PROGRESS", "var(--fvb-EEF3F9)", "var(--fvc-3F5A7A)"],
  partial: ["PARTIAL · NEEDS ATTENTION", "var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
  completed: ["COMPLETED · VERIFIED", "var(--fvb-E2EAD6)", "var(--fvc-2F552D)"],
  failed: ["FAILED", "var(--fvb-F6E3DE)", "var(--fvc-9A3F32)"],
  blocked: ["BLOCKED BY THE ENGINES", "var(--fvb-F6E3DE)", "var(--fvc-9A3F32)"],
  superseded: ["SUPERSEDED", "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  expired: ["EXPIRED", "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  cancelled: ["CANCELLED", "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
};
const OBJECTIVE: Record<string, string> = {
  deploy_surplus: "Put surplus to work", pay_obligation: "Pay a calendar payment", borrow: "Borrow under stress limits",
  repay: "Repay a loan", respond_to_change: "Respond to a changed payment", stake: "Stake", unstake: "Unstake",
  withdraw: "Withdraw", access_cash: "Access cash",
};

const code = (c: string) => {
  const [head, tail] = c.split(/:(.*)/s);
  if (head === "NO_EXECUTION_ADAPTER") return "No execution path for " + (STEP_LABEL[tail] ?? tail).toLowerCase() + " yet";
  if (head === "PROTECTED_ASSET") return tail + " is protected by your policy";
  if (tail && /^[A-Z_]+$/.test(head)) return reasonText([head]) + ": " + tail.trim();
  return reasonText([c]);
};
const STAKING_STEPS = ["stake", "unstake", "withdraw_unstaked", "native_stake", "native_unstake", "native_withdraw"];
/** Raw 24-decimal NEAR/LiNEAR as text, up to 4 decimals (display only). */
const raw24 = (r: string | null | undefined) => {
  if (r == null || !/^\d+$/.test(r)) return null;
  const n = BigInt(r);
  const whole = n / 10n ** 24n;
  const frac = ((n % 10n ** 24n) / 10n ** 20n).toString().padStart(4, "0").replace(/0+$/, "");
  return whole.toLocaleString() + (frac ? "." + frac : "");
};
const raw6 = (r: string | null | undefined) => {
  if (r == null) return null;
  try {
    const n = BigInt(r);
    const neg = n < 0n;
    const a = neg ? -n : n;
    return (neg ? "−" : "") + money((a / 1000000n).toString() + "." + (a % 1000000n).toString().padStart(6, "0"));
  } catch {
    return null;
  }
};

function stages(p: Plan) {
  const signed = p.steps.filter((s) => s.approval === "owner_wallet");
  const reachedWallet = signed.some((s) => IN_FLIGHT.includes(s.state) || s.state === "confirmed");
  const signedDone = signed.length > 0 && signed.every((s) => s.state === "confirmed" || s.state === "skipped") && signed.some((s) => s.state === "confirmed");
  const blocked = p.state === "blocked";
  return [
    { id: "understand", label: "Understand", done: true },
    { id: "evaluate", label: "Evaluate", done: !blocked, bad: blocked },
    { id: "review", label: "Review", done: !!p.selectedChoiceId },
    { id: "authorize", label: "Authorize", done: reachedWallet },
    { id: "sign", label: "Sign", done: signedDone },
    { id: "confirm", label: "Confirm result", done: p.state === "completed" },
  ];
}

const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
  padding: "9px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid var(--fvb-E3E6DB)",
  background: disabled ? "var(--fvb-F4F5EF)" : primary ? "var(--fvb-2B4233)" : "var(--fvb-FFFFFF)",
  color: disabled ? "var(--fvc-8A9285)" : primary ? "var(--fvc-EAF0E2)" : "var(--fvc-1E2A22)",
});

export function PlanDock({ scope, sign, canSign }: PlanDockProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [active, setActive] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, Preparation>>({});
  const panel = useRef<HTMLDivElement>(null);
  const planRef = useRef<Plan | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const loadActive = useCallback(async () => {
    try {
      const r = await api("/api/plans?active=1", undefined, "GET");
      setActive(r.plans ?? []);
      const cur = planRef.current;
      if (cur) {
        const fresh = (r.plans ?? []).find((p: Plan) => p.id === cur.id);
        if (fresh) setPlan(fresh);
      }
    } catch {
      setActive([]);
    }
  }, []);

  const refresh = useCallback(async (id: string) => {
    const r = await api("/api/plans/" + encodeURIComponent(id), undefined, "GET");
    setPlan(r.plan);
    if (r.warning) setNotice(r.warning);
    return r.plan as Plan;
  }, []);

  // Resume after navigation or a wallet redirect: active plans come back from the server, nothing is re-entered.
  // The parent keys this component by workspace scope, so switching Judge mode starts from a clean dock.
  useEffect(() => {
    const t = setTimeout(() => void loadActive(), 0);
    return () => clearTimeout(t);
  }, [scope, loadActive]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setError(null);
      setNotice(d.note ?? null);
      setOpen(true);
      if (d.plan) setPlan(d.plan);
      const id = d.planId ?? d.plan?.id;
      if (id) void refresh(id).catch((x) => setError(x instanceof Error ? x.message : String(x)));
      void loadActive();
      setTimeout(() => panel.current?.focus(), 30);
    };
    const onErr = (e: Event) => {
      setOpen(true);
      setError(String((e as CustomEvent).detail));
    };
    window.addEventListener("fv:plan-open", onOpen);
    window.addEventListener("fv:plan-error", onErr);
    window.addEventListener("fv:plans-refresh", loadActive);
    return () => {
      window.removeEventListener("fv:plan-open", onOpen);
      window.removeEventListener("fv:plan-error", onErr);
      window.removeEventListener("fv:plans-refresh", loadActive);
    };
  }, [refresh, loadActive]);

  // While money is in motion, reconcile from the journals every 8 s.
  const moving = !!plan && plan.steps.some((s) => IN_FLIGHT.includes(s.state));
  useEffect(() => {
    if (!open || !moving || !plan) return;
    const t = setInterval(() => void refresh(plan.id).catch(() => undefined), 8000);
    return () => clearInterval(t);
  }, [open, moving, plan, refresh]);

  // Default-deny policy: credit and staking steps may need entries the owner has not allowed yet (plans-policy.ts).
  const [policyRead, setPolicyRead] = useState<PolicyRead | null>(null);
  const [confirmAllow, setConfirmAllow] = useState(false);
  const gated = !!plan && !ENDED.includes(plan.state) && planPolicySteps(plan).some((x) => stepEntries(x.kind, x).length > 0);
  const planId = plan?.id;
  useEffect(() => {
    if (!gated || !planId) return;
    let live = true;
    api("/api/policy", undefined, "GET").then(
      (r) => live && setPolicyRead({ policy: r.policy, revision: r.revision }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gated, planId]);
  const missing: PolicyEntry[] = gated && policyRead && plan ? missingEntries(policyRead.policy, planPolicySteps(plan)) : [];

  const allowInPolicy = async () => {
    if (!plan) return;
    setBusy("policy");
    setError(null);
    try {
      // Re-read so the new revision is built on the current policy, then add exactly the missing entries.
      const fresh = await api("/api/policy", undefined, "GET");
      const entries = missingEntries(fresh.policy, planPolicySteps(plan));
      if (entries.length) await api("/api/policy", { revision: fresh.revision, policy: withEntries(fresh.policy, entries) }, "PUT");
      window.dispatchEvent(new CustomEvent("fv:workspace-refresh"));
      // A policy revision fences this plan; the same request is re-evaluated under the new revision.
      const r = await api("/api/plans", {
        key: crypto.randomUUID(),
        objective: plan.objective,
        ...(plan.request.obligationId ? { obligationId: plan.request.obligationId } : {}),
        ...(plan.objective === "access_cash" ? { amountRaw: plan.request.amountRaw, deadline: plan.request.deadline } : {}),
      });
      setPlan(r.plan);
      setConfirmAllow(false);
      setPolicyRead(null);
      setNotice(
        entries.length
          ? `Policy revision ${(fresh.policy.version ?? 0) + 1} saved with exactly: ${entries.map((e) => e.label).join("; ")}. This plan was re-evaluated under it.`
          : "Your policy already had these entries. This plan was re-evaluated.",
      );
      void loadActive();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (label: string, body: Record<string, unknown>) => {
    if (!plan) return null;
    setBusy(label);
    setError(null);
    try {
      const r = await api("/api/plans/" + encodeURIComponent(plan.id), body);
      setPlan(r.plan);
      if (r.preparation && typeof body.stepId === "string") setPrepared((m) => ({ ...m, [body.stepId as string]: r.preparation }));
      void loadActive();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handToWallet = async (step: PlanStep) => {
    const prep = prepared[step.id];
    if (!plan || !prep) return;
    setBusy("wallet");
    setError(null);
    try {
      await api("/api/plans/" + encodeURIComponent(plan.id), { action: "handoff", stepId: step.id });
      await sign(prep);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      await refresh(plan.id).catch(() => undefined);
    }
  };

  if (!open) {
    const live = active.filter((p) => !["completed", "cancelled", "expired", "superseded", "blocked", "failed"].includes(p.state) || p.steps.some((s) => IN_FLIGHT.includes(s.state)));
    if (!live.length) return null;
    const p = live[0];
    return (
      <button
        type="button"
        onClick={() => openPlan({ planId: p.id })}
        aria-label={"Open action plan: " + (p.title ?? OBJECTIVE[p.objective])}
        style={{ position: "fixed", right: "24px", bottom: "24px", zIndex: 55, display: "flex", alignItems: "center", gap: "10px", padding: "11px 16px", borderRadius: "999px", border: "1px solid var(--fvb-2B4233)", background: "var(--fvb-2B4233)", color: "var(--fvc-EAF0E2)", fontSize: "13px", fontWeight: 600, boxShadow: "0 10px 26px rgba(0,0,0,.18)", cursor: "pointer", maxWidth: "380px" }}
      >
        <span aria-hidden style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.steps.some((s) => IN_FLIGHT.includes(s.state)) ? "var(--fvb-C08A45)" : "var(--fvb-9DB48C)" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Plan · {p.title ?? OBJECTIVE[p.objective]}</span>
        <span style={{ opacity: 0.75 }}>{live.length > 1 ? "+" + (live.length - 1) : ""}</span>
      </button>
    );
  }

  const st = plan ? PLAN_STATE[plan.state] ?? [plan.state.toUpperCase(), "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"] : null;
  const example = plan?.source === "demo";
  const choice = plan?.alternatives.find((a) => a.id === plan.selectedChoiceId);
  const eligible = plan?.alternatives.filter((a) => a.eligible) ?? [];
  const nextStep = plan?.steps.find((s) => s.state === "ready" || s.state === "prepared");

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="complementary"
      aria-label="Action plan"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      style={{ position: "fixed", top: "12px", right: "12px", bottom: "12px", width: "min(440px, calc(100vw - 24px))", zIndex: 58, display: "flex", flexDirection: "column", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)", borderRadius: "16px", boxShadow: "0 18px 50px rgba(0,0,0,.18)", outline: "none", overflow: "hidden" }}
    >
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--fvb-EEF0E8)", display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "11px", letterSpacing: ".08em", fontWeight: 700, color: example ? "var(--fvc-8A5F25)" : "var(--fvc-3F6B3C)" }}>
            {plan ? (example ? "EXAMPLE · FICTIONAL · NOTHING CAN BE SIGNED" : "LIVE · YOU APPROVE EVERY STEP IN YOUR WALLET") : "ACTION PLAN"}
          </div>
          <h2 style={{ margin: "6px 0 0", fontSize: "16px", lineHeight: 1.3, color: "var(--fvc-1E2A22)" }}>{plan?.title ?? (plan ? OBJECTIVE[plan.objective] : "Loading plan…")}</h2>
          {st ? (
            <span style={{ display: "inline-block", marginTop: "8px", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, letterSpacing: ".04em", background: st[1], color: st[2] }}>{st[0]}</span>
          ) : null}
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimize the plan" style={{ ...btn(false), padding: "6px 10px" }}>—</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {error ? <div role="alert" style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--fvb-F6E3DE)", color: "var(--fvc-9A3F32)", fontSize: "13px" }}>{error}</div> : null}
        {notice ? <div role="status" style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--fvb-F6EBDD)", color: "var(--fvc-7A521E)", fontSize: "13px" }}>{notice}</div> : null}

        {plan ? (
          <>
            <ol aria-label="Plan stages" style={{ display: "flex", gap: "4px", listStyle: "none", margin: 0, padding: 0 }}>
              {stages(plan).map((x, i) => (
                <li key={x.id} title={x.label} style={{ flex: 1, textAlign: "center", fontSize: "10.5px", color: x.bad ? "var(--fvc-9A3F32)" : x.done ? "var(--fvc-2F552D)" : "var(--fvc-8A9285)" }}>
                  <div aria-hidden style={{ height: "4px", borderRadius: "2px", marginBottom: "5px", background: x.bad ? "var(--fvb-B4543F)" : x.done ? "var(--fvb-4E7A4A)" : "var(--fvb-E3E6DB)" }} />
                  <span>{i + 1}. {x.label}</span>
                  <span className="fv-sr">{x.bad ? " — blocked" : x.done ? " — done" : " — not yet"}</span>
                </li>
              ))}
            </ol>

            <section aria-label="What was understood" style={{ fontSize: "13px", color: "var(--fvc-4A5349)", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{OBJECTIVE[plan.objective] ?? plan.objective}</div>
              {plan.request.text ? <div>You asked: “{plan.request.text}”</div> : null}
              <div style={{ color: "var(--fvc-8A9285)", fontSize: "12px" }}>
                {plan.createdBy === "assistant" ? "Proposed by Ask FlowVault · figures from the engines" : plan.createdBy === "monitor" ? "Proposed by monitoring · nothing is approved or signed until you review it" : "Started by you · figures from the engines"}
                {plan.evidence ? " · " + plan.evidence : ""}
              </div>
            </section>

            {plan.figures?.length ? (
              <section aria-label="Engine figures">
                <h3 style={H3}>Engine figures</h3>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: "6px", columnGap: "12px", fontSize: "13px" }}>
                  {plan.figures.map((f) => (
                    <div key={f.label} style={{ display: "contents" }}>
                      <dt style={{ color: "var(--fvc-5B6458)" }}>{f.label}</dt>
                      <dd style={{ margin: 0, textAlign: "right", fontWeight: 600, color: "var(--fvc-1E2A22)" }} title={"from " + f.engine}>{f.value === null ? "Unknown" : /^-?\d+(\.\d+)?$/.test(f.value) ? money(f.value) : f.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {plan.state === "blocked" || plan.state === "superseded" || plan.state === "expired" ? (
              <section aria-label="Why" style={{ padding: "12px", borderRadius: "10px", background: "var(--fvb-F7F8F3)", fontSize: "13px", color: "var(--fvc-4A5349)" }}>
                <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)", marginBottom: "4px" }}>
                  {plan.state === "blocked" ? "Why the engines refused" : plan.state === "superseded" ? "What changed" : "Why it expired"}
                </div>
                <ul style={{ margin: 0, paddingLeft: "18px" }}>
                  {[...new Set(plan.blockedReasons)].slice(0, 8).map((r) => <li key={r}>{code(r)}</li>)}
                </ul>
                {plan.state === "blocked" ? <div style={{ marginTop: "6px" }}>The alternatives below are every route the engines checked, with the reason each one is unavailable.</div> : <div style={{ marginTop: "6px" }}>Ask again for a fresh plan with current figures. Steps already in your wallet are still tracked.</div>}
              </section>
            ) : null}

            <section aria-label="Alternatives">
              <h3 style={H3}>{plan.selectedChoiceId ? "Your choice" : "Alternatives the engines established"}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(plan.selectedChoiceId ? plan.alternatives.filter((a) => a.id === plan.selectedChoiceId) : plan.alternatives).map((a) => (
                  <Alt key={a.id} a={a} recommended={a.id === plan.recommendedChoiceId} canChoose={!plan.selectedChoiceId && (plan.state === "evaluated" || plan.state === "reviewed")} busy={busy} onChoose={() => act("review", { action: "review", choiceId: a.id })} />
                ))}
              </div>
              {!plan.selectedChoiceId && plan.state === "evaluated" && eligible.length ? (
                <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--fvc-8A9285)" }}>Choosing an alternative only reviews it. Nothing is prepared until you prepare a step, and nothing moves until you approve it in your wallet.</p>
              ) : null}
            </section>

            {missing.length ? (
              <section aria-label="Policy entries needed" style={{ padding: "12px", borderRadius: "10px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFF6E8)", fontSize: "13px", color: "var(--fvc-4A5349)" }}>
                <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>Your policy doesn’t allow this yet</div>
                <div style={{ marginTop: "4px" }}>Policy is default-deny, so preparing these steps would be refused. Missing:</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                  {missing.map((e) => <li key={e.label}>{e.label}</li>)}
                </ul>
                {confirmAllow ? (
                  <>
                    <p style={{ margin: "8px 0 0" }}>
                      Saving adds {missing.length === 1 ? "exactly this entry" : "exactly these " + missing.length + " entries"} as policy revision {(policyRead?.policy.version ?? 0) + 1}. Caps, protected assets and every other rule stay as they are. This plan is then re-evaluated under the new revision; nothing is prepared or signed.
                    </p>
                    <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={() => void allowInPolicy()}>{busy === "policy" ? "Saving…" : "Save revision " + ((policyRead?.policy.version ?? 0) + 1)}</button>
                      <button type="button" style={btn(false, !!busy)} disabled={!!busy} onClick={() => setConfirmAllow(false)}>Not now</button>
                    </div>
                  </>
                ) : (
                  <button type="button" style={{ ...btn(false, !!busy), marginTop: "8px" }} disabled={!!busy} onClick={() => setConfirmAllow(true)}>Allow in Policy…</button>
                )}
              </section>
            ) : null}

            {choice ? (
              <section aria-label="Effects">
                <h3 style={H3}>Effects if every step completes</h3>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: "6px", columnGap: "12px", fontSize: "13px" }}>
                  <dt style={DT}>Reserve after</dt><dd style={DD}>{raw6(plan.effects.reserveAfterUsdcRaw) ?? "Unknown"}</dd>
                  <dt style={DT}>Debt after</dt><dd style={DD}>{raw6(plan.effects.debtAfterUsdcRaw) ?? "Unknown"}</dd>
                  <dt style={DT}>Costs (most)</dt><dd style={DD}>{raw6(plan.effects.costsUsdcRaw) ?? "Unknown until quoted"}</dd>
                  {plan.effects.exposure.map((x) => (
                    <div key={x.asset} style={{ display: "contents" }}>
                      <dt style={DT}>{x.asset}</dt>
                      <dd style={DD}>{x.decimals === 6 ? raw6(x.deltaRaw) : x.deltaRaw}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {plan.steps.length ? (
              <section aria-label="Steps">
                <h3 style={H3}>Steps</h3>
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
                  {plan.steps.map((s, i) => (
                    <StepRow
                      key={s.id}
                      n={i + 1}
                      s={s}
                      isNext={nextStep?.id === s.id}
                      example={example}
                      canSign={canSign}
                      busy={busy}
                      prep={prepared[s.id]}
                      needsDebtApproval={plan.approvals.some((x) => x.stepId === s.id && (x.kind === "new_debt" || x.kind === "stake") && !x.grantedAt)}
                      debtApproved={plan.approvals.some((x) => x.stepId === s.id && (x.kind === "new_debt" || x.kind === "stake") && !!x.grantedAt)}
                      onApprove={() => act("approve", { action: "approve", stepId: s.id })}
                      onPrepare={() => act("prepare", { action: "prepare", stepId: s.id })}
                      onWallet={() => handToWallet(s)}
                    />
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--fvc-6F786B)" }}>{error ? "" : "Loading the saved plan…"}</p>
        )}

        {active.length > 1 ? (
          <section aria-label="Other active plans">
            <h3 style={H3}>Other active plans</h3>
            {active.filter((p) => p.id !== plan?.id).slice(0, 4).map((p) => (
              <button key={p.id} type="button" onClick={() => openPlan({ planId: p.id })} style={{ ...btn(false), display: "block", width: "100%", textAlign: "left", marginBottom: "6px", fontWeight: 500 }}>
                {p.title ?? OBJECTIVE[p.objective]} · <span style={{ color: "var(--fvc-8A9285)" }}>{(PLAN_STATE[p.state] ?? [p.state])[0].toLowerCase()}</span>
              </button>
            ))}
          </section>
        ) : null}
      </div>

      {plan ? (
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--fvb-EEF0E8)", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" style={btn(false, !!busy)} disabled={!!busy} onClick={() => act("check", { action: "check" })}>{busy === "check" ? "Checking…" : "Check status"}</button>
          {!["completed", "cancelled", "expired", "superseded"].includes(plan.state) ? (
            <button type="button" style={btn(false, !!busy || moving)} disabled={!!busy || moving} onClick={() => act("cancel", { action: "cancel" })} title={moving ? "A step is in your wallet; track it instead" : undefined}>Cancel plan</button>
          ) : null}
          <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--fvc-8A9285)" }}>Saved · {new Date(plan.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ) : null}
    </aside>
  );
}

const H3: React.CSSProperties = { margin: "0 0 8px", fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--fvc-6F786B)" };
const DT: React.CSSProperties = { color: "var(--fvc-5B6458)" };
const DD: React.CSSProperties = { margin: 0, textAlign: "right", fontWeight: 600, color: "var(--fvc-1E2A22)" };

function Alt({ a, recommended, canChoose, busy, onChoose }: { a: FundingChoice; recommended: boolean; canChoose: boolean; busy: string | null; onChoose: () => void }) {
  const label = a.id === "idle-cash" ? "Idle wallet USDC" : a.id === "withdraw-then-pay" ? "Withdraw from Rhea, then pay" : a.id === "borrow" || a.id === "rhea-borrow" ? "Borrow on Rhea" : a.id.startsWith("sell-") ? "Sell " + a.id.slice(5).toUpperCase() : a.id === "rhea-usdc" ? "Rhea Lending (supply USDC)" : a.id.replace(/-/g, " ");
  return (
    <div style={{ border: "1px solid " + (a.eligible ? "var(--fvb-C9D9BF)" : "var(--fvb-E3E6DB)"), background: a.eligible ? "var(--fvb-F4F7EE)" : "var(--fvb-FFFFFF)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span aria-hidden style={{ color: a.eligible ? "var(--fvc-3F6B3C)" : "var(--fvc-9A3F32)", fontWeight: 700 }}>{a.eligible ? "✓" : "✕"}</span>
        <span style={{ fontWeight: 600, color: "var(--fvc-1E2A22)", flex: 1 }}>{label}{recommended ? <span style={{ marginLeft: "6px", fontSize: "10.5px", fontWeight: 700, color: "var(--fvc-3F6B3C)" }}>ENGINE PICK</span> : null}</span>
        {a.amountUsdcRaw !== "0" ? <span style={{ fontWeight: 600 }}>{raw6(a.amountUsdcRaw)}</span> : null}
      </div>
      <div style={{ marginTop: "4px", color: "var(--fvc-6F786B)", fontSize: "12px" }}>
        {a.eligible ? (
          <>
            {a.steps.map((k) => STEP_LABEL[k] ?? k).join(" → ") || "No steps"}
            {a.costsUsdcRaw ? " · costs up to " + raw6(a.costsUsdcRaw) : ""}
            {a.availableAt ? (a.availableAt <= new Date().toISOString().slice(0, 10) ? " · available now" : " · available by " + dlabel(a.availableAt)) : ""}
          </>
        ) : (
          <span className="fv-sr">Not available: </span>
        )}
        {!a.eligible ? a.reasons.map(code).join(" · ") : null}
      </div>
      {canChoose && a.eligible ? (
        <button type="button" style={{ ...btn(true, !!busy), marginTop: "8px" }} disabled={!!busy} onClick={onChoose}>{busy === "review" ? "Reviewing…" : "Review this choice"}</button>
      ) : null}
    </div>
  );
}

function StepRow({ n, s, isNext, example, canSign, busy, prep, needsDebtApproval, debtApproved, onPrepare, onWallet, onApprove }: { n: number; s: PlanStep; isNext: boolean; example: boolean; canSign: boolean; busy: string | null; prep?: Preparation; needsDebtApproval: boolean; debtApproved: boolean; onPrepare: () => void; onWallet: () => void; onApprove: () => void }) {
  // Staking steps move NEAR or LiNEAR; show that quantity first and the USDC value only as an estimate.
  const staking = STAKING_STEPS.includes(s.kind);
  const amount = staking && s.expected.amountRaw && s.expected.asset
    ? raw24(s.expected.amountRaw) + " " + s.expected.asset + (s.expected.usdcRaw && s.expected.usdcRaw !== "0" ? " (≈ " + raw6(s.expected.usdcRaw) + " USDC)" : "")
    : s.expected.usdcRaw ? raw6(s.expected.usdcRaw) + " USDC" : null;
  const isStake = s.kind === "stake" || s.kind === "native_stake";
  const tone = s.state === "confirmed" ? "var(--fvc-2F552D)" : s.state === "failed" ? "var(--fvc-9A3F32)" : IN_FLIGHT.includes(s.state) ? "var(--fvc-3F5A7A)" : "var(--fvc-6F786B)";
  const last = s.timeline.at(-1);
  const signed = s.approval === "owner_wallet";
  return (
    <li style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px", background: isNext ? "var(--fvb-F7F8F3)" : "var(--fvb-FFFFFF)" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
        <span style={{ color: "var(--fvc-8A9285)", fontWeight: 600 }}>{n}</span>
        <span style={{ flex: 1, fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{STEP_LABEL[s.kind] ?? s.kind}</span>
        <span style={{ fontSize: "12px", color: tone }}>{STATE_LABEL[s.state] ?? s.state}</span>
      </div>
      <div style={{ marginTop: "3px", fontSize: "12px", color: "var(--fvc-6F786B)" }}>
        {signed ? "Signer: " + (s.signer ?? "your account") + " · you approve in your wallet" : "No signature"}
        {amount ? " · " + (s.kind === "pay_deposit" ? "at most " : "") + amount : ""}
        {s.kind === "verify_payout" && s.expected.amountRaw && s.expected.asset ? " · exact " + s.expected.asset : ""}
        {(s.kind === "collateral_add" || s.kind === "collateral_release") && s.expected.amountRaw && s.expected.asset ? " · " + (Number(BigInt(s.expected.amountRaw) / 10n ** 18n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + s.expected.asset : ""}
        {s.kind === "borrow" ? (debtApproved ? " · new debt approved by you" : " · needs your explicit new-debt approval") : ""}
        {isStake ? (debtApproved ? " · stake approved by you" : " · needs your explicit approval (staked NEAR takes about 4 epochs to get back)") : ""}
        {staking && s.expected.venue ? " · " + (s.expected.venue === "linear-protocol.near" ? "LiNEAR" : "validator " + s.expected.venue) : ""}
        {s.kind === "wait_until" && s.expected.note ? " · until about " + new Date(s.expected.note).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}
        {s.expiresAt && s.state === "prepared" ? " · expires " + new Date(s.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
      </div>
      {last && (s.state !== "pending" && s.state !== "ready") ? <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--fvc-4A5349)" }}>{last.message}</div> : null}
      {isNext ? (
        <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {s.state === "ready" && needsDebtApproval ? (
            <button type="button" style={btn(true, !!busy || example)} disabled={!!busy || example} onClick={onApprove}>
              {busy === "approve" ? "Recording…" : isStake ? "Approve staking " + (raw24(s.expected.amountRaw) ?? "this amount") + " NEAR" : "Approve new debt of " + (raw6(s.expected.amountRaw) ?? "this amount") + " USDC"}
            </button>
          ) : null}
          {s.state === "ready" && !needsDebtApproval ? (
            <button type="button" style={btn(true, !!busy || example)} disabled={!!busy || example} onClick={onPrepare} title={example ? "Example plans can't be prepared" : undefined}>
              {busy === "prepare" ? "Preparing…" : s.kind === "pay_quote" ? "Get a live quote" : signed ? "Prepare for review" : "Run"}
            </button>
          ) : null}
          {s.state === "prepared" && signed && !prep && !example ? (
            <button type="button" style={btn(true, !!busy)} disabled={!!busy} onClick={onPrepare}>{busy === "prepare" ? "Loading…" : "Load the reviewed request"}</button>
          ) : null}
          {s.state === "prepared" && signed && prep ? (
            <button type="button" style={btn(true, !!busy || !prep || !canSign)} disabled={!!busy || !prep || !canSign} onClick={onWallet} title={!canSign ? "Connect the wallet that owns this account" : !prep ? "Prepare again to load the reviewed request" : undefined}>
              {busy === "wallet" ? "Waiting for wallet…" : "Open wallet to approve →"}
            </button>
          ) : null}
          {example ? <span style={{ fontSize: "12px", color: "var(--fvc-8A5F25)" }}>Example plan: nothing can be prepared or signed.</span> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Entry point button used by Pay, Strategies and Credit; opens the same persistent plan. */
export function PlanCta({ cta }: { cta?: { label: string; onClick: () => void; note?: string } | null }) {
  if (!cta) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <button type="button" onClick={cta.onClick} style={{ ...btn(true), padding: "10px 14px", fontSize: "13.5px" }}>{cta.label}</button>
      {cta.note ? <span style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{cta.note}</span> : null}
    </span>
  );
}

/** Activity: every saved plan for this workspace, newest first. Opening one resumes it in the dock. */
export function PlanHistory({ scope }: { scope: Scope }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      api("/api/plans", undefined, "GET").then(
        (r) => live && setPlans(r.plans ?? []),
        (e) => live && setErr(e instanceof Error ? e.message : String(e)),
      );
    const t = setTimeout(load, 0);
    window.addEventListener("fv:plans-refresh", load);
    return () => {
      live = false;
      clearTimeout(t);
      window.removeEventListener("fv:plans-refresh", load);
    };
  }, [scope]);
  if (err) return <p style={{ fontSize: "13px", color: "var(--fvc-9A3F32)" }}>Plans couldn’t be read: {err}</p>;
  if (!plans) return <p style={{ fontSize: "13px", color: "var(--fvc-8A9285)" }}>Reading saved plans…</p>;
  if (!plans.length) return <p style={{ fontSize: "13px", color: "var(--fvc-8A9285)" }}>No plans yet. Ask FlowVault, or use “Plan this payment” on Pay on a date.</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
      {plans.slice(0, 12).map((p) => {
        const st = PLAN_STATE[p.state] ?? [p.state.toUpperCase(), "var(--fvb-F4F5EF)", "var(--fvc-5B6458)"];
        const done = p.steps.filter((s) => s.state === "confirmed").length;
        return (
          <li key={p.id} style={{ display: "flex", gap: "12px", alignItems: "center", padding: "12px 14px", border: "1px solid var(--fvb-E3E6DB)", borderRadius: "12px", background: "var(--fvb-FFFFFF)", fontSize: "13.5px" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, color: "var(--fvc-1E2A22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title ?? OBJECTIVE[p.objective]}</span>
              <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                {p.createdBy === "assistant" ? "From Ask FlowVault" : p.createdBy === "monitor" ? "Proposed by monitoring" : "Started by you"} · {p.steps.length ? done + " of " + p.steps.length + " steps confirmed" : "not reviewed"} · {new Date(p.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </span>
            <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "10.5px", fontWeight: 700, background: st[1], color: st[2], whiteSpace: "nowrap" }}>{st[0]}</span>
            <button type="button" onClick={() => openPlan({ planId: p.id })} style={btn(false)} aria-label={"Open plan: " + (p.title ?? OBJECTIVE[p.objective])}>Open</button>
          </li>
        );
      })}
    </ul>
  );
}
