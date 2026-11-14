"use client";
// Demo Mode approved-asset sales: save a sale limit for an asset in the example's policy, then compare what it takes
// to receive exactly a net USDC amount from each approved asset (within its quantity, value and slippage limits and
// what the example holds), and sell through the labelled example wallet. Today's Rhea prices; nothing is signed.
import { useState } from "react";
import { demoLedger, saveDemoLedger, simulateApproval, useDemoLedger, useDemoMarkets } from "./ledger-store";
import { applySale, applySalePermission, saleHeld, saleQuote, WNEAR_ID, type DemoSalePermission } from "@/lib/flowvault/demo-ledger";

const ASSETS = [{ id: WNEAR_ID, symbol: "wNEAR" }, { id: "linear-protocol.near", symbol: "LiNEAR" }, { id: "lst.rhealab.near", symbol: "rNEAR" }, { id: "usdt.tether-token.near", symbol: "USDT" }];
const n2 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });

export function DemoSales() {
  const l = useDemoLedger(), mk = useDemoMarkets();
  const [asset, setAsset] = useState(WNEAR_ID), [qty, setQty] = useState(""), [maxValue, setMaxValue] = useState(""), [slip, setSlip] = useState("100"), [priority, setPriority] = useState("P2");
  const [net, setNet] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState("");
  if (!l) return null;
  const price = (id: string) => mk?.m[id]?.price ?? null;
  const save = () => {
    try { saveDemoLedger(applySalePermission(demoLedger(), { asset, symbol: ASSETS.find((a) => a.id === asset)!.symbol, maxQty: Number(qty), maxValue: Number(maxValue), slippageBps: Number(slip), priority })); setMsg("Example: sale limit saved as a new policy revision. Protected assets stay protected; each sale still needs its own review."); setQty(""); setMaxValue(""); }
    catch (e) { setMsg((e as Error).message); }
  };
  const sell = (p: DemoSalePermission, q: number, x: number) => simulateApproval("demo-sale-" + crypto.randomUUID(), {
    wallet: () => { setBusy(p.asset); setMsg(""); }, submitted: () => {},
    landed: () => { saveDemoLedger(applySale(demoLedger(), p, q, x)); setBusy(""); setMsg(`Example: sold ${n2(q)} ${p.symbol}; exactly ${n2(x)} USDC arrived on your NEAR account. Nothing was signed.`); },
  }, { wallet: 1300, settle: 2800 });
  const want = Number(net), perms = [...(l.sales ?? [])].sort((a, b) => a.priority.localeCompare(b.priority));
  return <div className="fv-demo-sales">
    <p className="fv-demo-note">Example workspace: sale limits are saved in this tab and sales play a simulated wallet at today’s Rhea prices; nothing is signed.</p>
    <fieldset><legend>Approve a sale limit</legend>
      <label>Asset <select value={asset} onChange={(e) => setAsset(e.target.value)}>{ASSETS.map((a) => <option key={a.id} value={a.id}>{a.symbol} · you hold {n2(saleHeld(l, a.id))}</option>)}</select></label>
      <label>Maximum quantity <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></label>
      <label>Maximum value (USDC) <input value={maxValue} onChange={(e) => setMaxValue(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></label>
      <label>Slippage limit (basis points) <input value={slip} onChange={(e) => setSlip(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></label>
      <label>Sale priority <select value={priority} onChange={(e) => setPriority(e.target.value)}><option>P1</option><option>P2</option><option>P3</option></select></label>
      <button type="button" className="fv-button" onClick={save}>Save sale permission and limits · example</button>
    </fieldset>
    {perms.length > 0 && <fieldset><legend>Compare exact net proceeds</legend>
      <label>USDC needed in your NEAR account <input value={net} onChange={(e) => setNet(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></label>
      {want > 0 && <ul className="fv-demo-vault-reqs">{perms.map((p) => { const q = saleQuote(l, p, price(p.asset), want); return <li key={p.asset}>
        <span><b>{p.priority} · {p.symbol}</b> · {q.ok ? `sell ${n2(q.qty)} (≈ $${n2(q.value)}) to receive exactly ${n2(want)} USDC · cost ≈ $${n2(q.cost)}` : q.why}</span>
        {q.ok && <button type="button" className="fv-button" disabled={!!busy} onClick={() => sell(p, q.qty, want)}>{busy === p.asset ? "Example wallet approving…" : "Sell · example"}</button>}
      </li>; })}</ul>}
    </fieldset>}
    {msg && <p className="fv-demo-note" role="status">{msg}</p>}
  </div>;
}
