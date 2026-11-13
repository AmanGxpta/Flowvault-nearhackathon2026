"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- existing validated payment view-model */
import { LogoSelect } from "./LogoSelect";
import { TokenIcon, NetworkLabel } from "./AssetIdentity";

/** Collects intent only. Existing API validation, funding review and wallet handoff remain authoritative. */
export function PaymentForm({ v }: { v: any }) {
  return <div className="fv-form fv-payment-form">
    <p className="fv-muted">Set the recipient’s amount. You will compare funding sources and review fees before signing.</p>
    <label>Recipient<select value={v.intent.rid} onChange={v.onIntent.rid}><option value="new">New recipient</option>{(v.intentRecips ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name} · {r.chain}</option>)}</select></label>
    <div className="fv-form-columns"><div className="fv-labelled-control"><span>Network</span><LogoSelect label="Network" value={v.intent.chain} onChange={value => v.onIntent.chain({target:{value}})} disabled={!v.intentNew} options={[{value:'Base',network:'base'},{value:'Arbitrum',network:'arb'},{value:'Ethereum',network:'eth'},{value:'BNB Chain',network:'bnb'},{value:'NEAR',network:'near'}].map(x => ({value:x.value,label:x.value,icon:<NetworkLabel network={x.network} iconOnly/>}))}/></div><div className="fv-labelled-control"><span>Token</span><LogoSelect label="Token" value={v.intent.asset} onChange={value => v.onIntent.asset({target:{value}})} options={['USDC','USDT'].map(symbol => ({value:symbol,label:symbol,icon:<TokenIcon symbol={symbol} core size={24}/>}))}/></div></div>
    {v.intentNew && <label>Recipient address<input value={v.intent.addr} onChange={v.onIntent.addr} placeholder={v.intent.chain === "NEAR" ? "name.near" : "0x…"} autoComplete="off" /><small>{v.intent.addr ? v.intentAddrMsg : "Paste the recipient’s wallet address."}</small></label>}
    <label>Recipient receives<div className="fv-payment-amount"><TokenIcon symbol={v.intent.asset} core /><input aria-label="Recipient amount" value={v.intent.amount} onChange={v.onIntent.amount} inputMode="decimal" placeholder="0.00" /><strong>{v.intent.asset}</strong></div></label>
    <details className="fv-payment-options"><summary>Date and repeat options</summary><label>Payment date<input type="date" value={v.intent.due} onChange={v.onIntent.due} /></label><label>Repeat<select value={v.intent.repeats} onChange={v.onIntent.repeats}><option value="none">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><p className="fv-muted">Scheduling reserves funds in your plan. Each payment still needs your approval; setting a date does not enable automatic sending.</p></details>
    <details className="fv-payment-options"><summary>Funding availability</summary><p className="fv-muted">{v.intentNote}</p></details>
    <div className="fv-actions"><button type="button" className="fv-button" onClick={v.closeModal}>Cancel</button><button type="button" className="fv-button fv-primary" disabled={v.intentInvalid} onClick={v.submitIntent}>Compare funding sources →</button></div>
  </div>;
}
