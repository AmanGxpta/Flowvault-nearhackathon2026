// Receipt-derived holder accounting. Vault-owned protocol trades are never personal Rhea trades.
import type {LedgerEntry} from "./contracts.ts";
export interface HolderVaultConfig {asset_id:string;asset_decimals:number;share_decimals:number;share_symbol:string;curator_id:string;platform_id:string}
const raw=(v:unknown):string=>{if(typeof v!=="string"||!/^\d+$/.test(v))throw new Error("Invalid vault event amount.");return v;};
export function holderVaultLedger(result:any,contractId:string,accountId:string,c:HolderVaultConfig,at:string):LedgerEntry[]{
 if(result?.final_execution_status!=="FINAL"||!result.transaction?.hash||!Array.isArray(result.receipts_outcome))throw new Error("Vault receipt is not finalized.");
 if(c.asset_id!=="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"||c.asset_decimals!==6||c.share_decimals!==18)throw new Error("Unsupported vault identity or precision.");
 const events:{r:string;i:number;e:any;d:any;k:number}[]=[];
 const transfers:{from:string;to:string;amount:bigint}[]=[];
 for(const r of result.receipts_outcome){
  if(!r.id||typeof r.outcome?.status?.SuccessValue!=="string")continue;
  for(const [i,l] of (r.outcome.logs??[]).entries()){
   if(typeof l!=="string"||!l.startsWith("EVENT_JSON:"))continue;
   let e:any;try{e=JSON.parse(l.slice(11));}catch{throw new Error("Malformed finalized vault event.");}
   if(!Array.isArray(e.data))continue;
   if(r.outcome.executor_id===c.asset_id&&e.standard==="nep141"&&e.event==="ft_transfer")for(const d of e.data)transfers.push({from:d.old_owner_id,to:d.new_owner_id,amount:BigInt(raw(d.amount))});
   if(r.outcome.executor_id===contractId&&e.standard==="flowvault_vault"&&e.version==="1.0.0")e.data.forEach((d:any,k:number)=>events.push({r:r.id,i,e,d,k}));
  }
 }
 const out:LedgerEntry[]=[];
 const paid=new Map<string,bigint>();
 for(const x of events){const {d,e}=x;const mine=d.owner_id===accountId;
  const add=(suffix:string,kind:LedgerEntry["kind"],amount:string,shares:boolean,basis:string,value:string|null=null,effect:string|null="0")=>out.push({id:`vault:${contractId}:${x.r}:${x.i}:${x.k}:${accountId}:${suffix}`,at,kind,asset:shares?`${c.share_symbol} (${contractId})`:"USDC",chain:"near",amountRaw:raw(amount),decimals:shares?18:6,usdcRaw:value,netWorthEffectUsdcRaw:effect,liabilityEffectUsdcRaw:"0",realized:true,basis:`Vault ${contractId} · ${accountId} · ${basis}`,status:"confirmed",positionId:`vault:${contractId}:${accountId}`,txHashes:[result.transaction.hash],source:"live"});
  if(mine&&e.event==="deposit_queued"){
   const a=raw(d.assets_raw);const available=transfers.filter(t=>t.from===accountId&&t.to===contractId).reduce((n,t)=>n+t.amount,0n);const used=paid.get("deposit")??0n;
   if(used+BigInt(a)>available)throw new Error("Queued deposit lacks underlying transfer proof.");paid.set("deposit",used+BigInt(a));
   add("deposit","internal_transfer",a,false,"USDC queued outside NAV; no shares issued yet",a);
  }
  if(mine&&e.event==="deposit_settled")add("shares","position_entry",raw(d.shares_raw),true,"Share issuance; principal converted from queued USDC, no new contribution",raw(d.assets_raw));
  if(mine&&e.event==="redemption_requested")add("queue","internal_transfer",raw(d.shares_raw),true,"Shares escrowed for FIFO redemption; still in supply");
  if(mine&&e.event==="redemption_settled")add("redeem","position_exit",raw(d.shares_burned_raw),true,"Shares burned into fixed claim outside NAV; not wallet cash",raw(d.claimable_assets_raw));
  if(mine&&e.event==="claim_completed"){
   const a=raw(d.assets_raw);const available=transfers.filter(t=>t.from===contractId&&t.to===accountId).reduce((n,t)=>n+t.amount,0n);const used=paid.get("claim")??0n;
   if(used+BigInt(a)>available)throw new Error("Claim lacks exact underlying payout proof.");paid.set("claim",used+BigInt(a));
   add("claim","internal_transfer",a,false,"Fixed claim paid to wallet; principal moved once",a);
  }
  if(e.event==="fee_minted"){
   for(const [role,recipient,field] of [["curator",c.curator_id,"curator_shares_raw"],["platform",c.platform_id,"platform_shares_raw"]] as const)if(accountId===recipient&&BigInt(raw(d[field]))>0n)add(role,"incentive",d[field],true,`${role} performance-fee shares minted; historical USDC value unavailable`,null,null);
   if(accountId!==c.curator_id&&accountId!==c.platform_id){
    add("holder-fee-allocation","fee",(BigInt(raw(d.curator_shares_raw))+BigInt(raw(d.platform_shares_raw))).toString(),true,"Vault-wide fee issuance, NOT your personal quantity: historical holder dilution cannot be attributed from this receipt; excluded from realized totals",null,null);
    Object.assign(out[out.length-1],{status:"unresolved",realized:false});
   }
  }
 }
 return out;
}
