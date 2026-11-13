import type {AgentMandate,MandateAuthority} from "./contracts.ts";
import type {ConfigView,OperatorView,NavView} from "./vault-contract.ts";
export const CUSTODY_METHODS=["curator_supply","curator_withdraw"] as const;
export interface CustodyBinding {contractId:string;operatorId:string;publicKey:string;operatorVersion:string;codeHash:string;configDigest:string}
export function checkCustodyKey(permission:any,contractId:string){
 const p=permission?.FunctionCall;
 return !!p&&p.receiver_id===contractId&&Array.isArray(p.method_names)&&p.method_names.length>0&&p.method_names.every((m:string)=>(CUSTODY_METHODS as readonly string[]).includes(m))&&CUSTODY_METHODS.every(m=>p.method_names.includes(m))&&p.allowance!==null&&/^\d+$/.test(p.allowance)&&BigInt(p.allowance)>0n;
}
export function custodyProblems(m:AgentMandate,c:ConfigView,o:OperatorView|null,now:number):string[]{
 const p=o?.policy,out:string[]=[];
 if(!m.scope.strategies.includes("rhea-usdc-surplus")||m.scope.actions.some(a=>a.startsWith("perp_")))out.push("Custody authority supports only the Rhea USDC account strategy.");
 if(m.source!=="live"||c.owner_id!==m.accountId||c.single_depositor!==m.accountId)out.push("Only the owner's live single-depositor vault can authorize this mandate.");
 if(c.asset_id!=="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"||c.asset_decimals!==6||c.share_decimals!==18||c.performance_fee_bps!==0||c.management_fee_bps!==0)out.push("Custody requires native USDC, standard precision and zero fees.");
 if(!p)out.push("Configure the vault's bounded operator policy first.");
 else {
  if(p.paused||BigInt(p.valid_until_ms)<=BigInt(now)||BigInt(p.valid_until_ms)>BigInt(Date.parse(m.validUntil)))out.push("Operator policy must be active and expire within the signed mandate.");
  for(const [v,cap] of [[p.max_per_action_raw,m.limits.perActionUsdcRaw],[p.max_daily_raw,m.limits.dailyUsdcRaw],[p.max_cumulative_raw,m.limits.cumulativeUsdcRaw],[p.max_deployed_raw,m.limits.capitalUsdcRaw]])if(!/^\d+$/.test(v)||BigInt(v)>BigInt(cap))out.push("On-chain operator caps must be no larger than the signed mandate limits.");
  if(BigInt(p.min_idle_raw)<BigInt(m.protection.reserveFloorUsdcRaw))out.push("On-chain idle floor must protect the mandate reserve.");
 }
 if(c.max_position_bps>m.concentration.maxPositionBps||c.max_protocol_bps>m.concentration.maxProtocolBps||c.max_chain_bps>m.concentration.maxChainBps)out.push("On-chain concentration caps must be no larger than signed mandate caps.");
 if(BigInt(c.max_nav_age_ms)>300_000n||BigInt(c.max_nav_age_ms)<10_000n)out.push("NAV evidence must expire within five minutes.");
 return [...new Set(out)];
}
export function boundCustodyAuthority(binding:CustodyBinding,c:ConfigView,now:number):MandateAuthority{
 return {kind:"near_custody_contract",status:"verified",delegate:{address:binding.operatorId,chain:"near",name:binding.contractId},custodyContract:binding,verifiedAt:new Date(now).toISOString(),bounds:[`Pinned contract ${binding.contractId}, operator ${binding.operatorId}, public key ${binding.publicKey}, policy version ${binding.operatorVersion}, code hash ${binding.codeHash}.`,"Only typed Rhea native-USDC supply and withdrawal-to-vault; zero attached deposit from the scoped signer.","Contract enforces per-action, daily, lifetime, gross-supply allowance, idle reserve, concentration and expiry limits.","Unknown operations freeze new risk; no blind retry or fallback to wallet Rhea operations."],unbounded:["NAV is owner/curator-attested; owner reports authorize pricing and fees. It is not independent reserve proof.","Withdrawal returns to the vault, not your wallet. Redemption, verified claim payout and wallet payment are separate steps.","Mandate action-count, loss, quote quality and wallet obligations remain off-chain checks; deposited capital is exposed to protocol and upgrade risk."],custody:`USDC is held by ${binding.contractId}; only depositor ${c.single_depositor} owns shares. No other wallet funds are delegated.`,upgradeAuthority:`Owner ${c.owner_id} and actual full-access keys on ${binding.contractId} can replace code. Disclosed keys: ${c.disclosed_upgrade_keys.join(", ")||"none"}; runtime verifies actual keys and pins code.`};
}
export interface CustodyCall {receiverId:string;methodName:typeof CUSTODY_METHODS[number];args:{amount:string};gas:string;deposit:"0"}
export function custodyCall(m:AgentMandate,o:OperatorView,n:NavView,amount:string,reduce:boolean,now:number):CustodyCall{
 const binding=m.authority.custodyContract,p=o.policy;
 if(!binding||m.authority.status!=="verified"||!p||p.account_id!==binding.operatorId||o.version!==binding.operatorVersion)throw new Error("Custody operator binding changed; review and re-sign the mandate.");
 if(!/^\d+$/.test(amount)||BigInt(amount)<=0n)throw new Error("Choose a positive raw USDC amount.");
 if(n.busy||(n as any).unresolved||n.nav_raw===null||n.report_required||o.liquid_sync_required)throw new Error("Custody evidence is unavailable or an operation needs reconciliation.");
 if(!n.report||BigInt(now)<BigInt(n.report.observed_at_ms)||BigInt(now)-BigInt(n.report.observed_at_ms)>BigInt(m.freshness.evidenceMaxAgeSec)*1000n)throw new Error("Custody NAV report is stale.");
 if(BigInt(p.valid_until_ms)<=BigInt(now)||(!reduce&&p.paused))throw new Error("Custody operator expired or paused.");
 if(!reduce){
  if(n.status!=="running"||BigInt(n.queued_shares)>0n)throw new Error("Custody deployment paused or redemption queue protected.");
  const daily=o.usage_day===(BigInt(now)/86_400_000n).toString()?BigInt(o.daily_used_raw):0n;
  if(BigInt(amount)>BigInt(p.max_per_action_raw)||daily+BigInt(amount)>BigInt(p.max_daily_raw)||BigInt(o.cumulative_used_raw)+BigInt(amount)>BigInt(p.max_cumulative_raw)||BigInt(o.deployed_raw)+BigInt(amount)>BigInt(p.max_deployed_raw)||BigInt(n.liquid_assets_raw)<BigInt(amount)+BigInt(p.min_idle_raw))throw new Error("Custody operator budget or idle reserve would be exceeded.");
 }
 const methodName=reduce?"curator_withdraw":"curator_supply";
 if(!m.scope.methods.some(x=>x.receiver===binding.contractId&&x.method===methodName))throw new Error("Custody method is outside signed scope.");
 return {receiverId:binding.contractId,methodName,args:{amount},gas:"300000000000000",deposit:"0"};
}
