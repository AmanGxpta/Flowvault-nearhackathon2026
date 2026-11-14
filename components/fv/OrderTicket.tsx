"use client";
import { useEffect, useState } from "react";
import { Check, Circle, ShieldCheck, Wallet } from "lucide-react";
import { api, type Scope } from "./live";
import { useLiveMarket } from "./useLiveMarket";
import { fmtUsd } from "./swap-format";

export interface OrderDraft { coin: string; side: "buy" | "sell"; size: string; leverage: string; kind: string; price: string; n: number }
const MAX_LEV: Record<string, number> = { BTC: 40, ETH: 25, NEAR: 10 };
const PRESETS = ["25", "50", "100", "250"];

/** Always-visible perps ticket. Live notional, margin and an estimated liquidation price from the Hyperliquid mid.
 * Execution stays with the owner-configured agent flow: the button walks the setup steps, and once trading is
 * ready it hands a draft to the existing review (mandate limits, fresh checks) below. Nothing is sent from here.
 * Without a connected wallet (`connect` given) there are no setup steps: one Connect wallet button opens the modal. */
export function OrderTicket({ coin, scope, onDraft, example, connect }: { coin: string; scope: Scope; onDraft: (d: OrderDraft) => void; example: boolean; connect?: () => void }) {
  const { data } = useLiveMarket(coin, "15m", 0);
  const mid = data?.mid ? Number(data.mid) : null;
  const [side, setSide] = useState<"buy" | "sell">("buy"), [usd, setUsd] = useState("50"), [lev, setLev] = useState(5), [margin, setMargin] = useState<"cross" | "isolated">("isolated");
  const [kind, setKind] = useState<"market" | "limit">("market"), [price, setPrice] = useState(""), [tp, setTp] = useState(""), [sl, setSl] = useState("");
  const [ready, setReady] = useState<{ key: boolean; wallet: boolean; funded: boolean; linked: boolean; mandate: boolean } | null>(null);
  useEffect(() => {
    if (example || connect) return;
    Promise.all([api("/api/perps", undefined, "GET", scope), api("/api/mandates", undefined, "GET", scope)]).then(([p, m]) => {
      const accts = (p.accounts ?? []) as { master: string; funded?: boolean; link?: { status: string } | null }[];
      const mands = ((m.mandates ?? []) as { state: string; frozen?: boolean; authority: { kind: string } }[]).filter(x => x.authority?.kind === "hyperliquid_agent");
      setReady({ key: !!p.agentsAvailable, wallet: accts.length > 0, funded: accts.some(a => a.funded), linked: accts.some(a => a.link?.status === "verified"), mandate: mands.some(x => x.state === "active" && !x.frozen) });
    }).catch(() => setReady({ key: false, wallet: false, funded: false, linked: false, mandate: false }));
  }, [scope, example, connect]);
  const max = MAX_LEV[coin] ?? 10;
  const leverage = Math.min(lev, max);
  const entry = kind === "limit" && Number(price) > 0 ? Number(price) : mid;
  const notional = Number(usd) > 0 ? Number(usd) : 0;
  const size = entry ? notional / entry : 0;
  const marginUsd = notional / leverage;
  // Isolated estimate: maintenance ≈ half the initial margin at max leverage (Hyperliquid's documented tiering).
  const mm = 1 / (2 * max);
  const liq = entry ? side === "buy" ? entry * (1 - 1 / leverage + mm) : entry * (1 + 1 / leverage - mm) : null;
  const steps = ready ? [
    { done: ready.key, label: "Trading enabled for this installation", hint: "The owner adds the agent key secret on the server." },
    { done: ready.wallet, label: "Hyperliquid wallet connected", hint: "Connect and prove your Ethereum wallet." },
    { done: ready.funded, label: "Trading funds on Hyperliquid", hint: "Add funds below: an in-app NEAR Intents swap delivers USDC to your Hyperliquid account." },
    { done: ready.linked, label: "FlowVault agent approved", hint: "Approve the agent in your wallet below." },
    { done: ready.mandate, label: "Trading limits signed", hint: "Sign the perps mandate under Risk & permissions." },
  ] : [];
  const allReady = !!ready && steps.every(s => s.done);
  const valid = notional > 0 && !!entry && (kind === "market" || Number(price) > 0);
  function submit() {
    if (!valid || !entry) return;
    onDraft({ coin, side, size: size.toFixed(coin === "BTC" ? 5 : coin === "ETH" ? 4 : 1), leverage: String(leverage), kind, price: kind === "limit" ? price : "", n: Date.now() });
    document.getElementById("fv-perps-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return <section className="fv-panel fv-ticket">
    <div className="fv-segment fv-ticket-side"><button type="button" aria-pressed={side === "buy"} className="is-long" onClick={() => setSide("buy")}>Long</button><button type="button" aria-pressed={side === "sell"} className="is-short" onClick={() => setSide("sell")}>Short</button></div>
    <div className="fv-segment fv-segment-small"><button type="button" aria-pressed={kind === "market"} onClick={() => setKind("market")}>Market</button><button type="button" aria-pressed={kind === "limit"} onClick={() => setKind("limit")}>Limit</button><span className="fv-ticket-gap" /><button type="button" aria-pressed={margin === "cross"} onClick={() => setMargin("cross")}>Cross</button><button type="button" aria-pressed={margin === "isolated"} onClick={() => setMargin("isolated")}>Isolated</button></div>
    {kind === "limit" && <label className="fv-ticket-field"><span>Limit price</span><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder={mid ? mid.toFixed(2) : "Price"} /><b>USD</b></label>}
    <label className="fv-ticket-field"><span>Size</span><input inputMode="decimal" value={usd} onChange={e => setUsd(e.target.value.replace(/[^\d.]/g, ""))} /><b>USDC</b></label>
    <div className="fv-ticket-presets">{PRESETS.map(p => <button type="button" key={p} aria-pressed={usd === p} onClick={() => setUsd(p)}>{p}</button>)}</div>
    <div className="fv-ticket-lev"><div><span>Leverage</span><strong>{leverage}×</strong></div><input type="range" min={1} max={max} value={leverage} onChange={e => setLev(Number(e.target.value))} aria-label="Leverage" /><div className="fv-ticket-presets">{[1, 3, 5, 10, max].filter((x, i, a) => x <= max && a.indexOf(x) === i).map(x => <button type="button" key={x} aria-pressed={leverage === x} onClick={() => setLev(x)}>{x}×</button>)}</div></div>
    <div className="fv-ticket-tpsl"><label><span>Take profit</span><input inputMode="decimal" value={tp} onChange={e => setTp(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Price" /></label><label><span>Stop loss</span><input inputMode="decimal" value={sl} onChange={e => setSl(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Price" /></label></div>
    <div className="fv-ticket-facts">
      <div><span>Mark</span><strong>{mid ? fmtUsd(mid) : "…"}</strong></div>
      <div><span>Position</span><strong>{size ? size.toFixed(4) : "—"} {coin}</strong></div>
      <div><span>Margin</span><strong>{fmtUsd(marginUsd)}</strong></div>
      <div><span>Est. liquidation</span><strong className="fv-down">{liq ? fmtUsd(liq) : "—"}</strong></div>
      {tp && entry && <div><span>TP profit (est.)</span><strong className="fv-up">{fmtUsd((Number(tp) - entry) * size * (side === "buy" ? 1 : -1))}</strong></div>}
      {sl && entry && <div><span>SL loss (est.)</span><strong className="fv-down">{fmtUsd((Number(sl) - entry) * size * (side === "buy" ? 1 : -1))}</strong></div>}
    </div>
    {example ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go " + (side === "buy" ? "is-long" : "is-short")} disabled={!valid} onClick={submit}>Review {side === "buy" ? "long" : "short"} {coin} · example</button>
      : connect ? <button type="button" className="fv-button fv-primary fv-wide-button fv-ticket-go" onClick={connect}><Wallet size={15} /> Connect wallet</button>
      : allReady ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go " + (side === "buy" ? "is-long" : "is-short")} disabled={!valid} onClick={submit}>Review {side === "buy" ? "long" : "short"} {coin}</button>
      : <button type="button" className="fv-button fv-wide-button" onClick={() => document.getElementById("fv-perps-review")?.scrollIntoView({ behavior: "smooth" })} disabled={!ready}>{ready ? `Finish setup to trade · ${steps.filter(x => !x.done).length} of ${steps.length} left` : "Checking setup…"}</button>}
    {ready && !allReady && !example && !connect && <ol className="fv-ticket-steps">{steps.map(s => <li key={s.label} className={s.done ? "is-done" : ""}>{s.done ? <Check size={13} /> : <Circle size={13} />}<span>{s.label}{!s.done && <small>{s.hint}</small>}</span></li>)}</ol>}
    <p className="fv-ticket-note"><ShieldCheck size={13} /> Orders run through your signed mandate limits. FlowVault’s agent can trade but never withdraw.</p>
  </section>;
}
