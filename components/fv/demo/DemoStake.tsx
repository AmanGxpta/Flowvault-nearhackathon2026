"use client";
// Demo Mode staking: the stake review (what you get at today's rate, the contract call, the hazard scan), a labelled
// example wallet, then the example ledger changes; and the positions panel with unstake, the wait, and withdraw.
// The unstake wait is shortened to under a minute so the whole journey can be seen; the real one is about 2–3 days.
import { useEffect, useState } from "react";
import { ArrowRight, Check, RefreshCw, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { TokenIcon } from "../AssetIdentity";
import { HazardScan } from "../approvals/HazardScan";
import { fmtAmount } from "../swap-format";
import { demoLedger, saveDemoLedger, simulateApproval, useDemoLedger } from "./ledger-store";
import { applyClaim, applyStake, applyUnstake, GAS_RESERVE_NEAR, WNEAR_ID } from "@/lib/flowvault/demo-ledger";
import { exampleChecks } from "@/lib/flowvault/demo-sim";

type Venue = "linear" | "rnear";
const NAME: Record<Venue, string> = { linear: "LiNEAR", rnear: "rNEAR" };
const CONTRACT: Record<Venue, string> = { linear: "linear-protocol.near", rnear: "lst.rhealab.near" };
const n4 = (n: number) => fmtAmount(String(Math.round(n * 1e4) / 1e4), 4);

export function DemoStakeReview({ venue, near, nearPerShare, apr, nearUsd, close }: { venue: Venue; near: number; nearPerShare: number; apr: string | null; nearUsd: number | null; close: () => void }) {
  const [phase, setPhase] = useState<"review" | "wallet" | "settling" | "done" | "error">("review"), [hash, setHash] = useState(""), [error, setError] = useState("");
  const shares = near / nearPerShare, yearly = apr ? near * Number(apr) / 100 : null, busy = phase === "wallet" || phase === "settling";
  function approve() {
    simulateApproval("demo-stake-" + crypto.randomUUID(), {
      wallet: () => setPhase("wallet"),
      submitted: (h) => { setHash(h); setPhase("settling"); },
      landed: () => { try { saveDemoLedger(applyStake(demoLedger(), venue, near, nearPerShare)); setPhase("done"); } catch (e) { setError((e as Error).message); setPhase("error"); } },
    });
  }
  return <ReviewFrame busy={busy} close={close} className="fv-dialog fv-swap-confirm" label={`Example stake into ${NAME[venue]}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol="NEAR" network="near" core size={52} /></div>
    <h2>{phase === "review" ? `Stake ${n4(near)} NEAR into ${NAME[venue]}` : phase === "wallet" ? "Example wallet approving…" : phase === "settling" ? "Staking on NEAR" : phase === "done" ? "Staked" : "Not staked"}</h2>
    <p className="fv-confirm-sub">{phase === "error" ? error : "Example workspace: fictional balances at today’s rate. Approving plays the wallet step as a simulation; nothing is signed."}</p>
    <div className="fv-confirm-table">
      <div><span>You stake</span><strong>{n4(near)} NEAR{nearUsd ? <small> · ${(near * nearUsd).toFixed(2)}</small> : null}</strong></div>
      <div><span>You get</span><strong>≈ {n4(shares)} {NAME[venue]} <small>· 1 {NAME[venue]} = {nearPerShare.toFixed(4)} NEAR</small></strong></div>
      <div><span>Rate</span><strong>{apr ? `${Number(apr).toFixed(2)}% · variable${yearly !== null ? ` · ≈ ${n4(yearly)} NEAR a year` : ""}` : "variable"}</strong></div>
      <div><span>Way back</span><strong>Swap {NAME[venue]} when liquidity allows, or unstake in about 2–3 days</strong></div>
      <div><span>Kept on your account</span><strong>0.5 NEAR for fees</strong></div>
      {hash && <div><span>Transaction</span><strong className="fv-demo-hash">{hash} <small>(example, not on chain)</small></strong></div>}
    </div>
    {phase === "review" && <ol className="fv-confirm-steps"><li><span>1</span>deposit_and_stake<small>{CONTRACT[venue]}</small></li></ol>}
    {phase === "review" && <HazardScan checks={exampleChecks(near * (nearUsd ?? 0), [{ id: "code", label: `${NAME[venue]} contract code verified`, ok: true }, { id: "reserve", label: "0.5 NEAR stays for gas and a later unstake", ok: true }])} />}
    {phase === "done" && <div className="fv-confirm-success"><Check size={18} /> Example: {n4(near)} NEAR staked for ≈ {n4(shares)} {NAME[venue]}. Your position is below.</div>}
    <div className="fv-confirm-actions">
      {phase === "review" ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={approve}>Approve in wallet · example</button>
        : busy ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {phase === "wallet" ? "Waiting for the example wallet…" : "Settling on NEAR…"}</button>
        : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
    </div>
  </ReviewFrame>;
}

/** The example's staking: shares, NEAR equivalent, unstaking with its wait, ready to withdraw, and what's free to stake. */
export function DemoStakePositions({ venue, nearPerShare, apr }: { venue: Venue; nearPerShare: number | null; apr: string | null }) {
  const l = useDemoLedger();
  const [now, setNow] = useState(() => Date.now()), [amount, setAmount] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [hash, setHash] = useState("");
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!l) return null;
  const shares = l.staking[venue], rate = nearPerShare ?? 1, staked = shares * rate;
  const waiting = l.staking.unstaking.filter((u) => u.venue === venue && u.readyAt > now), ready = l.staking.unstaking.filter((u) => u.readyAt <= now);
  const free = Math.max(0, (l.wallet[WNEAR_ID] ?? 0) - GAS_RESERVE_NEAR);
  const run = (label: string, change: () => void, done: string) => simulateApproval("demo-" + label + "-" + crypto.randomUUID(), {
    wallet: () => { setBusy(label); setMsg(""); },
    submitted: (h) => setHash(h),
    landed: () => { try { change(); setMsg(done); } catch (e) { setMsg((e as Error).message); } setBusy(""); setHash(""); },
  }, { wallet: 1200, settle: 2600 });
  const unstake = () => { const s = Number(amount); if (!(s > 0) || s > shares) { setMsg(`Enter up to ${n4(shares)} ${NAME[venue]}.`); return; } run("unstake", () => saveDemoLedger(applyUnstake(demoLedger(), venue, s, rate)), `Example: unstake requested. ≈ ${n4(s * rate)} NEAR unlocks after the wait below.`); setAmount(""); };
  const claim = () => run("claim", () => saveDemoLedger(applyClaim(demoLedger())), "Example: NEAR withdrawn to your account.");
  return <section className="fv-panel fv-stake-summary">
    <div className="fv-stake-total"><small>{NAME[venue]} staked · NEAR equivalent</small><strong>{n4(staked)} <span>NEAR</span></strong><p>{shares > 0 ? `${n4(shares)} ${NAME[venue]} in your account${apr ? ` · earning ${Number(apr).toFixed(2)}%` : ""}` : `No ${NAME[venue]} staked yet.`}</p></div>
    <div className="fv-stake-stats">
      <div><small>Unstaking</small><strong>{waiting.length ? n4(waiting.reduce((s, u) => s + u.near, 0)) + " NEAR" : "None"}</strong><p>{waiting.length ? `Ready in ${Math.ceil((Math.min(...waiting.map((u) => u.readyAt)) - now) / 1000)}s · example (about 2–3 days for real)` : "Takes about 2–3 days once you start"}</p></div>
      <div><small>Ready to withdraw</small><strong>{ready.length ? n4(ready.reduce((s, u) => s + u.near, 0)) + " NEAR" : "None"}</strong><p>{ready.length ? <button type="button" className="fv-text-button" disabled={!!busy} onClick={claim}>{busy === "claim" ? "Example wallet approving…" : "Withdraw to your account"} <ArrowRight size={12} /></button> : "Unlocked NEAR shows up here"}</p></div>
      <div><small>Available to stake</small><strong>{n4(free)} NEAR</strong><p>After the 0.5 NEAR reserve</p></div>
    </div>
    {shares > 0 && <div className="fv-actions fv-demo-unstake"><input inputMode="decimal" placeholder={`${NAME[venue]} to unstake`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-label={`${NAME[venue]} to unstake`} /><button type="button" className="fv-text-button" onClick={() => setAmount(String(shares))}>Max</button><button type="button" className="fv-button" disabled={!!busy || !amount} onClick={unstake}>{busy === "unstake" ? "Example wallet approving…" : `Unstake ${NAME[venue]}`}</button></div>}
    {hash && <p className="fv-demo-hash">{hash} (example, not on chain)</p>}
    {msg && <p className="fv-demo-note" role="status">{msg}</p>}
  </section>;
}

/** What this tab has done in Demo Mode (newest first): every example supply, borrow, stake, swap and trade. */
export function DemoSessionActivity({ portfolio = false }: { portfolio?: boolean }) {
  const l = useDemoLedger();
  if (!l || !l.activity.length) return null;
  const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <section className="fv-panel fv-demo-session" aria-label="This session in Demo Mode">
    <div className="fv-section-head"><div><h2>This session in Demo Mode</h2><p className="fv-muted">{portfolio ? "The values above include these changes at today’s prices (perps margin isn’t counted: it isn’t money you have). Reset example starts over." : "Every example action you ran, simulated in this tab. Reset example starts over."}</p></div><span className="fv-chip">{l.activity.length} action{l.activity.length === 1 ? "" : "s"}</span></div>
    <ol>{l.activity.slice(0, portfolio ? 4 : 30).map((a, i) => <li key={a.at + ":" + i}><span>{when(a.at)}</span>{a.text}<em>example</em></li>)}</ol>
  </section>;
}
