"use client";
// Buy or sell any DexScreener token in-app through LI.FI: same-chain DEX aggregation or cross-chain routes, from
// and to your own proven wallets (EVM chains and Solana). A live quote previews as you type; Review prepares the
// exact transactions, checks your balance, fees and limits, and your own wallet signs.
import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewFrame } from "./ReviewFrame";
import { Check, ShieldCheck, ShieldAlert, X, ExternalLink, RefreshCw, ArrowRight } from "lucide-react";
import { api } from "./live";
import { fmtAmount, fmtUsd } from "./swap-format";
import { DS_CHAINS, SOLANA_ID } from "@/lib/flowvault/trade-lifi";
import { useMultiWallets, evmSessionFor, sendTradeEvm, waitEvmReceipt, type WalletSession } from "@/lib/flowvault/wallets";
import type { WalletAttempt } from "@/lib/flowvault/execution";
import type { TradePreparation } from "@/lib/flowvault/trade-live";

interface Option { chainId: number; chain: string; token: string; symbol: string; decimals: number; logo: string | null; balances: { address: string; amount: string }[] }
interface Preview { tool: string; output: string; minimum: string; fromUsd: string | null; toUsd: string | null; gasUsd: string | null; fees: { name: string; usd: string | null; included: boolean }[]; durationSec: number | null; from: { symbol: string }; to: { symbol: string }; fromChain: string; toChain: string; balance: string | null; enough: boolean | null }
interface Prepared {
  attempt: WalletAttempt;
  review: { tool: string; output: string; minimum: string; fromUsd: string | null; minOutUsd: string | null; gasUsd: string | null; fees: { name: string; usd: string | null; included: boolean }[]; durationSec: number | null; approvals: number; warning?: string; sender: string; recipient: string; fromChain: string; toChain: string; expiresAt: string };
  policy: { allowed: boolean; violations: { code: string; message: string }[]; missingEntries: { label: string }[]; revision: number; version: number };
}
const feeText = (f: { name: string; usd: string | null; included: boolean }) => `${f.name} ${f.usd === null ? "unknown" : fmtUsd(f.usd)}${f.included ? "" : " (on top)"}`;
const short = (a?: string) => !a ? "" : a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
const best = (o?: Option) => o?.balances.slice().sort((a, b) => Number(b.amount) - Number(a.amount))[0];

export function TradePanel({ chain, address, symbol, inline, onAttempt }: { chain: string; address: string; symbol: string; inline?: boolean; onAttempt?: (a: WalletAttempt) => void }) {
  const chainId = DS_CHAINS[chain];
  const { sessions } = useMultiWallets();
  const evmWallets = sessions.filter(s => s.chain === "evm").map(s => s.address), solWallets = sessions.filter(s => s.chain === "solana").map(s => s.address);
  const walletKey = [...evmWallets, ...solWallets].join(",");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [options, setOptions] = useState<Option[] | null>(null), [optError, setOptError] = useState("");
  const [pick, setPick] = useState(0), [amount, setAmount] = useState(""), [slippage, setSlippage] = useState(300);
  const [preview, setPreview] = useState<Preview | null>(null), [pvError, setPvError] = useState(""), [loading, setLoading] = useState(false);
  const [review, setReview] = useState<null | { body: Record<string, unknown> }>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!chainId) return;
    const evm = walletKey ? evmWallets : [], solana = walletKey ? solWallets : [];
    const t = setTimeout(() => api("/api/trade", { op: "options", chainId, evm, solana }).then((r: { options: Option[] }) => { setOptions(r.options); setOptError(""); }).catch(e => setOptError((e as Error).message)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- walletKey stands for the wallet lists
  }, [chainId, walletKey]);

  const opt = options?.[pick];
  const targetFamily = chainId === SOLANA_ID ? solWallets : evmWallets;
  const optFamily = opt ? (opt.chainId === SOLANA_ID ? solWallets : evmWallets) : [];
  // Buy: pay from the wallet holding the most of the chosen token; receive in your wallet on the token's chain.
  // Sell: send from your wallet on the token's chain; receive the chosen token in your wallet on its chain.
  const sender = side === "buy" ? best(opt)?.address ?? optFamily[0] : targetFamily[0];
  const recipient = side === "buy" ? (targetFamily.includes(sender ?? "") ? sender : targetFamily[0]) : (optFamily.includes(sender ?? "") ? sender : optFamily[0]);
  const body = opt && sender && recipient && Number(amount) > 0 ? (side === "buy"
    ? { fromChain: opt.chainId, fromToken: opt.token, toChain: chainId, toToken: address, amount, sender, recipient, slippageBps: slippage }
    : { fromChain: chainId, fromToken: address, toChain: opt.chainId, toToken: opt.token, amount, sender, recipient, slippageBps: slippage }) : null;
  const bodyKey = JSON.stringify(body);

  const run = useCallback(async (b: Record<string, unknown>) => {
    const n = ++seq.current;
    setLoading(true);
    try { const p = await api("/api/trade", { op: "preview", ...b }) as Preview; if (n === seq.current) { setPreview(p); setPvError(""); } }
    catch (e) { if (n === seq.current) { setPreview(null); setPvError((e as Error).message); } }
    finally { if (n === seq.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!body) { const t = setTimeout(() => { setPreview(null); setPvError(""); }, 0); return () => clearTimeout(t); }
    const t = setTimeout(() => void run(body), 500);
    const every = setInterval(() => void run(body), 20_000);
    return () => { clearTimeout(t); clearInterval(every); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bodyKey is the body's identity
  }, [bodyKey, run]);

  if (!chainId) return <p className="fv-muted">In-app trading doesn’t cover this network yet.</p>;
  const needFamily = chainId === SOLANA_ID ? "Solana" : "Ethereum-compatible";
  return <div className="fv-trade-panel">
    <div className="fv-segment fv-segment-small"><button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button><button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button></div>
    {!targetFamily.length && <p className="fv-notice">Connect a {needFamily} wallet (wallet menu) to {side === "buy" ? "receive" : "sell"} {symbol}.</p>}
    {optError && <p role="alert" className="fv-notice">{optError}</p>}
    <label className="fv-muted" style={{ display: "grid", gap: 4, marginTop: 8 }}>{side === "buy" ? "Pay with" : "Receive"}
      <select value={pick} onChange={e => { setPick(Number(e.target.value)); setPreview(null); }} disabled={!options?.length}>
        {(options ?? []).map((o, i) => <option key={o.chainId + o.token} value={i}>{o.symbol} on {o.chain}{best(o) ? ` · ${fmtAmount(best(o)!.amount)}` : ""}</option>)}
      </select>
    </label>
    <label className="fv-muted" style={{ display: "grid", gap: 4, marginTop: 8 }}>Amount ({side === "buy" ? opt?.symbol ?? "" : symbol})
      <span style={{ display: "flex", gap: 6 }}><input inputMode="decimal" value={amount} placeholder="0.0" onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} style={{ flex: 1, minWidth: 0 }} />
        {side === "buy" && best(opt) && <button type="button" className="fv-button" onClick={() => setAmount(best(opt)!.amount)}>Max</button>}
        {side === "sell" && preview?.balance && <button type="button" className="fv-button" onClick={() => setAmount(preview.balance!)}>Max</button>}</span>
    </label>
    <div className="fv-segment fv-segment-small" style={{ marginTop: 8 }} aria-label="Slippage">{[100, 300, 500].map(b => <button type="button" key={b} aria-pressed={slippage === b} onClick={() => setSlippage(b)}>{b / 100}%</button>)}</div>
    {preview && <div className="fv-confirm-table" style={{ marginTop: 10 }}>
      <div><span>You get</span><strong>≈ {fmtAmount(preview.output)} {preview.to.symbol}{preview.toUsd ? <small> · {fmtUsd(preview.toUsd)}</small> : null}</strong></div>
      <div><span>Minimum</span><strong>{fmtAmount(preview.minimum)} {preview.to.symbol}</strong></div>
      <div><span>Route</span><strong>{preview.tool} · {preview.fromChain === preview.toChain ? preview.fromChain : `${preview.fromChain} → ${preview.toChain}`}{preview.durationSec ? ` · ~${preview.durationSec}s` : ""}</strong></div>
      <div><span>Fees</span><strong>{preview.fees.length ? preview.fees.map(feeText).join(" · ") : "none listed"}{preview.gasUsd ? ` · gas ${fmtUsd(preview.gasUsd)}` : " · gas unknown"}</strong></div>
      {preview.balance !== null && <div><span>Your balance</span><strong className={preview.enough === false ? "fv-down" : ""}>{fmtAmount(preview.balance)} {preview.from.symbol}</strong></div>}
    </div>}
    {pvError && <p role="alert" className="fv-notice">{/no available quotes|No available quotes|no route/i.test(pvError) ? `No route for this amount right now. Try another amount or pay token.` : pvError}</p>}
    <button type="button" className="fv-button fv-primary fv-wide-button" style={{ marginTop: 10 }} disabled={!body || !preview || preview.enough === false || loading} onClick={() => body && setReview({ body })}>
      {loading ? <><RefreshCw size={14} className="fv-spin" /> Quoting…</> : preview?.enough === false ? "Not enough balance" : !amount ? "Enter an amount" : `Review ${side} ${symbol}`}</button>
    <p className="fv-muted" style={{ fontSize: 12, marginTop: 6 }}>Routed by LI.FI from your own wallets{sender ? ` (${short(sender)}${recipient && recipient !== sender ? " → " + short(recipient) : ""})` : ""}. Your wallet signs; FlowVault never holds funds.</p>
    {review && <TradeReview body={review.body} sessions={sessions} close={() => setReview(null)} inline={inline} onAttempt={onAttempt} />}
  </div>;
}

type Phase = "preparing" | "review" | "allowing" | "wallet" | "settling" | "done" | "failed" | "error";
const FIXABLE = new Set(["VENUE_NOT_ALLOWED", "METHOD_NOT_ALLOWED", "ASSET_USE_NOT_ALLOWED", "ASSET_SCOPE_UNVERIFIED"]);

function TradeReview({ body, sessions, close, inline, onAttempt }: { body: Record<string, unknown>; sessions: WalletSession[]; close: () => void; inline?: boolean; onAttempt?: (a: WalletAttempt) => void }) {
  const [phase, setPhase] = useState<Phase>("preparing"), [prep, setPrep] = useState<Prepared | null>(null), [attempt, setAttempt] = useState<WalletAttempt | null>(null);
  const [error, setError] = useState(""), [now, setNow] = useState(() => Date.now()), [step, setStep] = useState("");
  const alive = useRef(true), onAttemptRef = useRef(onAttempt);
  useEffect(() => { onAttemptRef.current = onAttempt; }, [onAttempt]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const prepare = useCallback(async () => {
    setPhase("preparing"); setError("");
    try { const r = await api("/api/trade", { op: "prepare", ...body }) as Prepared; if (alive.current) { setPrep(r); setAttempt(r.attempt); setPhase("review"); onAttemptRef.current?.(r.attempt); } }
    catch (e) { if (alive.current) { setError((e as Error).message); setPhase("error"); } }
  }, [body]);
  useEffect(() => { const t = setTimeout(() => void prepare(), 0); return () => clearTimeout(t); }, [prepare]);
  async function allow() {
    if (!prep) return;
    setPhase("allowing");
    try { await api("/api/trade", { op: "allow", id: prep.attempt.id, revision: prep.policy.revision }); await prepare(); } catch (e) { setError((e as Error).message); setPhase("review"); }
  }
  async function poll(id: string, seconds: number) {
    for (let i = 0; i < Math.ceil(seconds / 3) && alive.current; i++) {
      const r = await api("/api/transactions", { id, action: "check" }).catch(() => null) as { attempt?: WalletAttempt } | null;
      if (r?.attempt) { setAttempt(r.attempt); if (["confirmed", "failed", "partial"].includes(r.attempt.state)) return r.attempt; }
      await new Promise(res => setTimeout(res, 3000));
    }
    return null;
  }
  async function approve() {
    if (!prep) return;
    const id = prep.attempt.id, p = prep.attempt.preparation as unknown as TradePreparation;
    setError(""); setPhase("wallet");
    let authorized = false, opened = false;
    try {
      await api("/api/transactions", { id, action: "authorize" });
      authorized = true;
      const hashes: string[] = [];
      if (p.solanaTx) {
        const s = sessions.find(x => x.chain === "solana" && x.address === p.accountId);
        if (!s) throw new Error(`Connect ${short(p.accountId)} in your Solana wallet first. Nothing was sent.`);
        const { sendSolanaRoute } = await import("@/lib/flowvault/solana-wallet");
        opened = true; setStep("Approve the trade in " + s.walletName);
        hashes.push(await sendSolanaRoute(s, p.solanaTx));
      } else {
        const s = await evmSessionFor(p.accountId);
        if (!s) throw new Error(`Connect ${short(p.accountId)} in your wallet first. Nothing was sent.`);
        for (const [i, tx] of p.evmTxs.entries()) {
          const last = i === p.evmTxs.length - 1;
          setStep(last ? "Approve the trade in " + s.walletName : `Approve ${p.from.symbol} spending (${i + 1} of ${p.evmTxs.length - 1})`);
          opened = true;
          const h = await sendTradeEvm(s, tx, tx, p.chainParams);
          hashes.push(h);
          await api("/api/transactions", { id, action: "attach", hashes: [h] });
          if (!last && !(await waitEvmReceipt(s, h))) throw new Error("The approval failed on chain. The trade wasn't sent.");
        }
      }
      setPhase("settling"); setStep("");
      const attached = await api("/api/transactions", { id, action: "attach", hashes }) as { attempt: WalletAttempt };
      setAttempt(attached.attempt);
      const final = ["confirmed", "failed", "partial"].includes(attached.attempt.state) ? attached.attempt : await poll(id, (p.durationSec ?? 30) + 240);
      if (!alive.current) return;
      setPhase(final?.state === "confirmed" ? "done" : final ? "failed" : "settling");
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const refused = err?.code === 4001 || /reject|denied|declin|cancel/i.test(String(err?.message ?? e));
      if (authorized) await api("/api/transactions", { id, action: !opened || refused ? "declined" : "uncertain" }).catch(() => {});
      if (alive.current) { setError(refused && opened ? "You declined in your wallet. Nothing was sent." : (e as Error).message); setPhase("error"); }
    }
  }
  const r = prep?.review, p = attempt?.preparation as unknown as TradePreparation | undefined;
  const left = r ? Math.max(0, Math.floor((Date.parse(r.expiresAt) - now) / 1000)) : 0;
  const blocked = prep && !prep.policy.allowed, fixable = blocked && prep.policy.violations.every(v => FIXABLE.has(v.code));
  const busy = ["wallet", "settling"].includes(phase);
  const link = (h: string) => p?.solanaTx ? "https://solscan.io/tx/" + h : (p?.explorer ?? "https://etherscan.io/").replace(/\/?$/, "/") + "tx/" + h;
  return <ReviewFrame inline={inline} busy={busy} close={close} className={"fv-dialog fv-swap-confirm is-" + phase} label="Review trade">
      {!busy && !inline && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
      <h2>{phase === "preparing" ? "Preparing your trade" : phase === "allowing" ? "Updating your policy" : phase === "wallet" ? "Confirm in your wallet" : phase === "settling" ? "Settling" : phase === "done" ? "Trade complete" : phase === "failed" ? "Trade did not complete" : phase === "error" ? "Trade not sent" : "Review trade"}</h2>
      <p className="fv-confirm-sub">{phase === "preparing" ? "Fresh route, balance, allowance, fees and your limits." : phase === "wallet" ? step || "Approve in your wallet." : phase === "settling" || phase === "done" || phase === "failed" ? attempt?.message : phase === "error" ? error : "Exact transactions, checked against your limits before your wallet opens."}</p>
      {r && p && phase !== "error" && <div className="fv-confirm-table">
        <div><span>You pay</span><strong>{fmtAmount(p.amount)} {p.from.symbol}{r.fromUsd ? <small> · {fmtUsd(r.fromUsd)}</small> : null}</strong></div>
        <div><span>You get</span><strong>{phase === "done" && p.result?.received ? fmtAmount(p.result.received) : "≈ " + fmtAmount(r.output)} {p.to.symbol}</strong></div>
        {phase !== "done" && <div><span>Minimum</span><strong>{fmtAmount(r.minimum)} {p.to.symbol}{r.minOutUsd ? <small> · {fmtUsd(r.minOutUsd)}</small> : null}</strong></div>}
        <div><span>Route</span><strong>{r.tool} via LI.FI · {r.fromChain === r.toChain ? r.fromChain : <>{r.fromChain} <ArrowRight size={12} /> {r.toChain}</>}</strong></div>
        <div><span>From → to</span><strong>{short(r.sender)} → {short(r.recipient)}</strong></div>
        <div><span>Fees</span><strong>{r.fees.map(feeText).join(" · ") || "none listed"}{r.gasUsd ? ` · gas up to ${fmtUsd(r.gasUsd)}` : " · gas unknown"}</strong></div>
        {r.approvals > 0 && phase === "review" && <div><span>Approval</span><strong>Exactly {fmtAmount(p.amount)} {p.from.symbol} for the LI.FI router (not unlimited)</strong></div>}
      </div>}
      {r?.warning && phase === "review" && <p role="status" className="fv-notice">{r.warning}</p>}
      {prep && phase === "review" && (prep.policy.allowed
        ? <div className="fv-policy-check is-ok"><ShieldCheck size={17} /><div><strong>Within your limits</strong><small>Per-action cap, daily cap, cost limit and approved venues checked · policy v{prep.policy.version}</small></div></div>
        : <div className="fv-policy-check is-blocked"><ShieldAlert size={17} /><div><strong>{fixable ? "LI.FI trades aren’t in your policy yet" : "Your policy blocks this trade"}</strong>
          <ul>{prep.policy.violations.slice(0, 4).map(v => <li key={v.code + v.message}>{v.message}</li>)}</ul>
          {fixable && <small>Allowing adds exactly: {prep.policy.missingEntries.map(e => e.label).join("; ")}. Nothing else changes.</small>}</div></div>)}
      {(phase === "settling" || phase === "done" || phase === "failed") && <div className="fv-confirm-hashes">{attempt?.hashes.map(h => <a key={h} href={link(h)} target="_blank" rel="noopener noreferrer">{h.slice(0, 8)}…{h.slice(-6)} <ExternalLink size={12} /></a>)}</div>}
      {phase === "done" && <div className="fv-confirm-success"><Check size={18} /> {attempt?.message}</div>}
      <div className="fv-confirm-actions">
        {phase === "review" && (left === 0 ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void prepare()}><RefreshCw size={15} /> Quote expired · refresh</button>
          : blocked ? (fixable ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void allow()}><ShieldCheck size={15} /> Allow and continue</button> : <button type="button" className="fv-button fv-wide-button" onClick={close}>Close</button>)
          : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void approve()}>Approve in wallet · {left}s</button>)}
        {(phase === "preparing" || phase === "allowing") && <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {phase === "allowing" ? "Saving a new policy revision…" : "Checking…"}</button>}
        {(phase === "done" || phase === "failed") && <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
        {phase === "error" && <div className="fv-actions"><button type="button" className="fv-button" onClick={close}>Close</button><button type="button" className="fv-button fv-primary" onClick={() => void prepare()}>Try again</button></div>}
      </div>
  </ReviewFrame>;
}
