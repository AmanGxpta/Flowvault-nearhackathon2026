"use client";
import { useEffect, useState } from "react";
import { Check, Circle, ShieldCheck, Wallet } from "lucide-react";
import { api, type Scope } from "./live";
import { useLiveMarket } from "./useLiveMarket";
import { fmtUsd } from "./swap-format";
import { lotSize, usePerpMeta } from "./perp-meta";

export interface OrderDraft {
  coin: string; side: "buy" | "sell";
  /** Base-asset size, already rounded to the market's lot size. */
  size: string; leverage: string; kind: "market" | "limit"; price: string;
  margin: "cross" | "isolated";
  /** Take profit and stop loss trigger prices ("" when not set); only with a market order. */
  tp: string; sl: string;
  n: number;
}
const PRESETS = ["25", "50", "100", "250"];
/** Hyperliquid refuses orders worth less than $10. */
const MIN_ORDER_USD = 10;
/** Numbers each draft for the page's lifetime, so a remounted ticket never repeats one the review already saw. */
let draftSeq = 0;

type Ready = { key: boolean; wallet: boolean; funded: boolean; linked: boolean; mandate: boolean };

/** Always-visible perps ticket. Live notional, margin and an estimated liquidation price from the Hyperliquid mid.
 * Execution stays with the owner-configured agent flow: until one account has finished setup the button lists the
 * steps; once it has, Review opens the order review (mandate checks, then the agent places it). Nothing is sent from
 * here. Without a connected wallet (`connect` given) there are no setup steps: one Connect wallet button opens the
 * modal. `refresh` changes whenever the perps card below reads again, so finished setup steps show up here at once. */
export function OrderTicket({ coin, scope, onDraft, example, connect, refresh }: { coin: string; scope: Scope; onDraft: (d: OrderDraft) => void; example: boolean; connect?: () => void; refresh?: number }) {
  const { data } = useLiveMarket(coin, "15m", 0);
  const meta = usePerpMeta(coin);
  const mid = data?.mid ? Number(data.mid) : null;
  const [side, setSide] = useState<"buy" | "sell">("buy"), [usd, setUsd] = useState("50"), [lev, setLev] = useState(5), [margin, setMargin] = useState<"cross" | "isolated">("isolated");
  const [kind, setKind] = useState<"market" | "limit">("market"), [price, setPrice] = useState(""), [tp, setTp] = useState(""), [sl, setSl] = useState("");
  const [ready, setReady] = useState<Ready | null>(null);
  useEffect(() => {
    if (example || connect) return;
    let live = true;
    Promise.all([api("/api/perps", undefined, "GET", scope), api("/api/mandates", undefined, "GET", scope)]).then(([p, m]) => {
      const accts = (p.accounts ?? []) as { master: string; funded?: boolean; link?: { status: string } | null }[];
      const mands = ((m.mandates ?? []) as { state: string; frozen?: unknown; authority: { kind: string }; scope: { accounts: string[] } }[]).filter(x => x.authority?.kind === "hyperliquid_agent" && x.state === "active" && !x.frozen);
      // An order needs one account that has done every step, so progress is the furthest single account's.
      const per = accts.map((a): Ready => ({ key: !!p.agentsAvailable, wallet: true, funded: !!a.funded, linked: a.link?.status === "verified", mandate: mands.some(x => x.scope.accounts.includes("evm:" + a.master)) }));
      const score = (r: Ready) => Object.values(r).filter(Boolean).length;
      const best = per.sort((a, b) => score(b) - score(a))[0] ?? { key: !!p.agentsAvailable, wallet: false, funded: false, linked: false, mandate: false };
      if (live) setReady(best);
    }).catch(() => { if (live) setReady({ key: false, wallet: false, funded: false, linked: false, mandate: false }); });
    return () => { live = false; };
  }, [scope, example, connect, refresh]);
  const max = meta?.maxLeverage ?? 10;
  const leverage = Math.min(lev, max);
  const entry = kind === "limit" && Number(price) > 0 ? Number(price) : mid;
  const notional = Number(usd) > 0 ? Number(usd) : 0;
  const size = entry && meta ? lotSize(notional / entry, meta.szDecimals) : 0;
  const value = entry ? size * entry : 0;
  const marginUsd = value / leverage;
  // Isolated estimate: maintenance ≈ half the initial margin at max leverage (Hyperliquid's documented tiering).
  const mm = 1 / (2 * max);
  const long = side === "buy";
  const liq = entry && margin === "isolated" ? long ? entry * (1 - 1 / leverage + mm) : entry * (1 + 1 / leverage - mm) : null;
  const withTpsl = kind === "market";
  const tpN = withTpsl && Number(tp) > 0 ? Number(tp) : null, slN = withTpsl && Number(sl) > 0 ? Number(sl) : null;
  const tpBad = tpN !== null && !!entry && (long ? tpN <= entry : tpN >= entry);
  const slBad = slN !== null && !!entry && (long ? slN >= entry : slN <= entry);
  const steps = ready ? [
    { done: ready.key, label: "Trading enabled for this installation", hint: "The owner adds the agent key secret on the server." },
    { done: ready.wallet, label: "Hyperliquid wallet connected", hint: "Connect and prove your Ethereum wallet." },
    { done: ready.funded, label: "Trading funds on Hyperliquid", hint: "Add funds below: an in-app NEAR Intents swap delivers USDC to your Hyperliquid account." },
    { done: ready.linked, label: "FlowVault agent approved", hint: "Approve the agent in your wallet below." },
    { done: ready.mandate, label: "Trading limits signed", hint: "Create the perps mandate below, then sign and activate its limits." },
  ] : [];
  const allReady = !!ready && steps.every(s => s.done);
  const problem = !entry ? null
    : kind === "limit" && !(Number(price) > 0) ? "Enter a limit price."
    : !(notional > 0) || !meta ? null
    : size <= 0 ? `Too small: ${coin} trades in steps of ${10 ** -meta.szDecimals}.`
    : value < MIN_ORDER_USD ? `Hyperliquid's minimum order is ${fmtUsd(MIN_ORDER_USD)}.`
    : tpBad ? `Take profit has to be ${long ? "above" : "below"} the entry for a ${long ? "long" : "short"}.`
    : slBad ? `Stop loss has to be ${long ? "below" : "above"} the entry for a ${long ? "long" : "short"}.`
    : null;
  const valid = !problem && !!entry && !!meta && size > 0 && value >= MIN_ORDER_USD;
  function submit() {
    if (!valid || !meta) return;
    onDraft({ coin, side, size: size.toFixed(meta.szDecimals), leverage: String(leverage), kind, price: kind === "limit" ? price : "", margin, tp: tpN ? tp : "", sl: slN ? sl : "", n: ++draftSeq });
  }
  const sideLabel = long ? "long" : "short";
  return <section className="fv-panel fv-ticket">
    <div className="fv-segment fv-ticket-side"><button type="button" aria-pressed={long} className="is-long" onClick={() => setSide("buy")}>Long</button><button type="button" aria-pressed={!long} className="is-short" onClick={() => setSide("sell")}>Short</button></div>
    <div className="fv-segment fv-segment-small"><button type="button" aria-pressed={kind === "market"} onClick={() => setKind("market")}>Market</button><button type="button" aria-pressed={kind === "limit"} onClick={() => setKind("limit")}>Limit</button><span className="fv-ticket-gap" />
      <button type="button" aria-pressed={margin === "cross"} disabled={example} title={example ? "The example account trades isolated margin." : undefined} onClick={() => setMargin("cross")}>Cross</button><button type="button" aria-pressed={margin === "isolated"} onClick={() => setMargin("isolated")}>Isolated</button></div>
    {kind === "limit" && <label className="fv-ticket-field"><span>Limit price</span><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder={mid ? mid.toFixed(2) : "Price"} /><b>USD</b></label>}
    <label className="fv-ticket-field"><span>Size</span><input inputMode="decimal" value={usd} onChange={e => setUsd(e.target.value.replace(/[^\d.]/g, ""))} /><b>USDC</b></label>
    <div className="fv-ticket-presets">{PRESETS.map(p => <button type="button" key={p} aria-pressed={usd === p} onClick={() => setUsd(p)}>{p}</button>)}</div>
    <div className="fv-ticket-lev"><div><span>Leverage</span><strong>{leverage}×</strong></div><input type="range" min={1} max={max} value={leverage} onChange={e => setLev(Number(e.target.value))} aria-label="Leverage" /><div className="fv-ticket-presets">{[1, 3, 5, 10, max].filter((x, i, a) => x <= max && a.indexOf(x) === i).map(x => <button type="button" key={x} aria-pressed={leverage === x} onClick={() => setLev(x)}>{x}×</button>)}</div></div>
    {withTpsl ? <div className="fv-ticket-tpsl">
      <label><span>Take profit</span><input inputMode="decimal" value={tp} aria-invalid={tpBad || undefined} onChange={e => setTp(e.target.value.replace(/[^\d.]/g, ""))} placeholder={entry ? (long ? "Above " : "Below ") + entry.toFixed(2) : "Price"} /></label>
      <label><span>Stop loss</span><input inputMode="decimal" value={sl} aria-invalid={slBad || undefined} onChange={e => setSl(e.target.value.replace(/[^\d.]/g, ""))} placeholder={entry ? (long ? "Below " : "Above ") + entry.toFixed(2) : "Price"} /></label>
    </div> : <p className="fv-ticket-note">Take profit and stop loss go with market orders. Add them from the position once a limit order fills.</p>}
    <div className="fv-ticket-facts">
      <div><span>Mark</span><strong>{mid ? fmtUsd(mid) : "…"}</strong></div>
      <div><span>Position</span><strong>{size ? size.toFixed(meta?.szDecimals ?? 4) : "—"} {coin}</strong></div>
      <div><span>Margin</span><strong>{fmtUsd(marginUsd)}</strong></div>
      <div><span>Est. liquidation</span><strong className="fv-down">{margin === "cross" ? "Depends on your whole account" : liq ? fmtUsd(liq) : "—"}</strong></div>
      {tpN && entry && !tpBad && <div><span>TP profit (est.)</span><strong className="fv-up">{fmtUsd((tpN - entry) * size * (long ? 1 : -1))}</strong></div>}
      {slN && entry && !slBad && <div><span>SL loss (est.)</span><strong className="fv-down">{fmtUsd((slN - entry) * size * (long ? 1 : -1))}</strong></div>}
    </div>
    {problem && <p className="fv-ticket-note fv-field-warn" role="alert">{problem}</p>}
    {example ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go is-" + sideLabel} disabled={!valid} onClick={submit}>Review {sideLabel} {coin} · example</button>
      : connect ? <button type="button" className="fv-button fv-primary fv-wide-button fv-ticket-go" onClick={connect}><Wallet size={15} /> Connect wallet</button>
      : allReady ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go is-" + sideLabel} disabled={!valid} onClick={submit}>Review {sideLabel} {coin}</button>
      : <button type="button" className="fv-button fv-wide-button" onClick={() => document.getElementById("fv-perps-review")?.scrollIntoView({ behavior: "smooth" })} disabled={!ready}>{ready ? `Finish setup to trade · ${steps.filter(x => !x.done).length} of ${steps.length} left` : "Checking setup…"}</button>}
    {ready && !allReady && !example && !connect && <ol className="fv-ticket-steps">{steps.map(s => <li key={s.label} className={s.done ? "is-done" : ""}>{s.done ? <Check size={13} /> : <Circle size={13} />}<span>{s.label}{!s.done && <small>{s.hint}</small>}</span></li>)}</ol>}
    <p className="fv-ticket-note"><ShieldCheck size={13} /> Orders run through your signed mandate limits. FlowVault’s agent can trade but never withdraw.</p>
  </section>;
}
