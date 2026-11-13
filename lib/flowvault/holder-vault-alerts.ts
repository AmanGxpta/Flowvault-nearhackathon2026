import type {Candidate} from "./monitor.ts";
export interface MonitoredVault {contractId:string;config:{max_nav_age_ms:string;capacity_raw:string};nav:{nav_raw:string|null;pending_deposits_raw:string;liquid_assets_raw:string;report:{observed_at_ms:string}|null;report_required:boolean;busy:unknown;unresolved?:unknown;reasons:string[]};requests:{kind:string;status:string;not_before_ms:string;claimable_raw:string}[]}
/** Uses contract figures, not an alternate NAV engine. Failed reads are handled by the monitor group. */
export function holderVaultAlerts(vaults:MonitoredVault[],now:number):Candidate[]{
 const out:Candidate[]=[];
 for(const v of vaults){
  const add=(condition:string,severity:Candidate["severity"],message:string)=>out.push({dedupeKey:`vault_attention:${v.contractId}:${condition}`,kind:"vault_attention",severity,message:`Vault ${v.contractId}: ${message}`,figures:[{label:"Vault account",value:v.contractId,engine:"vault get_config/get_nav"},{label:"Liquid USDC (raw)",value:v.nav.liquid_assets_raw,engine:"vault get_nav"},{label:"NAV USDC (raw)",value:v.nav.nav_raw,engine:"vault get_nav"}]});
  const observed=v.nav.report?BigInt(v.nav.report.observed_at_ms):null;
  if(observed===null||BigInt(now)<observed||BigInt(now)-observed>BigInt(v.config.max_nav_age_ms)||v.nav.report_required||v.nav.reasons.some(r=>r.includes("STALE")||r.includes("REPORT_REQUIRED")))add("nav","warn","NAV is stale or needs a fresh report. Share pricing and new deposits must wait.");
  if(v.nav.unresolved||v.nav.reasons.some(r=>/UNRESOLVED/.test(r)))add("operation","urgent","An operation is unresolved. New deployment is frozen; verified-liquid exits require the contract’s reconciliation flow. Check receipts before retrying.");
  else if(v.nav.busy)add("operation","info","An operation is awaiting reconciliation. Track its receipt before starting another.");
  const due=v.requests.filter(r=>r.kind==="redemption"&&r.status==="queued"&&BigInt(r.not_before_ms)<=BigInt(now));
  if(due.length)add("queue","warn",`${due.length} redemption request${due.length===1?" is":"s are"} past notice and still queued. FIFO settlement depends on fresh NAV, minimum proceeds and verified liquid USDC.`);
  if(v.nav.nav_raw!==null&&BigInt(v.nav.nav_raw)+BigInt(v.nav.pending_deposits_raw)>=BigInt(v.config.capacity_raw))add("capacity","info","Deposit capacity is reached. Do not send another deposit until capacity is available.");
 }
 return out;
}
