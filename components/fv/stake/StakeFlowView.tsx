"use client";
// One staking flow, resumable at any time: where the money is (route), how far along it is, and the one thing to do
// next, done right here. Progress comes from the journal, so leaving, cancelling a wallet prompt or reloading never
// loses the place.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, RefreshCw, Repeat } from "lucide-react";
import { api } from "../live";
import { TokenIcon } from "../AssetIdentity";
import { useTokenCatalog, coreIdentity } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { ownAddress } from "../useSwapQuote";
import { SwapReview } from "../SwapReview";
import { StakeAction } from "./StakeAction";
import { nearText, STATUS_LABEL, type FlowStep, type FlowStatus, type StakeFlow, type AttemptView } from "@/lib/flowvault/stake-flow";

export interface FlowRead { flow: StakeFlow; attempts: { pay: AttemptView | null; stake: AttemptView | null }; steps: FlowStep[]; status: FlowStatus; current: FlowStep["id"] | null; done: number; total: number; stakeRaw: string | null }
const NEAR_ID = "near:native";

export function StakeFlowView({ id, owner, back, linearApy }: { id: string; owner: string; back: () => void; linearApy: string | null }) {
  const [data, setData] = useState<FlowRead | null>(null), [error, setError] = useState(""), [paying, setPaying] = useState(false), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api("/api/staking/flows?id=" + encodeURIComponent(id), undefined, "GET") as FlowRead); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  // While something is moving, follow it (the journal checks the chain and NEAR Intents on each read).
  useEffect(() => {
    if (!data || data.status !== "working") return;
    const t = setInterval(async () => {
      const pay = data.attempts.pay, stake = data.attempts.stake;
      const moving = [pay, stake].find((a) => a && ["awaiting_wallet", "submitted", "unknown", "partial"].includes(a.state));
      if (moving) await api("/api/transactions", { id: moving.id, action: "check" }).catch(() => null);
      void load();
    }, 6000);
    return () => clearInterval(t);
  }, [data, load]);

  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, true);
  const link = async (step: "pay" | "stake", attemptId: string) => { const r = await api("/api/staking/flows", { op: "link", id, step, attemptId }) as FlowRead; setData(r); };
  const cancel = async () => { setBusy(true); try { setData(await api("/api/staking/flows", { op: "cancel", id }) as FlowRead); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const checkPay = async () => { if (!data?.attempts.pay) return; setBusy(true); await api("/api/transactions", { id: data.attempts.pay.id, action: "check" }).catch(() => null); await load(); setBusy(false); };

  if (error && !data) return <section className="fv-panel fv-stake-flow"><p className="fv-notice">{error}</p><button type="button" className="fv-button" onClick={back}><ArrowLeft size={14} /> Back to staking</button></section>;
  if (!data) return <section className="fv-panel fv-stake-flow"><p className="fv-muted"><RefreshCw size={14} className="fv-spin" /> Opening your staking flow…</p></section>;
  const f = data.flow, src = f.source;
  const from = src.kind === "swap" ? tokens.find((t) => t.id === src.from) : tokens.find((t) => t.id === NEAR_ID);
  const nearToken = tokens.find((t) => t.id === NEAR_ID);
  const expected = src.kind === "swap" ? data.stakeRaw ?? src.expectedNearRaw : src.amountRaw;
  const title = src.kind === "swap" ? `Staking ${src.amount} ${src.fromSymbol}` : `Staking ${nearText(src.amountRaw)} NEAR`;
  const badge = { your_turn: "is-turn", working: "is-busy", done: "is-ok", attention: "is-bad", cancelled: "is-muted" }[data.status];
  const sender = src.kind === "swap" && from ? holdings.balances[from.id]?.account ?? ownAddress(holdings, from.network) : "";

  return <section className="fv-panel fv-stake-flow">
    <div className="fv-stake-flow-top">
      <button type="button" className="fv-text-button" onClick={back}><ArrowLeft size={14} /> Staking</button>
      <span className={"fv-flow-badge " + badge}>{data.status === "working" && <RefreshCw size={11} className="fv-spin" />}{STATUS_LABEL[data.status]}</span>
    </div>
    <h2>{title}</h2>
    <p className="fv-muted">≈ {nearText(expected)} NEAR into LiNEAR{linearApy ? ` · ${Number(linearApy).toFixed(2)}% APY, variable` : ""} · for {f.accountId}</p>

    <div className="fv-flow-route" aria-label="Where your funds go">
      {src.kind === "swap" && <><div className="fv-flow-node">{from ? <TokenIcon symbol={from.symbol} network={from.network} core={coreIdentity(from)} image={from.icon} size={34} /> : <span className="fv-flow-dot" />}<strong>{src.fromSymbol} on {src.fromNetwork}</strong><small>{src.amount} {src.fromSymbol}</small></div>
        <span className="fv-flow-line" /><div className="fv-flow-node"><span className="fv-flow-dot"><Repeat size={15} /></span><strong>NEAR Intents</strong><small>swap</small></div><span className="fv-flow-line" /></>}
      <div className="fv-flow-node"><TokenIcon symbol="NEAR" core size={34} /><strong>{f.accountId.length > 18 ? f.accountId.slice(0, 15) + "…" : f.accountId}</strong><small>≈ {nearText(expected)} NEAR</small></div>
      <span className="fv-flow-line" />
      <div className="fv-flow-node"><span className="fv-flow-dot is-linear">Li</span><strong>LiNEAR</strong><small>liquid staking</small></div>
    </div>

    <div className="fv-flow-progress"><span>{data.done} of {data.total} steps done</span><small>{src.kind === "swap" ? "NEAR usually arrives within a minute of your payment" : "One signature"}</small></div>
    <div className="fv-flow-bar"><i style={{ width: (data.done / data.total) * 100 + "%" }} /></div>

    <ol className="fv-flow-steps">{data.steps.map((s) => <li key={s.id} className={"is-" + s.state}>
      <span className="fv-flow-mark">{s.state === "done" ? <Check size={13} /> : s.state === "failed" ? <CircleAlert size={13} /> : s.state === "working" ? <RefreshCw size={12} className="fv-spin" /> : null}</span>
      <div className="fv-flow-step">
        <strong>{s.title}</strong><small>{s.detail}</small>
        {data.status !== "cancelled" && s.id === "pay" && s.state === "current" && from && nearToken && src.kind === "swap" && <div className="fv-flow-act">
          {!paying ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled={!sender} onClick={() => setPaying(true)}>{sender ? `Pay ${src.amount} ${src.fromSymbol} from your wallet` : `Connect your ${src.fromNetwork} wallet`} <ArrowRight size={15} /></button>
            : <SwapReview inline from={from} to={nearToken} amount={src.amount} slippage={100} route="intents" sender={sender} recipient={f.accountId}
              close={() => { setPaying(false); void load(); }} onSettled={() => void load()} onAttempt={(a) => void link("pay", a.id)} />}
        </div>}
        {s.id === "swap" && s.state === "working" && <div className="fv-flow-act"><button type="button" className="fv-button" disabled={busy} onClick={() => void checkPay()}>{busy ? "Checking…" : "Check status"}</button></div>}
        {data.status !== "cancelled" && s.id === "stake" && (s.state === "current" || s.state === "working" || s.state === "failed") && data.stakeRaw && <div className="fv-flow-act">
          <StakeAction amountRaw={data.stakeRaw} flowKey={f.id} existing={data.attempts.stake} onAttempt={(aid) => link("stake", aid)} onChange={() => void load()} />
        </div>}
      </div>
    </li>)}</ol>

    {error && <p className="fv-notice" role="alert">{error}</p>}
    <div className="fv-flow-foot">
      {data.status === "done" ? <button type="button" className="fv-button fv-primary" onClick={back}>See your staking</button>
        : data.status === "cancelled" ? <p className="fv-muted">Cancelled. Nothing was sent from this flow.</p>
        : <><small>You can leave this page. Find this flow under Staking › Recent activity or in Activity to continue.</small>{data.status !== "working" && <button type="button" className="fv-text-button" disabled={busy} onClick={() => void cancel()}>Cancel this flow</button>}</>}
    </div>
  </section>;
}
