"use client";
// Policy · "Who holds authority". Five separate things, each shown from its own source:
// local evaluation (saved policy), on-chain proposal acceptance (GET /api/policy-contract, finalized views),
// owner approval (your wallet), fund authority (none, stated verbatim by the backend) and verified outcome
// (the journals). Nothing here signs: an owner call is prepared unsigned and only shown for review.
import { useEffect, useState } from "react";
import { api, type Scope } from "./live";

interface ContractState {
  status: "not_deployed" | "configured" | "unreachable";
  contractId: string | null;
  note: string;
  authority: string;
  owner?: string | null;
  ownerIsAccount?: boolean;
  plan?: { version: string; venues: string[]; methods: { receiver: string; method: string }[]; per_action_cap: string; daily_cap: string } | null;
  agents?: string[];
  proposals?: { id: string; agent: string; status: string; plan_version: string; action: { kind: string; venue: string; method: string; amount: string } }[];
  capturedAt: string;
}
interface OwnerCall {
  contractId: string;
  method: string;
  transactions: { receiverId: string; actions: { params: { methodName: string; gas: string; deposit: string; args: unknown } }[] }[];
}

type Row = { k: string; tag: string; tone: "on" | "off" | "warn"; v: string; extra?: React.ReactNode };
const TONE = {
  on: ["var(--fvb-E2EAD6)", "var(--fvc-2F552D)"],
  off: ["var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  warn: ["var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
} as const;
const btn: React.CSSProperties = {
  padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)",
  color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer",
};

export function PolicyContractCard({ scope, policyVersion, live }: { scope: Scope; policyVersion: number | null; live: boolean }) {
  const [state, setState] = useState<{ s: ContractState | null; err: string | null } | null>(null);
  const [call, setCall] = useState<{ c: OwnerCall | null; err: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let on = true;
    api("/api/policy-contract", undefined, "GET", scope).then(
      (s: ContractState) => on && setState({ s, err: null }),
      (e) => on && setState({ s: null, err: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      on = false;
    };
  }, [scope]);

  const s = state?.s ?? null;
  const prepareSetPlan = async () => {
    setBusy(true);
    try {
      setCall({ c: await api("/api/policy-contract", { method: "set_plan" }, "POST", scope), err: null });
    } catch (e) {
      setCall({ c: null, err: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onchainVersion = s?.plan?.version ?? null;
  const pending = (s?.proposals ?? []).filter((p) => p.status === "pending");
  const rows: Row[] = [
    {
      k: "Local policy evaluation",
      tag: "ACTIVE",
      tone: "on",
      v: `FlowVault checks every plan step against your saved policy${policyVersion !== null ? " (revision " + policyVersion + ")" : ""} when it prepares the step and again at wallet handoff.`,
    },
    !s
      ? { k: "On-chain proposal acceptance", tag: state?.err ? "UNKNOWN" : "CHECKING", tone: "off", v: state?.err ? "The contract status couldn’t be read: " + state.err : "Reading the policy contract…" }
      : s.status === "not_deployed"
        ? { k: "On-chain proposal acceptance", tag: "NOT DEPLOYED", tone: "off", v: s.note }
        : s.status === "unreachable"
          ? { k: "On-chain proposal acceptance", tag: "UNREACHABLE", tone: "warn", v: s.note }
          : {
              k: "On-chain proposal acceptance",
              tag: "CONFIGURED",
              tone: onchainVersion ? "on" : "warn",
              v:
                `${s.contractId} (finalized read ${new Date(s.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}). ` +
                (onchainVersion ? `On-chain plan version ${onchainVersion}.` : "No plan published on-chain yet.") +
                ` ${(s.agents ?? []).length} agent${(s.agents ?? []).length === 1 ? "" : "s"} registered · ${pending.length} pending proposal${pending.length === 1 ? "" : "s"}.`,
              extra: pending.length ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px", color: "var(--fvc-5B6458)" }}>
                  {pending.slice(0, 5).map((p) => (
                    <li key={p.id}>#{p.id} from {p.agent}: {p.action.kind} via {p.action.venue} ({p.action.method}) · plan v{p.plan_version}</li>
                  ))}
                </ul>
              ) : null,
            },
    {
      k: "Owner approval",
      tag: "ACTIVE",
      tone: "on",
      v:
        "You review each plan and approve every signed step in your own wallet. New debt and staking also need an explicit approval in the plan first." +
        (s?.status === "configured" ? (s.ownerIsAccount ? " You own the policy contract." : ` The policy contract’s owner is ${s.owner ?? "unknown"}, not this account.`) : ""),
    },
    { k: "Fund authority", tag: "NONE", tone: "off", v: s?.authority ?? "FlowVault and its assistant hold no keys, allowance or delegated access. Only your wallet can move funds." },
    { k: "Verified outcome", tag: "ACTIVE", tone: "on", v: "A step counts as done only from finalized NEAR receipts or an independent destination-chain proof, never because a provider or model says so." },
  ];
  const canPublish = live && s?.status === "configured" && s.ownerIsAccount;

  return (
    <section aria-label="Who holds authority" style={{ borderRadius: "18px", padding: "20px", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 600 }}>Who holds authority</h3>
      <p style={{ margin: "0 0 12px", fontSize: "12.5px", color: "var(--fvc-6F786B)", lineHeight: 1.45 }}>
        Five separate things, each from its own source.{" "}
        {s?.status === "configured" ? "The on-chain row reads the contract’s finalized state." : "Only local evaluation, your approval and verified outcomes are active in this build."}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
        {rows.map((r) => (
          <li key={r.k} style={{ fontSize: "13px", lineHeight: 1.45 }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{r.k}</span>
              <span style={{ padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", background: TONE[r.tone][0], color: TONE[r.tone][1] }}>{r.tag}</span>
            </div>
            <div style={{ color: "var(--fvc-5B6458)", marginTop: "2px" }}>{r.v}</div>
            {r.extra}
          </li>
        ))}
      </ul>
      {canPublish ? (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--fvb-EEF0E8)", fontSize: "12.5px", color: "var(--fvc-5B6458)" }}>
          <div>
            Your saved policy is revision {policyVersion ?? "—"}; the contract holds plan version {onchainVersion ?? "none"}. Publishing records your saved rules on-chain as the next plan version. It moves no funds and grants no authority.
          </div>
          <button type="button" style={{ ...btn, marginTop: "8px" }} disabled={busy} onClick={() => void prepareSetPlan()}>
            {busy ? "Preparing…" : "Prepare the unsigned publish call"}
          </button>
          {call?.err ? <p role="alert" style={{ margin: "8px 0 0", color: "var(--fvc-9A3F32)" }}>{call.err}</p> : null}
          {call?.c ? (
            <p style={{ margin: "8px 0 0" }}>
              Unsigned: {call.c.transactions[0]?.actions[0]?.params.methodName} on {call.c.contractId}, {Number(call.c.transactions[0]?.actions[0]?.params.gas ?? 0) / 1e12} Tgas, {call.c.transactions[0]?.actions[0]?.params.deposit} yoctoNEAR (returned by the contract). Signing owner calls isn’t wired into FlowVault yet; it only becomes real when the next finalized read shows the new version.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
