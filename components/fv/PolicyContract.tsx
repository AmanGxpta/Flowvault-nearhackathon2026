"use client";
// Policy · "Who holds authority". Five separate things, each shown from its own source:
// local evaluation (saved policy), on-chain proposal acceptance (GET /api/policy-contract, finalized views),
// owner approval (your wallet), fund authority (none, stated verbatim by the backend) and verified outcome
// (the journals). Owner controls (publish policy, agents, proposal decisions) prepare ONE unsigned call; only
// your wallet signs it, and a change counts only when the contract's next finalized read shows it.
import { useCallback, useEffect, useState } from "react";
import { api, type Scope } from "./live";
import { signPolicyOwnerCall } from "@/lib/flowvault/wallet";

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
  kind: string;
  accountId: string;
  contractId: string;
  method: string;
  transactions: { receiverId: string; actions: { type: string; params: { methodName: string; gas: string; deposit: string; args: unknown } }[] }[];
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
  const [call, setCall] = useState<{ c: OwnerCall | null; err: string | null; label?: string; before?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [outcome, setOutcome] = useState<string | null>(null);
  const read = useCallback(
    () =>
      api("/api/policy-contract", undefined, "GET", scope).then(
        (s: ContractState) => {
          setState({ s, err: null });
          return s;
        },
        (e) => {
          setState({ s: null, err: e instanceof Error ? e.message : String(e) });
          return null;
        },
      ),
    [scope],
  );
  useEffect(() => {
    const t = setTimeout(() => void read(), 0);
    return () => clearTimeout(t);
  }, [read]);

  const s = state?.s ?? null;
  /** A fingerprint of the finalized state an owner call should change, to verify the outcome after signing. */
  const fingerprint = (x: ContractState | null) =>
    JSON.stringify([x?.plan?.version ?? null, [...(x?.agents ?? [])].sort(), (x?.proposals ?? []).map((p) => p.id + ":" + p.status)]);
  const prepare = async (label: string, body: Record<string, string>) => {
    setBusy(true);
    setOutcome(null);
    try {
      setCall({ c: await api("/api/policy-contract", body, "POST", scope), err: null, label, before: fingerprint(s) });
    } catch (e) {
      setCall({ c: null, err: e instanceof Error ? e.message : String(e), label });
    } finally {
      setBusy(false);
    }
  };
  const signAndVerify = async () => {
    if (!call?.c) return;
    setBusy(true);
    try {
      await signPolicyOwnerCall(call.c);
      // Verification is the contract's finalized state, never the wallet's answer.
      const after = await read();
      setOutcome(
        after && fingerprint(after) !== call.before
          ? `${call.label}: confirmed in the contract’s finalized state.`
          : `${call.label}: signed, but the finalized state doesn’t show it yet. Check again in a few seconds.`,
      );
      setCall(null);
    } catch (e) {
      setCall({ ...call, err: e instanceof Error ? e.message : String(e) });
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
                    <li key={p.id}>
                      #{p.id} from {p.agent}: {p.action.kind} via {p.action.venue} ({p.action.method}) · plan v{p.plan_version}
                      {live && s.ownerIsAccount ? (
                        <span style={{ display: "inline-flex", gap: "6px", marginLeft: "8px" }}>
                          <button type="button" style={btn} disabled={busy} onClick={() => void prepare("Approve proposal #" + p.id, { method: "approve", opId: p.id })}>Approve…</button>
                          <button type="button" style={btn} disabled={busy} onClick={() => void prepare("Reject proposal #" + p.id, { method: "reject", opId: p.id })}>Reject…</button>
                        </span>
                      ) : null}
                    </li>
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
      {s?.status === "not_deployed" ? (
        <p style={{ margin: "14px 0 0", paddingTop: "12px", borderTop: "1px solid var(--fvb-EEF0E8)", fontSize: "12.5px", color: "var(--fvc-5B6458)", lineHeight: 1.5 }}>
          Deploying the contract is your action, not FlowVault’s: see <code>contracts/policy/README.md</code> (the owner-run script deploys to testnet only). Then set <code>FLOWVAULT_POLICY_CONTRACT</code>. This app reads mainnet contracts only, so a testnet deployment shows here as unreachable.
        </p>
      ) : null}
      {canPublish ? (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--fvb-EEF0E8)", fontSize: "12.5px", color: "var(--fvc-5B6458)", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            Your saved policy is revision {policyVersion ?? "—"}; the contract holds plan version {onchainVersion ?? "none"}. Owner calls record rules, agents or decisions in the contract. They move no funds and grant no authority; each needs your wallet signature and 1 yoctoNEAR, which the contract returns.
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" style={btn} disabled={busy} onClick={() => void prepare("Publish policy revision " + (policyVersion ?? ""), { method: "set_plan" })}>Publish saved policy…</button>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>Agents (propose only, never sign)</div>
            {(s?.agents ?? []).length ? (
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {(s?.agents ?? []).map((a) => (
                  <li key={a}>
                    {a}{" "}
                    <button type="button" style={btn} disabled={busy} onClick={() => void prepare("Remove agent " + a, { method: "remove_agent", agentId: a })}>Remove…</button>
                  </li>
                ))}
              </ul>
            ) : (
              <div>No agents registered.</div>
            )}
            <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
              <label className="fv-sr" htmlFor="fv-agent-id">Agent account</label>
              <input id="fv-agent-id" value={agentInput} onChange={(e) => setAgentInput(e.target.value.trim().toLowerCase())} placeholder="agent.near" style={{ padding: "7px 10px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px" }} />
              <button type="button" style={btn} disabled={busy || !agentInput} onClick={() => void prepare("Add agent " + agentInput, { method: "add_agent", agentId: agentInput })}>Add agent…</button>
            </div>
          </div>
          {call?.err ? <p role="alert" style={{ margin: 0, color: "var(--fvc-9A3F32)" }}>{call.label}: {call.err}</p> : null}
          {call?.c ? (
            <div role="group" aria-label="Unsigned owner call" style={{ padding: "10px", borderRadius: "10px", background: "var(--fvb-F7F8F3)" }}>
              <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{call.label}</div>
              <div>
                Unsigned: {call.c.transactions[0]?.actions[0]?.params.methodName} on {call.c.contractId}, {Number(call.c.transactions[0]?.actions[0]?.params.gas ?? 0) / 1e12} Tgas, {call.c.transactions[0]?.actions[0]?.params.deposit} yoctoNEAR (returned). Signer: {call.c.accountId}.
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="button" style={{ ...btn, background: "var(--fvb-2A4034)", color: "var(--fvc-FFFFFF)", border: "none" }} disabled={busy} onClick={() => void signAndVerify()}>{busy ? "Waiting for your wallet…" : "Sign in your wallet"}</button>
                <button type="button" style={btn} disabled={busy} onClick={() => setCall(null)}>Discard</button>
              </div>
            </div>
          ) : null}
          {outcome ? <p role="status" style={{ margin: 0, color: "var(--fvc-3F6B3C)" }}>{outcome}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
