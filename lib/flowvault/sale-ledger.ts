import type {LedgerEntry} from "./contracts.ts";
import type {WalletAttempt} from "./execution.ts";
import type {SalePreparation} from "./sale.ts";
import type {SaleSourceProof} from "./sale-receipts.ts";
export function saleLedger(a:WalletAttempt):LedgerEntry[]{
  if(a.kind!=="sell")return [];const p=a.preparation as SalePreparation,q=p.sale.quote,r=p.sale.result;
  const base={at:a.updatedAt,attemptId:a.id,txHashes:a.hashes,source:"live" as const,realized:true,liabilityEffectUsdcRaw:"0",acquisitionHistoryMissing:true,realizedPnlUsdcRaw:null};
  const entries:LedgerEntry[]=[];
  if(["submitted","unknown","partial","confirmed"].includes(a.state)){
    const status=a.state==="confirmed"?"confirmed":a.state==="submitted"?"pending":"unresolved";
    entries.push({...base,id:a.id+":sold",kind:"position_exit",chain:q.request.asset.chain,asset:p.asset,amountRaw:r?.soldRaw??p.amountRaw,decimals:p.decimals,usdcRaw:null,netWorthEffectUsdcRaw:null,status,
      positionId:`sale:${p.accountId}:${p.tokenId}`,basis:status==="confirmed"?"Verified sold quantity. Acquisition history missing; realized PnL unavailable.":"Source deposit/disposition awaiting final sale/refund proof; this is not a realized sale quantity."});
    if(r?.proceedsUsdcRaw&&BigInt(r.proceedsUsdcRaw)>0n)entries.push({...base,id:a.id+":proceeds",kind:"internal_transfer",chain:"near",asset:"USDC",amountRaw:r.proceedsUsdcRaw,decimals:6,usdcRaw:r.proceedsUsdcRaw,netWorthEffectUsdcRaw:"0",status:"confirmed",basis:"Net sale proceeds verified by finalized native USDC transfer to the owner's NEAR account; excess proceeds remain cash."});
  }
  if(p.sale.refundedRaw) entries.push({...base,id:a.id+":refund",kind:"refund",chain:q.request.asset.chain,asset:p.asset,amountRaw:p.sale.refundedRaw,decimals:p.decimals,usdcRaw:null,netWorthEffectUsdcRaw:"0",status:"confirmed",basis:"Source asset returned by independently verified finalized refund receipt; no sale proceeds, not yield."});
  for(const proof of (a.verificationEvidence??[]) as SaleSourceProof[])if(proof.gasNativeRaw!==null&&BigInt(proof.gasNativeRaw)>0n)entries.push({...base,id:a.id+":fee",kind:"fee",chain:q.request.asset.chain,asset:q.request.asset.chain==="near"?"NEAR":"ETH",amountRaw:proof.gasNativeRaw,decimals:q.request.asset.chain==="near"?24:18,usdcRaw:null,netWorthEffectUsdcRaw:null,status:"confirmed",basis:"Actual finalized source gas; historical USDC price unavailable."});
  if((a.verificationEvidence??[]).some(x=>(x as SaleSourceProof).gasNativeRaw===null)) entries.push({...base,id:a.id+":fee-unknown",kind:"fee",chain:q.request.asset.chain,asset:q.request.asset.chain==="near"?"NEAR":"ETH",amountRaw:"0",decimals:q.request.asset.chain==="near"?24:18,usdcRaw:null,netWorthEffectUsdcRaw:null,status:"unresolved",basis:"Source fee evidence incomplete; unavailable amount, not a zero fee."});
  return entries;
}
