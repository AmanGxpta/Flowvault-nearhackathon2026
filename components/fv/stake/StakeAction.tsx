"use client";
// The "sign once to stake" step: prepares a LiNEAR stake for an exact amount through the journal (fresh quote,
// policy check, gas reserve), shows what you get, then authorizes, hands it to your NEAR wallet and tracks it to
// final receipts. A declined wallet request is recorded as not sent so the step can be signed again.
import { useEffect, useRef, useState } from "react";
import { HazardScan } from "../approvals/HazardScan";
import type { HazardCheck } from "@/lib/flowvault/policy";
import { Check, RefreshCw, ShieldCheck } from "lucide-react";
import type { Policy } from "@/lib/flowvault/policy";
import { api } from "../live";
import { signStaking } from "@/lib/flowvault/wallet";
import type { WalletAttempt } from "@/lib/flowvault/execution";
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
import { stakeAttemptMode } from "@/lib/flowvault/staking-ui";
import { nearText } from "@/lib/flowvault/stake-flow";

type Phase = "idle" | "preparing" | "review" | "wallet" | "settling" | "done" | "error";
type Prep = StakingPreparation & { attemptId: string; checks?: HazardCheck[] };

export function StakeAction({ amountRaw, existing, onAttempt, onChange, disabledReason, autoReview, venue = "linear" }: {
  amountRaw: string; existing?: { id: string; state: string; hashes: number; preparation?: StakingPreparation | null } | null;
  onAttempt: (attemptId: string) => Promise<void> | void; onChange: () => void; disabledReason?: string | null; autoReview?: boolean; venue?: "linear"|"rnear";
}) {
  const symbol = venue === "rnear" ? "rNEAR" : "LiNEAR";
  const [phase, setPhase] = useState<Phase>(stakeAttemptMode(existing) === "track" ? "settling" : existing?.state === "prepared" && existing.preparation ? "review" : "idle");
  const [prep, setPrep] = useState<Prep | null>(existing?.state === "prepared" && existing.preparation ? {...existing.preparation,attemptId:existing.id} : null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [permission, setPermission] = useState<{revision:number;policy:Policy;receiver:string}|null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; const t = setInterval(() => setNow(Date.now()), 1000); return () => { alive.current = false; clearInterval(t); }; }, []);

  // Reuse the server-linked prepared attempt on reload. A declined/expired review gets a fresh key.
  const requestKey = useRef<string | null>(null), preparing = useRef(false);
  async function prepare() {
    if(preparing.current || stakeAttemptMode(existing) === "track") return;
    preparing.current=true;
    if(prep && Date.parse(prep.expiresAt)<=Date.now()) requestKey.current=null;
    requestKey.current ??= crypto.randomUUID();
    setPhase("preparing"); setError("");
    try {
      const receiver = venue === "rnear" ? "lst.rhealab.near" : "linear-protocol.near";
      const policyRead = await api("/api/policy",undefined,"GET") as {revision:number;policy:Policy};
      if(!policyRead.policy.venues.includes(receiver) || !policyRead.policy.methods.some(m=>m.receiver===receiver && m.method==="deposit_and_stake")) {
        setPermission({...policyRead,receiver}); setPhase("idle"); return;
      }
      const p = await api("/api/staking/actions", { kind: "stake", venue, amountRaw, key:requestKey.current }) as Prep;
      if (!alive.current) return;
      setPrep(p); setPhase("review");
      await onAttempt(p.attemptId);
    } catch (e) { requestKey.current=null; if (alive.current) { setError(/All NEAR providers|RPC|timed out|fetch failed/i.test((e as Error).message) ? "NEAR is temporarily unreachable. Your progress is saved and no new wallet request was sent. Try again to refresh the staking review." : (e as Error).message); setPhase("error"); } } finally { preparing.current=false; }
  }
  useEffect(() => { if (!autoReview || existing) return; const timer = setTimeout(() => void prepare(), 0); return () => clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only the initial unprepared flow; explicit refreshes handle later quotes
  async function allow() {
    if(!permission) return;
    setPhase("preparing");setError("");
    try {
      const policy=structuredClone(permission.policy);
      if(!policy.venues.includes(permission.receiver)) policy.venues.push(permission.receiver);
      if(!policy.methods.some(m=>m.receiver===permission.receiver && m.method==="deposit_and_stake")) policy.methods.push({receiver:permission.receiver,method:"deposit_and_stake"});
      await api("/api/policy", {revision:permission.revision,policy}, "PUT"); setPermission(null); await prepare();
    } catch(e) {setError((e as Error).message);setPhase("error");}
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
    const returnUrl = new URL(window.location.href);
    let authorized = false, opened = false;
    try {
      await api("/api/transactions", { id, action: "authorize" });
      authorized = true;
      returnUrl.searchParams.set("fv_attempt",id); history.replaceState(null,"",returnUrl);
      opened = true;
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
      if (alive.current) { setError(refused ? "You declined in your wallet. Nothing was sent; sign again when you're ready." : (e as Error).message); setPhase("error"); requestKey.current=null; }
      onChange();
    } finally {
      const url = new URL(window.location.href); if(url.searchParams.get("fv_attempt") === id) {url.searchParams.delete("fv_attempt");history.replaceState(null,"",url);}
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
  const mode=stakeAttemptMode(existing);
  if(permission) return <div className="fv-stake-action"><p>Allow staking into {symbol}?</p><p className="fv-muted">Adds {permission.receiver} and its deposit_and_stake method to your permissions. Your caps and other rules stay unchanged. Nothing is sent.</p>{error && <p className="fv-notice" role="alert">{error}</p>}<button type="button" className="fv-button fv-primary" disabled={phase === "preparing"} onClick={()=>void allow()}>{phase === "preparing" ? "Saving…" : `Allow ${symbol} staking and continue`}</button></div>;
  if (mode === "attention") return <div className="fv-notice" role="status">This stake needs attention. Check its recorded outcome before starting another stake.<button type="button" className="fv-button" onClick={()=>void check()}>Check status</button></div>;
  if (phase === "settling" || mode === "track" && phase !== "wallet") return <div className="fv-stake-action">
    <p className="fv-stake-wait"><RefreshCw size={14} className="fv-spin" /> {message || "Waiting for final receipts on NEAR."}</p>
    {existing && <button type="button" className="fv-button" onClick={() => void check()}>Check status</button>}
  </div>;
  if (phase === "done" || mode === "done") return <p className="fv-stake-ok"><Check size={15} /> {message || "Staked."}</p>;
  return <div className="fv-stake-action">
    {prep && phase !== "error" && <div className="fv-confirm-table">
      <div><span>You stake</span><strong>{nearText(prep.amountRaw)} NEAR</strong></div>
      <div><span>You get</span><strong>≈ {nearText(prep.quote.sharesRaw)} {symbol}</strong></div>
      <div><span>Network fee</span><strong>up to {nearText(prep.quote.networkFeeNearRaw)} NEAR</strong></div>
      {BigInt(prep.quote.storageFeeNearRaw ?? "0") > 0n && <div><span>First-stake storage</span><strong>{nearText(prep.quote.storageFeeNearRaw)} NEAR · included in amount</strong></div>}
      <div><span>Kept for gas</span><strong>{nearText(prep.quote.exitReserveNearRaw)} NEAR stays on your account</strong></div>
    </div>}
    {prep?.reserveNote && phase === "review" && <p className="fv-notice" role="status">{prep.reserveNote}</p>}
    {phase === "review" && (prep?.checks?.length ? <HazardScan checks={prep.checks} compact /> : <p className="fv-stake-policy"><ShieldCheck size={14} /> Checked against your limits · {symbol} contract code verified</p>)}
    {(error || disabledReason) && <p className="fv-notice" role="alert">{error || disabledReason}</p>}
    {phase === "review" ? (left === 0
      ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void prepare()}><RefreshCw size={15} /> Quote expired · refresh</button>
      : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void approve()}>Sign once to stake · {left}s</button>)
      : phase === "wallet" ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Confirm in your NEAR wallet</button>
      : <button type="button" className="fv-button fv-primary fv-wide-button" disabled={phase === "preparing" || !!disabledReason} onClick={() => void prepare()}>{phase === "preparing" ? <><RefreshCw size={15} className="fv-spin" /> Checking…</> : phase === "error" ? "Try again" : "Review stake"}</button>}
  </div>;
}
