import {CUSTODY_TABLE,CUSTODY_START_BOUNDED,CUSTODY_FINISH} from "./custody-sql";
import {database} from "./store";
import type {CustodyCall} from "./custody-authority";
export interface CustodyOperation {id:string;sessionId:string;mandateId:string;contractId:string;signerId:string;hash:string;publicKey:string;nonce:string;call:CustodyCall;at:string;state:"unknown"|"confirmed"|"failed";usedRaw?:string;reason?:string}
async function db(){const d=await database();await d.prepare(CUSTODY_TABLE).run();return d;}
export async function custodyOperations(sessionId:string,mandateId:string){const r=await(await db()).prepare("SELECT payload FROM custody_ops WHERE session_id=? AND mandate_id=? ORDER BY rowid").bind(sessionId,mandateId).all<{payload:string}>();return r.results.map(x=>JSON.parse(x.payload) as CustodyOperation);}
export async function startCustodyOperation(o:CustodyOperation,maxActionsPerDay:number){const r=await(await db()).prepare(CUSTODY_START_BOUNDED).bind(o.id,o.sessionId,o.mandateId,o.contractId,o.hash,o.state,JSON.stringify(o),o.contractId,o.call.methodName,o.sessionId,o.mandateId,o.at.slice(0,10),maxActionsPerDay).run();if(r.meta.changes!==1)throw new Error("A custody operation already exists or is unresolved. Reconcile it before submitting another.");}
export async function finishCustodyOperation(o:CustodyOperation){await(await db()).prepare(CUSTODY_FINISH).bind(o.state,JSON.stringify(o),o.id,o.sessionId).run();}
