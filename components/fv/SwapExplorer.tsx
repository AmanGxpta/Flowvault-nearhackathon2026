"use client";
import { useEffect, useState } from "react";
import { ArrowDownUp, ArrowUpRight, RefreshCw, Settings2, Zap, Wallet } from "lucide-react";
import { useTokenCatalog } from "./useTokenCatalog";
import { useWalletBalances } from "./useWalletBalances";
import { TokenPicker } from "./TokenPicker";
import { SwapReview } from "./SwapReview";
import { fmtAmount, fmtUsd } from "./swap-format";
import { networkInfo } from "./AssetIdentity";
const netName = (n?: string) => (n && networkInfo(n)?.name) || n || "";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { swapVenueUrl } from "@/lib/flowvault/swap-explorer";
import { units, decimal } from "@/lib/flowvault/money";
import { useSwapQuote, ownAddress, runsInApp, type SwapRoute as Route } from "./useSwapQuote";

const USDC_NEAR = "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NATIVE_KEEP = 100_000_000_000_000_000_000_000n; // 0.1 NEAR left for fees when using Max on native NEAR

type Cta = { label: string; disabled?: boolean; spin?: boolean; onClick?: () => void; href?: string; icon?: React.ReactNode };

export function SwapExplorer({ owner, example, onManaged, onConnect, onSettled }: { owner: string; example: boolean; onManaged: () => void; onConnect?: () => void; onSettled?: () => void }) {
  const { tokens, error: catalogError } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, !example);
  const [fromId, setFrom] = useState("near:native"), [toId, setTo] = useState(USDC_NEAR);
  const [amount, setAmount] = useState(""), [slippage, setSlippage] = useState("100");
  const [sender, setSender] = useState(owner), [recipient, setRecipient] = useState(owner);
  const [settings, setSettings] = useState(false), [review, setReview] = useState(false);
  const fromBal = holdings.balances[fromId], toBal = holdings.balances[toId];

  // Send from the connected wallet that holds the token, and receive into your wallet on the destination network.
  // An EVM address serves every EVM chain. The addresses stay editable under Slippage › Cross-chain addresses.
  // A prefill may name the receiving address (e.g. funding one Hyperliquid account); it holds while that token is the destination.
  const [pin, setPin] = useState<{ to: string; address: string } | null>(null);
  const q = useSwapQuote({ tokens, holdings, owner, example, fromId, toId, amount, slippage, sender, recipient, paused: review });
  const { from, to, preview, busy, error, routes, best, chosen, expires, validAmount, quote, rawOf } = q, setSelected = q.setSelected;
  const addrFor = (n?: string) => ownAddress(holdings, n);
  const senderAuto = fromBal?.account ?? addrFor(from?.network), recipientAuto = pin && pin.to === toId ? pin.address : addrFor(to?.network);
  useEffect(() => { const t = setTimeout(() => { setSender(senderAuto); setRecipient(recipientAuto); }, 0); return () => clearTimeout(t); }, [senderAuto, recipientAuto]);
  useEffect(() => {
    // Prefill from links and commands (?swap=from|to|amount, ?buy=id, ?buy=sell:id). Prefill only; review still applies.
    const apply = () => {
      const q = new URL(location.href).searchParams, cmd = q.get("swap"), id = q.get("buy");
      if (cmd) { const [a, b, amt, rcpt] = cmd.split("|"); if (a) setFrom(a); if (b) setTo(b); if (amt && /^\d+(\.\d+)?$/.test(amt)) setAmount(amt); setPin(b && rcpt && /^0x[0-9a-fA-F]{40}$/.test(rcpt) ? { to: b, address: rcpt } : null); return; }
      if (id?.startsWith("sell:")) { setFrom(id.slice(5)); setTo(id.slice(5) === USDC_NEAR ? "near:native" : USDC_NEAR); }
      else if (id) { setTo(id); if (id === "near:native") setFrom(USDC_NEAR); }
    };
    const t = setTimeout(apply, 0);
    window.addEventListener("fv-prefill", apply);
    return () => { clearTimeout(t); window.removeEventListener("fv-prefill", apply); };
  }, []);

  const inApp = (r?: Route) => runsInApp(r, from, to, sender, recipient);

  function change(side: "from" | "to", t: SwapToken) {
    if (side === "from") { if (t.id === toId) setTo(fromId); setFrom(t.id); }
    else { if (t.id === fromId) setFrom(toId); setTo(t.id); }
  }
  function fraction(pct: bigint) {
    if (!from || !fromBal) return;
    let raw = BigInt(fromBal.raw);
    if (from.contract === "native" && from.network === "near") raw = raw > NATIVE_KEEP ? raw - NATIVE_KEEP : 0n;
    raw = raw * pct / 100n;
    setAmount(raw > 0n ? decimal(raw, from.decimals) : "");
  }
  const usdIn = from?.price && validAmount ? Number(amount) * Number(from.price) : null;
  const usdOut = to?.price && chosen ? Number(chosen.output) * Number(to.price) : null;
  const valueDrop = usdIn && usdOut ? (usdOut - usdIn) / usdIn * 100 : null;
  const balanceKnown = !!from && holdings.covered.has(from.network);
  const overBalance = validAmount && !!from && balanceKnown && units(amount, from.decimals) > BigInt(fromBal?.raw ?? "0");

  const cta: Cta = (() => {
    if (!from || !to) return { label: "Loading tokens…", disabled: true };
    if (!validAmount) return { label: "Enter an amount", disabled: true };
    if (from.network !== "near" && !sender && owner && !example && !holdings.covered.has(from.network)) return { label: "Reading your wallets…", disabled: true, spin: true };
    if (busy && !preview) return { label: "Finding the best route…", disabled: true, spin: true };
    if (!chosen) return { label: error ? "No route for this amount" : "No route yet", disabled: true };
    if (inApp(chosen)) {
      if (example) return { label: "Connect your own wallet to swap", disabled: true };
      if (!owner) return { label: "Connect wallet to swap", onClick: onConnect, disabled: !onConnect };
      if (overBalance) return { label: `Not enough ${from.symbol}`, disabled: true };
      return { label: `Swap via ${chosen.venue}`, onClick: () => setReview(true), icon: <Zap size={16} /> };
    }
    return { label: `Continue at ${chosen.venue}`, href: chosen.url, icon: <ArrowUpRight size={16} /> };
  })();

  return <div className="fv-swap-workspace">
    <section className="fv-panel fv-swap-explorer">
      <div className="fv-section-head"><h2>Swap</h2><button type="button" className="fv-chip fv-chip-button" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings2 size={14} /> Slippage {Number(slippage) / 100}%</button></div>
      {settings && <div className="fv-swap-settings-row" role="group" aria-label="Slippage">{["50", "100", "300", "500"].map(v => <button type="button" key={v} aria-pressed={slippage === v} onClick={() => setSlippage(v)}>{Number(v) / 100}%</button>)}
        <details><summary>Cross-chain addresses</summary><p className="fv-muted">Needed for NEAR Intents routes to other networks. Use addresses you control.</p><label>Send / refund on {netName(from?.network)}<input value={sender} onChange={e => setSender(e.target.value)} placeholder={from?.network === "near" ? "your-account.near" : "Your address"} /></label><label>Receive on {netName(to?.network)}<input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={to?.network === "near" ? "your-account.near" : "Your address"} /></label></details></div>}
      <div className="fv-swap-amount">
        <div className="fv-swap-box-head"><label htmlFor="swap-pay">You pay</label>{fromBal ? <span className="fv-swap-balance"><Wallet size={13} /> {fmtAmount(fromBal.amount)} {from?.symbol}{[25n, 50n, 100n].map(p => <button type="button" key={String(p)} onClick={() => fraction(p)}>{p === 100n ? "Max" : p + "%"}</button>)}</span> : balanceKnown ? <span className="fv-swap-balance">No {from?.symbol} in your connected wallets</span> : null}</div>
        <div className="fv-swap-line"><input id="swap-pay" value={amount} inputMode="decimal" placeholder="0" autoComplete="off" onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /><TokenPicker label="Choose token to sell" tokens={tokens} balances={holdings.balances} covered={holdings.covered} value={from} onChange={t => change("from", t)} /></div>
        <small>{usdIn !== null ? fmtUsd(usdIn) : from?.contract === "native" ? (from.network === "near" ? "Native NEAR · Max keeps 0.1 NEAR for fees" : `Native ${from.symbol} · keep some for gas`) : " "}{overBalance && <b className="fv-swap-warn"> · more than your balance</b>}</small>
      </div>
      <div className="fv-swap-flip"><button type="button" className="fv-icon-button" aria-label="Reverse swap pair" onClick={() => { setFrom(toId); setTo(fromId); setAmount(""); }}><ArrowDownUp size={19} /></button></div>
      <div className="fv-swap-amount fv-swap-receive">
        <div className="fv-swap-box-head"><span>You receive</span>{toBal && <span className="fv-swap-balance"><Wallet size={13} /> {fmtAmount(toBal.amount)} {to?.symbol}</span>}</div>
        <div className="fv-swap-line"><strong className={"fv-swap-output" + (busy ? " fv-loading-text" : "")}>{chosen ? fmtAmount(chosen.output) : busy ? "…" : "0"}</strong><TokenPicker label="Choose token to buy" tokens={tokens} balances={holdings.balances} covered={holdings.covered} value={to} onChange={t => change("to", t)} /></div>
        <small>{usdOut !== null ? <>{fmtUsd(usdOut)}{valueDrop !== null && <span className={valueDrop < -1 ? "fv-swap-warn" : ""}> ({valueDrop >= 0 ? "+" : ""}{valueDrop.toFixed(2)}%)</span>}</> : to?.symbol === "wNEAR" ? "Wrapped NEAR · distinct from native NEAR" : " "}</small>
      </div>
      {chosen && from && to && <div className="fv-swap-facts">
        <div><span>Rate</span><strong>1 {from.symbol} ≈ {fmtAmount(String(Number(chosen.output) / Number(amount)))} {to.symbol}</strong></div>
        <div><span>Minimum received</span><strong>{fmtAmount(chosen.minimum)} {to.symbol}</strong></div>
        <div><span>Route</span><strong>{chosen.venue}{chosen.eta ? ` · ~${chosen.eta}s` : ""}</strong></div>
      </div>}
      {(error || catalogError) && <p role="alert" className="fv-notice">{error || catalogError}</p>}
      {cta.href ? <a className="fv-button fv-primary fv-wide-button" href={cta.href} target="_blank" rel="noopener noreferrer">{cta.label} {cta.icon}</a>
        : <button type="button" className="fv-button fv-primary fv-wide-button" disabled={cta.disabled} onClick={cta.onClick}>{cta.spin && <RefreshCw size={16} className="fv-spin" />}{cta.label} {cta.icon}</button>}
      {toId && !to && tokens.length > 0 && <p className="fv-notice">The selected token is not in the current catalog. Choose another token; no similar ticker is substituted.</p>}
    </section>
    <div className="fv-swap-route-column">
      <section className="fv-panel fv-swap-routes">
        <div className="fv-section-head"><h2>Routes</h2>{preview ? <button type="button" className="fv-text-button" onClick={() => void quote()} disabled={busy}><RefreshCw size={13} className={busy ? "fv-spin" : ""} /> {busy ? "Updating" : `Refreshes in ${expires}s`}</button> : <small className="fv-muted">{tokens.length ? `${tokens.length.toLocaleString()} tokens · ${new Set(tokens.map(t => t.network)).size} networks` : ""}</small>}</div>
        {!preview && !busy && <div className="fv-empty fv-routes-empty"><ArrowDownUp size={26} /><h3>Live routes appear as you type</h3><p>FlowVault asks Rhea / Ref and NEAR Intents at the same time and puts the best output first.</p></div>}
        {!preview && busy && <div className="fv-route-skeletons">{[0, 1].map(i => <div key={i} className="fv-route-skeleton" />)}</div>}
        {routes.map((r, i) => {
          const b = best && to ? rawOf(best.output, to.decimals) : 0n;
          const gap = i > 0 && b > 0n && to ? Number((b - rawOf(r.output, to.decimals)) * 10000n / b) / 100 : 0;
          const isChosen = chosen?.venue === r.venue;
          return <button type="button" key={r.venue} className={"fv-route-option" + (isChosen ? " is-chosen" : "")} aria-pressed={isChosen} onClick={() => setSelected(r.venue)}>
            <span className="fv-route-rank">{i + 1}</span>
            <span className="fv-route-main"><strong>{r.venue} {i === 0 && <em className="fv-best">Best</em>}</strong><small>{inApp(r) ? "Swaps inside FlowVault" : "Opens the venue"}{r.eta ? ` · ~${r.eta}s` : ""} · min {fmtAmount(r.minimum)}</small></span>
            <span className="fv-route-out"><strong>{fmtAmount(r.output)} {to?.symbol}</strong><small>{i === 0 ? (to?.price ? fmtUsd(Number(r.output) * Number(to.price)) : "best output") : `−${gap.toFixed(2)}%`}</small></span>
          </button>;
        })}
        {preview && !routes.length && <div className="fv-empty"><h3>No route returned</h3><p>Try another amount or pair. No funds moved.</p>{from && to && !example && <a className="fv-button" href={swapVenueUrl(from, to)} target="_blank" rel="noopener noreferrer">Check at the venue <ArrowUpRight size={14} /></a>}</div>}
        {!!preview?.warnings.length && <details className="fv-route-warnings" open={!routes.length}><summary>Why some venues are missing</summary>{preview.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
        {chosen && <details className="fv-route-fees"><summary>Fees & execution</summary><p>{chosen.feeNote}</p>{inApp(chosen) ? <p>FlowVault prepares the exact transactions, checks them against your limits and tracks them to settlement. You approve them in your wallet.</p> : <p>This venue runs outside FlowVault, so your limits and tracking don’t apply there.</p>}</details>}
      </section>
      <section className="fv-panel fv-managed-swap-callout"><div><h3>Funding a payment?</h3><p>USDC → NEAR and approved sales keep FlowVault’s payment checks.</p></div><button type="button" className="fv-button" onClick={onManaged}>Managed funding <ArrowUpRight size={14} /></button></section>
    </div>
    {review && from && to && chosen && <SwapReview from={from} to={to} amount={amount} slippage={Number(slippage)} route={chosen.venue === "NEAR Intents" ? "intents" : "ref"} sender={sender} recipient={recipient}
      close={() => setReview(false)} onSettled={() => { void holdings.refresh(); onSettled?.(); setAmount(""); }} />}
  </div>;
}
