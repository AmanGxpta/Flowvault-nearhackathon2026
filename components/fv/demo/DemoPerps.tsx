"use client";
// Demo Mode perpetuals: the example's Hyperliquid account, with a FlowVault agent approved and a signed mandate, both
// fictional. An order from the ticket is reviewed against the mandate's limits (the real checks), then the agent
// "places" it and it fills at the live Hyperliquid price. Positions mark to the live price; closing realizes the PnL.
// Prices are real public data; the account, the agent and the fills are not.
import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, ShieldCheck, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { TokenIcon } from "../AssetIdentity";
import { HazardScan } from "../approvals/HazardScan";
import { useLiveMarket } from "../useLiveMarket";
import { fmtUsd } from "../swap-format";
import { demoLedger, saveDemoLedger, simulateApproval, useDemoLedger } from "./ledger-store";
import { applyPerpClose, applyPerpOpen, freeMargin, perpLiq, perpMargin, perpPnl, type DemoPerp } from "@/lib/flowvault/demo-ledger";
import type { OrderDraft } from "../OrderTicket";

const MAX_LEV: Record<string, number> = { BTC: 40, ETH: 25, NEAR: 10 };
/** The example mandate's limits: what the FlowVault agent may do without asking again. */
const MANDATE = { leverage: 10, notional: 5000, daily: 20000, lossStop: 500 };
const TAKER = 0.00045;
const usd = (n: number) => fmtUsd(n);
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 5 : 3 });

export function DemoPerps({ coin, draft, onMarket }: { coin: string; draft: OrderDraft | null; onMarket: (c: string) => void }) {
  const l = useDemoLedger();
  const [review, setReview] = useState<OrderDraft | null>(null), [closing, setClosing] = useState<string | null>(null), [note, setNote] = useState("");
  const seen = useRef<number | null>(null), [dayAgo] = useState(() => Date.now() - 86_400_000);
  useEffect(() => { if (!draft || draft.n === seen.current) return; seen.current = draft.n; const t = setTimeout(() => setReview(draft), 0); return () => clearTimeout(t); }, [draft]);
  if (!l) return null;
  const today = l.activity.filter((a) => a.at > dayAgo && /^Opened/.test(a.text)).length;
  return <section className="fv-panel fv-demo-perps" aria-label="Perpetuals · example account">
    <div className="fv-section-head"><div><h3>Perpetuals on Hyperliquid · example account</h3><p className="fv-muted">Live Hyperliquid prices; the account, agent and fills are fictional. Margin isn’t spendable cash, and unrealized gains never count as money you have.</p></div><span className="fv-chip">Example</span></div>
    <Account l={l} />
    <div className="fv-demo-mandate"><ShieldCheck size={15} /><span>FlowVault agent <b>0xa9c4…71e2</b> approved · can trade, never withdraw · mandate “Perps · example” <b>active</b>: up to {MANDATE.leverage}×, {usd(MANDATE.notional)} per order, {usd(MANDATE.daily)} a day, loss stop {usd(MANDATE.lossStop)}</span></div>
    {note && <p className="fv-demo-note" role="status">{note}</p>}
    {l.perps.positions.length ? <div className="fv-demo-positions">{l.perps.positions.map((p) => <Position key={p.coin} p={p} pick={() => onMarket(p.coin)} close={() => setClosing(p.coin)} />)}</div>
      : <p className="fv-muted">No open positions. Use the ticket above: choose long or short, size and leverage, then Review.</p>}
    {review && <OrderReview d={review} coin={coin} free={freeMargin(l)} ordersToday={today} close={() => setReview(null)} done={(msg) => { setReview(null); setNote(msg); }} />}
    {closing && <CloseReview p={l.perps.positions.find((x) => x.coin === closing)!} close={() => setClosing(null)} done={(msg) => { setClosing(null); setNote(msg); }} />}
  </section>;
}

function Account({ l }: { l: NonNullable<ReturnType<typeof useDemoLedger>> }) {
  const marks = useMarks(l.perps.positions.map((p) => p.coin));
  const unrealized = l.perps.positions.reduce((s, p) => s + (marks[p.coin] ? perpPnl(p, marks[p.coin]!) : 0), 0);
  return <div className="fv-perp-stats">
    <div><small>Account value (USDC)</small><strong>{usd(l.perps.margin + unrealized)}</strong></div>
    <div><small>Free margin</small><strong>{usd(freeMargin(l))}</strong></div>
    <div><small>Unrealized PnL</small><strong className={unrealized >= 0 ? "fv-up" : "fv-down"}>{unrealized >= 0 ? "+" : "−"}{usd(Math.abs(unrealized))}</strong></div>
    <div><small>Realized</small><strong>{l.perps.realized >= 0 ? "+" : "−"}{usd(Math.abs(l.perps.realized))}</strong></div>
  </div>;
}
/** Live marks for up to three coins (one hook each, in a stable order). */
function useMarks(coins: string[]) {
  const [a, b, c] = [coins[0] ?? "ETH", coins[1] ?? "BTC", coins[2] ?? "NEAR"];
  const ma = useLiveMarket(a, "15m", 0).data?.mid, mb = useLiveMarket(b, "15m", 0).data?.mid, mc = useLiveMarket(c, "15m", 0).data?.mid;
  return { [a]: ma ? Number(ma) : null, [b]: mb ? Number(mb) : null, [c]: mc ? Number(mc) : null } as Record<string, number | null>;
}

function Position({ p, pick, close }: { p: DemoPerp; pick: () => void; close: () => void }) {
  const mid = useLiveMarket(p.coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const pnl = mark ? perpPnl(p, mark) : null, liq = perpLiq(p, MAX_LEV[p.coin] ?? 10);
  return <div className="fv-perp-position">
    <div className="fv-section-head"><button type="button" className="fv-asset-cell fv-link-reset" onClick={pick}><TokenIcon symbol={p.coin} core={["ETH", "BTC"].includes(p.coin)} /><strong>{p.coin}</strong><span className={"fv-chip " + (p.side === "long" ? "fv-up" : "fv-down")}>{p.side === "long" ? "Long" : "Short"} · {p.leverage}×</span></button>
      <button type="button" className="fv-button" onClick={close}>Close position</button></div>
    <div className="fv-perp-stats">
      <div><small>Size</small><strong>{qty(p.size)} {p.coin}</strong></div>
      <div><small>Entry / mark</small><strong>{usd(p.entry)} / {mark ? usd(mark) : "…"}</strong></div>
      <div><small>Unrealized PnL</small><strong className={pnl === null ? "" : pnl >= 0 ? "fv-up" : "fv-down"}>{pnl === null ? "…" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}</strong></div>
      <div><small>Margin · liquidation estimate</small><strong>{usd(perpMargin(p))} · {usd(liq)}</strong></div>
    </div>
  </div>;
}

function OrderReview({ d, coin, free, ordersToday, close, done }: { d: OrderDraft; coin: string; free: number; ordersToday: number; close: () => void; done: (msg: string) => void }) {
  const mid = useLiveMarket(d.coin || coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const price = d.kind === "limit" && Number(d.price) > 0 ? Number(d.price) : mark;
  const lev = Number(d.leverage), size = Number(d.size), notional = price ? size * price : 0, margin = notional / lev, fee = notional * TAKER;
  const side: "long" | "short" = d.side === "buy" ? "long" : "short";
  const liq = price ? perpLiq({ coin: d.coin, side, size, entry: price, leverage: lev, openedAt: 0 }, MAX_LEV[d.coin] ?? 10) : null;
  const checks = [
    { id: "lev", label: lev <= MANDATE.leverage ? `Leverage ${lev}× within your mandate’s ${MANDATE.leverage}×` : `Leverage ${lev}× is above your mandate’s ${MANDATE.leverage}× maximum`, ok: lev <= MANDATE.leverage },
    { id: "notional", label: notional <= MANDATE.notional ? `${usd(notional)} order within your ${usd(MANDATE.notional)} limit` : `${usd(notional)} order is above your ${usd(MANDATE.notional)} limit`, ok: notional <= MANDATE.notional },
    { id: "daily", label: `Daily limit: ${usd(MANDATE.daily)}, ${ordersToday} order${ordersToday === 1 ? "" : "s"} today`, ok: true },
    { id: "margin", label: margin <= free ? `${usd(margin)} margin from ${usd(free)} free` : `Needs ${usd(margin)} margin; ${usd(free)} is free`, ok: margin <= free },
    { id: "loss", label: `Loss stop ${usd(MANDATE.lossStop)} armed`, ok: true },
    { id: "withdraw", label: "The agent can trade but never withdraw", ok: true },
    { id: "fresh", label: "Price from the live Hyperliquid book", ok: !!mark },
  ];
  const ok = checks.every((c) => c.ok);
  const [phase, setPhase] = useState<"review" | "placing" | "error">("review"), [err, setErr] = useState("");
  function place() {
    simulateApproval("demo-perp-" + crypto.randomUUID(), {
      wallet: () => setPhase("placing"), submitted: () => {},
      landed: () => {
        try { saveDemoLedger(applyPerpOpen(demoLedger(), { coin: d.coin, side, notional, leverage: lev, price: price! })); done(`Example: ${side} ${qty(size)} ${d.coin} filled at ${usd(price!)} by the FlowVault agent under your mandate. Nothing was signed.`); }
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
      <div><span>Order value</span><strong>{usd(notional)}</strong></div>
      <div><span>Margin · fee</span><strong>{usd(margin)} · {usd(fee)} taker</strong></div>
      <div><span>Liquidation estimate</span><strong className="fv-down">{liq ? usd(liq) : "—"}</strong></div>
    </div>
    <HazardScan checks={checks} />
    <div className="fv-confirm-actions">
      {phase === "placing" ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Placing with the agent…</button>
        : ok ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go " + (side === "long" ? "is-long" : "is-short")} disabled={!price} onClick={place}>Place {side} · example</button>
        : <button type="button" className="fv-button fv-wide-button" onClick={close}>Change the order: it’s outside your mandate</button>}
    </div>
  </ReviewFrame>;
}

function CloseReview({ p, close, done }: { p: DemoPerp; close: () => void; done: (msg: string) => void }) {
  const mid = useLiveMarket(p.coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const pnl = mark ? perpPnl(p, mark) : null;
  const [busy, setBusy] = useState(false);
  function go() {
    simulateApproval("demo-close-" + crypto.randomUUID(), { wallet: () => setBusy(true), submitted: () => {}, landed: () => { saveDemoLedger(applyPerpClose(demoLedger(), p.coin, mark!)); done(`Example: ${p.coin} ${p.side} closed at ${usd(mark!)} (${pnl! >= 0 ? "+" : "−"}${usd(Math.abs(pnl!))}). Nothing was signed.`); } }, { wallet: 600, settle: 1200 });
  }
  return <ReviewFrame busy={busy} close={close} className="fv-dialog fv-swap-confirm" label={`Close ${p.coin}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol={p.coin} core={["ETH", "BTC"].includes(p.coin)} size={52} /></div>
    <h2>Close {p.coin} {p.side}</h2>
    <p className="fv-confirm-sub">A reduce-only market order closes the whole position at the live price. Example account; nothing is real.</p>
    <div className="fv-confirm-table">
      <div><span>Size</span><strong>{qty(p.size)} {p.coin}</strong></div>
      <div><span>Entry → mark</span><strong>{usd(p.entry)} → {mark ? usd(mark) : "…"}</strong></div>
      <div><span>Realized PnL</span><strong className={pnl !== null && pnl >= 0 ? "fv-up" : "fv-down"}>{pnl === null ? "…" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}</strong></div>
    </div>
    <div className="fv-confirm-actions"><button type="button" className="fv-button fv-primary fv-wide-button" disabled={busy || !mark} onClick={go}>{busy ? <><RefreshCw size={15} className="fv-spin" /> Closing…</> : <><Check size={15} /> Close position · example</>}</button></div>
  </ReviewFrame>;
}
