import {z} from "zod";
import {session,mutation,json,failure} from "@/lib/flowvault/store";
import {requireSalePermissionOwner} from "@/lib/flowvault/sale-policy-owner";
import {mandateGet,auditAppend} from "@/lib/flowvault/mandate-store";
import {custodyOperations,finishCustodyOperation} from "@/lib/flowvault/custody-journal";
import {reconcileCustody} from "@/lib/flowvault/custody-runner";
import {readVault} from "@/lib/flowvault/vault-live";
import {networkRpc,rpc} from "@/lib/flowvault/near";
export async function POST(r:Request){try{
 mutation(r);const s=await session(r);requireSalePermissionOwner(s,"Connect and sign in to your workspace’s NEAR account before managing custody authority.");
 const b=z.object({mandateId:z.string().max(80),operationId:z.string().max(128),evidence:z.string().min(16).max(128).optional()}).strict().parse(await r.json());
 const stored=await mandateGet(s.id,b.mandateId);if(!stored||stored.mandate.accountId!==s.account)throw new Error("This custody mandate is not yours.");
 const op=(await custodyOperations(s.id,b.mandateId)).find(o=>o.id===b.operationId);if(!op)throw new Error("Custody operation not found.");
 const checked=await reconcileCustody(op);if(checked.state!=="unknown"||!b.evidence)return json({operation:checked},s.cookie);
 // Explicit owner acknowledgement after contract-level resolution; never resets contract usage or calls a transfer.
 const v=await readVault(op.contractId,[s.account!]);
 if(v.config.owner_id!==s.account||v.config.single_depositor!==s.account||v.nav.busy||(v.nav as any).unresolved||!v.nav.report_by_owner||v.nav.nav_raw===null||v.nav.report_required||!v.nav.report||Date.now()-Number(v.nav.report.observed_at_ms)>Number(v.config.max_nav_age_ms))throw new Error("Resolve the on-chain operation, sync liquid and submit a fresh owner NAV report before acknowledging this journal.");
 let finalized=false;
 try{const tx=await networkRpc("EXPERIMENTAL_tx_status",{tx_hash:op.hash,sender_account_id:op.signerId,wait_until:"FINAL"});finalized=tx.final_execution_status==="FINAL"&&tx.transaction?.hash===op.hash;}catch{}
 if(!finalized){
  const key=await rpc({request_type:"view_access_key",account_id:op.signerId,public_key:op.publicKey});
  if(!op.nonce||BigInt(key.nonce)<BigInt(op.nonce))throw new Error("The original transaction may still execute. Wait for finality or have the owner invalidate its key nonce before acknowledgement.");
 }
 const resolved={...op,state:"confirmed" as const,reason:`Owner acknowledged on-chain reconciliation with evidence ${b.evidence}; no cash or budget refund inferred.`};await finishCustodyOperation(resolved);
 await auditAppend(s.id,[{id:`custody-owner-ack:${op.id}`,mandateId:b.mandateId,mandateVersion:stored.mandate.version,runId:null,at:new Date().toISOString(),phase:"result",summary:resolved.reason,data:{operation:resolved,evidence:b.evidence}}]);
 return json({operation:resolved},s.cookie);
 }catch(e){return failure(e);}}

export async function GET(r:Request){try{const s=await session(r);requireSalePermissionOwner(s,"Connect and sign in to your workspace’s NEAR account before managing custody authority.");const id=new URL(r.url).searchParams.get("id");if(!id)throw new Error("Choose a mandate.");const m=await mandateGet(s.id,id);if(!m||m.mandate.accountId!==s.account)throw new Error("This mandate is not yours.");return json({operations:await custodyOperations(s.id,id)},s.cookie);}catch(e){return failure(e);}}
