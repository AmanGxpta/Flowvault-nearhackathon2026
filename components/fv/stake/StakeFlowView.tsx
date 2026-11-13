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
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
import { nearText, STATUS_LABEL, type FlowStep, type FlowStatus, type StakeFlow, type AttemptView } from "@/lib/flowvault/stake-flow";

export interface FlowRead { flow: StakeFlow; attempts: { pay: AttemptView | null; stake: (AttemptView & {preparation?:StakingPreparation|null}) | null }; steps: FlowStep[]; status: FlowStatus; current: FlowStep["id"] | null; done: number; total: number; stakeRaw: string | null }
const NEAR_ID = "near:native";

export function StakeFlowView({ id, owner, back, linearApy, rnearApy, connect }: { id: string; connect:()=>void; owner: string; back: () => void; linearApy: string | null; rnearApy:string|null }) {
  const [data, setData] = useState<FlowRead | null>(null), [error, setError] = useState(""), [paying, setPaying] = useState(true), [busy, setBusy] = useState(false);
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

  useEffect(() => {
    const refresh = () => void load(); window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, true);
  const link = async (step: "pay" | "stake", attemptId: string) => { const r = await api("/api/staking/flows", { op: "link", id, step, attemptId }) as FlowRead; setData(r); };
  const cancel = async () => { setBusy(true); try { setData(await api("/api/staking/flows", { op: "cancel", id }) as FlowRead); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const resume = async () => { setBusy(true); try { setData(await api("/api/staking/flows", {op:"resume",id}) as FlowRead); } catch(e) { setError((e as Error).message); } finally {setBusy(false);} };
  const checkPay = async () => { if (!data?.attempts.pay) return; setBusy(true); await api("/api/transactions", { id: data.attempts.pay.id, action: "check" }).catch(() => null); await load(); setBusy(false); };

  if (error && !data) return <section className="fv-panel fv-stake-flow"><p className="fv-notice">{error}</p><button type="button" className="fv-button" onClick={back}><ArrowLeft size={14} /> Back to staking</button></section>;
  if (!data) return <section className="fv-panel fv-stake-flow"><p className="fv-muted"><RefreshCw size={14} className="fv-spin" /> Opening your staking flow…</p></section>;
  const f = data.flow, src = f.source;
  const symbol = f.venue === "rnear" ? "rNEAR" : "LiNEAR", apy = f.venue === "rnear" ? rnearApy : linearApy;
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
    <h2>{data.status === "done" ? "Your NEAR is earning" : title}</h2>
    <div className="fv-stake-current" role="status"><small>{data.status === "done" ? "Completed" : data.status === "working" ? "Happening now" : data.status === "cancelled" ? "Flow closed" : "Next step"}</small><strong>{data.steps.find(s => s.id === data.current)?.title ?? (data.status === "done" ? `${symbol} is in your account` : "No more steps")}</strong>{data.status === "working" && <p>You can leave this page and reopen this status from Activity.</p>}</div>
    <p className="fv-muted">≈ {nearText(expected)} NEAR into {symbol}{apy ? ` · ${Number(apy).toFixed(2)}% APY, variable` : ""} · for {f.accountId}</p>

    <details className="fv-stake-route-details"><summary>View route · {src.kind === "swap" ? `${src.fromSymbol} → NEAR → ${symbol}` : `NEAR → ${symbol}`}</summary><div className="fv-flow-route" aria-label="Where your funds go">
      {src.kind === "swap" && <><div className="fv-flow-node">{from ? <TokenIcon symbol={from.symbol} network={from.network} core={coreIdentity(from)} image={from.icon} size={34} /> : <span className="fv-flow-dot" />}<strong>{src.fromSymbol} on {src.fromNetwork}</strong><small>{src.amount} {src.fromSymbol}</small></div>
        <span className="fv-flow-line" /><div className="fv-flow-node"><span className="fv-flow-dot"><Repeat size={15} /></span><strong>NEAR Intents</strong><small>swap</small></div><span className="fv-flow-line" /></>}
      <div className="fv-flow-node"><TokenIcon symbol="NEAR" core size={34} /><strong>{f.accountId.length > 18 ? f.accountId.slice(0, 15) + "…" : f.accountId}</strong><small>≈ {nearText(expected)} NEAR</small></div>
      <span className="fv-flow-line" />
      <div className="fv-flow-node"><span className="fv-flow-dot is-linear">{f.venue === "rnear" ? "r" : "Li"}</span><strong>{symbol}</strong><small>liquid staking</small></div>
    </div></details>

    <div className="fv-flow-progress" role="status"><span>{data.done} of {data.total} steps done</span><small>{src.kind === "swap" ? "NEAR usually arrives within a minute of your payment" : "Review, then one staking signature"}</small></div>
    <div className="fv-flow-bar" role="progressbar" aria-label="Staking progress" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}><i style={{ width: (data.done / data.total) * 100 + "%" }} /></div>

    <ol className="fv-flow-steps">{data.steps.map((s, index) => <li key={s.id} className={"is-" + s.state} aria-current={s.id === data.current ? "step" : undefined}>
      <span className="fv-flow-mark">{s.state === "done" ? <Check size={13} /> : s.state === "failed" ? <CircleAlert size={13} /> : s.state === "working" ? <RefreshCw size={12} className="fv-spin" /> : index + 1}</span>
      <div className="fv-flow-step">
        <strong>{s.title}</strong><small>{s.detail}</small>
        {data.status !== "cancelled" && s.id === "pay" && s.state === "current" && from && nearToken && src.kind === "swap" && <div className="fv-flow-act">
          {!paying || !sender ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => sender ? setPaying(true) : connect()}>{sender ? `Pay ${src.amount} ${src.fromSymbol} from your wallet` : `Connect your ${src.fromNetwork} wallet`} <ArrowRight size={15} /></button>
            : <SwapReview inline journey="stake" resumeId={data.attempts.pay?.state === "prepared" ? data.attempts.pay.id : undefined} from={from} to={nearToken} amount={src.amount} slippage={100} route="intents" sender={sender} recipient={f.accountId}
              close={() => { setPaying(false); void load(); }} onSettled={() => { setPaying(false); void load(); }} onAttempt={(a) => link("pay", a.id)} />}
        </div>}
        {s.id === "swap" && s.state === "working" && <div className="fv-flow-act"><button type="button" className="fv-button" disabled={busy} onClick={() => void checkPay()}>{busy ? "Checking…" : "Check status"}</button></div>}
        {data.status !== "cancelled" && s.id === "stake" && (s.state === "current" || s.state === "working" || s.state === "failed") && data.stakeRaw && <div className="fv-flow-act">
          <StakeAction venue={f.venue} autoReview key={data.attempts.stake?.id ?? f.id} amountRaw={data.stakeRaw} existing={data.attempts.stake} onAttempt={(aid) => link("stake", aid)} onChange={() => void load()} />
        </div>}
      </div>
    </li>)}</ol>

    {error && <p className="fv-notice" role="alert">{error}</p>}
    <div className="fv-flow-foot">
      {data.status === "done" ? <button type="button" className="fv-button fv-primary" onClick={back}>See your staking</button>
        : data.status === "cancelled" ? <div><p className="fv-muted">Flow closed. Your progress is saved. Any funds already received stay in your account.</p><button type="button" className="fv-button fv-primary" disabled={busy} onClick={()=>void resume()}>Resume this stake <ArrowRight size={14}/></button></div>
        : <><small>You can leave this page. Find this flow under Staking › Recent activity or in Activity to continue.</small>{data.status !== "working" && <button type="button" className="fv-text-button" disabled={busy} onClick={() => void cancel()}>Close this flow</button>}</>}
    </div>
  </section>;
}
