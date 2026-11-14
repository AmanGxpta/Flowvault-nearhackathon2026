"use client";
// Demo Mode supply review (e.g. opened from an example approval): the amount, rate and hazard scan of a real supply
// card, approved as a labelled simulation. Nothing is signed or sent.
import { useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { TokenIcon } from "../AssetIdentity";
import { HazardScan } from "../approvals/HazardScan";
import { exampleChecks, simAttempt } from "@/lib/flowvault/demo-sim";

export function DemoSupplyReview({ symbol, icon, amount, apy, close }: { symbol: string; icon?: string | null; amount: string; apy: number | null; close: () => void }) {
  const [at, setAt] = useState<number | null>(null), [now, setNow] = useState(() => Date.now()), [id] = useState(() => "demo-supply-" + crypto.randomUUID());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(t); }, []);
  const a = simAttempt(id, at, now, { settleMs: 5000 });
  const busy = a?.state === "awaiting_wallet" || a?.state === "submitted";
  const yearly = apy !== null ? Number(amount) * apy / 100 : null;
  const amt = Number(amount).toLocaleString("en-US");
  return <ReviewFrame busy={busy} close={close} className="fv-dialog fv-swap-confirm" label={`Example supply ${symbol}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <div className="fv-confirm-pair"><TokenIcon symbol={symbol} image={icon ?? undefined} network="near" core size={52} /></div>
    <h2>{!a ? `Supply ${amt} ${symbol}` : a.state === "confirmed" ? "Supplied" : "Confirm in your wallet"}</h2>
    <p className="fv-confirm-sub">Example workspace: a simulation with fictional balances. Nothing is signed and nothing moves.</p>
    <div className="fv-confirm-table">
      <div><span>Supply</span><strong>{amt} {symbol} · from your NEAR account</strong></div>
      <div><span>Supply APY</span><strong>{apy !== null ? `${apy.toFixed(2)}% · variable${yearly !== null ? ` · ≈ ${"$" + yearly.toFixed(2)} a year` : ""}` : "variable"}</strong></div>
      <div><span>Network fees</span><strong>up to 0.003 NEAR</strong></div>
      {a?.hash && <div><span>Transaction</span><strong className="fv-demo-hash">{a.hash} <small>(example, not on chain)</small></strong></div>}
    </div>
    {!a && <HazardScan checks={exampleChecks(Number(amount), [{ id: "health", label: "No debt: nothing can be liquidated", ok: true }, { id: "oracle", label: "Priced by Rhea's own oracle", ok: true }])} />}
    {a?.state === "confirmed" && <div className="fv-confirm-success"><Check size={18} /> Example: {amt} {symbol} supplied to Rhea.</div>}
    <div className="fv-confirm-actions">
      {!a ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => setAt(Date.now())}>Approve in wallet · example</button>
        : busy ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {a.state === "awaiting_wallet" ? "Waiting for the example wallet…" : "Settling on NEAR…"}</button>
        : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
    </div>
  </ReviewFrame>;
}
