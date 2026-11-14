"use client";
// Demo Mode perpetuals: the example's Hyperliquid account, with a FlowVault agent approved and a signed mandate, both
// fictional. An order from the ticket is reviewed against the mandate's limits (the real checks), then the agent
// "places" it and it fills at the live Hyperliquid price. Positions mark to the live price; closing realizes the PnL.
// Prices are real public data; the account, the agent and the fills are not.
import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { TokenIcon } from "../AssetIdentity";
import { HazardScan } from "../approvals/HazardScan";
import { useLiveMarket } from "../useLiveMarket";
import { fmtUsd } from "../swap-format";
import { demoLedger, saveDemoLedger, simulateApproval, useDemoLedger } from "./ledger-store";
import { applyPerpClose, applyPerpOpen, applyPerpReduce, freeMargin, perpLiq, perpMargin, perpPnl, type DemoPerp } from "@/lib/flowvault/demo-ledger";
import type { OrderDraft } from "../OrderTicket";

const MAX_LEV: Record<string, number> = { BTC: 40, ETH: 25, NEAR: 10 };
/** The example mandate's limits: what the FlowVault agent may do without asking again. */
const MANDATE = { leverage: 10, notional: 5000, daily: 20000, lossStop: 500 };
const TAKER = 0.00045;
const usd = (n: number) => fmtUsd(n);
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 5 : 3 });

export function DemoPerps({ coin, draft, onMarket }: { coin: string; draft: OrderDraft | null; onMarket: (c: string) => void }) {
  const l = useDemoLedger();
  const [review, setReview] = useState<OrderDraft | null>(null), [note, setNote] = useState("");
  const seen = useRef<number | null>(null), [dayAgo] = useState(() => Date.now() - 86_400_000);
  useEffect(() => { if (!draft || draft.n === seen.current) return; seen.current = draft.n; const t = setTimeout(() => setReview(draft), 0); return () => clearTimeout(t); }, [draft]);
  if (!l) return null;
  const today = l.activity.filter((a) => a.at > dayAgo && /^Opened/.test(a.text)).length;
  return <section className="fv-panel fv-demo-perps" aria-label="Perpetuals · example account">
    <div className="fv-section-head"><div><h3>Perpetuals on Hyperliquid · example account</h3><p className="fv-muted">Live Hyperliquid prices; the account, agent and fills are fictional. Margin isn’t spendable cash, and unrealized gains never count as money you have.</p></div><span className="fv-chip">Example</span></div>
    <Account l={l} />
    <div className="fv-demo-mandate"><ShieldCheck size={15} /><span>FlowVault agent <b>0xa9c4…71e2</b> approved · can trade, never withdraw · mandate “Perps · example” <b>active</b>: up to {MANDATE.leverage}×, {usd(MANDATE.notional)} per order, {usd(MANDATE.daily)} a day, loss stop {usd(MANDATE.lossStop)}</span></div>
    {note && <p className="fv-demo-note" role="status">{note}</p>}
    {l.perps.positions.length ? <div className="fv-pos-table" role="table" aria-label="Open positions">
      <div className="fv-pos-row is-head" role="row">{["Market", "Side", "Size", "Entry", "Mark", "PnL (USDC)", "PnL %", "Leverage", "Liq. price", "Margin", "Actions"].map((h) => <span key={h} role="columnheader">{h}</span>)}</div>
      {l.perps.positions.map((p) => <Position key={p.coin} p={p} pick={() => onMarket(p.coin)} note={setNote} />)}
    </div> : <p className="fv-muted">No open positions. Use the ticket above: choose long or short, size and leverage, then Review.</p>}
    {review && <OrderReview d={review} coin={coin} existing={l.perps.positions.find((p) => p.coin === review.coin) ?? null} free={freeMargin(l)} ordersToday={today} close={() => setReview(null)} done={(msg) => { setReview(null); setNote(msg); }} />}
  </section>;
}

function Account({ l }: { l: NonNullable<ReturnType<typeof useDemoLedger>> }) {
  const marks = useMarks(l.perps.positions.map((p) => p.coin));
  const unrealized = l.perps.positions.reduce((s, p) => s + (marks[p.coin] ? perpPnl(p, marks[p.coin]!) : 0), 0);
  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
  return <div className="fv-perp-strip">
    <span><small>Account value</small><b>{usd(l.perps.margin + unrealized)}</b></span>
    <span><small>Free margin</small><b>{usd(freeMargin(l))}</b></span>
    <span><small>Unrealized PnL</small><b className={unrealized >= 0 ? "fv-up" : "fv-down"}>{signed(unrealized)}</b></span>
    <span><small>Realized</small><b className={l.perps.realized > 0 ? "fv-up" : l.perps.realized < 0 ? "fv-down" : ""}>{signed(l.perps.realized)}</b></span>
  </div>;
}
/** Live marks for up to three coins (one hook each, in a stable order). */
function useMarks(coins: string[]) {
  const [a, b, c] = [coins[0] ?? "ETH", coins[1] ?? "BTC", coins[2] ?? "NEAR"];
  const ma = useLiveMarket(a, "15m", 0).data?.mid, mb = useLiveMarket(b, "15m", 0).data?.mid, mc = useLiveMarket(c, "15m", 0).data?.mid;
  return { [a]: ma ? Number(ma) : null, [b]: mb ? Number(mb) : null, [c]: mc ? Number(mc) : null } as Record<string, number | null>;
}

function Position({ p, pick, note }: { p: DemoPerp; pick: () => void; note: (m: string) => void }) {
  const mid = useLiveMarket(p.coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const pnl = mark ? perpPnl(p, mark) : null, margin = perpMargin(p), roe = pnl !== null ? pnl / margin * 100 : null, liq = perpLiq(p, MAX_LEV[p.coin] ?? 10);
  const [busy, setBusy] = useState("");
  const act = (what: "reduce" | "close") => {
    if (!mark) return;
    simulateApproval("demo-" + what + "-" + crypto.randomUUID(), { wallet: () => setBusy(what), submitted: () => {}, landed: () => {
      try { const before = demoLedger().perps.realized; const next = what === "close" ? applyPerpClose(demoLedger(), p.coin, mark) : applyPerpReduce(demoLedger(), p.coin, 0.5, mark); saveDemoLedger(next); const got = next.perps.realized - before; note(`Example: ${what === "close" ? `closed ${p.coin} ${p.side}` : `reduced ${p.coin} ${p.side} by half`} at ${usd(mark)} (${got >= 0 ? "+" : "−"}${usd(Math.abs(got))}) by the agent, reduce-only. Nothing was signed.`); }
      catch (e) { note((e as Error).message); }
      setBusy("");
    } }, { wallet: 500, settle: 900 });
  };
  // Take profit and stop loss: when the live mark crosses a trigger, the position closes there, as on Hyperliquid.
  const fired = useRef(false);
  useEffect(() => {
    if (!mark || fired.current) return;
    const long = p.side === "long";
    const hit = p.tp && (long ? mark >= p.tp : mark <= p.tp) ? "Take profit" : p.sl && (long ? mark <= p.sl : mark >= p.sl) ? "Stop loss" : null;
    if (!hit) return;
    fired.current = true;
    try { const before = demoLedger().perps.realized; const next = applyPerpClose(demoLedger(), p.coin, mark); saveDemoLedger(next); const got = next.perps.realized - before; note(`Example: ${hit.toLowerCase()} triggered at ${usd(mark)} and closed your ${p.coin} ${p.side} (${got >= 0 ? "+" : "−"}${usd(Math.abs(got))}). Nothing was signed.`); }
    catch (e) { note((e as Error).message); }
  }, [mark, p, note]);
  const tone = (n: number | null) => (n === null ? "" : n >= 0 ? "fv-up" : "fv-down");
  return <div className="fv-pos-row" role="row">
    <span role="cell"><button type="button" className="fv-pos-market fv-link-reset" onClick={pick}><TokenIcon symbol={p.coin} core={["ETH", "BTC"].includes(p.coin)} size={26} /><span><strong>{p.coin}-PERP</strong><small>Perpetual</small></span></button></span>
    <span role="cell"><em className={"fv-pos-side is-" + p.side}>{p.side === "long" ? "Long" : "Short"}</em></span>
    <span role="cell"><strong>{qty(p.size)} {p.coin}</strong><small>≈ {usd(p.size * (mark ?? p.entry))}</small></span>
    <span role="cell">{usd(p.entry)}</span>
    <span role="cell">{mark ? usd(mark) : "…"}</span>
    <span role="cell" className={tone(pnl)}>{pnl === null ? "…" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}</span>
    <span role="cell" className={tone(roe)}>{roe === null ? "…" : `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`}</span>
    <span role="cell"><em className="fv-pos-lev">{p.leverage}×</em></span>
    <span role="cell" className="fv-pos-liq">{usd(liq)}{p.tp || p.sl ? <small>{[p.tp && "TP " + usd(p.tp), p.sl && "SL " + usd(p.sl)].filter(Boolean).join(" · ")}</small> : null}</span>
    <span role="cell"><strong>{usd(margin)}</strong><small>Isolated</small></span>
    <span role="cell" className="fv-pos-actions"><button type="button" className="fv-button" disabled={!!busy || !mark} onClick={() => act("reduce")}>{busy === "reduce" ? "…" : "Reduce 50%"}</button><button type="button" className="fv-button" disabled={!!busy || !mark} onClick={() => act("close")}>{busy === "close" ? "Closing…" : "Close"}</button></span>
  </div>;
}

function OrderReview({ d, coin, existing, free, ordersToday, close, done }: { d: OrderDraft; coin: string; existing: DemoPerp | null; free: number; ordersToday: number; close: () => void; done: (msg: string) => void }) {
  const mid = useLiveMarket(d.coin || coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const price = d.kind === "limit" && Number(d.price) > 0 ? Number(d.price) : mark;
  const lev = Number(d.leverage), size = Number(d.size), notional = price ? size * price : 0, fee = notional * TAKER;
  const sideNow: "long" | "short" = d.side === "buy" ? "long" : "short";
  // Against an open position on the other side the order first reduces it; only what's left needs new margin.
  const opposite = !!existing && existing.side !== sideNow, reduces = opposite ? Math.min(size, existing!.size) : 0;
  const adds = Math.max(0, size - reduces), margin = price ? adds * price / lev : 0;
  const effect = !opposite ? (existing ? `Adds to your ${d.coin} ${existing.side}` : null) : adds > 1e-9 ? `Closes your ${d.coin} ${existing!.side} and opens a ${sideNow} of ${qty(adds)}` : reduces >= existing!.size - 1e-9 ? `Closes your ${d.coin} ${existing!.side}` : `Reduces your ${d.coin} ${existing!.side} to ${qty(existing!.size - reduces)}`;
  const side: "long" | "short" = d.side === "buy" ? "long" : "short";
  const liq = price ? perpLiq({ coin: d.coin, side, size, entry: price, leverage: lev, openedAt: 0 }, MAX_LEV[d.coin] ?? 10) : null;
  const tp = Number(d.tp) > 0 ? Number(d.tp) : undefined, sl = Number(d.sl) > 0 ? Number(d.sl) : undefined;
  const tpslOk = !price || ((tp === undefined || (side === "long" ? tp > price : tp < price)) && (sl === undefined || (side === "long" ? sl < price : sl > price)));
  const pnlAt = (px: number) => price ? (px - price) * size * (side === "long" ? 1 : -1) : 0;
  const checks = [
    { id: "lev", label: lev <= MANDATE.leverage ? `Leverage ${lev}× within your mandate’s ${MANDATE.leverage}×` : `Leverage ${lev}× is above your mandate’s ${MANDATE.leverage}× maximum`, ok: lev <= MANDATE.leverage },
    { id: "notional", label: notional <= MANDATE.notional ? `${usd(notional)} order within your ${usd(MANDATE.notional)} limit` : `${usd(notional)} order is above your ${usd(MANDATE.notional)} limit`, ok: notional <= MANDATE.notional },
    { id: "daily", label: `Daily limit: ${usd(MANDATE.daily)}, ${ordersToday} order${ordersToday === 1 ? "" : "s"} today`, ok: true },
    { id: "margin", label: adds <= 1e-9 ? "Reduce only: no new margin needed" : margin <= free ? `${usd(margin)} margin from ${usd(free)} free` : `Needs ${usd(margin)} margin; ${usd(free)} is free`, ok: margin <= free },
    { id: "loss", label: `Loss stop ${usd(MANDATE.lossStop)} armed`, ok: true },
    { id: "withdraw", label: "The agent can trade but never withdraw", ok: true },
    { id: "fresh", label: "Price from the live Hyperliquid book", ok: !!mark },
    ...(tp || sl ? [{ id: "tpsl", label: tpslOk ? `${[tp && "Take profit", sl && "stop loss"].filter(Boolean).join(" and ")} set reduce-only once it fills` : `Take profit has to be ${side === "long" ? "above" : "below"} and stop loss ${side === "long" ? "below" : "above"} the price for a ${side}`, ok: tpslOk }] : []),
  ];
  const ok = checks.every((c) => c.ok);
  const [phase, setPhase] = useState<"review" | "placing" | "error">("review"), [err, setErr] = useState("");
  function place() {
    simulateApproval("demo-perp-" + crypto.randomUUID(), {
      wallet: () => setPhase("placing"), submitted: () => {},
      landed: () => {
        try { saveDemoLedger(applyPerpOpen(demoLedger(), { coin: d.coin, side, notional, leverage: lev, price: price!, tp, sl })); done(`Example: ${effect ? effect.replace(/^./, (c) => c.toLowerCase()) + " — " : ""}${side} ${qty(size)} ${d.coin} filled at ${usd(price!)} by the FlowVault agent under your mandate${tp || sl ? `, with ${[tp && "take profit at " + usd(tp), sl && "stop loss at " + usd(sl)].filter(Boolean).join(" and ")}` : ""}. Nothing was signed.`); }
        catch (e) { setErr((e as Error).message); setPhase("error"); }
      },
    }, { wallet: 700, settle: 1300 });
  }
  return <ReviewFrame busy={phase === "placing"} close={close} className="fv-dialog fv-swap-confirm" label={`Example ${side} ${d.coin}`}>
    {phase !== "placing" && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol={d.coin} core={["ETH", "BTC"].includes(d.coin)} size={52} /></div>
    <h2>{phase === "placing" ? "The FlowVault agent is placing it…" : `${side === "long" ? "Long" : "Short"} ${qty(size)} ${d.coin} · ${lev}×`}</h2>
    <p className="fv-confirm-sub">{phase === "error" ? err : "Example account at the live Hyperliquid price. The agent places orders inside your signed mandate, so there’s no wallet step; nothing is real."}</p>
    <div className="fv-confirm-table">
      <div><span>{d.kind === "limit" ? "Limit price" : "Market price"}</span><strong>{price ? usd(price) : "Reading the book…"}</strong></div>
      {effect && <div><span>Effect</span><strong>{effect}</strong></div>}
      <div><span>Order value</span><strong>{usd(notional)}</strong></div>
      <div><span>Margin · fee</span><strong>{usd(margin)} · {usd(fee)} taker</strong></div>
      <div><span>Liquidation estimate</span><strong className="fv-down">{adds <= 1e-9 ? "No new position" : liq ? usd(liq) : "—"}</strong></div>
      {tp && <div><span>Take profit</span><strong>{usd(tp)}{price ? <small className="fv-up"> · ≈ {pnlAt(tp) >= 0 ? "+" : "−"}{usd(Math.abs(pnlAt(tp)))}</small> : null}</strong></div>}
      {sl && <div><span>Stop loss</span><strong>{usd(sl)}{price ? <small className="fv-down"> · ≈ {pnlAt(sl) >= 0 ? "+" : "−"}{usd(Math.abs(pnlAt(sl)))}</small> : null}</strong></div>}
    </div>
    <HazardScan checks={checks} />
    <div className="fv-confirm-actions">
      {phase === "placing" ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Placing with the agent…</button>
        : ok ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go " + (side === "long" ? "is-long" : "is-short")} disabled={!price} onClick={place}>Place {side}{tp || sl ? " with " + [tp && "TP", sl && "SL"].filter(Boolean).join(" / ") : ""} · example</button>
        : <button type="button" className="fv-button fv-wide-button" onClick={close}>Change the order: it’s outside your mandate</button>}
    </div>
  </ReviewFrame>;
}
