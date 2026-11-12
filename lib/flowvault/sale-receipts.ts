import type { SalePreparation } from "./sale.ts";
import { LENDING_USDC } from "./lending.ts";
import { matchAaveTx } from "./aave-receipts.ts";
import { hashText,word,words } from "./aave-abi.ts";
export interface SaleSourceProof {state:"confirmed"|"pending"|"failed";inputRaw:string;refundRaw:string|null;proceedsUsdcRaw:string|null;gasNativeRaw:string|null;hash:string;blockHash:string}
function stable(v:any):string {return Array.isArray(v)?"["+v.map(stable).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+stable(v[k])).join(",")+"}":JSON.stringify(v);}
export function tokenTransfers(result:any,token:string,to:string,from?:string):{amount:string;receiptId:string}[] {
  const rows=[];
  for(const r of result.receipts_outcome??[]){
    if(r.outcome?.executor_id!==token)continue;
    for(const l of r.outcome.logs??[]){
      if(typeof l!=="string"||!l.startsWith("EVENT_JSON:"))continue;
      let e;try{e=JSON.parse(l.slice(11));}catch{throw new Error("Malformed sale transfer event.");}
      if(e.standard!=="nep141"||e.version!=="1.0.0"||e.event!=="ft_transfer"||!Array.isArray(e.data))continue;
      for(const d of e.data)if(d?.new_owner_id===to&&d.old_owner_id!==to&&(!from||d.old_owner_id===from)&&typeof d.amount==="string"&&/^\d+$/.test(d.amount))rows.push({amount:d.amount,receiptId:r.id});
    }
  }return rows;
}
export function verifySaleNearSource(r:any,p:SalePreparation,hash:string):SaleSourceProof|null {
  const tx=r.transaction,expected=p.transactions[0],call=expected?.actions[0]?.params,actual=tx?.actions?.[0]?.FunctionCall;
  if(!tx||tx.hash!==hash||tx.signer_id!==p.accountId||tx.receiver_id!==expected?.receiverId||tx.actions?.length!==1||!actual||actual.method_name!==call.methodName||String(actual.deposit)!==call.deposit||String(actual.gas)!==call.gas)throw new Error("Sale transaction does not match reviewed source.");
  let args;try{args=JSON.parse(atob(actual.args));}catch{throw new Error("Malformed sale source arguments.");}
  if(stable(args)!==stable(call.args))throw new Error("Sale source arguments changed.");
  if(r.final_execution_status!=="FINAL"||!Array.isArray(r.receipts_outcome)||!r.receipts_outcome.length)return null;
  const base={inputRaw:p.amountRaw,refundRaw:null,proceedsUsdcRaw:null,gasNativeRaw:null,hash,blockHash:r.transaction_outcome?.block_hash??""};
  if(r.status?.Failure||r.receipts_outcome.some((x:any)=>x.outcome?.status?.Failure))return {...base,state:"failed"};
  if(typeof r.status?.SuccessValue!=="string"||r.receipts_outcome.some((x:any)=>!x.outcome?.status||!Array.isArray(x.outcome?.logs)))return null;
  const all=[r.transaction_outcome?.outcome,...r.receipts_outcome.map((x:any)=>x.outcome)];
  const gas=all.every(x=>typeof x?.tokens_burnt==="string"&&/^\d+$/.test(x.tokens_burnt))?all.reduce((n,x)=>n+BigInt(x.tokens_burnt),0n).toString():null;
  if(p.sale.quote.venueId==="rhea-ref"){
    let used;try{used=JSON.parse(atob(r.status.SuccessValue));}catch{return null;}
    if(typeof used!=="string"||!/^\d+$/.test(used)||BigInt(used)!==BigInt(p.amountRaw))return null;
    const out=tokenTransfers(r,LENDING_USDC,p.sale.quote.request.recipient,"v2.ref-finance.near");
    if(out.length!==1||BigInt(out[0].amount)<BigInt(p.sale.quote.request.netUsdcRaw))return null;
    return {...base,state:"confirmed",refundRaw:"0",proceedsUsdcRaw:out[0].amount,gasNativeRaw:gas};
  }
  const deposit=(p.sale.quote.evidence as any)?.quote?.depositAddress;
  const sent=tokenTransfers(r,p.tokenId,deposit,p.accountId);
  if(sent.length!==1||sent[0].amount!==p.amountRaw)return null;
  return {...base,state:"confirmed",gasNativeRaw:gas};
}
export function verifySaleEvmSource(tx:any,r:any,p:SalePreparation,hash:string):SaleSourceProof|null {
  const expected=p.sale.evmTx;if(!expected||!matchAaveTx(tx,expected)||tx.hash!==hash||r.transactionHash!==hash||r.blockHash!==tx.blockHash)throw new Error("Sale source EVM payload mismatch.");
  const base={inputRaw:p.amountRaw,refundRaw:null,proceedsUsdcRaw:null,gasNativeRaw:p.sale.quote.request.asset.chain==="base"&&typeof r.l1Fee!=="string"?null:(BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice)+BigInt(r.l1Fee??"0x0")).toString(),hash,blockHash:r.blockHash};
  if(r.status==="0x0")return {...base,state:"failed"};if(r.status!=="0x1"||!Array.isArray(r.logs))return null;
  const deposit=(p.sale.quote.evidence as any)?.quote?.depositAddress;
  const sent=r.logs.filter((l:any)=>!l.removed&&l.blockHash===r.blockHash&&l.transactionHash===hash&&l.address?.toLowerCase()===p.tokenId.toLowerCase()&&l.topics?.[0]?.toLowerCase()==="0x"+hashText("Transfer(address,address,uint256)")&&l.topics[1]?.toLowerCase()==="0x"+word(p.accountId)&&l.topics[2]?.toLowerCase()==="0x"+word(deposit)&&words(l.data)[0]===BigInt(p.amountRaw));
  return sent.length===1?{...base,state:"confirmed"}:null;
}
