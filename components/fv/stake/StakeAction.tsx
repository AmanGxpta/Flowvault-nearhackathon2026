"use client";
// The "sign once to stake" step: prepares a LiNEAR stake for an exact amount through the journal (fresh quote,
// policy check, gas reserve), shows what you get, then authorizes, hands it to your NEAR wallet and tracks it to
// final receipts. A declined wallet request is recorded as not sent so the step can be signed again.
import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../live";
import { signStaking } from "@/lib/flowvault/wallet";
import type { WalletAttempt } from "@/lib/flowvault/execution";
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
import { nearText } from "@/lib/flowvault/stake-flow";

type Phase = "idle" | "preparing" | "review" | "wallet" | "settling" | "done" | "error";
type Prep = StakingPreparation & { attemptId: string };

export function StakeAction({ amountRaw, flowKey, existing, onAttempt, onChange, disabledReason }: {
  amountRaw: string; flowKey: string; existing?: { id: string; state: string } | null;
  onAttempt: (attemptId: string) => Promise<void> | void; onChange: () => void; disabledReason?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>(existing && ["awaiting_wallet", "submitted", "unknown"].includes(existing.state) ? "settling" : "idle");
  const [prep, setPrep] = useState<Prep | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now()), [tries, setTries] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; const t = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; clearInterval(t); }; }, []);

  // One idempotency key per flow and attempt number, so a double click or reload never prepares twice.
  const key = flowKey.slice(0, 28) + tries.toString(16).padStart(8, "0");
  async function prepare() {
    setPhase("preparing"); setError("");
    try {
      const p = await api("/api/staking/actions", { kind: "stake", amountRaw, key }) as Prep;
      if (!alive.current) return;
      setPrep(p); setPhase("review");
      await onAttempt(p.attemptId);
    } catch (e) { if (alive.current) { setError((e as Error).message); setPhase("error"); } }
  }
  async function poll(id: string) {
    for (let i = 0; i < 30 && alive.current; i++) {
      const r = await api("/api/transactions", { id, action: "check" }).catch(() => null) as { attempt?: WalletAttempt } | null;
      if (r?.attempt) { setMessage(r.attempt.message); if (["confirmed", "failed", "partial"].includes(r.attempt.state)) return r.attempt; }
      await new Promise((res) => setTimeout(res, 2500));
    }
    return null;
  }
  async function approve() {
    if (!prep) return;
    const id = prep.attemptId;
    setPhase("wallet"); setError("");
    let authorized = false, opened = false;
    try {
      await api("/api/transactions", { id, action: "authorize" });
      authorized = true; opened = true;
      const outcomes = await signStaking(prep);
      const hashes = ((outcomes ?? []) as { transaction: { hash: string } }[]).map((o) => o.transaction.hash);
      setPhase("settling");
      const attached = await api("/api/transactions", { id, action: hashes.length ? "attach" : "uncertain", hashes }) as { attempt: WalletAttempt };
      const final = ["confirmed", "failed", "partial"].includes(attached.attempt.state) ? attached.attempt : await poll(id);
      if (!alive.current) return;
      setMessage(final?.message ?? attached.attempt.message);
      setPhase(final?.state === "confirmed" ? "done" : final ? "error" : "settling");
      onChange();
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const refused = err?.code === 4001 || /reject|denied|declin|cancel|closed/i.test(String(err?.message ?? e));
      if (authorized) await api("/api/transactions", { id, action: !opened || refused ? "declined" : "uncertain" }).catch(() => {});
      if (alive.current) { setError(refused ? "You declined in your wallet. Nothing was sent; sign again when you're ready." : (e as Error).message); setPhase("error"); setTries((n) => n + 1); }
      onChange();
    }
  }
  async function check() {
    if (!existing) return;
    setPhase("settling");
    const a = await poll(existing.id);
    if (!alive.current) return;
    setPhase(a?.state === "confirmed" ? "done" : a ? "error" : "settling");
    if (a && a.state !== "confirmed") setError(a.message);
    onChange();
  }

  const left = prep ? Math.max(0, Math.floor((Date.parse(prep.expiresAt) - now) / 1000)) : 0;
  if (phase === "settling") return <div className="fv-stake-action">
    <p className="fv-stake-wait"><RefreshCw size={14} className="fv-spin" /> {message || "Waiting for final receipts on NEAR."}</p>
    {existing && <button type="button" className="fv-button" onClick={() => void check()}>Check status</button>}
  </div>;
  if (phase === "done") return <p className="fv-stake-ok"><Check size={15} /> {message || "Staked."}</p>;
  return <div className="fv-stake-action">
    {prep && phase !== "error" && <div className="fv-confirm-table">
      <div><span>You stake</span><strong>{nearText(prep.amountRaw)} NEAR</strong></div>
      <div><span>You get</span><strong>≈ {nearText(prep.quote.sharesRaw)} LiNEAR</strong></div>
      <div><span>Network fee</span><strong>up to {nearText(prep.quote.networkFeeNearRaw)} NEAR</strong></div>
      <div><span>Kept for gas</span><strong>{nearText(prep.quote.exitReserveNearRaw)} NEAR stays on your account</strong></div>
    </div>}
    {prep?.reserveNote && phase === "review" && <p className="fv-notice" role="status">{prep.reserveNote}</p>}
    {phase === "review" && <p className="fv-stake-policy"><ShieldCheck size={14} /> Checked against your limits · LiNEAR contract code verified</p>}
    {(error || disabledReason) && <p className="fv-notice" role="alert">{error || disabledReason}</p>}
    {phase === "review" ? (left === 0
      ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void prepare()}><RefreshCw size={15} /> Quote expired · refresh</button>
      : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void approve()}>Sign once to stake · {left}s</button>)
      : phase === "wallet" ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Confirm in your NEAR wallet</button>
      : <button type="button" className="fv-button fv-primary fv-wide-button" disabled={phase === "preparing" || !!disabledReason} onClick={() => void prepare()}>{phase === "preparing" ? <><RefreshCw size={15} className="fv-spin" /> Checking…</> : phase === "error" ? "Try again" : "Review stake"}</button>}
  </div>;
}
