"use client";
// Demo Mode swap: the same review card as a real swap, played as a labelled simulation with the example wallets.
// "Approve" waits briefly in a pretend wallet, runs, and lands slightly under the quote. Nothing is signed or sent.
import { useEffect, useState } from "react";
import { Check, ExternalLink, RefreshCw, ShieldCheck, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { TokenIcon } from "../AssetIdentity";
import { coreIdentity } from "../useTokenCatalog";
import { fmtAmount, fmtUsd } from "../swap-format";
import { simAttempt, simDelivered } from "@/lib/flowvault/demo-sim";
import { units, decimal } from "@/lib/flowvault/money";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";

const NET: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", pol: "Polygon" };

export function DemoSwapReview({ from, to, amount, route, close, onDone }: { from: SwapToken; to: SwapToken; amount: string; route: { venue: string; output: string; minimum: string; eta: number | null }; close: () => void; onDone?: () => void }) {
  const [at, setAt] = useState<number | null>(null), [now, setNow] = useState(() => Date.now()), [id] = useState(() => "demo-swap-" + crypto.randomUUID());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(t); }, []);
  const outRaw = (() => { try { return units(route.output, to.decimals).toString(); } catch { return null; } })();
  const a = simAttempt(id, at, now, { settleMs: route.venue.startsWith("Rhea") ? 3500 : 8000, deliveredRaw: simDelivered(outRaw) });
  const delivered = a?.state === "confirmed" && a.deliveredRaw ? decimal(BigInt(a.deliveredRaw), to.decimals) : null;
  useEffect(() => { if (delivered) onDone?.(); }, [delivered]); // eslint-disable-line react-hooks/exhaustive-deps -- once, when it lands
  const busy = a?.state === "awaiting_wallet" || a?.state === "submitted";
  const cross = from.network !== to.network;
  return <ReviewFrame busy={busy} close={close} className={"fv-dialog fv-swap-confirm"} label={`Example swap ${from.symbol} to ${to.symbol}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol={from.symbol} network={from.network} core={coreIdentity(from)} image={from.icon} size={44} /><TokenIcon symbol={to.symbol} network={to.network} core={coreIdentity(to)} image={to.icon} size={44} /></div>
    <h2>{!a ? `Swap ${fmtAmount(amount)} ${from.symbol}` : a.state === "awaiting_wallet" ? "Confirm in your wallet" : a.state === "submitted" ? (cross ? "NEAR Intents is delivering" : "Settling on NEAR") : "Swapped"}</h2>
    <p className="fv-confirm-sub">Example workspace: a simulation with fictional balances. Nothing is signed and nothing moves.</p>
    <div className="fv-confirm-table">
      <div><span>You pay</span><strong>{fmtAmount(amount)} {from.symbol} <small>· {NET[from.network] ?? from.network}</small></strong></div>
      <div><span>{delivered ? "You received" : "You receive"}</span><strong>{delivered ? fmtAmount(delivered) : "≈ " + fmtAmount(route.output)} {to.symbol} <small>· {NET[to.network] ?? to.network}{to.price ? " · " + fmtUsd(Number(delivered ?? route.output) * Number(to.price)) : ""}</small></strong></div>
      <div><span>Minimum</span><strong>{fmtAmount(route.minimum)} {to.symbol}</strong></div>
      <div><span>Route</span><strong>{route.venue}{route.eta ? ` · ~${route.eta}s` : ""}</strong></div>
      {a?.hash && <div><span>Transaction</span><strong className="fv-demo-hash">{a.hash} <small>(example, not on chain)</small></strong></div>}
    </div>
    {!a && <p className="fv-stake-policy"><ShieldCheck size={14} /> Example: checked against the example workspace&apos;s limits</p>}
    {a?.state === "confirmed" && <div className="fv-confirm-success"><Check size={18} /> Example: {fmtAmount(delivered)} {to.symbol} arrived.<div className="fv-confirm-hashes"><span className="fv-demo-hash">View transaction <ExternalLink size={12} /> unavailable for examples</span></div></div>}
    <div className="fv-confirm-actions">
      {!a ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => setAt(Date.now())}>Approve in wallet · example</button>
        : busy ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {a.state === "awaiting_wallet" ? "Waiting for the example wallet…" : "In progress…"}</button>
        : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
    </div>
  </ReviewFrame>;
}
