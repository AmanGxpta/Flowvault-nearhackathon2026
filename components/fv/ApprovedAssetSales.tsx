"use client";
import {explainVenueReason} from "@/lib/flowvault/lending-venue-messages";
import {useState} from "react";
import type {LinkedAccount} from "@/lib/flowvault/types";
import type {VenueAsset} from "@/lib/flowvault/contracts";
import {AAVE_MARKETS,type AaveChain} from "@/lib/flowvault/aave-markets";
import {units} from "@/lib/flowvault/money";
import {api,type Scope} from "./live";
import {openPlan} from "./PlanDock";
const NEAR:VenueAsset[]=[{id:"wrap.near",symbol:"wNEAR",decimals:24,chain:"near"},{id:"linear-protocol.near",symbol:"LiNEAR",decimals:24,chain:"near"},{id:"lst.rhealab.near",symbol:"rNEAR",decimals:24,chain:"near"},{id:"usdt.tether-token.near",symbol:"USDT",decimals:6,chain:"near"}];
/** Explicit asset policy approval. No sale is authorized by opening or saving this form. */
export function ApprovedAssetSales({scope,accounts}:{scope:Scope;accounts:LinkedAccount[]}){
  const [chain,setChain]=useState<"near"|AaveChain>("near"),[token,setToken]=useState("wrap.near"),[qty,setQty]=useState(""),[maxValue,setMaxValue]=useState(""),[slippage,setSlippage]=useState("100"),[priority,setPriority]=useState("P2"),[net,setNet]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const assets=chain==="near"?NEAR:AAVE_MARKETS[chain].collateral,asset=assets.find(a=>a.id===token)??assets[0];
  async function configure(){setBusy(true);setMessage("");try{
    const r=await api("/api/policy",undefined,"GET",scope),policy=r.policy;
    if(!asset||!qty||!maxValue)throw new Error("Choose an asset, maximum quantity and maximum USDC value.");
    const old=policy.assetRows?.find((x:any)=>x.asset===asset.symbol&&x.chain===chain);
    const sale={tokenId:asset.id,decimals:asset.decimals,maxQuantityRaw:units(qty,asset.decimals).toString(),maxValueUsdc:maxValue,maxSlippageBps:Number(slippage)};
    const row={...(old??{}),asset:asset.symbol,chain,priority,uses:[...new Set([...(old?.uses??["hold"]),"sell"])],sale};
    const methods=chain==="near"?[{receiver:asset.id,method:"ft_transfer"},{receiver:asset.id,method:"ft_transfer_call"}]:[{receiver:asset.id,method:"0xa9059cbb"}];
    const venues=chain==="near"?["1click","v2.ref-finance.near"]:["1click"];
    await api("/api/policy",{revision:r.revision,policy:{...policy,assetRows:[...(policy.assetRows??[]).filter((x:any)=>!(x.asset===asset.symbol&&x.chain===chain)),row],venues:[...new Set([...policy.venues,...venues])],methods:[...policy.methods,...methods.filter(m=>!policy.methods.some((x:any)=>x.receiver===m.receiver&&x.method===m.method))]}},"PUT",scope);
    setMessage("Sale permission saved as a new policy revision. Protected assets stay protected. Refresh your plan before execution.");
    window.dispatchEvent(new Event("fv:plans-refresh"));
  }catch(e){setMessage(explainVenueReason((e as Error).message));}finally{setBusy(false);}}
  async function plan(){setBusy(true);setMessage("");try{const r=await api("/api/sales",{action:"plan",key:crypto.randomUUID(),netUsdcRaw:units(net).toString()},"POST",scope);openPlan({plan:r.plan});}catch(e){setMessage(explainVenueReason((e as Error).message));}finally{setBusy(false);}}
  return <section aria-label="Approved asset sale funding" style={{marginTop:20,padding:16,border:"1px solid var(--fvb-E3E6DB)",borderRadius:12,background:"var(--fvb-FFFFFF)",color:"var(--fvc-1E2A22)"}}>
    <h3>Approved asset sales</h3>
    <p>Sell only explicitly approved assets for a net USDC amount. Unsupported or illiquid routes remain unavailable. Acquisition history missing: realized PnL is not computed.</p>
    {scope==="example"?<p>Example mode cannot create live sale permissions or transactions.</p>:<>
      <fieldset disabled={busy}>
        <legend>Approve a sale limit</legend>
        <label>Network <select value={chain} onChange={e=>{const c=e.target.value as typeof chain;setChain(c);setToken((c==="near"?NEAR:AAVE_MARKETS[c].collateral)[0].id);}}><option value="near">NEAR</option><option value="eth">Ethereum</option><option value="base">Base</option><option value="arb">Arbitrum</option></select></label>
        <label>Asset <select value={token} onChange={e=>setToken(e.target.value)}>{assets.map(a=><option value={a.id} key={a.id}>{a.symbol}</option>)}</select></label>
        <label>Maximum quantity <input value={qty} onChange={e=>setQty(e.target.value)} inputMode="decimal" /></label>
        <label>Maximum value (USDC) <input value={maxValue} onChange={e=>setMaxValue(e.target.value)} inputMode="decimal" /></label>
        <label>Slippage limit (basis points) <input value={slippage} onChange={e=>setSlippage(e.target.value)} inputMode="numeric" /></label>
        <label>Sale priority <select value={priority} onChange={e=>setPriority(e.target.value)}><option>P1</option><option>P2</option><option>P3</option></select></label>
        <p>Saving explicitly allows this token’s sale transfer methods on 1Click{chain==="near"?" and Rhea/Ref":""}. Each sale still needs a fresh review and owner wallet signature.</p>
        <button onClick={configure}>Save sale permission and limits</button>
      </fieldset>
      <fieldset disabled={busy||!accounts.some(a=>a.proof)}><legend>Compare exact net proceeds</legend><label>USDC needed in your NEAR account <input value={net} onChange={e=>setNet(e.target.value)} inputMode="decimal" /></label><button onClick={plan}>Compare approved sale sources</button></fieldset>
      <p>Calendar payment plans compare sales with cash, withdrawals and eligible borrowing. Proceeds and leftovers need finalized proof before the sale step completes. Recover uncertain hashes through Activity; never resubmit a sale blindly.</p>
    </>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
