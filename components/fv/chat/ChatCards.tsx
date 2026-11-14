"use client";
// Ask FlowVault cards: a typed registry (no model-generated markup). Executable cards reuse the same controllers and
// review components as the screens (swap quoting, SwapReview, RheaSheet, TradePanel, plans), rendered inline, so
// the operation stays in the conversation. A card's lifecycle comes from the journal attempt or plan it is linked
// to; a model message or a wallet response is never taken as proof of completion.
import { useEffect, useRef, useState } from "react";
import { checkAutomation, describe, template } from "@/lib/flowvault/automations";
import { ArrowDownUp, ArrowUpRight, Check, CircleAlert, ExternalLink, RefreshCw, Settings2, ShieldAlert, Wallet, Zap } from "lucide-react";
import type { Card, CardKind } from "@/lib/flowvault/chat-cards";
import type { WalletAttempt } from "@/lib/flowvault/execution";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { units, decimal } from "@/lib/flowvault/money";
import { useTokenCatalog, coreIdentity } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { useSwapQuote, ownAddress, runsInApp } from "../useSwapQuote";
import { TokenPicker } from "../TokenPicker";
import { TokenIcon, NetworkLabel, networkInfo } from "../AssetIdentity";
import { SwapReview } from "../SwapReview";
import { RheaSheet, type RheaAction } from "../RheaSheet";
import { TradePanel } from "../TradePanel";
import { openPlan } from "../PlanDock";
import { fmtAmount, fmtUsd, ago } from "../swap-format";
import { api } from "../live";

export interface CardEnv {
  owner: string;
  example: boolean;
  /** The owner's verified addresses per network (server-provided). */
  addresses: Record<string, string>;
  connect: () => void;
  send: (text: string) => void;
  /** Reload the conversation (cards reconciled with their journals). */
  refresh: () => Promise<void>;
  edit: (card: Card, patch: Record<string, unknown>) => Promise<Card | null>;
  link: (card: Card, ref: { attemptId?: string; planId?: string }, params?: Record<string, unknown>) => Promise<void>;
  spawn: (kind: CardKind, params: Record<string, unknown>, note?: string) => Promise<void>;
  onSettled: () => void;
  navigate: (screen: string) => void;
  /** Later messages exist (a choice was answered, a newer card exists). */
  answered: boolean;
}

const HANDED_OFF = new Set(["awaiting_wallet", "submitted", "unknown", "confirmed", "failed", "partial", "executing", "completed"]);
const locked = (c: Card) => !!c.link && HANDED_OFF.has(c.link.state);
const net = (n: string) => networkInfo(n)?.name ?? n;

/** One lifecycle vocabulary for every operation card. */
function lifecycle(c: Card, local?: string): { label: string; tone: "muted" | "ok" | "warn" | "bad" | "busy" } {
  const st = local ?? c.link?.state;
  switch (st) {
    case "loading": return { label: "Loading evidence", tone: "busy" };
    case "review": case "prepared": case "evaluated": case "reviewed": case "draft-plan": return { label: "Ready to review", tone: "ok" };
    case "blocked": return { label: "Blocked", tone: "bad" };
    case "wallet": case "awaiting_wallet": return { label: "Awaiting wallet", tone: "busy" };
    case "submitted": return { label: "Submitted", tone: "busy" };
    case "settling": case "executing": return { label: "Settling", tone: "busy" };
    case "confirmed": case "completed": case "done": return { label: "Completed", tone: "ok" };
    case "partial": return { label: "Partial", tone: "warn" };
    case "failed": return { label: "Failed", tone: "bad" };
    case "unknown": return { label: "Uncertain", tone: "warn" };
    case "not_sent": return { label: "Not sent", tone: "warn" };
    case "superseded": case "expired": case "cancelled": return { label: "Expired", tone: "muted" };
  }
  return { label: (c.kind === "swap" && !(c.params as { amount?: string | null }).amount) || (c.kind === "lend" && !(c.params as { amount?: string | null }).amount) ? "Needs details" : "Draft", tone: "muted" };
}

function Head({ title, card, local, children }: { title: string; card: Card; local?: string; children?: React.ReactNode }) {
  const l = lifecycle(card, local);
  const readOnly = ["portfolio", "research", "perps"].includes(card.kind);
  return <div className="fv-chat-card-head">
    <strong>{title}</strong>
    {card.version > 1 && <small title={card.by === "you" ? "Last changed by you" : "Last changed by the assistant"}>v{card.version}</small>}
    {children}
    {!readOnly && <span className={"fv-chat-pill is-" + l.tone}>{l.tone === "busy" && <RefreshCw size={11} className="fv-spin" />}{l.label}</span>}
  </div>;
}
function Notes({ card }: { card: Card }) {
  if (!card.notes.length && !card.supersededBy) return null;
  return <ul className="fv-chat-notes">{card.supersededBy && <li>A newer card below replaced this one. This one is unchanged.</li>}{card.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>;
}

/* ───────────── Linked outcome: the journal's own record, with status checks and safe recovery ───────────── */

function Outcome({ card, env, title }: { card: Card; env: CardEnv; title: string }) {
  const [attempt, setAttempt] = useState<WalletAttempt | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const id = card.link?.attemptId;
  useEffect(() => {
    if (!id) return;
    let live = true;
    api("/api/transactions", undefined, "GET").then((r: { attempts?: WalletAttempt[] }) => { if (live) setAttempt(r.attempts?.find((a) => a.id === id) ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [id, card.link?.state]);
  const st = card.link!.state;
  const open = ["awaiting_wallet", "submitted", "unknown", "partial"].includes(st);
  async function check() {
    if (!id) return;
    setBusy(true); setErr("");
    try { const r = await api("/api/transactions", { id, action: "check" }) as { attempt: WalletAttempt }; setAttempt(r.attempt); await env.refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const explorer = (h: string) => h.startsWith("0x") ? "https://etherscan.io/tx/" + h : /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(h) ? "https://solscan.io/tx/" + h : "https://nearblocks.io/txns/" + h;
  return <div className={"fv-chat-outcome is-" + lifecycle(card).tone}>
    <div className="fv-chat-outcome-line">{st === "confirmed" || st === "completed" ? <Check size={16} /> : open ? <RefreshCw size={15} className={busy ? "fv-spin" : ""} /> : <CircleAlert size={16} />}<span>{attempt?.message || (card.link?.planId ? "Tracked as a plan. Open it to review and sign each step." : title)}</span></div>
    {!!attempt?.hashes.length && <div className="fv-confirm-hashes">{attempt.hashes.slice(-2).map((h) => <a key={h} href={explorer(h)} target="_blank" rel="noopener noreferrer">{h.slice(0, 8)}…{h.slice(-6)} <ExternalLink size={12} /></a>)}</div>}
    {st === "unknown" && <p className="fv-muted">FlowVault can’t yet tell whether this reached the chain. Don’t send it again: check its status first.</p>}
    {err && <p role="alert" className="fv-notice">{err}</p>}
    <div className="fv-chat-actions">
      {open && id && <button type="button" className="fv-button fv-primary" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check status"}</button>}
      {card.link?.planId && <button type="button" className="fv-button fv-primary" onClick={() => openPlan({ planId: card.link!.planId })}>Open plan</button>}
      {!open && ["swap", "lend", "trade", "stake"].includes(card.kind) && !card.supersededBy && <button type="button" className="fv-button" onClick={() => void env.spawn(card.kind, card.params as Record<string, unknown>, "Same details as an earlier card")}>New draft with these details</button>}
    </div>
  </div>;
}

/* ───────────── Swap / bridge ───────────── */

function SwapChatCard({ card, env }: { card: Card<"swap">; env: CardEnv }) {
  const p = card.params;
  const { tokens, error: catalogError } = useTokenCatalog();
  const holdings = useWalletBalances(env.owner, tokens, !env.example);
  const [fromId, setFrom] = useState(p.from), [toId, setTo] = useState(p.to);
  const [amount, setAmount] = useState(p.amount ?? ""), [slippage, setSlippage] = useState(String(p.slippageBps));
  const [review, setReview] = useState(false), [settings, setSettings] = useState(false);
  // The assistant changed the draft: show its version and close any review prepared from the old one.
  const seen = useRef(card.version);
  useEffect(() => {
    if (card.version === seen.current) return;
    seen.current = card.version;
    if (card.by !== "assistant") return;
    const t = setTimeout(() => { setFrom(card.params.from); setTo(card.params.to); setAmount(card.params.amount ?? ""); setSlippage(String(card.params.slippageBps)); setReview(false); }, 0);
    return () => clearTimeout(t);
  }, [card.version, card.by, card.params]);
  // Save the owner's own edits so the assistant sees the card as it is.
  const current = { from: fromId, to: toId, amount: amount || null, slippageBps: Number(slippage) };
  const dirty = current.from !== p.from || current.to !== p.to || current.amount !== p.amount || current.slippageBps !== p.slippageBps;
  const envRef = useRef(env); useEffect(() => { envRef.current = env; }, [env]);
  useEffect(() => {
    if (!dirty || locked(card) || review) return;
    const valid = !current.amount || /^\d+(\.\d+)?$/.test(current.amount);
    if (!valid) return;
    const t = setTimeout(() => void envRef.current.edit(card, { ...current, amountUsd: null, priceUsed: null }), 900);
    return () => clearTimeout(t);
  }, [fromId, toId, amount, slippage]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = tokens.find((t) => t.id === fromId), to = tokens.find((t) => t.id === toId);
  const fromBal = holdings.balances[fromId], toBal = holdings.balances[toId];
  const own = (n?: string) => ownAddress(holdings, n) || (n ? env.addresses[n] ?? (["eth", "base", "arb", "bsc", "op", "pol", "avax", "gnosis", "hypercore"].includes(n) ? env.addresses.eth ?? "" : "") : "");
  const sender = fromBal?.account ?? own(from?.network), recipient = own(to?.network);
  const q = useSwapQuote({ tokens, holdings, owner: env.owner, example: env.example, fromId, toId, amount, slippage, sender, recipient, paused: review || locked(card) });
  const { chosen, busy, error, expires, validAmount, preview } = q;
  const inApp = runsInApp(chosen, from, to, sender, recipient);
  const balanceKnown = !!from && holdings.covered.has(from.network);
  const over = validAmount && !!from && balanceKnown && units(amount, from.decimals) > BigInt(fromBal?.raw ?? "0");
  const left = validAmount && from && balanceKnown && !over ? decimal(BigInt(fromBal?.raw ?? "0") - units(amount, from.decimals), from.decimals) : null;
  function fraction(pct: bigint) {
    if (!from || !fromBal) return;
    let raw = BigInt(fromBal.raw);
    if (from.contract === "native" && from.network === "near") raw = raw > 10n ** 23n ? raw - 10n ** 23n : 0n;
    raw = (raw * pct) / 100n;
    setAmount(raw > 0n ? decimal(raw, from.decimals) : "");
  }
  function change(side: "from" | "to", t: SwapToken) {
    if (side === "from") { if (t.id === toId) setTo(fromId); setFrom(t.id); } else { if (t.id === fromId) setFrom(toId); setTo(t.id); }
  }

  if (locked(card) && !review) return <div className="fv-chat-card"><Head title="Swap" card={card} /><SwapSummary card={card} tokens={tokens} /><Outcome card={card} env={env} title="Swap" /></div>;
  const cta = !from || !to ? { label: "Loading tokens…", disabled: true }
    : !validAmount ? { label: "Enter an amount", disabled: true }
    : q.waitingForWallet ? (from.network !== "near" && !env.addresses[from.network] && !env.addresses.eth ? { label: `Connect your ${net(from.network)} wallet`, onClick: env.connect } : { label: "Reading your wallets…", disabled: true, spin: true })
    : busy && !chosen ? { label: "Comparing routes…", disabled: true, spin: true }
    : !chosen ? { label: error ? "No route for this amount" : "No route yet", disabled: true }
    : !inApp ? { label: `Continue at ${chosen.venue}`, href: chosen.url }
    : env.example ? { label: "Example workspace: nothing can be signed", disabled: true }
    : !env.owner ? { label: "Connect wallet to continue", onClick: env.connect }
    : over ? { label: `Not enough ${from.symbol}`, disabled: true }
    : { label: `Review swap via ${chosen.venue}`, onClick: () => setReview(true) };
  return <div className="fv-chat-card">
    <Head title={from && to && from.network !== to.network ? "Bridge & swap" : "Swap"} card={card} local={review ? undefined : busy && !chosen && validAmount ? "loading" : undefined}>
      <button type="button" className="fv-chat-chip" aria-expanded={settings} onClick={() => setSettings(!settings)} disabled={review}><Settings2 size={12} /> {Number(slippage) / 100}%</button>
    </Head>
    <Notes card={card} />
    {!review && <>
      {settings && <div className="fv-swap-settings-row fv-chat-slippage" role="group" aria-label="Slippage">{["50", "100", "300", "500"].map((v) => <button type="button" key={v} aria-pressed={slippage === v} onClick={() => setSlippage(v)}>{Number(v) / 100}%</button>)}</div>}
      <div className="fv-swap-amount fv-chat-amount">
        <div className="fv-swap-box-head"><label htmlFor={"chat-pay-" + card.id}>You pay{from && <> · {net(from.network)}</>}</label>{fromBal ? <span className="fv-swap-balance"><Wallet size={13} /> {fmtAmount(fromBal.amount)}{[25n, 50n, 100n].map((x) => <button type="button" key={String(x)} onClick={() => fraction(x)}>{x === 100n ? "Max" : x + "%"}</button>)}</span> : balanceKnown ? <span className="fv-swap-balance">None held</span> : null}</div>
        <div className="fv-swap-line"><input id={"chat-pay-" + card.id} value={amount} inputMode="decimal" placeholder="0" autoComplete="off" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /><TokenPicker label="Choose token to sell" tokens={tokens} balances={holdings.balances} covered={holdings.covered} value={from} onChange={(t) => change("from", t)} /></div>
        <small>{validAmount && from?.price ? fmtUsd(Number(amount) * Number(from.price)) : " "}{over && <b className="fv-swap-warn"> · more than your balance</b>}{left !== null && <> · {fmtAmount(left)} {from!.symbol} left after</>}</small>
      </div>
      <div className="fv-swap-flip"><button type="button" className="fv-icon-button" aria-label="Reverse pair" onClick={() => { setFrom(toId); setTo(fromId); setAmount(""); }}><ArrowDownUp size={16} /></button></div>
      <div className="fv-swap-amount fv-swap-receive fv-chat-amount">
        <div className="fv-swap-box-head"><span>You receive{to && <> · {net(to.network)}</>}</span>{toBal && <span className="fv-swap-balance"><Wallet size={13} /> {fmtAmount(toBal.amount)}</span>}</div>
        <div className="fv-swap-line"><strong className={"fv-swap-output" + (busy ? " fv-loading-text" : "")}>{chosen ? fmtAmount(chosen.output) : busy ? "…" : "0"}</strong><TokenPicker label="Choose token to buy" tokens={tokens} balances={holdings.balances} covered={holdings.covered} value={to} onChange={(t) => change("to", t)} /></div>
        <small>{chosen && to?.price ? fmtUsd(Number(chosen.output) * Number(to.price)) : " "}</small>
      </div>
      {chosen && from && to && <div className="fv-swap-facts fv-chat-facts">
        <div><span>Minimum received</span><strong>{fmtAmount(chosen.minimum)} {to.symbol}</strong></div>
        <div><span>Route</span><strong>{chosen.venue}{chosen.eta ? ` · ~${chosen.eta}s` : ""}{q.routes.length > 1 ? ` · best of ${q.routes.length}` : ""}</strong></div>
        <div><span>Quote</span><strong>{expires > 0 ? `refreshes in ${expires}s` : "refreshing…"} <button type="button" className="fv-text-button" onClick={() => void q.quote()} disabled={busy} aria-label="Refresh quote"><RefreshCw size={12} className={busy ? "fv-spin" : ""} /></button></strong></div>
      </div>}
      {chosen && <details className="fv-chat-details"><summary>Fees & execution</summary><p>{chosen.feeNote}</p><p>{inApp ? "FlowVault prepares the exact transactions, checks them against your limits and tracks them to settlement. You approve in your wallet." : "This venue runs outside FlowVault, so your limits and tracking don’t apply there."}</p>{q.routes.length > 1 && q.routes.slice(1).map((r) => <p key={r.venue}>{r.venue}: {fmtAmount(r.output)} {to?.symbol}</p>)}</details>}
      {!!preview?.warnings.length && !chosen && <p className="fv-muted fv-chat-small">{preview.warnings[0]}</p>}
      {(error || catalogError) && <p role="alert" className="fv-notice">{error || catalogError}</p>}
      {"href" in cta && cta.href ? <a className="fv-button fv-primary fv-wide-button" href={cta.href} target="_blank" rel="noopener noreferrer">{cta.label} <ArrowUpRight size={15} /></a>
        : <button type="button" className="fv-button fv-primary fv-wide-button" disabled={"disabled" in cta && cta.disabled} onClick={"onClick" in cta ? cta.onClick : undefined}>{"spin" in cta && cta.spin && <RefreshCw size={15} className="fv-spin" />}{cta.label}{"onClick" in cta && cta.onClick && env.owner ? <Zap size={15} /> : null}</button>}
    </>}
    {review && from && to && chosen && <SwapReview inline from={from} to={to} amount={amount} slippage={Number(slippage)} route={chosen.venue === "NEAR Intents" ? "intents" : "ref"} sender={sender} recipient={recipient}
      close={() => { setReview(false); void env.refresh(); }} onSettled={() => { void holdings.refresh(); env.onSettled(); }}
      onAttempt={(a) => void env.link(card, { attemptId: a.id }, { ...current, amountUsd: current.amount === p.amount ? p.amountUsd : null, priceUsed: current.amount === p.amount ? p.priceUsed : null })} />}
  </div>;
}
function SwapSummary({ card, tokens }: { card: Card<"swap">; tokens: SwapToken[] }) {
  const f = tokens.find((t) => t.id === card.params.from), t = tokens.find((x) => x.id === card.params.to);
  return <div className="fv-chat-pair">{f && <TokenIcon symbol={f.symbol} network={f.network} core={coreIdentity(f)} image={f.icon} size={30} />}<span>{fmtAmount(card.params.amount ?? "0")} {f?.symbol ?? ""} <small>{f ? net(f.network) : ""}</small></span><ArrowUpRight size={14} />{t && <TokenIcon symbol={t.symbol} network={t.network} core={coreIdentity(t)} image={t.icon} size={30} />}<span>{t?.symbol ?? ""} <small>{t ? net(t.network) : ""}</small></span></div>;
}

/* ───────────── Rhea: supply / withdraw / borrow / repay / collateral ───────────── */

const LEND_TITLE: Record<string, string> = { supply: "Earn on Rhea", withdraw: "Withdraw from Rhea", borrow: "Borrow on Rhea", repay: "Repay on Rhea", collateral_add: "Add collateral", collateral_release: "Release collateral" };
function LendChatCard({ card, env }: { card: Card<"lend">; env: CardEnv }) {
  const p = card.params;
  // Only the assistant's versions reset the form; the owner's own saves must not interrupt a review.
  const assistantVersion = card.by === "assistant" ? card.version : card.history.filter((h) => h.by === "assistant").at(-1)?.version ?? 1;
  if (locked(card)) return <div className="fv-chat-card"><Head title={LEND_TITLE[p.action]} card={card} /><div className="fv-chat-pair"><TokenIcon symbol={p.symbol} image={p.icon ?? undefined} network="near" core={["USDC", "USDT", "NEAR"].includes(p.symbol)} size={30} /><span>{fmtAmount(p.amount ?? "0")} {p.symbol}</span></div><Outcome card={card} env={env} title={LEND_TITLE[p.action]} /></div>;
  const mode = ["supply", "withdraw"].includes(p.action) ? "earn" : "borrow";
  return <div className="fv-chat-card fv-chat-card-lend">
    <Head title={LEND_TITLE[p.action]} card={card} />
    <Notes card={card} />
    <RheaSheet key={mode} inline tokenId={p.tokenId} symbol={p.symbol === "NEAR" ? "wNEAR" : p.symbol} icon={p.icon} mode={mode} initial={p.action as RheaAction} initialAmount={p.amount} rates={{ supply: p.supplyApy, borrow: p.borrowApy }}
      draftKey={card.id + ":" + assistantVersion} close={() => void env.refresh()} onSettled={env.onSettled}
      onDraft={(d) => { if (d.action !== p.action || (d.amount || null) !== p.amount) void env.edit(card, { action: d.action, amount: d.amount && /^\d+(\.\d+)?$/.test(d.amount) ? d.amount : null }); }}
      onAttempt={(a) => void env.link(card, { attemptId: a.id })}
      disabledReason={env.example ? "Example workspace: nothing can be signed. Switch to Personal to use Rhea." : !env.owner ? "Connect your NEAR wallet to review this." : null}
      fund={p.action === "supply" ? { owner: env.owner, example: env.example, connect: env.connect, onFlow: (id) => { const u = new URL(window.location.href); u.searchParams.set("tab", "supply"); u.searchParams.set("sflow", id); history.replaceState(null, "", u); env.navigate("earn"); } } : undefined} />
  </div>;
}

/* ───────────── Token trade (LI.FI, any DexScreener token) ───────────── */

function TradeChatCard({ card, env }: { card: Card<"trade">; env: CardEnv }) {
  const p = card.params;
  if (locked(card)) return <div className="fv-chat-card"><Head title={`Trade ${p.symbol}`} card={card} /><Outcome card={card} env={env} title="Trade" /></div>;
  return <div className="fv-chat-card"><Head title={`Trade ${p.symbol}`} card={card}><small className="fv-chat-mono">{net(p.chain)} · {p.address.slice(0, 6)}…{p.address.slice(-4)}</small></Head>
    {env.example ? <p className="fv-notice">Example workspace: nothing can be signed.</p> : <TradePanel inline chain={p.chain} address={p.address} symbol={p.symbol} onAttempt={(a) => void env.link(card, { attemptId: a.id })} />}
  </div>;
}

/* ───────────── Plans: staking and scheduled payments (reviewed and signed in the plan dock) ───────────── */

/** A stable idempotency key per card version, so double clicks and retries open the same plan. */
const planKey = (c: Card) => c.id.slice(0, 28) + c.version.toString(16).padStart(8, "0");
function usePlanStart(card: Card, env: CardEnv) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function start(body: Record<string, unknown>, params?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api("/api/plans", { key: planKey(card), ...body }) as { plan: { id: string; state: string } };
      await env.link(card, { planId: r.plan.id }, params);
      openPlan({ plan: r.plan });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return { busy, err, start };
}
function StakeChatCard({ card, env }: { card: Card<"stake">; env: CardEnv }) {
  const p = card.params;
  const [venue, setVenue] = useState(p.venue ?? p.options[0]?.venue ?? "linear"), [amount, setAmount] = useState(p.amount ?? "");
  const plan = usePlanStart(card, env);
  const seen = useRef(card.version);
  useEffect(() => { if (card.version === seen.current) return; seen.current = card.version; if (card.by !== "assistant") return; const t = setTimeout(() => { setVenue(card.params.venue ?? "linear"); setAmount(card.params.amount ?? ""); }, 0); return () => clearTimeout(t); }, [card.version, card.by, card.params]);
  if (card.link) return <div className="fv-chat-card"><Head title={p.action === "stake" ? "Stake NEAR" : "Unstake"} card={card} /><Outcome card={card} env={env} title="Staking plan" /></div>;
  const valid = (() => { try { return units(amount, 24) > 0n; } catch { return false; } })();
  const o = p.options.find((x) => x.venue === venue);
  const body = p.action === "stake" ? { objective: "stake", venue, amountRaw: valid ? units(amount, 24).toString() : undefined } : { objective: "unstake", positionId: p.positionId ?? undefined, amountRaw: valid ? units(amount, 24).toString() : undefined };
  return <div className="fv-chat-card"><Head title={p.action === "stake" ? "Stake NEAR" : "Start unstaking"} card={card} />
    {p.action === "stake" && <div className="fv-chat-options" role="radiogroup" aria-label="Staking venue">{p.options.map((x) => <button type="button" role="radio" aria-checked={venue === x.venue} key={x.venue} onClick={() => setVenue(x.venue)}><TokenIcon symbol="NEAR" core size={22} /><span><strong>{x.name}</strong><small>{x.apy ? `${Number(x.apy).toFixed(2)}% variable` : "rate unavailable"} · {x.exit}</small></span></button>)}</div>}
    <div className="fv-swap-amount fv-chat-amount"><div className="fv-swap-box-head"><label htmlFor={"stake-" + card.id}>{p.action === "stake" ? "Amount to stake" : "Amount to unstake"}</label></div><div className="fv-swap-line"><input id={"stake-" + card.id} value={amount} inputMode="decimal" placeholder="0" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /><span className="fv-rhea-unit"><TokenIcon symbol="NEAR" core size={22} />NEAR</span></div></div>
    {p.action === "unstake" && <p className="fv-muted fv-chat-small">Unstaking starts a wait of about 4 epochs (2–3 days). Claiming the NEAR afterwards is a separate step.</p>}
    {o && venue === "native" && <p className="fv-muted fv-chat-small">Native staking needs a validator. You choose it in the plan.</p>}
    {plan.err && <p role="alert" className="fv-notice">{plan.err}</p>}
    <button type="button" className="fv-button fv-primary fv-wide-button" disabled={!valid || plan.busy || env.example || !env.owner} onClick={() => void plan.start(body, { venue, amount })}>{plan.busy ? <><RefreshCw size={15} className="fv-spin" /> Checking…</> : env.example ? "Example workspace: nothing can be signed" : !env.owner ? "Connect your NEAR wallet" : !valid ? "Enter an amount" : "Review staking plan"}</button>
  </div>;
}
function PayChatCard({ card, env }: { card: Card<"pay">; env: CardEnv }) {
  const p = card.params;
  const plan = usePlanStart(card, env);
  return <div className="fv-chat-card"><Head title="Scheduled payment" card={card} />
    <div className="fv-confirm-table"><div><span>To</span><strong>{p.label}</strong></div><div><span>Amount</span><strong>{fmtAmount(p.amount)} {p.token} on <NetworkLabel network={p.chain === "bnb" ? "bsc" : p.chain} /></strong></div><div><span>Due</span><strong>{p.dueDate}</strong></div></div>
    {card.link ? <Outcome card={card} env={env} title="Payment plan" /> : <>
      <p className="fv-muted fv-chat-small">FlowVault compares funding sources (idle cash first, then Rhea) and keeps your reserve. Each step is approved in your wallet. Paying doesn’t change the schedule.</p>
      {plan.err && <p role="alert" className="fv-notice">{plan.err}</p>}
      <button type="button" className="fv-button fv-primary fv-wide-button" disabled={plan.busy} onClick={() => void plan.start({ objective: "pay_obligation", obligationId: p.obligationId })}>{plan.busy ? "Comparing sources…" : "Compare funding and review"}</button>
    </>}
  </div>;
}

/* ───────────── Read cards ───────────── */

function PortfolioChatCard({ card, env }: { card: Card<"portfolio">; env: CardEnv }) {
  const p = card.params;
  const [all, setAll] = useState(false);
  const rows = all ? p.rows : p.rows.slice(0, 6);
  // The same asset on the same network in several wallets: say which wallet.
  const shared = (r: (typeof p.rows)[number]) => p.rows.filter((x) => x.asset === r.asset && x.network === r.network && x.kind === r.kind).length > 1;
  const short = (a: string | null) => (!a ? "" : a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);
  return <div className="fv-chat-card"><Head title="Your balances" card={card}><small>{ago(p.capturedAt)}</small></Head>
    {p.totalUsd && <div className="fv-chat-total"><strong>{fmtUsd(p.totalUsd)}</strong><small>{p.unvalued ? `+ ${p.unvalued} unvalued` : "valued holdings"}</small></div>}
    <div className="fv-chat-rows">{rows.map((r, i) => <div key={i} className="fv-chat-row">
      <TokenIcon symbol={r.asset} network={r.network} core={["USDC", "USDT", "NEAR", "ETH", "SOL"].includes(r.asset)} size={28} />
      <span><strong>{r.asset}</strong><small>{net(r.network)}{r.kind !== "wallet" ? " · " + r.kind : ""}{shared(r) ? " · " + short(r.account) : ""}</small></span>
      <span className="fv-chat-row-num"><strong>{fmtAmount(r.amount, 4)}</strong><small>{r.usd !== null ? fmtUsd(r.usd) : "unvalued"}</small></span>
      {r.kind === "wallet" && r.catalogId && !env.example && <button type="button" className="fv-chat-chip" onClick={() => void env.spawn("swap", { from: r.catalogId, to: r.catalogId === "near:native" ? "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : "near:native", amount: null, slippageBps: 100 })}>Swap</button>}
    </div>)}</div>
    {p.rows.length > 6 && <button type="button" className="fv-text-button" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${p.rows.length}`}</button>}
    {!p.rows.length && <p className="fv-muted">No balances were read. {env.owner ? "" : "Connect a wallet to see yours."}</p>}
    <details className="fv-chat-details"><summary>Coverage</summary>{p.coverage.map((c, i) => <p key={i}>{c}</p>)}<p>Missing prices never count as zero. Watched wallets are not included.</p></details>
  </div>;
}

interface Research { holdings?: { contract: string; symbol: string; name: string; amount: string | null; usd: string | null; share: number | null; icon?: string; decimals: number | null }[]; pricedTotal?: string; unpriced?: number; positions: { label: string; asset: string; amount: string; kind: string }[]; coverage: string; capturedAt: string; transactionCount?: string | null; error?: string }
function ResearchChatCard({ card, env }: { card: Card<"research">; env: CardEnv }) {
  const p = card.params;
  const [data, setData] = useState<Research | null>(null), [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/research?network=" + p.network + "&address=" + encodeURIComponent(p.address), { cache: "no-store" }).then(async (r) => { const b = await r.json() as Research; if (!r.ok) throw new Error(b.error); if (live) setData(b); }).catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [p.network, p.address]);
  const top = (data?.holdings ?? []).filter((h) => h.usd !== null && Number(h.usd) >= 1).slice(0, 6);
  return <div className="fv-chat-card"><Head title={p.address.length > 28 ? p.address.slice(0, 10) + "…" + p.address.slice(-6) : p.address} card={card}><span className="fv-chat-pill is-muted">Watched · not your funds</span></Head>
    {!data && !err && <p className="fv-muted fv-chat-small"><RefreshCw size={12} className="fv-spin" /> Reading public holdings…</p>}
    {err && <p role="alert" className="fv-notice">{err}</p>}
    {data && <>
      <div className="fv-chat-total"><strong>{data.pricedTotal !== undefined ? fmtUsd(data.pricedTotal) : "Not valued"}</strong><small>{data.unpriced ? `${data.unpriced} unpriced tokens` : "priced tokens"}{data.transactionCount ? ` · ${Number(data.transactionCount).toLocaleString()} transactions` : ""}</small></div>
      <div className="fv-chat-rows">{top.map((h) => <div key={h.contract} className="fv-chat-row">
        <TokenIcon symbol={h.symbol} network="near" image={h.icon} core={coreIdentity({ network: "near", contract: h.contract, symbol: h.symbol })} size={28} />
        <span><strong>{h.symbol}</strong><small>{h.share !== null ? h.share.toFixed(1) + "% of priced" : h.name}</small></span>
        <span className="fv-chat-row-num"><strong>{h.amount ? fmtAmount(h.amount, 4) : "—"}</strong><small>{fmtUsd(h.usd)}</small></span>
        {p.network === "near" && h.decimals !== null && !env.example && <button type="button" className="fv-chat-chip" onClick={() => void env.spawn("swap", { from: "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", to: "near:" + h.contract, amount: null, slippageBps: 100 }, `Buying a token held by ${p.address}. Check the contract before buying.`)}>Buy</button>}
      </div>)}</div>
      {!!data.positions?.length && <div className="fv-chat-rows">{data.positions.slice(0, 4).map((x, i) => <div key={i} className="fv-chat-row is-plain"><span><strong>{x.label}</strong><small>{x.kind}</small></span><span className="fv-chat-row-num"><strong>{fmtAmount(x.amount, 4)} {x.asset}</strong></span></div>)}</div>}
      <details className="fv-chat-details"><summary>Coverage & freshness · {ago(data.capturedAt)}</summary><p>{data.coverage}</p><p>Public indexers can lag, and token lists can include unsolicited or counterfeit assets.</p></details>
    </>}
  </div>;
}

interface PerpsRead { agentsAvailable?: boolean; accounts?: { master: string; funded?: boolean; snapshot?: { accountValueUsdcRaw?: string; positions?: { coin?: string; szi?: string }[] } | null; link?: { state?: string } | null; error?: string | null }[] }
function PerpsChatCard({ card, env }: { card: Card<"perps">; env: CardEnv }) {
  const [data, setData] = useState<PerpsRead | null>(null), [err, setErr] = useState("");
  useEffect(() => { let live = true; api("/api/perps", undefined, "GET").then((r) => { if (live) setData(r); }).catch((e) => { if (live) setErr((e as Error).message); }); return () => { live = false; }; }, []);
  const a = data?.accounts?.[0];
  const steps = [
    { ok: !!data?.accounts?.length, label: "A verified EVM wallet", act: !data?.accounts?.length ? { label: "Connect", run: env.connect } : null },
    { ok: !!a?.funded, label: "Trading funds on Hyperliquid", act: a && !a.funded ? { label: "Add funds", run: () => void env.spawn("swap", { from: "eth:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", to: "hypercore:0x6d1e7cde53ba9467b783cb7c530ce054", amount: null, slippageBps: 100 }, "Funds your Hyperliquid account with USDC through NEAR Intents.") } : null },
    { ok: !!a?.link && a.link.state !== "revoked", label: "FlowVault agent approved, with your limits", act: a?.funded && !a.link ? { label: "Set up", run: () => env.navigate("trade") } : null },
  ];
  return <div className="fv-chat-card"><Head title="Hyperliquid perps" card={card} />
    {!data && !err && <p className="fv-muted fv-chat-small"><RefreshCw size={12} className="fv-spin" /> Checking Hyperliquid…</p>}
    {err && <p role="alert" className="fv-notice">{err}</p>}
    {data && <>
      <ol className="fv-chat-steps">{steps.map((s) => <li key={s.label} className={s.ok ? "is-ok" : ""}>{s.ok ? <Check size={14} /> : <span />}<span>{s.label}</span>{s.act && <button type="button" className="fv-chat-chip" onClick={s.act.run}>{s.act.label}</button>}</li>)}</ol>
      {a?.snapshot && <div className="fv-confirm-table"><div><span>Account value</span><strong>{fmtUsd(Number(a.snapshot.accountValueUsdcRaw ?? 0) / 1e6)}</strong></div><div><span>Open positions</span><strong>{a.snapshot.positions?.length ?? 0}</strong></div></div>}
      <button type="button" className="fv-button fv-wide-button" onClick={() => env.navigate("trade")}>Open the trading desk</button>
      <p className="fv-muted fv-chat-small">Orders are placed by FlowVault’s agent only within the limits you sign. Your wallet signs funding, agent approval and limits.</p>
    </>}
  </div>;
}

function NoticeChatCard({ card, env }: { card: Card<"notice">; env: CardEnv }) {
  const p = card.params;
  return <div className={"fv-chat-card fv-chat-notice is-" + p.tone}>
    <div className="fv-chat-card-head">{p.tone === "blocked" ? <ShieldAlert size={16} /> : <CircleAlert size={16} />}<strong>{p.title}</strong></div>
    <ul>{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
    {card.notes.map((n, i) => <p className="fv-muted fv-chat-small" key={i}>{n}</p>)}
    {!!p.remedies.length && <div className="fv-chat-actions">{p.remedies.map((r) => <button type="button" key={r.label} className="fv-chat-chip" onClick={() => env.send(r.prompt)}>{r.label}</button>)}</div>}
  </div>;
}
function ChoiceChatCard({ card, env }: { card: Card<"choice">; env: CardEnv }) {
  const p = card.params;
  return <div className="fv-chat-choice" role="group" aria-label={p.question}>
    <span>{p.question}</span>
    <div>{p.options.map((o) => <button type="button" key={o.label} disabled={env.answered} onClick={() => env.send(o.prompt)}>{o.label}{o.detail && <small>{o.detail}</small>}</button>)}</div>
  </div>;
}

function AutomationChatCard({ card, env }: { card: Card<"automation">; env: CardEnv }) {
  const p = card.params;
  const t = template(p.kind, -new Date().getTimezoneOffset());
  const draft = { kind: p.kind, schedule: { ...t.schedule, ...(p.at ? { at: p.at } : {}), ...(p.day !== null ? { day: p.day } : {}) }, params: { ...t.params, ...(p.thresholdUsd !== null ? { thresholdUsd: p.thresholdUsd } : {}), ...(p.asset ? { asset: p.asset } : {}), ...(p.pct !== null ? { pct: p.pct } : {}) } };
  const d = describe(draft), problem = checkAutomation(draft);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function turnOn() {
    setBusy(true); setError("");
    try {
      if (env.example) { await env.edit(card, { createdId: "example" }); return; }
      const r = await api("/api/automations", { op: "create", kind: p.kind, tzOffsetMin: draft.schedule.tzOffsetMin, schedule: draft.schedule, params: draft.params, by: "assistant" }) as { automation: { id: string } };
      await env.edit(card, { createdId: r.automation.id });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="fv-chat-card fv-chat-automation">
    <div className="fv-chat-card-head"><Zap size={16} /><strong>{d.title}</strong></div>
    <p className="fv-muted fv-chat-small">{d.sub}</p>
    <div className="fv-chat-automation-chip">{d.chip}</div>
    {card.notes.map((n, i) => <p className="fv-muted fv-chat-small" key={i}>{n}</p>)}
    {problem && <p className="fv-notice">{problem}</p>}
    {error && <p className="fv-notice" role="alert">{error}</p>}
    {p.createdId ? <div className="fv-chat-actions"><span className="fv-chat-on"><Check size={14} /> On{env.example ? " (example)" : ""}</span><button type="button" className="fv-chat-chip" onClick={() => env.navigate("hub")}>Manage automations</button></div>
      : <div className="fv-chat-actions"><button type="button" className="fv-button fv-primary" disabled={busy || !!problem || (!env.owner && !env.example)} onClick={() => void turnOn()}>{busy ? "Turning on…" : env.example ? "Turn on · example" : !env.owner ? "Sign in to turn on" : "Turn on"}</button></div>}
  </div>;
}

export function ChatCard({ card, env }: { card: Card; env: CardEnv }) {
  switch (card.kind) {
    case "swap": return <SwapChatCard card={card as Card<"swap">} env={env} />;
    case "lend": return <LendChatCard card={card as Card<"lend">} env={env} />;
    case "trade": return <TradeChatCard card={card as Card<"trade">} env={env} />;
    case "stake": return <StakeChatCard card={card as Card<"stake">} env={env} />;
    case "pay": return <PayChatCard card={card as Card<"pay">} env={env} />;
    case "portfolio": return <PortfolioChatCard card={card as Card<"portfolio">} env={env} />;
    case "research": return <ResearchChatCard card={card as Card<"research">} env={env} />;
    case "perps": return <PerpsChatCard card={card as Card<"perps">} env={env} />;
    case "notice": return <NoticeChatCard card={card as Card<"notice">} env={env} />;
    case "choice": return <ChoiceChatCard card={card as Card<"choice">} env={env} />;
    case "automation": return <AutomationChatCard card={card as Card<"automation">} env={env} />;
  }
  return null;
}
