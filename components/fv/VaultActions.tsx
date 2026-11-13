"use client";
// Vault operations (owner: Stream A): deposit, redeem, cancel, claim and settle as action plans with one
// wallet-signed step each. This only starts a plan; the plan panel reviews it, prepares the exact transactions and
// hands them to your NEAR wallet. Also lists your vault requests from the wallet journal: confirmed effects
// (verified from finalized receipts, or matched in the vault's records when the wallet returned nothing) apart
// from requests still in flight, which never count before they are confirmed.
import { useState } from "react";
import type { RequestView, VaultSnapshot } from "@/lib/flowvault/vault-contract";
import { vaultPolicyEntries, withVaultInPolicy, type VaultEffect } from "@/lib/flowvault/vault-ops";
import { api, type Scope } from "./live";
import { openPlan } from "./PlanDock";

export interface VaultOperation {
  id: string;
  kind: string;
  state: string;
  message: string;
  contractId: string;
  detail: string;
  amountRaw: string | null;
  sharesRaw: string | null;
  requestId: string | null;
  hashes: string[];
  effects: VaultEffect[];
  updatedAt: string;
}

const muted: React.CSSProperties = { color: "var(--fvc-5B6458)", fontSize: "12.5px", lineHeight: 1.45 };
const btn: React.CSSProperties = { padding: "6px 10px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer" };
const input: React.CSSProperties = { padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", minWidth: 0, width: "120px" };
const IN_FLIGHT = ["prepared", "awaiting_wallet", "submitted", "unknown", "partial"];
const STATE: Record<string, string> = { prepared: "prepared, not signed", awaiting_wallet: "in your wallet", submitted: "submitted, verifying", unknown: "outcome unknown, checking the vault", partial: "partly done", confirmed: "confirmed", failed: "failed" };

/** Decimal text → raw units; refuses more decimals than the unit has (never rounds money). */
export function toRaw(text: string, decimals: number): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Enter a plain number, like 25 or 25.5.");
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places.`);
  const raw = BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (raw <= 0n) throw new Error("Enter an amount above zero.");
  return raw;
}
const fixed = (raw: string, decimals: number, shown: number) => {
  const n = BigInt(raw);
  const d = 10n ** BigInt(decimals);
  return (n / d).toLocaleString("en-US") + (shown ? "." + (n % d).toString().padStart(decimals, "0").slice(0, shown) : "");
};
const usdc = (raw: string) => fixed(raw, 6, 2) + " USDC";
const shares = (raw: string) => fixed(raw, 18, 4) + " shares";

export function VaultActions({ v, account, scope, policyAllowed, ops, changed }: { v: VaultSnapshot; account: string; scope: Scope; policyAllowed: boolean; ops: VaultOperation[]; changed: () => void }) {
  const [amount, setAmount] = useState("");
  const [redeem, setRedeem] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const holder = v.holders.find((h) => h.account === account);
  const mine = v.requests.filter((r) => r.owner_id === account);
  const queuedDeposits = mine.filter((r) => r.kind === "deposit" && r.status === "queued");
  const queuedRedemptions = mine.filter((r) => r.kind === "redemption" && r.status === "queued");
  const claimable = mine.filter((r) => r.status === "claimable");
  const claiming = mine.filter((r) => r.status === "claiming");
  const due = v.requests.some((r) => r.kind === "redemption" && r.status === "queued" && Number(r.not_before_ms) <= v.readAt);
  const freeShares = holder?.accountView?.shares ?? "0";
  const pending = ops.some((o) => o.contractId === v.contractId && IN_FLIGHT.includes(o.state));

  const start = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setNote(null);
    try {
      const r = await api("/api/vaults", { action: "plan", key: crypto.randomUUID(), contractId: v.contractId, ...body }, "POST", scope);
      openPlan({ plan: r.plan, note: "Review the vault operation, then prepare and sign it in your NEAR wallet." });
      setNote(r.policyAllowed ? "Plan created. Review and sign it in the plan panel." : "Plan created, but your policy doesn’t allow this vault yet; signing will be refused until you add it below.");
      window.dispatchEvent(new Event("fv:plans-refresh"));
      changed();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const allow = async () => {
    setBusy("policy");
    setNote(null);
    try {
      const cur = await api("/api/policy", undefined, "GET", scope);
      await api("/api/policy", { revision: cur.revision, policy: withVaultInPolicy(cur.policy, v.contractId) }, "PUT", scope);
      setNote("Saved a new policy revision that allows this vault. Plans prepared before it must be prepared again.");
      changed();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const need = vaultPolicyEntries(v.contractId);
  const parse = (f: () => bigint) => {
    try {
      return f().toString();
    } catch (e) {
      setNote((e as Error).message);
      return null;
    }
  };
  const reqLabel = (r: RequestView) => `#${r.id} ${r.kind === "deposit" ? usdc(r.amount_raw) : shares(r.amount_raw)}`;

  return (
    <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed var(--fvb-E3E6DB)" }}>
      {!policyAllowed ? (
        <div style={{ ...muted, color: "var(--fvc-8A5F25)", marginBottom: "6px" }}>
          Your policy doesn’t allow this vault, so FlowVault will refuse to hand any vault operation to your wallet. Adding it saves a new policy revision with venue {need.venue} and the methods {need.methods.map((m) => m.method).join(", ")}. Your caps and asset rules still apply.
          <div><button type="button" style={{ ...btn, marginTop: "4px" }} disabled={!!busy} onClick={() => void allow()}>{busy === "policy" ? "Saving…" : "Allow this vault in my policy"}</button></div>
        </div>
      ) : null}
      {pending ? <div style={{ ...muted, marginBottom: "6px" }}>A vault request is still open; finish or check it in the plan panel before starting another on this vault.</div> : null}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="USDC to deposit" placeholder="USDC" inputMode="decimal" style={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" style={btn} disabled={!!busy || !amount.trim() || v.nav.status !== "running"} onClick={() => { const raw = parse(() => toRaw(amount, 6)); if (raw) void start("deposit", { op: "vault_deposit", amountRaw: raw }); }}>{busy === "deposit" ? "Checking…" : "Deposit…"}</button>
        <input aria-label="Shares to redeem" placeholder="shares" inputMode="decimal" style={input} value={redeem} onChange={(e) => setRedeem(e.target.value)} />
        <button type="button" style={{ ...btn, padding: "6px 8px" }} disabled={!!busy || freeShares === "0"} onClick={() => setRedeem(fixed(freeShares, 18, 18).replace(/,/g, "").replace(/\.?0+$/, ""))}>All</button>
        <button type="button" style={btn} disabled={!!busy || !redeem.trim() || freeShares === "0"} onClick={() => { const raw = parse(() => toRaw(redeem, 18)); if (raw) void start("redeem", { op: "vault_redeem", sharesRaw: raw }); }}>{busy === "redeem" ? "Checking…" : "Redeem…"}</button>
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
        {queuedDeposits.map((r) => (
          <span key={"d" + r.id} style={{ display: "inline-flex", gap: "6px" }}>
            <button type="button" style={btn} disabled={!!busy} onClick={() => void start("settle" + r.id, { op: "vault_settle", requestId: r.id })}>Settle deposit {reqLabel(r)} into shares…</button>
            <button type="button" style={btn} disabled={!!busy} onClick={() => void start("cancel" + r.id, { op: "vault_cancel", requestId: r.id })}>Cancel {reqLabel(r)}…</button>
          </span>
        ))}
        {queuedRedemptions.map((r) => <button key={"r" + r.id} type="button" style={btn} disabled={!!busy} onClick={() => void start("cancel" + r.id, { op: "vault_cancel", requestId: r.id })}>Cancel redemption {reqLabel(r)}…</button>)}
        {claimable.map((r) => <button key={"c" + r.id} type="button" style={btn} disabled={!!busy} onClick={() => void start("claim" + r.id, { op: "vault_claim", requestId: r.id })}>Claim {usdc(r.claimable_raw)} (#{r.id})…</button>)}
        {due ? <button type="button" style={btn} disabled={!!busy} onClick={() => void start("process", { op: "vault_settle" })}>Process due redemptions…</button> : null}
      </div>
      {claiming.length ? <div style={muted}>Claim {claiming.map((r) => "#" + r.id).join(", ")} is being paid; check it rather than claiming again.</div> : null}
      {note ? <p role="status" style={{ ...muted, color: "var(--fvc-1E2A22)", margin: "6px 0 0" }}>{note}</p> : null}
    </div>
  );
}

export function VaultOperations({ ops }: { ops: VaultOperation[] }) {
  if (!ops.length) return null;
  return (
    <details style={{ ...muted, marginTop: "6px" }} open={ops.some((o) => IN_FLIGHT.includes(o.state))}>
      <summary style={{ cursor: "pointer" }}>Your requests on this vault ({ops.length})</summary>
      <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
        {ops.map((o) => (
          <li key={o.id} style={{ color: o.state === "failed" ? "var(--fvc-9A3F32)" : o.state === "confirmed" ? "var(--fvc-3F6B3C)" : "var(--fvc-8A5F25)" }}>
            {o.detail.replace(/_/g, " ")}{o.requestId ? ` #${o.requestId}` : ""}{o.amountRaw ? ` · ${usdc(o.amountRaw)}` : ""}{o.sharesRaw ? ` · ${shares(o.sharesRaw)}` : ""} · {STATE[o.state] ?? o.state}
            {o.state === "confirmed"
              ? o.effects.map((e, i) => <span key={i}> · {e.summary}{e.requestId ? ` (#${e.requestId})` : ""} — {e.evidence === "receipt" ? "verified from the finalized receipt" : "matched in the vault’s records (no transaction hash)"}</span>)
              : <span> · {o.message}{IN_FLIGHT.includes(o.state) ? " Not counted until confirmed." : ""}</span>}
            {o.hashes.map((h) => <a key={h} href={"https://nearblocks.io/txns/" + h} target="_blank" rel="noreferrer" style={{ marginLeft: "6px", color: "inherit" }}>tx</a>)}
          </li>
        ))}
      </ul>
    </details>
  );
}
