"use client";
// The live perps order review, opened from the order ticket. FlowVault first runs the order through the same checks
// the agent will face (signed mandate, limits, lot size, Hyperliquid's minimum, take profit and stop loss sides)
// without sending anything; the owner confirms; the agent then places the order and, once it fills, the take profit
// and stop loss as reduce-only trigger orders. There is no wallet step: the agent acts inside the signed mandate.
import { useEffect, useState } from "react";
import { Check, CircleAlert, RefreshCw, X } from "lucide-react";
import { ReviewFrame } from "./ReviewFrame";
import { TokenIcon } from "./AssetIdentity";
import { HazardScan } from "./approvals/HazardScan";
import { useLiveMarket } from "./useLiveMarket";
import { fmtUsd } from "./swap-format";
import { usePerpMeta } from "./perp-meta";
import { api, type Scope } from "./live";
import type { HazardCheck } from "@/lib/flowvault/policy";
import type { OrderDraft } from "./OrderTicket";

const TAKER = 0.00045;
type Check = { id: string; ok: boolean | null; detail: string };
type Placed = { cloid: string; state: string; error?: string; checks: Check[]; intent: { kind: string; price?: string; size: string }; response?: unknown };

const LABELS: Record<string, string> = {
  kill_switch: "Kill switch off", signed_terms: "Mandate terms signed by you", validity: "Mandate in date", authority_kind: "Hyperliquid agent mandate",
  named_agent: "Agent named in your mandate", agent: "Agent approved on Hyperliquid", mandate_state: "Mandate active", mandate_scope: "Mandate allows this action",
  perp_limits: "Perp limits set", asset: "Market allowed by your mandate", snapshot_fresh: "Fresh account read", mid_price: "Live Hyperliquid price",
  leverage: "Leverage within your limit", notional: "Order size within your per-order limit", daily: "Within today's limit", capital: "Margin within your capital limit",
  strategy_loss: "Loss stop not reached", liquidation_distance: "Liquidation cushion", slippage: "Slippage bounded", lot_size: "Size fits Hyperliquid's lot size",
  min_order: "Above Hyperliquid's $10 minimum", tpsl: "Take profit and stop loss", reduces_position: "Reduces an open position",
};
const hazard = (c: Check): HazardCheck => ({ id: c.id, label: LABELS[c.id] ?? c.detail, ok: c.ok, detail: c.detail });
const fill = (resp: unknown) => (resp as { response?: { data?: { statuses?: { filled?: { avgPx: string; totalSz: string } }[] } } })?.response?.data?.statuses?.[0]?.filled ?? null;

/** One line per placed order, for the result and the card's status note. */
function outcome(o: Placed, coin: string) {
  const what = o.intent.kind === "take_profit" ? `Take profit at ${o.intent.price}` : o.intent.kind === "stop_loss" ? `Stop loss at ${o.intent.price}` : "Order";
  const f = fill(o.response);
  const failed = o.checks.filter((c) => c.ok !== true).map((c) => c.detail).join(" ");
  if (o.state === "filled") return { ok: true, text: f ? `${what}: filled ${f.totalSz} ${coin} at ${fmtUsd(f.avgPx)}.` : `${what}: filled.` };
  if (o.state === "resting") return { ok: true, text: o.intent.kind === "market" || o.intent.kind === "limit" ? `${what}: resting on the book at ${o.intent.price ?? "your price"}.` : `${what}: set, reduce-only. It triggers as a market order.` };
  if (o.state === "unknown") return { ok: false, text: `${what}: outcome unknown. Your mandate is paused until FlowVault reconciles it with Hyperliquid; check your Hyperliquid account.` };
  return { ok: false, text: `${what}: not placed.${o.error ? " " + o.error : ""}${failed && !o.error?.includes(failed) ? " " + failed : ""}` };
}

export function PerpOrderReview({ d, master, mandateId, scope, close, done }: { d: OrderDraft; master: string; mandateId: string; scope: Scope; close: () => void; done: (summary: string) => void }) {
  const mid = useLiveMarket(d.coin, "15m", 0).data?.mid, mark = mid ? Number(mid) : null;
  const meta = usePerpMeta(d.coin);
  const [phase, setPhase] = useState<"checking" | "review" | "placing" | "result" | "error">("checking");
  const [checks, setChecks] = useState<Check[]>([]), [allowed, setAllowed] = useState(false), [error, setError] = useState("");
  const [results, setResults] = useState<{ ok: boolean; text: string }[]>([]);
  const [key] = useState(() => crypto.randomUUID());
  const long = d.side === "buy", side = long ? "long" : "short";
  const order = { mandateId, master, coin: d.coin, isBuy: long, size: d.size, kind: d.kind, ...(d.kind === "limit" ? { price: d.price } : {}), reduceOnly: false, leverage: Number(d.leverage), margin: d.margin, ...(d.tp ? { tp: d.tp } : {}), ...(d.sl ? { sl: d.sl } : {}) };

  async function check() {
    setPhase("checking"); setError("");
    try {
      const r = await api("/api/perps", { action: "order_preview", ...order }, "POST", scope) as { checks: Check[]; allowed: boolean };
      setChecks(r.checks); setAllowed(r.allowed); setPhase("review");
    } catch (e) { setError((e as Error).message); setPhase("error"); }
  }
  useEffect(() => { const t = setTimeout(() => void check(), 0); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per review

  async function place() {
    setPhase("placing"); setError("");
    try {
      const r = await api("/api/perps", { action: "order", ...order, key }, "POST", scope) as { order: Placed; protection?: Placed[]; protectionNote?: string };
      const lines = [outcome(r.order, d.coin), ...(r.protection ?? []).map((p) => outcome(p, d.coin))];
      if (r.protectionNote) lines.push({ ok: false, text: r.protectionNote });
      setResults(lines); setPhase("result");
    } catch (e) { setError((e as Error).message); setPhase("error"); }
  }

  const price = d.kind === "limit" ? Number(d.price) : mark;
  const size = Number(d.size), lev = Number(d.leverage), value = price ? size * price : 0;
  const max = meta?.maxLeverage ?? 10, mm = 1 / (2 * max);
  const liq = price && d.margin === "isolated" ? long ? price * (1 - 1 / lev + mm) : price * (1 + 1 / lev - mm) : null;
  const pnlAt = (px: string) => price ? (Number(px) - price) * size * (long ? 1 : -1) : null;
  const tpPnl = d.tp ? pnlAt(d.tp) : null, slPnl = d.sl ? pnlAt(d.sl) : null;
  const filledAll = phase === "result" && results.every((x) => x.ok);
  const busy = phase === "placing";
  return <ReviewFrame busy={busy} close={close} className="fv-dialog fv-swap-confirm" label={`Review ${side} ${d.coin}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={phase === "result" ? () => done(results.map((x) => x.text).join(" ")) : close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol={d.coin} core={["ETH", "BTC"].includes(d.coin)} size={52} /></div>
    <h2>{phase === "placing" ? "The FlowVault agent is placing it…" : phase === "result" ? (filledAll ? "Order placed" : "Order result") : phase === "error" ? "Order not placed" : `${long ? "Long" : "Short"} ${d.size} ${d.coin} · ${lev}×`}</h2>
    <p className="fv-confirm-sub">{phase === "checking" ? "Checking the order against your signed mandate and Hyperliquid's rules. Nothing is sent yet."
      : phase === "error" ? error
      : phase === "result" ? "Placed by your FlowVault agent under your signed mandate."
      : "Your FlowVault agent places this under the limits you signed, so there's no wallet step. Fees, fill price and liquidation depend on execution."}</p>
    {phase !== "result" && <div className="fv-confirm-table">
      <div><span>{d.kind === "limit" ? "Limit price" : "Market price"}</span><strong>{price ? fmtUsd(price) : "Reading the book…"}</strong></div>
      <div><span>Order value</span><strong>{fmtUsd(value)}</strong></div>
      <div><span>Margin · fee</span><strong>{fmtUsd(value / lev)} {d.margin} · {fmtUsd(value * TAKER)} taker</strong></div>
      <div><span>Liquidation estimate</span><strong className="fv-down">{d.margin === "cross" ? "Depends on your whole account" : liq ? fmtUsd(liq) : "—"}</strong></div>
      {d.tp && <div><span>Take profit</span><strong>{fmtUsd(d.tp)}{tpPnl !== null ? <small className="fv-up"> · ≈ {tpPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(tpPnl))}</small> : null}</strong></div>}
      {d.sl && <div><span>Stop loss</span><strong>{fmtUsd(d.sl)}{slPnl !== null ? <small className="fv-down"> · ≈ {slPnl >= 0 ? "+" : "−"}{fmtUsd(Math.abs(slPnl))}</small> : null}</strong></div>}
      {(d.tp || d.sl) && <div><span>Protection</span><strong>Placed reduce-only once the order fills, for the size that filled</strong></div>}
    </div>}
    {phase === "review" && <HazardScan checks={checks.map(hazard)} />}
    {phase === "result" && <ul className="fv-order-results">{results.map((x) => <li key={x.text} className={x.ok ? "is-ok" : "is-bad"}>{x.ok ? <Check size={14} /> : <CircleAlert size={14} />}<span>{x.text}</span></li>)}</ul>}
    <div className="fv-confirm-actions">
      {phase === "checking" && <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Checking…</button>}
      {phase === "placing" && <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> Placing with the agent…</button>}
      {phase === "review" && (allowed
        ? <button type="button" className={"fv-button fv-primary fv-wide-button fv-ticket-go is-" + side} onClick={() => void place()}>Place {side}{d.tp || d.sl ? " with " + [d.tp && "TP", d.sl && "SL"].filter(Boolean).join(" / ") : ""}</button>
        : <div className="fv-actions"><button type="button" className="fv-button" onClick={close}>Change the order</button><button type="button" className="fv-button" onClick={() => void check()}><RefreshCw size={14} /> Check again</button></div>)}
      {phase === "error" && <div className="fv-actions"><button type="button" className="fv-button" onClick={close}>Close</button><button type="button" className="fv-button fv-primary" onClick={() => void check()}>Check again</button></div>}
      {phase === "result" && <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => done(results.map((x) => x.text).join(" "))}>Done</button>}
    </div>
  </ReviewFrame>;
}
