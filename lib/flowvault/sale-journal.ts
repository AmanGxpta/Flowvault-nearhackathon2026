import { session } from "./store";
import { attemptsDb,readAttempt,saveAttempt } from "./attempts";
import { assertSignable } from "./execution";
import { readSaleEvidence } from "./sale-live";
import { guardSaleQuote,reconcileSale } from "./sale";
import type { SalePreparation } from "./sale";
import { reservePolicy,checkPolicy } from "./policy-store";
import { mayRead } from "./account-registry";
import { evmRpc,hexQuantity } from "./evm";
import { networkRpc } from "./near";
import { appendStep } from "./timeline";
import { verifySaleNearSource,verifySaleEvmSource,tokenTransfers } from "./sale-receipts";
import { verifyNearUsdcDelivery } from "./lending-venue-proof";
import { hashText,word,words } from "./aave-abi";
async function claim(key:string,id:string){const db=await attemptsDb();await db.prepare("INSERT OR IGNORE INTO wallet_hashes(hash,attempt_id) VALUES (?,?)").bind(key,id).run();const r=await db.prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?").bind(key).first<{attempt_id:string}>();if(r?.attempt_id!==id)throw new Error("Sale receipt already claimed by another operation.");}
export async function saleJournalAction(request:Request,id:string,action:string,hashes:string[]=[]) {
  const s=await session(request),{attempt:a,previous}=await readAttempt(s.id,id),p=a.preparation as SalePreparation;
  if(a.kind!=="sell"||!p.sale||s.workspace.mode!=="live")throw new Error("Sale not in this live workspace.");
  const q=p.sale.quote,near=q.request.asset.chain==="near";
  if((action==="check"||action==="attach")&&a.state==="confirmed"){if(hashes.some(h=>!a.hashes.includes(h)))throw new Error("Confirmed sale cannot accept another hash.");return a;}
  let revision:number|undefined;
  if(action==="authorize"){
    if(p.sale.workspaceRevision!==s.revision||p.sale.policyVersion!==s.workspace.policy?.version||p.sale.mandateVersion!==s.workspace.mandate.version||q.request.recipient!==s.workspace.accountId||!mayRead(s.workspace,near?"near":"evm",p.accountId))throw new Error("Sale account, policy, mandate or workspace changed.");
    assertSignable(a,p.accountId,s.workspace.mode,s.workspace.mandate.version);
    const evidence=await readSaleEvidence(s.workspace,q.request.asset,p.accountId);guardSaleQuote(q,evidence);
    const current=await session(request);if(current.revision!==s.revision)throw new Error("Workspace changed during sale authorization.");
    const policyAction={...p.policyAction,id:a.id};
    await checkPolicy(s.id,policyAction,current.workspace.policy!);await reservePolicy(s.id,policyAction,current.workspace.policy!,current.revision);
    revision=current.revision;a.state="awaiting_wallet";a.message="Owner wallet requested for the reviewed sale deposit. Do not retry if the result is uncertain.";
  }else if(action==="uncertain"){
    if(a.state==="awaiting_wallet"){a.state="unknown";a.message="Sale handoff uncertain. Recover the existing wallet hash before any new sale.";}
  }else{
    if(a.state==="prepared")throw new Error("Sale has not reached the wallet.");
    const all=[...new Set([...a.hashes,...hashes])];if(all.length>1)throw new Error("Sale accepts one source transaction only.");
    const hash=all[0];if(hash){
      let proof:import("./sale-receipts").SaleSourceProof|null=null;
      if(near){
        if(!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash))throw new Error("Invalid NEAR sale hash.");
        const result=await networkRpc("EXPERIMENTAL_tx_status",{tx_hash:hash,sender_account_id:p.accountId,wait_until:"FINAL"});proof=verifySaleNearSource(result,p,hash);
        if(proof){const block=await networkRpc("block",{block_id:proof.blockHash});if(BigInt(block.header.timestamp_nanosec)/1000000n<BigInt(Date.parse(a.createdAt)))throw new Error("Sale source predates preparation.");}
      }else{
        if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("Invalid EVM sale hash.");
        const chain=q.request.asset.chain as "eth"|"base"|"arb";
        const [tx,receipt,final]=await Promise.all([evmRpc(chain,"eth_getTransactionByHash",[hash]),evmRpc(chain,"eth_getTransactionReceipt",[hash]),evmRpc(chain,"eth_getBlockByNumber",["finalized",false])]);
        if(tx&&receipt&&final?.number&&hexQuantity(receipt.blockNumber)<=hexQuantity(final.number)){
          const block=await evmRpc(chain,"eth_getBlockByNumber",[receipt.blockNumber,false]);
          if(block?.hash!==receipt.blockHash||Number(hexQuantity(block.timestamp))*1000<Date.parse(a.createdAt)-1000)throw new Error("Sale source is not canonical or predates preparation.");
          proof=verifySaleEvmSource(tx,receipt,p,hash);
        }
      }
      a.hashes=all;a.state="submitted";
      if(proof){
        await claim(`sale:${q.request.asset.chain}:${hash}`,a.id);a.verificationEvidence=[proof];
        appendStep(a,"receipt:"+hash,proof.state,"Sale source "+proof.state,{evidence:proof,fees:[{unit:near?"yoctoNEAR":"weiETH",amount:proof.gasNativeRaw,verified:proof.gasNativeRaw!==null}]});
        if(proof.state==="failed"){a.state="failed";a.message="Source sale transaction failed; inspect fees and balances.";}
        if(proof.state==="confirmed"){
          p.sale.sourceFinalized=true;
          if(q.venueId==="rhea-ref")p.sale.result=reconcileSale(q,{inputRaw:proof.inputRaw,refundRaw:proof.refundRaw,proceedsUsdcRaw:proof.proceedsUsdcRaw,finalized:true});
          else{
            const deposit=(q.evidence as any)?.quote?.depositAddress;
            const res=await fetch("https://1click.chaindefuser.com/v0/status?depositAddress="+encodeURIComponent(deposit),{signal:AbortSignal.timeout(10000)});
            const report:any=await res.json();if(!res.ok)throw new Error("Sale delivery status unavailable.");p.sale.providerReport=report;
            const d=report?.swapDetails??{};
            if(report.status==="REFUNDED" && await verifySaleRefund(p,d.originChainTxHashes,BigInt(p.amountRaw),a.createdAt,a.id)) {
              p.sale.refundedRaw=p.amountRaw;
              a.state="failed";
              a.message="The sale deposit was independently verified as fully refunded to its source account. No USDC payment was funded; network fees remain recorded.";
            }
            if(report.status==="SUCCESS"&&typeof d.amountOut==="string"&&/^\d+$/.test(d.amountOut)){
              const hashes=(Array.isArray(d.destinationChainTxHashes)?d.destinationChainTxHashes:[]).map((x:any)=>typeof x==="string"?x:x?.hash).filter((x:unknown):x is string=>typeof x==="string");
              const output=await verifyNearUsdcDelivery(hashes,q.request.recipient,BigInt(d.amountOut),a.createdAt);
              if(output)await claim("near-payout:"+output.receiptId,a.id);
              const used=typeof d.amountIn==="string"&&/^\d+$/.test(d.amountIn)&&BigInt(d.amountIn)<=BigInt(p.amountRaw)?BigInt(d.amountIn):null;
              const refund=typeof d.refundedAmount==="string"&&/^\d+$/.test(d.refundedAmount)?BigInt(d.refundedAmount):used!==null?BigInt(p.amountRaw)-used:null;
              let refundProven=refund===0n;
              // Positive refunds remain unresolved until an independent token receipt proves the leftovers.
              if(refund!==null&&refund>0n)refundProven=await verifySaleRefund(p,d.originChainTxHashes,refund,a.createdAt,a.id);
              p.sale.result=reconcileSale(q,{inputRaw:p.amountRaw,refundRaw:refundProven?refund!.toString():null,proceedsUsdcRaw:output?.amountRaw??null,finalized:true});
            }
          }
          if(!p.sale.refundedRaw) { a.state=p.sale.result?.complete?"confirmed":"partial";
          a.message=a.state==="confirmed"?"Asset sale and net USDC proceeds independently finalized. Acquisition history missing; realized PnL is unavailable.":"Sale source finalized; proceeds/leftovers still need proof. Keep this attempt and check; do not sell again."; }
        }
      }
    }
  }
  await saveAttempt(s.id,a,previous,revision);return a;
}
async function verifySaleRefund(p:SalePreparation,rawHashes:any,amount:bigint,notBefore:string,id:string) {
  if(!Array.isArray(rawHashes)||rawHashes.length>10)return false;
  const hashes=rawHashes.map(x=>typeof x==="string"?x:x?.hash).filter((x:unknown):x is string=>typeof x==="string");
  const proofs:string[]=[];
  for(const hash of new Set(hashes)){
    if(p.sale.quote.request.asset.chain==="near"){
      if(!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash))continue;
      const r=await networkRpc("EXPERIMENTAL_tx_status",{tx_hash:hash,sender_account_id:p.accountId,wait_until:"FINAL"});
      if(r.transaction?.hash!==hash||r.final_execution_status!=="FINAL"||typeof r.status?.SuccessValue!=="string"||r.receipts_outcome?.some((x:any)=>x.outcome?.status?.Failure))continue;
      const block=await networkRpc("block",{block_id:r.transaction_outcome.block_hash});if(BigInt(block.header.timestamp_nanosec)/1000000n<BigInt(Date.parse(notBefore)))continue;
      const found=tokenTransfers(r,p.tokenId,p.accountId).filter(x=>x.amount===amount.toString());
      for(const x of found)proofs.push("near-refund:"+x.receiptId);
    }else{
      if(!/^0x[0-9a-fA-F]{64}$/.test(hash))continue;
      const chain=p.sale.quote.request.asset.chain as "eth"|"base"|"arb";
      const [r,f]=await Promise.all([evmRpc(chain,"eth_getTransactionReceipt",[hash]),evmRpc(chain,"eth_getBlockByNumber",["finalized",false])]);
      if(!r||r.transactionHash!==hash||r.status!=="0x1"||!f?.number||hexQuantity(r.blockNumber)>hexQuantity(f.number))continue;
      const b=await evmRpc(chain,"eth_getBlockByNumber",[r.blockNumber,false]);if(b?.hash!==r.blockHash||Number(hexQuantity(b.timestamp))*1000<Date.parse(notBefore))continue;
      for(const l of r.logs??[])if(!l.removed&&l.blockHash===r.blockHash&&l.transactionHash===hash&&l.address?.toLowerCase()===p.tokenId.toLowerCase()&&l.topics?.[0]?.toLowerCase()==="0x"+hashText("Transfer(address,address,uint256)")&&l.topics[2]?.toLowerCase()==="0x"+word(p.accountId)&&words(l.data)[0]===amount)proofs.push(`sale-refund:${chain}:${hash}:${l.logIndex}`);
    }
  }
  if(proofs.length!==1)return false;await claim(proofs[0],id);return true;
}
