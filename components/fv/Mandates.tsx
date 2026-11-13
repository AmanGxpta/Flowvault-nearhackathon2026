"use client";
import {CustodyAuthorityEditor} from "./CustodyAuthorityEditor";
// Autonomous mandates (Stream C). What FlowVault may decide and prepare on a schedule without asking again,
// within limits you sign with your NEAR wallet. Today every transaction still needs your wallet: the authority
// row says exactly what bounds it. Figures come from GET /api/mandates; nothing here computes a balance.
import { useCallback, useEffect, useState } from "react";
import { api, type Scope } from "./live";

type Check = { id: string; ok: boolean | null; detail: string };
interface Mandate {
  id: string; version: number; title: string; state: string; accountId: string;
  validFrom: string; validUntil: string; digest: string; signatureMatches: boolean; problems: string[];
  approval: { signedAt: string; publicKey: string } | null;
  frozen: { at: string; reason: string } | null;
  scope: { actions: string[]; venues: string[]; methods: { receiver: string; method: string }[]; recipients: string[]; strategies: string[] };
  limits: { capitalUsdcRaw: string; perActionUsdcRaw: string; dailyUsdcRaw: string; cumulativeUsdcRaw: string; maxActionsPerDay: number; maxCostUsdcRaw: string; maxSlippageBps: number; maxStrategyLossUsdcRaw: string };
  borrowing: { allowed: boolean }; spending: { allowed: boolean };
  protection: { reserveFloorUsdcRaw: string; obligationBufferDays: number };
  freshness: { quoteMaxAgeSec: number; evidenceMaxAgeSec: number };
  concentration: { maxPositionBps: number; maxProtocolBps: number; maxChainBps: number };
  schedule: { everyMinutes: number; nextRunAt: string | null; lastRunAt: string | null };
  authority: { kind: string; status: string; bounds: string[]; unbounded: string[]; custody: string; upgradeAuthority: string };
}
interface Audit { id: string; at: string; phase: string; summary: string; planId?: string; data?: { checks?: Check[] } }
interface Option { kind: string; title: string; classification: string; verdict: string }
interface State {
  source: string; accountId: string | null; signedIn: string | null; killSwitchAt: string | null;
  mandates: Mandate[]; audit?: Audit[]; options: Option[]; strategies: { id: string; title: string }[];
}

const u = (raw: string) => {
  const n = BigInt(raw);
  const whole = n / 1000000n, frac = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return whole.toLocaleString("en-US") + (frac ? "." + frac.slice(0, 2) : "");
};
const TONE: Record<string, [string, string]> = {
  active: ["var(--fvb-E2EAD6)", "var(--fvc-2F552D)"],
  approved: ["var(--fvb-E2EAD6)", "var(--fvc-2F552D)"],
  draft: ["var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  paused: ["var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
  frozen: ["var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
  expired: ["var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
  revoked: ["var(--fvb-F4F5EF)", "var(--fvc-5B6458)"],
};
const btn: React.CSSProperties = {
  padding: "7px 12px", borderRadius: "9px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)",
  color: "var(--fvc-1E2A22)", fontSize: "12.5px", fontWeight: 500, cursor: "pointer",
};
const muted: React.CSSProperties = { color: "var(--fvc-5B6458)", fontSize: "12.5px", lineHeight: 1.45 };
const tag = (t: string) => (
  <span style={{ padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700, letterSpacing: ".06em", background: (TONE[t] ?? TONE.draft)[0], color: (TONE[t] ?? TONE.draft)[1] }}>{t.toUpperCase()}</span>
);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const FIELDS: { key: string; label: string; from: (m: Mandate) => string; num?: boolean }[] = [
  { key: "capital", label: "Capital limit (USDC)", from: (m) => u(m.limits.capitalUsdcRaw).replace(/,/g, "") },
  { key: "perAction", label: "Per action (USDC)", from: (m) => u(m.limits.perActionUsdcRaw).replace(/,/g, "") },
  { key: "daily", label: "Per day (USDC)", from: (m) => u(m.limits.dailyUsdcRaw).replace(/,/g, "") },
  { key: "lifetime", label: "Lifetime (USDC)", from: (m) => u(m.limits.cumulativeUsdcRaw).replace(/,/g, "") },
  { key: "maxLoss", label: "Stop at loss (USDC)", from: (m) => u(m.limits.maxStrategyLossUsdcRaw).replace(/,/g, "") },
  { key: "reserveFloor", label: "Never below (USDC)", from: (m) => u(m.protection.reserveFloorUsdcRaw).replace(/,/g, "") },
  { key: "maxActionsPerDay", label: "Actions per day", from: (m) => String(m.limits.maxActionsPerDay), num: true },
  { key: "everyMinutes", label: "Check every (min)", from: (m) => String(m.schedule.everyMinutes), num: true },
  { key: "validDays", label: "Valid for (days)", from: (m) => String(Math.round((Date.parse(m.validUntil) - Date.parse(m.validFrom)) / 864e5)), num: true },
];

export function MandatesCard({ scope }: { scope: Scope }) {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async (id: string | null = open) => {
    try {
      setSt(await api("/api/mandates" + (id ? "?id=" + encodeURIComponent(id) : ""), undefined, "GET", scope));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [scope, open]);
  useEffect(() => {
    void read();
  }, [read]);

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    setNote(null);
    try {
      const r = await api("/api/mandates", body, "POST", scope);
      if (r.outcome) setNote(r.outcome);
      else if (r.notes?.length) setNote(r.notes.join(" "));
      if (r.mandate?.id && body.action === "create") setOpen(r.mandate.id);
      await read(body.action === "create" ? r.mandate?.id ?? open : open);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sign = async (m: Mandate) => {
    setBusy("sign");
    setNote(null);
    try {
      const c = await api("/api/mandates", { action: "challenge", id: m.id }, "POST", scope);
      const { walletClient } = await import("@/lib/flowvault/wallet");
      const { selector } = await walletClient();
      const w = await selector.wallet();
      const { Buffer } = await import("buffer");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wallet-selector signMessage result
      const signed: any = await (w as any).signMessage({ message: c.message, recipient: c.recipient, nonce: Buffer.from(c.nonce, "base64") });
      if (!signed?.signature) throw new Error("The wallet didn’t return a signature.");
      await api("/api/mandates", { action: "approve", id: m.id, challengeId: c.challengeId, signature: signed.signature, publicKey: signed.publicKey, accountId: signed.accountId }, "POST", scope);
      setNote("Signed. Your wallet signed the terms only; no transaction was sent.");
      await read();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const live = st?.source === "live" && !!st.accountId;
  const kill = !!st?.killSwitchAt;
  return (
    <section aria-label="Autonomous mandates" style={{ borderRadius: "18px", padding: "20px", background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Autonomous mandates</h3>
        {live || kill ? (
          <button type="button" style={{ ...btn, borderColor: kill ? "var(--fvc-8A5F25)" : "var(--fvb-E3E6DB)" }} disabled={!!busy} onClick={() => void act(kill ? "Kill off" : "Kill on", { action: "kill", on: !kill })} aria-pressed={kill}>
            {kill ? "Kill switch ON · turn off" : "Kill switch"}
          </button>
        ) : null}
      </div>
      <p style={{ ...muted, margin: "4px 0 12px" }}>
        A mandate lets FlowVault check your money on a schedule and prepare actions inside limits you sign. It only uses surplus above your reserve and dated payments. Every transaction still needs your wallet.
      </p>
      {err ? <p role="alert" style={muted}>Couldn’t read mandates: {err}</p> : null}
      {kill ? <p role="status" style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Kill switch on since {when(st!.killSwitchAt)}: no mandate runs or prepares anything.</p> : null}
      {note ? <p role="status" style={{ ...muted, color: "var(--fvc-1E2A22)" }}>{note}</p> : null}
      {st && !live ? <p style={muted}>Mandates run on your own live NEAR account. Connect your NEAR wallet in your own workspace to create one.</p> : null}

      {st?.mandates.map((m) => {
        const shown = m.frozen && m.state === "active" ? "frozen" : m.state;
        const isOpen = open === m.id;
        return (
          <div key={m.id} style={{ borderTop: "1px solid var(--fvb-EEF0E8)", padding: "12px 0 4px", fontSize: "13px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--fvc-1E2A22)", minWidth: 0, overflowWrap: "anywhere" }}>{m.title}</span>
              {tag(shown)}
              <span style={{ ...muted, fontSize: "11.5px" }}>v{m.version}</span>
            </div>
            <div style={{ ...muted, marginTop: "4px" }}>
              Up to {u(m.limits.capitalUsdcRaw)} USDC deployed · {u(m.limits.perActionUsdcRaw)} per action · {u(m.limits.dailyUsdcRaw)} per day · stops at {u(m.limits.maxStrategyLossUsdcRaw)} loss.
              {" "}Borrowing {m.borrowing.allowed ? "allowed" : "off"} · paying others {m.spending.allowed ? "allowed" : "off"}.
              {" "}Checks every {m.schedule.everyMinutes} min{m.state === "active" ? `, next ${when(m.schedule.nextRunAt)}` : ""} · valid until {when(m.validUntil)}.
            </div>
            {m.frozen ? <div style={{ ...muted, color: "var(--fvc-8A5F25)", marginTop: "4px" }}>Frozen: {m.frozen.reason}</div> : null}
            {m.problems.length ? <div style={{ ...muted, color: "var(--fvc-8A5F25)", marginTop: "4px" }}>{m.problems.join(" ")}</div> : null}
            {m.approval && !m.signatureMatches ? <div style={{ ...muted, color: "var(--fvc-8A5F25)" }}>Terms changed after signing; sign again.</div> : null}

            {live ? (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                {m.state === "draft" ? <button type="button" style={btn} disabled={!!busy || m.problems.length > 0} onClick={() => void sign(m)}>{busy === "sign" ? "Waiting for wallet…" : "Sign terms…"}</button> : null}
                {m.state === "approved" ? <button type="button" style={btn} disabled={!!busy || kill} onClick={() => void act("activate", { action: "activate", id: m.id })}>Activate</button> : null}
                {m.state === "active" && !m.frozen ? <button type="button" style={btn} disabled={!!busy || kill} onClick={() => void act("run", { action: "run", id: m.id })}>{busy === "run" ? "Checking…" : "Check now"}</button> : null}
                {m.state === "active" ? <button type="button" style={btn} disabled={!!busy} onClick={() => void act("pause", { action: "pause", id: m.id })}>Pause</button> : null}
                {m.state === "paused" ? <button type="button" style={btn} disabled={!!busy || kill} onClick={() => void act("resume", { action: "resume", id: m.id })}>Resume</button> : null}
                {m.frozen ? <button type="button" style={btn} disabled={!!busy} onClick={() => void act("unfreeze", { action: "unfreeze", id: m.id })}>I checked it · clear freeze</button> : null}
                {["draft", "approved", "paused"].includes(m.state) ? <button type="button" style={btn} disabled={!!busy} onClick={() => setEdit(edit && open === m.id ? null : Object.fromEntries(FIELDS.map((f) => [f.key, f.from(m)])))}>{edit && isOpen ? "Close terms" : "Change terms"}</button> : null}
                {!["revoked", "expired"].includes(m.state) ? <button type="button" style={btn} disabled={!!busy} onClick={() => void act("revoke", { action: "revoke", id: m.id })}>Revoke</button> : null}
                <button type="button" style={btn} onClick={() => { const id = isOpen ? null : m.id; setOpen(id); setEdit(null); void read(id); }} aria-expanded={isOpen}>{isOpen ? "Hide details" : "Details"}</button>
              </div>
            ) : null}

            {isOpen && edit ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t: Record<string, unknown> = {};
                  for (const f of FIELDS) if (edit[f.key] !== f.from(m)) t[f.key] = f.num ? Number(edit[f.key]) : edit[f.key];
                  void act("update", { action: "update", id: m.id, terms: t }).then(() => setEdit(null));
                }}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "8px", marginTop: "10px" }}
              >
                {FIELDS.map((f) => (
                  <label key={f.key} style={{ ...muted, display: "flex", flexDirection: "column", gap: "3px", fontSize: "11.5px" }}>
                    {f.label}
                    <input value={edit[f.key]} inputMode="decimal" onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value.trim() })} style={{ padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--fvb-E3E6DB)", background: "var(--fvb-FFFFFF)", color: "var(--fvc-1E2A22)", fontSize: "12.5px", minWidth: 0 }} />
                  </label>
                ))}
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button type="submit" style={btn} disabled={!!busy}>Save as new version</button>
                  <span style={{ ...muted, fontSize: "11.5px" }}>Saving returns it to draft; you sign the new terms.</span>
                </div>
              </form>
            ) : null}

            {isOpen ? (
              <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <div>
                  <CustodyAuthorityEditor scope={scope} mandateId={m.id} state={m.state} onChanged={()=>void read(m.id)} />
                  <div style={{ fontWeight: 600, fontSize: "12.5px" }}>Who can move money</div>
                  <ul style={{ ...muted, margin: "2px 0 0", paddingLeft: "18px" }}>
                    {m.authority.bounds.map((b) => <li key={b}>{b}</li>)}
                    {m.authority.unbounded.map((b) => <li key={b}>{b}</li>)}
                    <li>Custody: {m.authority.custody}</li>
                    <li>Upgrade authority: {m.authority.upgradeAuthority}</li>
                  </ul>
                </div>
                <div style={muted}>
                  Scope: {m.scope.actions.join(", ")} · venue {m.scope.venues.join(", ")} · methods {m.scope.methods.map((x) => x.method).join(", ")} · recipient {m.scope.recipients.map((r) => (r === "$owner" ? "your own account" : r)).join(", ")}.
                  {" "}Quotes ≤ {m.freshness.quoteMaxAgeSec} s old, balances ≤ {m.freshness.evidenceMaxAgeSec} s. At most {m.concentration.maxPositionBps / 100}% of net worth in one position. Max cost {u(m.limits.maxCostUsdcRaw)} USDC, slippage {m.limits.maxSlippageBps} bps.
                </div>
                <div style={{ ...muted, fontSize: "11px", overflowWrap: "anywhere" }}>
                  Terms digest {m.digest.slice(0, 20)}…{m.approval ? ` · signed ${when(m.approval.signedAt)} with ${m.approval.publicKey.slice(0, 18)}…` : " · not signed"}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "12.5px" }}>Audit trail</div>
                  {st.audit?.length ? (
                    <ol style={{ ...muted, margin: "2px 0 0", paddingLeft: "18px", maxHeight: "260px", overflow: "auto" }}>
                      {st.audit.slice(0, 40).map((a) => (
                        <li key={a.id} style={{ marginBottom: "4px", overflowWrap: "anywhere" }}>
                          <span style={{ fontWeight: 600 }}>{a.phase}</span> · {when(a.at)} — {a.summary}
                          {a.planId ? <span> (plan {a.planId.slice(0, 10)}… in your plans dock)</span> : null}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div style={muted}>Nothing yet.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      {live ? (
        <div style={{ borderTop: "1px solid var(--fvb-EEF0E8)", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {st!.strategies.length ? (
            st!.strategies.map((s) => (
              <button key={s.id} type="button" style={{ ...btn, alignSelf: "flex-start" }} disabled={!!busy} onClick={() => void act("create", { action: "create", strategyId: s.id })}>
                New mandate: {s.title}
              </button>
            ))
          ) : (
            <div style={muted}>No strategy can run under a mandate yet.</div>
          )}
          <details style={muted}>
            <summary style={{ cursor: "pointer" }}>How authority is bounded</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
              {st!.options.map((o) => (
                <li key={o.kind} style={{ marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600 }}>{o.title}</span>: {o.verdict}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}
