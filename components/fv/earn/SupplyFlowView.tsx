"use client";
// One swap-then-supply flow, resumable at any time: the route, how far along it is, and the one thing to do next,
// done right here. Live flows read their progress from the journal, so leaving, declining a wallet prompt or
// reloading never loses the place. Demo Mode flows play the same steps as a labelled simulation: nothing is signed
// and nothing moves.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, RefreshCw, Repeat, ShieldCheck } from "lucide-react";
import { api } from "../live";
import { TokenIcon } from "../AssetIdentity";
import { useTokenCatalog, coreIdentity } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { ownAddress } from "../useSwapQuote";
import { SwapReview } from "../SwapReview";
import { RheaSheet } from "../RheaSheet";
import { decimal } from "@/lib/flowvault/money";
import { deriveSupplyFlow, SUPPLY_STATUS_LABEL, tokenText, type SupplyAttemptView, type SupplyFlow, type SupplyFlowStatus, type SupplyStep } from "@/lib/flowvault/supply-flow";
import { simAttempt, simDelivered } from "@/lib/flowvault/demo-sim";
import { demoGet, demoPut, isDemoId } from "../demo/demo-store";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";

export interface SupplyFlowRead { flow: SupplyFlow; attempts: { pay: SupplyAttemptView | null; supply: SupplyAttemptView | null }; steps: SupplyStep[]; status: SupplyFlowStatus; current: SupplyStep["id"] | null; done: number; total: number; supplyRaw: string | null }
export type DemoSupplyRow = { id: string; kind: "supply"; updatedAt: number; flow: SupplyFlow; payAt: number | null; supplyAt: number | null };
const MOVING = ["awaiting_wallet", "submitted", "unknown", "partial"];
type Props = { id: string; owner: string; back: () => void; connect: () => void };

export function SupplyFlowView(p: Props) { return isDemoId(p.id) ? <DemoSupplyFlow {...p} /> : <LiveSupplyFlow {...p} />; }

/** A Demo Mode flow's current state: the scripted attempts for each approved step, through the same derivation. */
export function demoSupplyRead(row: DemoSupplyRow, now = Date.now()): SupplyFlowRead {
  const f = row.flow;
  const pay = simAttempt(f.id + ":pay", row.payAt, now, { deliveredRaw: simDelivered(f.source.expectedRaw), working: `Example: NEAR Intents is delivering ${f.symbol}.`, done: `Example: ${f.symbol} delivered.` });
  const delivered = pay?.state === "confirmed" ? pay.deliveredRaw ?? null : null;
  const supply = delivered ? simAttempt(f.id + ":supply", row.supplyAt, now, { settleMs: 5000, suppliedRaw: delivered, working: "Example: waiting for final receipts.", done: `Example: ${f.symbol} supplied.` }) : null;
  const attempts = { pay, supply };
  return { flow: f, attempts, ...deriveSupplyFlow(f, attempts) };
}

function DemoSupplyFlow({ id, back }: Props) {
  const [row, setRow] = useState<DemoSupplyRow | null>(() => demoGet<DemoSupplyRow>(id)), [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const { tokens } = useTokenCatalog();
  if (!row) return <section className="fv-panel fv-stake-flow"><p className="fv-notice">This example flow ended with the tab that started it.</p><button type="button" className="fv-button" onClick={back}><ArrowLeft size={14} /> Back to Earn</button></section>;
  const data = demoSupplyRead(row, now);
  const save = (patch: Partial<DemoSupplyRow>) => setRow(demoPut({ ...row, ...patch }));
  const f = data.flow;
  const supplyAmount = data.supplyRaw ? tokenText(data.supplyRaw, f.decimals) : "";
  return <SupplyFlowPanel data={data} tokens={tokens} back={back} demo busy={false} error=""
    pay={<div className="fv-stake-action"><div className="fv-confirm-table"><div><span>You pay</span><strong>{f.source.amount} {f.source.fromSymbol}{f.source.fromNetwork === "NEAR" ? "" : " on " + f.source.fromNetwork}</strong></div><div><span>You receive</span><strong>≈ {tokenText(f.source.expectedRaw, f.decimals)} {f.symbol}</strong></div><div><span>Route</span><strong>NEAR Intents · example</strong></div></div>
      <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => save({ payAt: Date.now() })}>Approve in wallet · example</button></div>}
    supply={<div className="fv-stake-action"><div className="fv-confirm-table"><div><span>Supply</span><strong>{supplyAmount} {f.symbol}</strong></div><div><span>Supply APY</span><strong>{f.apy !== null ? f.apy.toFixed(2) + "% · variable" : "variable"}</strong></div><div><span>Network fees</span><strong>up to 0.003 NEAR · example</strong></div></div>
      <p className="fv-stake-policy"><ShieldCheck size={14} /> Example: checked against the example workspace&apos;s limits</p>
      <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => save({ supplyAt: Date.now() })}>Sign once to supply · example</button></div>}
    onCancel={() => save({ flow: { ...f, cancelledAt: new Date().toISOString() } })} onResume={() => save({ flow: { ...f, cancelledAt: null } })} />;
}

function LiveSupplyFlow({ id, owner, back, connect }: Props) {
  const [data, setData] = useState<SupplyFlowRead | null>(null), [error, setError] = useState(""), [paying, setPaying] = useState(true), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api("/api/lend/flows?id=" + encodeURIComponent(id), undefined, "GET") as SupplyFlowRead); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  // While something is moving, follow it (each check reads the chain and NEAR Intents).
  useEffect(() => {
    if (!data || data.status !== "working") return;
    const t = setInterval(async () => {
      const moving = [data.attempts.pay, data.attempts.supply].find((a) => a && MOVING.includes(a.state));
      if (moving) await api("/api/transactions", { id: moving.id, action: "check" }).catch(() => null);
      void load();
    }, 6000);
    return () => clearInterval(t);
  }, [data, load]);
  useEffect(() => { const refresh = () => void load(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [load]);
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, true);
  const link = async (step: "pay" | "supply", attemptId: string) => { setData(await api("/api/lend/flows", { op: "link", id, step, attemptId }) as SupplyFlowRead); };
  const act = async (op: "cancel" | "resume") => { setBusy(true); try { setData(await api("/api/lend/flows", { op, id }) as SupplyFlowRead); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const check = async (attemptId?: string) => { if (!attemptId) return; setBusy(true); await api("/api/transactions", { id: attemptId, action: "check" }).catch(() => null); await load(); setBusy(false); };

  if (error && !data) return <section className="fv-panel fv-stake-flow"><p className="fv-notice">{error}</p><button type="button" className="fv-button" onClick={back}><ArrowLeft size={14} /> Back to Earn</button></section>;
  if (!data) return <section className="fv-panel fv-stake-flow"><p className="fv-muted"><RefreshCw size={14} className="fv-spin" /> Opening your supply flow…</p></section>;
  const f = data.flow, src = f.source;
  const from = tokens.find((t) => t.id === src.from), to = tokens.find((t) => t.network === "near" && t.contract === f.tokenId);
  const sender = from ? (from.network === "near" ? owner : holdings.balances[from.id]?.account ?? ownAddress(holdings, from.network)) : "";
  return <SupplyFlowPanel data={data} tokens={tokens} back={back} busy={busy} error={error} onCheck={(stepId) => void check(stepId === "swap" ? data.attempts.pay?.id : data.attempts.supply?.id)}
    pay={from && to ? (!paying || !sender ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => sender ? setPaying(true) : connect()}>{sender ? `Pay ${src.amount} ${src.fromSymbol} from your wallet` : `Connect your ${src.fromNetwork} wallet`} <ArrowRight size={15} /></button>
      : <SwapReview inline resumeId={data.attempts.pay?.state === "prepared" ? data.attempts.pay.id : undefined} from={from} to={to} amount={src.amount} slippage={100} route="intents" sender={sender} recipient={f.accountId}
        close={() => { setPaying(false); void load(); }} onSettled={() => { setPaying(false); void load(); }} onAttempt={(a) => link("pay", a.id)} />) : null}
    supply={data.supplyRaw ? <RheaSheet inline lockAction key={data.supplyRaw} tokenId={f.tokenId} symbol={f.symbol} icon={to?.icon} mode="earn" initial="supply" initialAmount={decimal(BigInt(data.supplyRaw), f.decimals)}
      rates={{ supply: f.apy, borrow: null }} close={() => void load()} onSettled={() => void load()} onAttempt={(a) => void link("supply", a.id).catch((e) => setError((e as Error).message))} /> : null}
    onCancel={() => void act("cancel")} onResume={() => void act("resume")} />;
}

function SupplyFlowPanel({ data, tokens, back, busy, error, pay, supply, onCheck, onCancel, onResume, demo }: { data: SupplyFlowRead; tokens: SwapToken[]; back: () => void; busy: boolean; error: string; pay: ReactNode; supply: ReactNode; onCheck?: (stepId: string) => void; onCancel: () => void; onResume: () => void; demo?: boolean }) {
  const f = data.flow, src = f.source;
  const from = tokens.find((t) => t.id === src.from), to = tokens.find((t) => t.network === "near" && t.contract === f.tokenId);
  const expected = data.supplyRaw ?? src.expectedRaw;
  const badge = { your_turn: "is-turn", working: "is-busy", done: "is-ok", attention: "is-bad", cancelled: "is-muted" }[data.status];
  const supplyStep = data.steps.find((s) => s.id === "supply");
  const hashFor = (id: string) => { const a = id === "swap" || id === "pay" ? data.attempts.pay : id === "supply" ? data.attempts.supply : null; return (a as { hash?: string | null } | null)?.hash ?? null; };
  return <section className="fv-panel fv-stake-flow">
    <div className="fv-stake-flow-top">
      <button type="button" className="fv-text-button" onClick={back}><ArrowLeft size={14} /> Earn</button>
      <span className={"fv-flow-badge " + badge}>{data.status === "working" && <RefreshCw size={11} className="fv-spin" />}{demo ? "Example · " : ""}{SUPPLY_STATUS_LABEL[data.status]}</span>
    </div>
    {demo && <p className="fv-demo-note">Example workspace: this flow is a simulation with fictional balances. Nothing is signed and nothing moves.</p>}
    <h2>{data.status === "done" ? `Your ${f.symbol} is earning on Rhea` : `Supplying ${f.symbol} from ${src.amount} ${src.fromSymbol}`}</h2>
    <div className="fv-stake-current" role="status"><small>{data.status === "done" ? "Completed" : data.status === "working" ? "Happening now" : data.status === "cancelled" ? "Flow closed" : "Next step"}</small><strong>{data.steps.find((s) => s.id === data.current)?.title ?? (data.status === "done" ? `${f.symbol} supplied` : "No more steps")}</strong>{data.status === "working" && <p>You can leave this page and reopen this status from Activity.</p>}</div>
    <p className="fv-muted">≈ {tokenText(expected, f.decimals)} {f.symbol} into Rhea{f.apy !== null ? ` · ${f.apy.toFixed(2)}% APY when started, variable` : ""} · for {f.accountId}</p>

    <details className="fv-stake-route-details"><summary>View route · {src.fromSymbol} → {f.symbol} → Rhea</summary><div className="fv-flow-route" aria-label="Where your funds go">
      <div className="fv-flow-node">{from ? <TokenIcon symbol={from.symbol} network={from.network} core={coreIdentity(from)} image={from.icon} size={34} /> : <span className="fv-flow-dot" />}<strong>{src.fromSymbol}{src.fromNetwork === "NEAR" ? "" : " on " + src.fromNetwork}</strong><small>{src.amount} {src.fromSymbol}</small></div>
      <span className="fv-flow-line" /><div className="fv-flow-node"><span className="fv-flow-dot"><Repeat size={15} /></span><strong>NEAR Intents</strong><small>swap</small></div><span className="fv-flow-line" />
      <div className="fv-flow-node">{to ? <TokenIcon symbol={to.symbol} network="near" core={coreIdentity(to)} image={to.icon} size={34} /> : <span className="fv-flow-dot" />}<strong>{f.accountId.length > 18 ? f.accountId.slice(0, 15) + "…" : f.accountId}</strong><small>≈ {tokenText(expected, f.decimals)} {f.symbol}</small></div>
      <span className="fv-flow-line" /><div className="fv-flow-node"><span className="fv-flow-dot">R</span><strong>Rhea Lending</strong><small>supply</small></div>
    </div></details>

    <div className="fv-flow-progress" role="status"><span>{data.done} of {data.total} steps done</span><small>{f.symbol} usually arrives within a minute of your payment</small></div>
    <div className="fv-flow-bar" role="progressbar" aria-label="Supply progress" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}><i style={{ width: (data.done / data.total) * 100 + "%" }} /></div>

    <ol className="fv-flow-steps">{data.steps.map((s, index) => <li key={s.id} className={"is-" + s.state} aria-current={s.id === data.current ? "step" : undefined}>
      <span className="fv-flow-mark">{s.state === "done" ? <Check size={13} /> : s.state === "failed" ? <CircleAlert size={13} /> : s.state === "working" ? <RefreshCw size={12} className="fv-spin" /> : index + 1}</span>
      <div className="fv-flow-step">
        <strong>{s.title}</strong><small>{s.detail}</small>
        {demo && hashFor(s.id) && (s.id === "pay" || s.id === "supply") && s.state !== "waiting" && <small className="fv-demo-hash">Transaction {hashFor(s.id)} (example, not on chain)</small>}
        {data.status !== "cancelled" && s.id === "pay" && s.state === "current" && pay && <div className="fv-flow-act">{pay}</div>}
        {!demo && onCheck && (s.id === "swap" || s.id === "supply") && s.state === "working" && <div className="fv-flow-act"><button type="button" className="fv-button" disabled={busy} onClick={() => onCheck(s.id)}>{busy ? "Checking…" : "Check status"}</button></div>}
        {data.status !== "cancelled" && s.id === "supply" && s.state === "current" && supply && <div className="fv-flow-act">{supply}</div>}
      </div>
    </li>)}</ol>

    {error && <p className="fv-notice" role="alert">{error}</p>}
    <div className="fv-flow-foot">
      {data.status === "done" ? <button type="button" className="fv-button fv-primary" onClick={back}>Back to Earn</button>
        : data.status === "cancelled" ? <div><p className="fv-muted">Flow closed. Your progress is saved. Anything that already arrived stays in your account.</p><button type="button" className="fv-button fv-primary" disabled={busy} onClick={onResume}>Resume this supply <ArrowRight size={14} /></button></div>
        : <><small>You can leave this page. Find this flow in Activity to continue.{supplyStep?.state === "current" ? ` ${f.symbol} that arrived stays in your wallet until you supply it.` : ""}</small>{data.status !== "working" && <button type="button" className="fv-text-button" disabled={busy} onClick={onCancel}>Close this flow</button>}</>}
    </div>
  </section>;
}
