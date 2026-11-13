import {custodyReceiptState} from "./custody-receipts";
import type {AgentMandate,MandateAuditEntry} from "./contracts";
import type {MandateSession,RunResult} from "./mandate-service";
import {mandateDigest,checkAction,type MandateObservation,type ProposedAction} from "./mandate";
import {custodyEvidence,checkedCustody} from "./custody-service";
import {custodyOperations,startCustodyOperation,finishCustodyOperation,type CustodyOperation} from "./custody-journal";
import {signCustodyCall,broadcastCustody} from "./custody-transport";
import {killSwitch,auditAppend} from "./mandate-store";
import {keyedAttemptId} from "./preparation-key";
import {networkRpc,rpc} from "./near";
import {readPriceEvidence} from "./valuation-evidence";
import {usdcValue} from "./valuation";
const min=(...v:bigint[])=>v.reduce((a,b)=>a<b?a:b);
export async function reconcileCustody(o:CustodyOperation){
 try{const r=await networkRpc("EXPERIMENTAL_tx_status",{tx_hash:o.hash,sender_account_id:o.signerId,wait_until:"FINAL"});const next={...o,...custodyReceiptState(r,o)};await finishCustodyOperation(next);return next;}catch{return o;}
}
export async function runCustodyMandate(s:MandateSession,m:AgentMandate,runId:string,now:number):Promise<RunResult>{
 const at=new Date(now).toISOString();
 const note=async(outcome:string,phase:MandateAuditEntry["phase"]="check",data?:unknown)=>{await auditAppend(s.id,[{id:await keyedAttemptId(s.id,`custody:${m.id}:${runId}:${phase}`),mandateId:m.id,mandateVersion:m.version,runId,at,phase,summary:outcome,...(data?{data}:{})} as MandateAuditEntry]);return {mandate:m,runId,outcome};};
 try{
  if(await killSwitch(s.id))return note("Custody stopped by the account kill switch.");
  if(m.frozen||!m.approval||m.approval.digest!==mandateDigest(m))return note("Custody requires current signed terms and a cleared freeze.");
  let ops=await custodyOperations(s.id,m.id);
  for(const o of ops.filter(x=>x.state==="unknown"))await reconcileCustody(o);
  ops=await custodyOperations(s.id,m.id);
  if(ops.some(o=>o.state==="unknown"))return note("Custody frozen: a journaled transaction is unresolved. Check its receipt; nothing else was sent.","freeze",{operations:ops.filter(o=>o.state==="unknown")});
  const b=m.authority.custodyContract;if(!b)return note("Bind the single-depositor vault before running custody.");
  const e=await custodyEvidence(m,b.contractId,b.operatorId,b.publicKey,now),v=e.snapshot,n=v.nav,p=v.operator!.policy!;
  if(n.nav_raw===null||n.report_required||n.busy||(n as any).unresolved)return note("Custody awaits verified liquid and a fresh NAV report; new risk is frozen.","freeze");
  if(n.report!.positions.some(x=>x.protocol!==v.config.rhea_id||x.chain!=="near"||BigInt(x.liabilities_raw)!==0n))return note("Custody only supports debt-free Rhea USDC positions.");
  const external=n.report!.positions.reduce((sum,x)=>sum+BigInt(x.assets_raw),0n);
  const hasPayments=s.workspace.obligations.some(o=>o.status==="pending"||o.status==="processing");
  const reduce=hasPayments||n.status!=="running";
  if(reduce&&external===0n)return note("No external custody position to unwind. Claims to the owner wallet remain separate.");
  if(!reduce&&BigInt(n.queued_shares)>0n)return note("Custody protects the redemption queue; no deployment.");
  const daily=v.operator!.usage_day===(BigInt(now)/86_400_000n).toString()?BigInt(v.operator!.daily_used_raw):0n;
  const room=(cap:string,used:bigint)=>BigInt(cap)>used?BigInt(cap)-used:0n;
  const idleFloor=BigInt(p.min_idle_raw)>BigInt(m.protection.reserveFloorUsdcRaw)?BigInt(p.min_idle_raw):BigInt(m.protection.reserveFloorUsdcRaw);
  const surplus=BigInt(n.liquid_assets_raw)>idleFloor?BigInt(n.liquid_assets_raw)-idleFloor:0n;
  const amount=reduce?min(external,BigInt(m.limits.perActionUsdcRaw)):min(surplus,BigInt(m.limits.perActionUsdcRaw),room(p.max_daily_raw,daily),room(p.max_cumulative_raw,BigInt(v.operator!.cumulative_used_raw)),room(p.max_deployed_raw,BigInt(v.operator!.deployed_raw)));
  if(amount<=0n)return note("No custody capital is available within the signed and on-chain limits.");
  const [prices,gas]=await Promise.all([readPriceEvidence(),networkRpc("gas_price",{block_id:null})]);
  if(!prices||!Number.isFinite(Date.parse(prices.freshUntil))||Date.parse(prices.freshUntil)<=Date.now()||!/^\d+$/.test(String(gas.gas_price))||BigInt(gas.gas_price)<=0n)throw new Error("Custody gas price valuation is unavailable or stale.");
  const cost=usdcValue(300_000_000_000_000n*BigInt(gas.gas_price),24,"NEAR",prices,"liability").toString();
  const today=ops.filter(o=>o.at.slice(0,10)===at.slice(0,10)&&o.call.methodName==="curator_supply");
  const deployed=BigInt(v.operator!.deployed_raw);const loss=deployed>external?null:"0"; // Gross supply is not a cost-basis history after exits; unknown loss blocks new risk.
  const observation:MandateObservation={now,capital:{spendableNowUsdcRaw:n.liquid_assets_raw,holdbackUsdcRaw:idleFloor.toString(),surplusUsdcRaw:surplus.toString(),reserveUsdcRaw:idleFloor.toString(),netWorthUsdcRaw:n.nav_raw,debtUsdcRaw:"0",blocksAutomation:false,capturedAt:new Date(Number(n.report!.observed_at_ms)).toISOString(),reasons:[]},horizonDays:s.workspace.mandate.horizon,obligations:[],exposure:external>0n?[{positionId:`vault:${b.contractId}:rhea`,venue:v.config.rhea_id,protocol:v.config.rhea_id,chain:"near",usdcRaw:external.toString()}]:[],recallable:[],uncertain:[],killSwitch:false,usage:{cumulativeUsdcRaw:v.operator!.cumulative_used_raw,todayUsdcRaw:daily.toString(),todayActions:today.length,deployedUsdcRaw:deployed.toString(),realizedLossUsdcRaw:"0",unrealizedLossUsdcRaw:loss,openPlanIds:[]}};
  const action:ProposedAction={kind:reduce?"recall_for_obligation":"deploy_surplus",strategyId:"rhea-usdc-surplus",asset:"USDC",chain:"near",venue:v.config.rhea_id,protocol:v.config.rhea_id,methods:[{receiver:b.contractId,method:reduce?"curator_withdraw":"curator_supply"}],recipient:"$owner",amountUsdcRaw:amount.toString(),costUsdcRaw:cost,slippageBps:0,quoteCapturedAt:at,borrows:false,spends:false,exitHours:0,reason:reduce?"Unwind to vault for owner exits; not a wallet payout":"Deploy only within custody limits"};
  const check=checkAction(m,observation,action);if(!check.allowed)return note("Custody checks refused this action.","check",{checks:check.checks});
  const checked=await checkedCustody(m,amount.toString(),reduce,now);
  const gasBudget=300_000_000_000_000n*BigInt(gas.gas_price);
  const signerBalance=await rpc({request_type:"view_account",account_id:b.operatorId});
  if(BigInt(signerBalance.amount)<gasBudget||BigInt(checked.key.permission.FunctionCall.allowance)<gasBudget)throw new Error("Custody signer balance or scoped-key gas allowance is insufficient. Nothing was sent.");
  const signed=await signCustodyCall(b,checked.call,String(checked.key.nonce),String(checked.key.block_hash));
  // Fence again after reads/signing; no server network submission until a durable unknown journal exists.
  const {mandateGet}=await import("./mandate-store");const latest=await mandateGet(s.id,m.id);
  if(await killSwitch(s.id)||!latest||latest.mandate.state!=="active"||latest.mandate.frozen||mandateDigest(latest.mandate)!==mandateDigest(m))throw new Error("Mandate paused, revoked or changed before custody submission.");
  const op:CustodyOperation={id:await keyedAttemptId(s.id,`custody:${m.id}:${runId}`),sessionId:s.id,mandateId:m.id,contractId:b.contractId,signerId:b.operatorId,hash:signed.hash,publicKey:b.publicKey,nonce:signed.nonce,call:checked.call,at,state:"unknown"};
  await startCustodyOperation(op,m.limits.maxActionsPerDay);
  await note("Custody call journaled before submission; unknown outcome must never be retried blind.","execute",{operation:op});
  try{await broadcastCustody(signed.bytes);}catch{/* A timeout is unknown, not failure. The saved hash remains the only recovery route. */}
  const result=await reconcileCustody(op);
  return note(result.state==="confirmed"?`Custody ${action.kind} call confirmed. ${result.reason??"Fresh NAV is required before the next action."}`:"Custody outcome unknown; frozen pending finalized receipt reconciliation.","result",{operation:result});
 }catch(e){return note((e as Error).message,"check");}
}
