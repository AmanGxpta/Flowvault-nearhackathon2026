"use client";
// Strategy vaults (owner: Stream A). Holder view per proven NEAR account (shares, value, attributable exposure,
// costs, exit terms, queue position, claims), an owner/curator view when one of your accounts holds the role, and
// who controls the money (admin and upgrade keys checked against the account's actual keys, the trusted NAV
// attestation). Deposits, redemptions, cancellations, claims and settlement start plans (VaultActions) that your
// own NEAR wallet signs; FlowVault never signs.
import { useCallback, useEffect, useState } from "react";
import type { VaultSnapshot } from "@/lib/flowvault/vault-contract";
import { api, type Scope } from "./live";
import { VaultActions, VaultOperations, type VaultOperation } from "./VaultActions";

type VaultEntry = VaultSnapshot | { contractId: string; error: string };
interface Listing { id: string; stage: string; opportunity: { title: string }; updatedAt: string; deployment: { contractId: string } | null }
interface State { source: "live" | "example"; vaults: VaultEntry[]; listings: Listing[]; readiness: { custody: boolean; evidence: Record<string, string> }; accounts: string[]; operations?: VaultOperation[]; policyAllowed?: Record<string, boolean>; signer?: string | null }

const muted: React.CSSProperties = { color: "var(--fvc-5B6458)", fontSize: "12.5px", lineHeight: 1.45 };
const btn: React.CSSProperties = { padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer" };
const input: React.CSSProperties = { padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", minWidth: 0 };
const box: React.CSSProperties = { borderTop: "1px solid var(--fvb-EEF0E8)", padding: "12px 0 4px", fontSize: "13px" };
const RISK: Record<string, string> = { info: "var(--fvc-5B6458)", warn: "var(--fvc-8A5F25)", urgent: "var(--fvc-9A3F32)" };

const fixed = (raw: string | bigint, decimals: number, shown: number) => {
  const n = BigInt(raw);
  const neg = n < 0n;
  const a = neg ? -n : n;
  const d = 10n ** BigInt(decimals);
  const frac = (a % d).toString().padStart(decimals, "0").slice(0, shown);
  return (neg ? "−" : "") + (a / d).toLocaleString("en-US") + (shown ? "." + frac : "");
};
const usdc = (raw: string | null | undefined) => (raw == null ? "unknown" : fixed(raw, 6, 2) + " USDC");
const shares = (raw: string) => fixed(raw, 18, 4);
/** pps_e18 is raw USDC per raw share × 1e18; with 18-decimal shares that is USDC per whole share × 1e6. */
const price = (ppsE18: string | null) => (ppsE18 == null ? "unknown" : fixed(ppsE18, 6, 6) + " USDC");
const when = (ms: number) => new Date(ms).toLocaleString();
const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};

export function VaultsCard({ scope }: { scope: Scope }) {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [contract, setContract] = useState("");
  const [busy, setBusy] = useState(false);

  const [tick, setTick] = useState(0);
  const read = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let current = true;
    api("/api/vaults", undefined, "GET", scope).then(
      (x: State) => {
        if (!current) return;
        setSt(x);
        setErr(null);
      },
      (e: Error) => current && setErr(e.message),
    );
    return () => {
      current = false;
    };
  }, [scope, tick]);
  // Re-read when a plan changes, and every 15 s while one of your vault requests is in flight.
  const inFlight = !!st?.operations?.some((o) => ["awaiting_wallet", "submitted", "unknown", "partial"].includes(o.state));
  useEffect(() => {
    window.addEventListener("fv:plans-refresh", read);
    const t = inFlight ? setInterval(read, 15_000) : null;
    return () => {
      window.removeEventListener("fv:plans-refresh", read);
      if (t) clearInterval(t);
    };
  }, [read, inFlight]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await api("/api/vaults", body, "POST", scope);
      setNote(done);
      setContract("");
      read();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Strategy vaults" style={{ borderRadius: "18px", padding: "20px", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)", marginTop: "16px" }}>
      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
        Strategy vaults {st?.source === "example" ? <span style={{ ...muted, fontWeight: 500, marginLeft: "6px", padding: "2px 7px", borderRadius: "7px", background: "var(--fvb-EEF0E8)" }}>Example</span> : null}
      </h3>
      <p style={{ ...muted, margin: "4px 0 10px" }}>
        A vault holds pooled USDC in a NEAR contract and issues shares. Its value outside the vault is reported by the owner or curator, not proven on-chain, and exits wait in a first-in, first-out queue for USDC the vault holds. Deposits, redemptions and claims become plans that your own NEAR wallet signs; FlowVault never signs.
      </p>
      {err ? <p role="alert" style={muted}>Couldn’t read vaults: {err}</p> : null}
      {note ? <p role="status" style={{ ...muted, color: "var(--fvc-1E2A22)" }}>{note}</p> : null}
      {st?.source === "live" ? (
        <form onSubmit={(e) => { e.preventDefault(); void act({ action: "watch", contractId: contract.trim() }, "Following this vault."); }} style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
          <input aria-label="Vault contract account" placeholder="vault contract, e.g. usdc.vaults.near" style={{ ...input, flex: "1 1 220px" }} value={contract} onChange={(e) => setContract(e.target.value)} />
          <button type="submit" style={btn} disabled={busy || !contract.trim()}>{busy ? "Checking…" : "Follow vault"}</button>
        </form>
      ) : null}
      {st?.source === "live" && !st.accounts.length ? <p style={muted}>Prove a NEAR account to see your shares, queue position and claims.</p> : null}
      {st?.source === "live" && !st.vaults.length ? <p style={muted}>You don’t follow any vault yet. No FlowVault vault is deployed by FlowVault itself: an owner deploys one and shares its contract account.</p> : null}
      {st?.vaults.map((v) => ("error" in v ? (
        <div key={v.contractId} style={box}>
          <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{v.contractId}</div>
          <div style={{ ...muted, color: RISK.warn }}>Couldn’t read this vault: {v.error}</div>
          {st.source === "live" ? <button type="button" style={{ ...btn, marginTop: "6px" }} disabled={busy} onClick={() => void act({ action: "unwatch", contractId: v.contractId }, "Stopped following.")}>Stop following</button> : null}
        </div>
      ) : (
        <Vault key={v.contractId} v={v} live={st.source === "live"} busy={busy} unwatch={() => void act({ action: "unwatch", contractId: v.contractId }, "Stopped following.")}
          actions={st.source === "live" && st.signer ? { signer: st.signer, scope, policyAllowed: !!st.policyAllowed?.[v.contractId], ops: (st.operations ?? []).filter((o) => o.contractId === v.contractId), changed: read } : null} />
      )))}
      {st?.listings.length ? (
        <div style={box}>
          <div style={{ fontWeight: 600 }}>Your vault listings</div>
          <ul style={{ ...muted, margin: "4px 0 0", paddingLeft: "18px" }}>
            {st.listings.map((l) => <li key={l.id}>{l.opportunity.title} · {l.stage.replace(/_/g, " ")}{l.deployment ? ` · ${l.deployment.contractId}` : ""} · updated {when(Date.parse(l.updatedAt))}</li>)}
          </ul>
        </div>
      ) : null}
      {st ? <p style={{ ...muted, fontSize: "11.5px", marginTop: "8px" }}>Custody basis: {st.readiness.evidence.custody}. Nothing here is a safety or audit claim.</p> : null}
    </section>
  );
}

interface ActionProps { signer: string; scope: Scope; policyAllowed: boolean; ops: VaultOperation[]; changed: () => void }
function Vault({ v, live, busy, unwatch, actions }: { v: VaultSnapshot; live: boolean; busy: boolean; unwatch: () => void; actions: ActionProps | null }) {
  const n = v.nav;
  const reportAge = n.report ? v.readAt - Number(n.report.observed_at_ms) : null;
  const queued = v.requests.filter((r) => r.status === "queued").sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const dueRedemptions = queued.filter((r) => r.kind === "redemption" && Number(r.not_before_ms) <= v.readAt);
  const target = n.nav_raw ? (BigInt(n.nav_raw) * BigInt(v.config.liquidity_target_bps)) / 10_000n : null;
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{v.config.share_name} ({v.config.share_symbol}) · <span style={{ fontWeight: 400 }}>{v.contractId}</span></div>
        <div style={{ ...muted, color: n.status === "running" ? RISK.info : RISK.warn }}>{n.status}{v.config.single_depositor ? " · custody mode" : ""}</div>
      </div>
      <div style={muted}>
        NAV {usdc(n.nav_raw)} · price per share {price(n.pps_e18)} · high-water mark {price(n.hwm_e18)} · {fixed(n.total_shares, 18, 2)} shares · USDC held {usdc(n.liquid_assets_raw)} · capacity {usdc(v.config.capacity_raw)}
      </div>
      <div style={muted}>
        {n.report ? `Valued by report #${n.report.sequence}, ${ago(reportAge!)} ago (expires after ${ago(Number(v.config.max_nav_age_ms))})` : "No NAV report yet"}
        {n.reasons.length ? <span style={{ color: RISK.warn }}> · not priced now: {n.reasons.join(", ").replace(/_/g, " ").toLowerCase()}</span> : null}
      </div>
      {v.differences.length ? <div role="alert" style={{ ...muted, color: RISK.urgent }}>FlowVault’s model disagrees with the contract (the contract’s numbers are shown): {v.differences.join(" ")}</div> : null}
      {v.alerts.length ? <ul style={{ ...muted, margin: "4px 0", paddingLeft: "18px" }}>{v.alerts.map((a) => <li key={a.code} style={{ color: a.severity === "urgent" ? RISK.urgent : a.severity === "warn" ? RISK.warn : RISK.info }}>{a.message}</li>)}</ul> : null}

      {v.holders.map((h) => {
        const role = v.roles.find((r) => r.account === h.account);
        const empty = h.sharesRaw === "0" && h.pendingDepositRaw === "0" && h.claimableRaw === "0" && !h.queue.length;
        return (
          <div key={h.account} style={{ marginTop: "10px", padding: "10px 12px", borderRadius: "12px", background: "var(--fvb-F7F8F3)" }}>
            <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{h.account}{role ? <span style={{ ...muted, fontWeight: 500 }}> · {role.role}</span> : null}</div>
            {empty ? <div style={muted}>No shares, requests or claims in this vault.</div> : (
              <>
                <div style={muted}>
                  {shares(h.sharesRaw)} shares{h.ownershipBps !== null ? ` (${(h.ownershipBps / 100).toFixed(2)}% of the vault)` : ""} · worth {usdc(h.valueRaw)} at the current price, before exit timing
                  {h.pendingDepositRaw !== "0" ? ` · ${usdc(h.pendingDepositRaw)} deposited, waiting to be settled into shares (not invested yet)` : ""}
                  {h.claimableRaw !== "0" ? ` · ${usdc(h.claimableRaw)} claimable: a fixed claim, not in your wallet until you claim it and the payout is confirmed` : ""}
                </div>
                {h.queue.map((q) => (
                  <div key={q.requestId} style={muted}>
                    Redemption #{q.requestId}: {shares(q.sharesRaw)} shares escrowed · {q.ahead === 0 ? "first in the queue" : `${q.ahead} request${q.ahead === 1 ? "" : "s"} ahead (${shares(q.sharesAheadRaw)} shares)`} · {q.notBefore > v.readAt ? `notice ends ${when(q.notBefore)}` : "notice over"} · minimum {usdc(q.minAssetsRaw)}
                  </div>
                ))}
                {h.exposure.some((x) => x.usdcRaw && x.usdcRaw !== "0") ? (
                  <div style={muted}>
                    Your share of what the vault holds: {h.exposure.filter((x) => x.usdcRaw !== "0").map((x) => `${x.positionId === "idle-usdc" ? "USDC in the vault" : x.positionId} ${usdc(x.usdcRaw)}`).join(" · ")}
                  </div>
                ) : null}
                <div style={muted}>
                  Costs: performance fee {h.costs.performanceBps / 100}% of gains above the high-water mark ({h.costs.aboveHwm ? "the price is above it now, so the next owner report mints a fee" : "the price is at or below it, so no fee until losses are recovered"}), no management fee. Redemption requests cost a refundable-in-kind NEAR storage charge.
                </div>
                <details style={{ ...muted, marginTop: "2px" }}>
                  <summary style={{ cursor: "pointer" }}>Exit terms</summary>
                  <p style={{ margin: "4px 0" }}>{h.exit.terms}</p>
                  {h.exit.liquidityShortRaw && h.exit.liquidityShortRaw !== "0" ? <p style={{ margin: "4px 0", color: RISK.warn }}>Queued redemptions need {usdc(h.exit.liquidityShortRaw)} more than the vault holds.</p> : null}
                </details>
              </>
            )}
            {actions && h.account === actions.signer ? (
              <>
                <VaultActions v={v} account={h.account} scope={actions.scope} policyAllowed={actions.policyAllowed} ops={actions.ops} changed={actions.changed} />
                <VaultOperations ops={actions.ops} />
              </>
            ) : actions && !empty ? <div style={muted}>Operate this account’s position by signing in with {h.account}.</div> : null}
          </div>
        );
      })}

      {v.roles.length ? (
        <div style={{ marginTop: "10px", padding: "10px 12px", borderRadius: "12px", border: "1px solid var(--fvb-E3E6DB)" }}>
          <div style={{ fontWeight: 600 }}>Running this vault ({v.roles.map((r) => `${r.role}: ${r.account}`).join(", ")})</div>
          <div style={muted}>
            USDC held {usdc(n.liquid_assets_raw)} · liquidity target {target === null ? "unknown" : usdc(target.toString())} · pending deposits {usdc(n.pending_deposits_raw)} · claims owed {usdc(n.claimable_raw)} · queued shares {shares(n.queued_shares)}
          </div>
          {dueRedemptions.length ? <div style={{ ...muted, color: RISK.warn }}>{dueRedemptions.length} redemption{dueRedemptions.length === 1 ? " is" : "s are"} past notice. Anyone can call process_redemptions; the head of the queue needs enough USDC held.</div> : null}
          {reportAge !== null && reportAge > Number(v.config.max_nav_age_ms) * 0.75 ? <div style={{ ...muted, color: RISK.warn }}>The NAV report is close to expiring; deposits and redemptions stop pricing when it does.</div> : null}
          {v.roles.some((r) => r.role === "curator") && !v.roles.some((r) => r.role === "owner") ? <div style={muted}>Your reports value the vault but never mint fees; only an owner report crystallizes the performance fee.</div> : null}
          {v.operator?.policy ? (
            <div style={muted}>
              Operator {v.operator.policy.account_id} {v.operator.policy.paused ? "(paused)" : ""} until {when(Number(v.operator.policy.valid_until_ms))}: per action {usdc(v.operator.policy.max_per_action_raw)}, daily {usdc(v.operator.daily_used_raw)} of {usdc(v.operator.policy.max_daily_raw)}, lifetime {usdc(v.operator.cumulative_used_raw)} of {usdc(v.operator.policy.max_cumulative_raw)}, supplied {usdc(v.operator.deployed_raw)} of {usdc(v.operator.policy.max_deployed_raw)} (gross, withdrawals don’t free it), keeps at least {usdc(v.operator.policy.min_idle_raw)} in the vault. Only Rhea USDC supply and withdrawal back to the vault.
            </div>
          ) : v.operator ? <div style={muted}>No operator policy: only the owner and curator can move vault USDC.</div> : null}
          {queued.length ? (
            <details style={{ ...muted, marginTop: "4px" }}>
              <summary style={{ cursor: "pointer" }}>Queue ({queued.length})</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                {queued.map((r) => <li key={r.id}>#{r.id} {r.kind} · {r.owner_id} · {r.kind === "deposit" ? usdc(r.amount_raw) : shares(r.amount_raw) + " shares"} · from {when(Number(r.not_before_ms))} · minimum {r.kind === "deposit" ? shares(r.min_output_raw) + " shares" : usdc(r.min_output_raw)}</li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <details style={{ ...muted, marginTop: "8px" }} open={v.disclosures.some((d) => d.risk === "urgent")}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--fvc-1E2A22)" }}>Who controls this money</summary>
        <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
          {v.disclosures.map((d) => <li key={d.label} style={{ color: RISK[d.risk] }}><strong>{d.label}.</strong> {d.value}</li>)}
        </ul>
      </details>
      {live ? <button type="button" style={{ ...btn, marginTop: "8px" }} disabled={busy} onClick={unwatch}>Stop following</button> : null}
    </div>
  );
}
