import { networkRpc } from "./near.ts";
import { LENDING_USDC } from "./lending.ts";
/** Exact canonical NEAR payout. Provider hashes are only locators; finalized token receipts prove cash. */
export function nearUsdcProof(result:any,hash:string,recipient:string,amount:bigint) {
  if(result?.transaction?.hash!==hash || result.final_execution_status!=="FINAL" || typeof result.status?.SuccessValue!=="string" || !Array.isArray(result.receipts_outcome) || !result.receipts_outcome.length) return null;
  if(result.receipts_outcome.some((x:any)=>!x.outcome?.status || x.outcome.status.Failure || !Array.isArray(x.outcome.logs))) return null;
  const matches:{receiptId:string;amountRaw:string}[]=[];
  for(const receipt of result.receipts_outcome) {
    if(receipt.outcome.executor_id!==LENDING_USDC) continue;
    for(const log of receipt.outcome.logs) {
      if(typeof log!=="string" || !log.startsWith("EVENT_JSON:")) continue;
      let e;try{e=JSON.parse(log.slice(11));}catch{return null;}
      if(e.standard!=="nep141" || e.version!=="1.0.0" || e.event!=="ft_transfer" || !Array.isArray(e.data)) continue;
      for(const d of e.data) if(d?.new_owner_id===recipient && d.old_owner_id!==recipient && typeof d.old_owner_id==="string" && d.amount===amount.toString()) matches.push({receiptId:receipt.id,amountRaw:d.amount});
    }
  }
  return matches.length===1?matches[0]:null;
}
export async function verifyNearUsdcDelivery(hashes:string[],recipient:string,amount:bigint,notBefore:string) {
  if(!hashes.length || hashes.length>10) return null;
  const matches=[];
  for(const hash of new Set(hashes)) {
    if(!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) continue;
    const result=await networkRpc("EXPERIMENTAL_tx_status",{tx_hash:hash,sender_account_id:recipient,wait_until:"FINAL"});
    const proof=nearUsdcProof(result,hash,recipient,amount);if(!proof)continue;
    const block=await networkRpc("block",{block_id:result.transaction_outcome.block_hash});
    if(BigInt(block.header.timestamp_nanosec)/1000000n<BigInt(Date.parse(notBefore))) continue;
    matches.push({...proof,hash,blockHash:result.transaction_outcome.block_hash});
  }
  return matches.length===1?matches[0]:null;
}
