"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronDown, CircleAlert, Info, Layers3, Plus, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { ApprovedAssetSales } from "./ApprovedAssetSales";
import { explainVenueReason } from "@/lib/flowvault/lending-venue-messages";
import type { LendingVenueSnapshot, VenueAsset } from "@/lib/flowvault/contracts";
import type { LinkedAccount } from "@/lib/flowvault/types";
import { decimal } from "@/lib/flowvault/money";
import { borrowAprLabel, borrowHealth, collateralValue } from "@/lib/flowvault/borrow-display";
import { AAVE_MARKETS, type AaveChain } from "@/lib/flowvault/aave-markets";
import { api, type Scope } from "./live";
import { openPlan } from "./PlanDock";
import { TokenIcon } from "./AssetIdentity";
import { RheaSheet, type RheaAction } from "./RheaSheet";
import { ago, fmtAmount } from "./swap-format";

const MARKETS = [{id:"rhea",name:"Rhea",network:"NEAR",symbol:"RHEA"},{id:"eth",name:"Aave v3",network:"Ethereum",symbol:"ETH"},{id:"base",name:"Aave v3",network:"Base",symbol:"ETH"},{id:"arb",name:"Aave v3",network:"Arbitrum",symbol:"ETH"}];
const short = (s:string) => s.length > 22 ? s.slice(0,10)+"…"+s.slice(-6) : s;
const positive = (s:string|null|undefined) => typeof s === "string" && /^\d+$/.test(s) && BigInt(s)>0n;
const quantity = (raw:string,decimals:number) => /^\d+$/.test(raw) ? fmtAmount(decimal(BigInt(raw),decimals),4) : "Unavailable";
function usdc(raw:string|null|undefined) {
  if(typeof raw !== "string" || !/^\d+$/.test(raw)) return "Unavailable";
  const n=Number(decimal(BigInt(raw))); return n>0 && n<.01 ? "<0.01" : n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}

/** Presentation only: the existing action sheets, PlanDock and journals still own every check and signature. */
export function LendingVenues({ scope, accounts = [], expanded = false, hideSales = false, simulate, connect, permissions }: { scope: Scope; accounts?: LinkedAccount[]; expanded?: boolean; hideSales?: boolean; simulate?:()=>void; connect?:()=>void; permissions?:()=>void }) {
  const [snapshot,setSnapshot]=useState<LendingVenueSnapshot|null>(null), [message,setMessage]=useState("");
  const [noticeKind,setNoticeKind]=useState<"read"|"plan">("read");
  const [busy,setBusy]=useState(false), [planning,setPlanning]=useState(false), [opened,setOpened]=useState(expanded);
  const [venue,setVenue]=useState("rhea"), [account,setAccount]=useState("");
  const [kind,setKind]=useState("borrow"), [asset,setAsset]=useState("USDC"), [amount,setAmount]=useState(""), [form,setForm]=useState(false);
  const [sheet,setSheet]=useState<{token:VenueAsset;action:RheaAction}|null>(null), [now,setNow]=useState(()=>Date.now());
  const request=useRef(0), formId=useId();
  const evm=accounts.filter(a=>a.chain==="evm" && a.proof?.method==="siwe");
  const market=MARKETS.find(m=>m.id===venue)!;
  const load=useCallback(async()=>{
    const version=++request.current;
    if(venue!=="rhea" && !account){setBusy(false);setSnapshot(null);setMessage("");return;}
    setBusy(true);setMessage("");setNoticeKind("read");
    try {
      const path=venue==="rhea" ? "/api/lending" : `/api/lending/venues?chain=${venue}&account=${encodeURIComponent(account)}`;
      const r=await api(path,undefined,"GET",scope);
      if(version!==request.current)return;
      const next=r.venueSnapshot ?? r.snapshot ?? null;
      setSnapshot(next);setNow(Date.now());setMessage(next ? "" : (r.reasons??[]).map(explainVenueReason).join(" · "));
    }catch(e){if(version===request.current){setSnapshot(null);setMessage(explainVenueReason((e as Error).message));}}
    finally{if(version===request.current)setBusy(false);}
  },[venue,account,scope]);
  useEffect(()=>{if(!opened)return;const t=setTimeout(()=>void load(),0);return()=>{clearTimeout(t);request.current++;};},[load,opened]);
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(t);},[]);
  const stale=!!snapshot && (!Number.isFinite(Date.parse(snapshot.freshUntil)) || Date.parse(snapshot.freshUntil)<=now);
  const active=snapshot?.positions.filter(p=>[p.suppliedRaw,p.collateralRaw,p.liabilityRaw].some(positive))??[];
  const walletCollateral=snapshot?.positions.filter(p=>positive(p.walletRaw) && snapshot.collateralAssets.some(a=>a.id===p.asset.id))??[];
  const health=snapshot ? borrowHealth(snapshot) : null;
  const issues=[...new Set((snapshot?.reasons??[]).map(explainVenueReason))];
  const hasCollateral=!!snapshot?.positions.some(p=>positive(p.collateralRaw));
  const debt=positive(snapshot?.debtUsdcRaw), capacity=positive(snapshot?.stressedCapacityUsdcRaw);
  const unavailable=!snapshot || busy || stale || scope!=="personal";
  const debtToken=snapshot?.debtAssets[0];
  const needsRead=stale || snapshot?.stressedCapacityUsdcRaw===null;
  const needsLimits=hasCollateral && !capacity && !needsRead;
  const collateralToken=walletCollateral[0]?.asset ?? snapshot?.collateralAssets.find(a=>a.id==="wrap.near") ?? snapshot?.collateralAssets[0];
  function chooseMarket(id:string){request.current++;setVenue(id);if(id!=="rhea")setAccount(previous=>evm.some(a=>a.address===previous)?previous:evm[0]?.address??"");setSnapshot(null);setMessage("");setForm(false);setAmount("");setAsset("USDC");}
  function operate(action:RheaAction,token?:VenueAsset){
    if(!token || unavailable)return;
    if(venue==="rhea"){setSheet({token,action});return;}
    setKind(action);setAsset(token.symbol);setAmount("");setForm(true);
    setTimeout(()=>document.getElementById(formId)?.scrollIntoView({behavior:"smooth",block:"center"}),0);
  }
  async function plan(){
    setPlanning(true);setMessage("");setNoticeKind("plan");
    try {const r=await api("/api/lending/venues",{action:"plan",chain:venue,account,kind,asset,amount,key:crypto.randomUUID()},"POST",scope);openPlan({plan:r.plan});}
    catch(e){setMessage(explainVenueReason((e as Error).message));}finally{setPlanning(false);}
  }
  const chain=venue as AaveChain;
  const assets=AAVE_MARKETS[chain] ? (kind==="borrow" || kind==="repay" ? [AAVE_MARKETS[chain].debt] : AAVE_MARKETS[chain].collateral) : [];
  const heading=<><span className="fv-borrow-heading-icon"><Layers3 size={20}/></span><span><strong>Your borrowing account</strong><small>Collateral, loans and what you can do next</small></span></>;
  const body=<div className="fv-borrow-body">
    <div className="fv-borrow-toolbar">
      <label className="fv-borrow-market"><span>Market</span><div><TokenIcon symbol={market.symbol} network={venue==="rhea"?"near":venue} core size={30}/><select aria-label="Lending market" value={venue} onChange={e=>chooseMarket(e.target.value)}>{MARKETS.map(m=><option key={m.id} value={m.id}>{m.name} · {m.network}</option>)}</select><ChevronDown size={15}/></div></label>
      {venue!=="rhea" && <label className="fv-borrow-wallet"><span>Wallet</span><select value={account} aria-label="Lending wallet" onChange={e=>{request.current++;setAccount(e.target.value);setSnapshot(null);setMessage("");setForm(false);}}><option value="">Choose a verified wallet</option>{evm.map(a=><option key={a.id} value={a.address}>{a.label} · {short(a.address)}</option>)}</select></label>}
      <div className="fv-borrow-read"><span role="status">{busy ? "Updating account…" : snapshot ? <><i className={stale?"is-stale":""}/>{scope==="example" ? "Example data" : stale ? "Refresh needed" : `Updated ${ago(snapshot.capturedAt)}`}</> : ""}</span><button type="button" className="fv-button" aria-label="Refresh borrowing account" title="Refresh borrowing account" disabled={busy || venue!=="rhea"&&!account} onClick={()=>void load()}><RefreshCw size={15} className={busy?"fv-spin":""}/><span>Refresh</span></button></div>
    </div>
    {scope==="example" && <p className="fv-notice">Example workspace · borrowing and collateral actions are unavailable.</p>}
    {message && <div className="fv-borrow-alert" role="alert"><CircleAlert size={18}/><div><strong>{noticeKind === "plan" ? "This operation needs attention" : "We couldn’t load this account"}</strong><p>{message}</p></div>{connect && /connect|account|wallet|prove|sign in/i.test(message) && <button type="button" className="fv-button" onClick={connect}>Connect wallet</button>}</div>}
    {!snapshot && !message && !busy && <div className="fv-borrow-empty"><Wallet size={28}/><h3>{venue!=="rhea"&&!account?"Choose the wallet you borrow with":"Your borrowing account will appear here"}</h3><p>{venue!=="rhea"&&!account?"Balances and health are separate for every wallet and network.":"Refresh to read collateral, borrowing capacity and existing loans."}</p>{venue!=="rhea"&&!evm.length && connect && <button type="button" className="fv-button" onClick={connect}>Connect an EVM wallet</button>}</div>}
    {(snapshot || busy) && <>
      <div className="fv-borrow-metrics" aria-busy={busy}>
        <section className="fv-borrow-metric is-primary"><span>Available to borrow <Info size={13} aria-label="Capacity after your configured price stress and credit limits"/></span><strong>{snapshot?usdc(snapshot.stressedCapacityUsdcRaw):"—"}<small>{snapshot?.stressedCapacityUsdcRaw!=null?" USDC":""}</small></strong><p>{!snapshot?"Reading borrowing capacity…":snapshot.stressedCapacityUsdcRaw===null?"Capacity could not be verified":hasCollateral?"After price stress and your credit limits":"Add collateral to unlock borrowing"}</p></section>
        <section className="fv-borrow-metric"><span>Your debt</span><strong>{snapshot?usdc(snapshot.debtUsdcRaw):"—"}<small>{snapshot?.debtUsdcRaw!=null?" USDC":""}</small></strong><p>{!snapshot?"Reading debt balance…":snapshot.debtUsdcRaw===null?"Debt could not be verified":debt?"Includes accrued interest":"No outstanding USDC loan"}</p></section>
        <section className={"fv-borrow-metric is-"+(health?.tone??"unknown")}><span>Health factor <ShieldCheck size={13}/></span><strong>{health?.label??"—"}</strong><p>{health?.detail??"Reading account health…"}</p></section>
        <section className="fv-borrow-metric"><span>Borrow APR · USDC</span><strong>{snapshot?borrowAprLabel(snapshot.borrowApr):"—"}</strong><p>Variable annual rate</p></section>
      </div>
      <div className="fv-borrow-account-line"><span><Wallet size={13}/>{snapshot?short(snapshot.accountId):"Reading wallet…"}</span><span>{market.name} · {market.network}</span><span>Collateral value <strong>{snapshot?usdc(collateralValue(snapshot)):"—"} {snapshot?"USDC":""}</strong></span></div>
      {stale && <div className="fv-borrow-alert" role="status"><CircleAlert size={17}/><p>This snapshot has expired. Refresh before reviewing an operation.</p></div>}
      {snapshot && <div className="fv-borrow-workspace">
        <section className="fv-borrow-positions">
          <div className="fv-section-head"><div><h3>Your positions</h3><p>{active.length?`${active.length} asset${active.length===1?"":"s"} in this market`:"Get started with collateral"}</p></div><span className="fv-chip">{market.network}</span></div>
          {active.length ? <><div className="fv-borrow-table-head"><span>Asset</span><span>Supplied</span><span>Collateral</span><span>Borrowed</span><span>Manage</span></div>{active.map(p=><article className="fv-borrow-position" key={p.asset.id}><div className="fv-asset-cell"><TokenIcon symbol={p.asset.symbol} network={venue==="rhea"?"near":venue} core size={32}/><div><strong>{p.asset.symbol}</strong><small>{market.name}</small></div></div><div><small>Supplied</small><strong>{quantity(p.suppliedRaw,p.asset.decimals)}</strong></div><div><small>Collateral</small><strong>{quantity(p.collateralRaw,p.asset.decimals)}</strong></div><div><small>Borrowed</small><strong>{quantity(p.liabilityRaw,p.asset.decimals)}</strong></div><div className="fv-borrow-row-actions">{positive(p.liabilityRaw)&&<button type="button" className="fv-text-button" disabled={unavailable} onClick={()=>operate("repay",p.asset)}>Repay <ArrowDownLeft size={12}/></button>}{positive(p.collateralRaw)&&<button type="button" className="fv-text-button" disabled={unavailable} onClick={()=>operate("collateral_release",p.asset)}>Release <ArrowUpRight size={12}/></button>}{!positive(p.liabilityRaw)&&!positive(p.collateralRaw)&&snapshot.collateralAssets.some(t=>t.id===p.asset.id)&&<button type="button" className="fv-text-button" disabled={unavailable} onClick={()=>operate("collateral_add",p.asset)}>Add collateral</button>}</div></article>)}</> : <div className="fv-borrow-empty"><span className="fv-borrow-empty-icon"><Layers3 size={24}/></span><h3>No lending positions here yet</h3><p>Add collateral to this market, then review how much USDC you can borrow. It stays exposed to liquidation while a loan is open.</p><div className="fv-borrow-token-options">{(walletCollateral.length?walletCollateral.map(p=>p.asset):snapshot.collateralAssets).map(t=><button key={t.id} type="button" className="fv-button" disabled={unavailable} onClick={()=>operate("collateral_add",t)}><TokenIcon symbol={t.symbol} core size={20}/>{t.symbol}<Plus size={12}/></button>)}</div><small>{walletCollateral.length?"Supported collateral in your wallet":"Supported collateral · a wallet balance is required"}</small></div>}
        </section>
        <aside className={"fv-borrow-next is-"+(health?.tone??"unknown")}>
          <span className="fv-borrow-eyebrow">{health?.tone==="danger"||health?.tone==="warning"?"Account needs attention":"Your next step"}</span>
          <h3>{health?.tone==="danger"?"Reduce liquidation risk":health?.tone==="warning"?"Give your loan more room":needsRead?"Refresh your account":!hasCollateral?"Put collateral to work":capacity?"Review a USDC loan":"Check your borrowing limits"}</h3>
          <p>{health?.tone==="danger"||health?.tone==="warning"?"Repay debt or add collateral. Review the updated health factor before signing.":needsRead?"Fresh market data is needed before FlowVault can verify borrowing capacity.":!hasCollateral?"Collateral unlocks borrowing capacity. Start with an asset you already hold.":capacity?"Compare the borrowing cost and the resulting health factor before taking on debt.":issues[0] ?? "Your collateral, credit permissions and price-stress settings determine what you can borrow."}</p>
          {debt&&(health?.tone==="danger"||health?.tone==="warning")?<button type="button" className="fv-button fv-primary" disabled={unavailable} onClick={()=>operate("repay",debtToken)}>Repay USDC <ArrowDownLeft size={15}/></button>:needsRead?<button type="button" className="fv-button fv-primary" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/>Refresh account</button>:needsLimits&&permissions?<button type="button" className="fv-button fv-primary" onClick={permissions}>Review credit limits <ArrowRight size={15}/></button>:capacity?<button type="button" className="fv-button fv-primary" disabled={unavailable} onClick={()=>operate("borrow",debtToken)}>Borrow USDC <ArrowRight size={15}/></button>:<button type="button" className="fv-button fv-primary" disabled={unavailable||!collateralToken} onClick={()=>operate("collateral_add",collateralToken)}><Plus size={15}/>Add collateral</button>}
          {simulate&&<button type="button" className="fv-text-button" onClick={simulate}>Simulate before borrowing <ArrowRight size={13}/></button>}
          {debt&&health?.tone==="safe"&&<button type="button" className="fv-text-button" disabled={unavailable} onClick={()=>operate("repay",debtToken)}>Repay existing debt</button>}
          <small><ShieldCheck size={13}/>Every operation is reviewed before your wallet signs.</small>
        </aside>
      </div>}
    </>}
    {venue!=="rhea" && form && scope==="personal" && <section id={formId} className="fv-borrow-operation"><div className="fv-section-head"><h3>Review an operation</h3><button type="button" className="fv-text-button" onClick={()=>setForm(false)}>Close</button></div><div className="fv-borrow-operation-fields"><label>Action<select value={kind} onChange={e=>{const k=e.target.value;setKind(k);setAsset(k==="borrow"||k==="repay"?"USDC":AAVE_MARKETS[chain].collateral[0].symbol);}}><option value="borrow">Borrow USDC</option><option value="repay">Repay USDC</option><option value="collateral_add">Add collateral</option><option value="collateral_release">Release collateral</option></select></label><label>Asset<select value={asset} onChange={e=>setAsset(e.target.value)}>{assets.map(t=><option key={t.id} value={t.symbol}>{t.symbol}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label><button type="button" className="fv-button fv-primary" onClick={()=>void plan()} disabled={planning||unavailable||!/^\d+(\.\d+)?$/.test(amount)||Number(amount)<=0}>{planning?"Preparing…":"Review operation"}<ArrowRight size={14}/></button></div><p className="fv-muted">WETH is wrapped ETH. Review fees, permissions and the health factor before signing. Borrowing requires explicit approval of the new debt.</p></section>}
    {snapshot && <details className="fv-borrow-risk-details"><summary><Info size={15}/>Risk & market details<ChevronDown size={14}/></summary><div className="fv-borrow-risk-grid"><div><small>Health after price stress</small><strong>{snapshot.stressedHealth==="no debt"?"No debt":snapshot.stressedHealth?fmtAmount(snapshot.stressedHealth,2):"Unavailable"}</strong></div><div><small>Your minimum health</small><strong>{fmtAmount(snapshot.minHealth,2)}</strong></div><div><small>Liquidation threshold</small><strong>{fmtAmount(snapshot.liquidation.thresholdHealth,2)}</strong></div><div><small>Market liquidity</small><strong>{usdc(snapshot.liquidityUsdcRaw)} USDC</strong></div><div><small>Capacity before price stress</small><strong>{usdc(snapshot.currentCapacityUsdcRaw)} USDC</strong></div></div><p>{snapshot.interest.basis}</p>{snapshot.exit.reasons.map((reason,i)=><p key={i}>{reason}</p>)}{issues.length>0&&<div><strong>What affects availability</strong><ul>{issues.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}<p>Posted collateral is not spendable cash. Health is measured for this market and wallet. Submitted and uncertain transactions can be recovered in Activity.</p><small>Read {new Date(snapshot.capturedAt).toLocaleString()} · {snapshot.venueId}</small></details>}
    {!hideSales&&<ApprovedAssetSales scope={scope} accounts={accounts}/>}
    {sheet && <RheaSheet key={sheet.token.id+sheet.action} tokenId={sheet.token.id} symbol={sheet.token.symbol} mode="borrow" initial={sheet.action} close={()=>{setSheet(null);void load();}} onSettled={()=>void load()}/>}
  </div>;
  return expanded ? <section className="fv-panel fv-borrow-account"><header className="fv-borrow-heading">{heading}</header>{body}</section> : <details className="fv-panel fv-borrow-account" open={opened} onToggle={e=>setOpened(e.currentTarget.open)}><summary className="fv-borrow-heading">{heading}<ChevronDown size={16}/></summary>{body}</details>;
}
