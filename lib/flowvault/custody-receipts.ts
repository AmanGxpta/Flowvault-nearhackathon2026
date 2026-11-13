import type {CustodyOperation} from "./custody-journal.ts";
export function custodyReceiptState(r:any,o:CustodyOperation):Pick<CustodyOperation,"state"|"usedRaw"|"reason">{
 if(r?.final_execution_status!=="FINAL")return {state:"unknown",reason:"Waiting for finalized receipt."};
 if(r.transaction?.hash!==o.hash||r.transaction?.signer_id!==o.signerId||r.transaction?.receiver_id!==o.contractId)throw new Error("Custody receipt identity mismatch.");
 const call=r.transaction.actions?.[0]?.FunctionCall;
 if(r.transaction.actions?.length!==1||call?.method_name!==o.call.methodName||String(call.deposit)!=="0"||String(call.gas)!==o.call.gas||JSON.stringify(JSON.parse(atob(call.args)))!==JSON.stringify(o.call.args))throw new Error("Custody receipt changed the exact reviewed call.");
 if(r.status?.Failure&&Array.isArray(r.receipts_outcome)&&r.receipts_outcome.length&&!r.receipts_outcome.some((x:any)=>x.outcome?.executor_id===o.contractId&&(x.outcome?.logs??[]).some((l:string)=>l.startsWith("EVENT_JSON:")&&l.includes('"curator_started"'))))return {state:"failed",reason:"Final contract call refused before starting an external operation; no capital deployed."};
 if(r.status?.Failure||r.receipts_outcome?.some((x:any)=>x.outcome?.status?.Failure))return {state:"unknown",reason:"External outcome needs owner reconciliation; a failed child does not prove capital returned."};
 for(const receipt of r.receipts_outcome??[]){if(receipt.outcome?.executor_id!==o.contractId||typeof receipt.outcome?.status?.SuccessValue!=="string")continue;
  for(const line of receipt.outcome.logs??[]){if(!line.startsWith("EVENT_JSON:"))continue;let e;try{e=JSON.parse(line.slice(11));}catch{continue;}
   if(e.standard!=="flowvault_vault"||e.event!=="curator_result")continue;
   for(const d of e.data??[]){if(o.call.methodName==="curator_supply"&&d.kind==="supply"&&d.status==="resolved"&&/^\d+$/.test(d.used_raw)&&BigInt(d.used_raw)<=BigInt(o.call.args.amount))return {state:"confirmed",usedRaw:d.used_raw};
    if(o.call.methodName==="curator_withdraw"&&d.kind==="withdraw"&&d.status==="payout_unverified")return {state:"confirmed",reason:"Withdrawal call resolved; cash remains unverified until payout, sync and owner report."};}
  }
 }
 return {state:"unknown",reason:"No matching resolved contract operation event; do not retry."};
}
