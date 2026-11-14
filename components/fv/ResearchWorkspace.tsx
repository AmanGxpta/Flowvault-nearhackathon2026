"use client";
import {useEffect,useState} from "react";
import {Lock,Plus,Share2} from "lucide-react";
import {LockedPreview,PreviewRows} from "./Locked";
import {useWatchlist} from "./useWatchlist";
import {researchAddress} from "@/lib/flowvault/research";
import {useTokenCatalog} from "./useTokenCatalog";
import {NetworkLabel} from "./AssetIdentity";
import {WatchedWallet} from "./WatchedWallet";
import {MarketScreener} from "./MarketScreener";
import {TokenPage} from "./TokenPage";
// Watching tokens and wallets belongs to a connected account and is saved with it, so it follows the account to every
// device (useWatchlist). Without a wallet (outside Demo Mode) Discover stays open, but the Watchlist and Wallets tabs
// are locked and starring or watching asks to connect. Nothing is saved for a visitor.
export function ResearchWorkspace({owner,example,buy,shareCard,locked=false,connect,demo}:{owner:string;example:boolean;buy:(id:string)=>void;shareCard?:(card:{title:string;subtitle:string;lines:string[]})=>void;locked?:boolean;connect?:()=>void;demo?:()=>void}){
  const {tokens}=useTokenCatalog();
  const list=useWatchlist({owner,example,locked}),data=list.data,storageKey=example?"example":owner;
  const [tab,setTab]=useState("Discover"),[selected,setSelected]=useState(""),[adding,setAdding]=useState(false),[message,setMessage]=useState(""),[shared,setShared]=useState<string[]>([]);
  const [form,setForm]=useState({network:"near",address:"",label:"",notes:""});
  useEffect(()=>{const timer=setTimeout(()=>{const ids=new URL(location.href).searchParams.get("list")?.split(",")??[];setShared(ids.slice(0,100));},0);return()=>clearTimeout(timer);},[]);
  const ask=()=>connect?.();
  // Every change goes through the watchlist: shown at once, saved with the account (example: this browser).
  const change=(op:Parameters<typeof list.apply>[0],debounce?:string)=>{if(locked){ask();return;}void list.apply(op,debounce).catch(()=>{});};
  async function add(){if(locked){ask();return;}try{const id=form.network+":"+researchAddress(form.network,form.address);await list.apply({op:"watch_wallet",network:form.network,address:form.address,label:form.label,notes:form.notes});setSelected(id);setTab("Wallets");setAdding(false);setForm({network:"near",address:"",label:"",notes:""});setMessage("");}catch(e){setMessage((e as Error).message);}}
  // Watchlist ids are "<chain>:<address>" in DexScreener chain names; older catalog ids (eth:/arb:/sol:) map across.
  const toMarket=(id:string)=>{const i=id.indexOf(":"),n=id.slice(0,i);return ({eth:"ethereum",arb:"arbitrum",sol:"solana",bnb:"bsc"} as Record<string,string>)[n]?({eth:"ethereum",arb:"arbitrum",sol:"solana",bnb:"bsc"} as Record<string,string>)[n]+id.slice(i):id;};
  const watchIds=data.saved.map(toMarket);
  const marketKey=(t:{chain:string;address:string})=>t.chain+":"+t.address;
  function toggleWatch(id:string){const raw=data.saved.find(x=>toMarket(x).toLowerCase()===id.toLowerCase());change(raw?{op:"unstar",id:raw}:{op:"star",id});}
  const [openToken,setOpenToken]=useState<{chain:string;address:string;symbol?:string}|null>(null);
  useEffect(()=>{const apply=()=>{const t=new URL(location.href).searchParams.get("token");if(t&&t.includes(":")){const i=t.indexOf(":");setOpenToken({chain:t.slice(0,i),address:t.slice(i+1)});setTab("Discover");}};const timer=setTimeout(apply,0);window.addEventListener("fv-prefill",apply);return()=>{clearTimeout(timer);window.removeEventListener("fv-prefill",apply);};},[]);
  function openMarket(t:{chain:string;address:string;symbol?:string}|null){setOpenToken(t);const u=new URL(location.href);if(t)u.searchParams.set("token",t.chain+":"+t.address);else u.searchParams.delete("token");history.replaceState(null,"",u);window.scrollTo({top:0});}
  async function share(){const ids=tokens.filter(t=>data.saved.includes(t.id)).map(t=>t.id).slice(0,100);const u=new URL(location.pathname,location.origin);u.searchParams.set("view","research");u.searchParams.set("list",ids.join(","));try{await navigator.clipboard.writeText(u.href);setMessage("Token watchlist link copied. Wallets and private notes are excluded.");}catch{setMessage("Copy this token-only watchlist link: "+u.href);}}
  const wallet=data.wallets.find(w=>w.id===selected)??data.wallets[0];
  return <>
    <div className="fv-page-heading"><div><h1>Markets</h1><p>Live prices, liquidity and flow. Follow tokens and wallets, then act inside your plan.</p></div><button className="fv-button fv-primary" onClick={()=>locked?ask():setAdding(!adding)}>{locked?<Lock size={15}/>:<Plus size={16}/>}Watch a wallet</button></div>
    {(message||list.error)&&<p role="status" className="fv-notice">{message||list.error}</p>}
    {adding&&<section className="fv-panel fv-form fv-watch-add"><h2>Watch a public wallet</h2><p className="fv-muted">Save an address and a private note. This never connects the wallet or grants spending access.</p><div className="fv-form-columns"><label>Network<select value={form.network} onChange={e=>setForm({...form,network:e.target.value})}><option value="near">NEAR · tokens & positions</option><option value="base">Base · USDC only</option><option value="arb">Arbitrum · USDC only</option><option value="eth">Ethereum · explorer</option></select></label><label>Public address<input value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder={form.network==="near"?"paul.near":"0x…"}/></label><label>Label<input value={form.label} maxLength={80} onChange={e=>setForm({...form,label:e.target.value})} placeholder="A name you recognize"/></label></div><label>Private note<textarea value={form.notes} maxLength={1000} onChange={e=>setForm({...form,notes:e.target.value})}/></label><div className="fv-actions"><button className="fv-button" onClick={()=>setAdding(false)}>Cancel</button><button className="fv-button fv-primary" onClick={add}>Watch wallet</button></div></section>}
    <div className="fv-section-head"><div className="fv-tabs" role="tablist">{["Discover","Watchlist","Wallets"].map(t=><button role="tab" aria-selected={tab===t} key={t} onClick={()=>setTab(t)}>{locked&&t!=="Discover"&&<Lock size={12} className="fv-tab-lock"/>}{t}{t==="Wallets"&&data.wallets.length?" ("+data.wallets.length+")":""}</button>)}</div><button className="fv-button" disabled={locked||!data.saved.length} onClick={()=>void share()}><Share2 size={14}/>Share tokens</button></div>
    {locked&&tab!=="Discover"?<LockedPreview compact connect={ask} demo={demo} label={tab==="Wallets"?"Watched wallets, locked until a wallet is connected":"Your watchlist, locked until a wallet is connected"}
      title={tab==="Wallets"?"Watching wallets needs a connected wallet":"Your watchlist is locked"}
      body={tab==="Wallets"?"Connect a wallet to follow public accounts with your own labels and private notes, and see their tokens, allocation and recent activity. Watched wallets are read only and never count as yours.":"Connect a wallet to star tokens and follow their price, liquidity and flow in one list, here and on Research. Discover stays open to everyone."}
      preview={tab==="Wallets"?<PreviewRows rows={[["paul.near","NEAR · tokens and positions","$182,400"],["Treasury multisig","Base · USDC","$48,120"],["0x7a3…c19e","Ethereum · explorer","$12,960"]]}/>:<PreviewRows rows={[["wNEAR","NEAR · $3.33","−7.6%"],["PEARL","NEAR · $1.54","+7.9%"],["ETH","Ethereum · $3,412","+1.2%"],["SOL","Solana · $168.40","−2.1%"]]}/>}/>
    :!list.loaded?<p>Reading your watchlist…</p>:tab==="Wallets"?<>{wallet?<div className="fv-watch-layout"><aside className="fv-panel fv-watch-sidebar">{data.wallets.map(w=><button key={w.id} aria-pressed={w.id===wallet.id} className="fv-watch-choice" onClick={()=>setSelected(w.id)}><NetworkLabel network={w.network}/><strong>{w.label}</strong><small className="fv-address">{w.address}</small></button>)}<details className="fv-watch-manage"><summary>Manage {wallet.label}</summary><label>Label<input maxLength={80} value={wallet.label} onChange={e=>change({op:"update_wallet",id:wallet.id,label:e.target.value},wallet.id+":label")}/></label><label>Private notes<textarea maxLength={1000} value={wallet.notes} onChange={e=>change({op:"update_wallet",id:wallet.id,notes:e.target.value},wallet.id+":notes")}/></label><button className="fv-button" onClick={()=>{change({op:"unwatch_wallet",id:wallet.id});setSelected("");}}>Stop watching</button></details></aside><section className="fv-panel"><WatchedWallet key={wallet.id+storageKey} wallet={wallet} example={example} buy={buy}/></section></div>:<section className="fv-panel fv-empty"><h2>Keep interesting wallets in sight</h2><p>Add paul.near or another public account to explore its indexed tokens, allocation and recent activity.</p><button className="fv-button fv-primary" onClick={()=>setAdding(true)}>Watch your first wallet</button></section>}</>:<>
      {!!shared.length&&<section className="fv-shared-list-banner"><p>A shared token watchlist. Addresses and private notes are excluded.</p><button className="fv-button fv-primary" onClick={()=>{if(locked){ask();return;}change({op:"import",data:{saved:tokens.filter(t=>shared.includes(t.id)).map(t=>t.id)}});setShared([]);setTab("Watchlist");const u=new URL(location.href);u.searchParams.delete("list");history.replaceState(null,"",u);}}>Save tokens</button><button className="fv-button" onClick={()=>setShared([])}>Browse all</button></section>}
      {openToken ? <TokenPage token={openToken} back={()=>openMarket(null)} buy={buy} watched={watchIds.includes(marketKey(openToken))} toggleWatch={()=>toggleWatch(marketKey(openToken))} share={shareCard}/>
        : <MarketScreener key={tab} watchOnly={tab==="Watchlist"} watch={watchIds} toggleWatch={toggleWatch} open={r=>openMarket({chain:r.chain,address:r.address,symbol:r.symbol})} buy={buy}/>}
    </>}
    <p className="fv-muted fv-fineprint">{locked?"Discover is public. Your watchlist, watched wallets and notes are saved with your connected account.":example?"Example watchlist, kept in this browser.":"Your watchlist, watched wallets and notes are saved with your account and follow you to every device."} Listings aren’t endorsements.</p>
  </>;
}
