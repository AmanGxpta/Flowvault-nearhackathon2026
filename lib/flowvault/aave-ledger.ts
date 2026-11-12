import type { LedgerEntry } from "./contracts.ts";
import type { WalletAttempt } from "./execution.ts";
import type { AaveReceiptProof } from "./aave-receipts.ts";
import { isAave } from "./aave.ts";
export function aaveLedger(a: WalletAttempt): LedgerEntry[] {
  const p=a.preparation;if(!isAave(p)) return [];
  const proofs=(a.verificationEvidence??[]) as AaveReceiptProof[];
  const result:LedgerEntry[]=[];
  const status=a.state==="confirmed"?"confirmed":a.state==="submitted"?"pending":["unknown","partial"].includes(a.state)?"unresolved":null;
  const base={at:a.updatedAt,chain:p.evm.chain,attemptId:a.id,txHashes:a.hashes,source:"live" as const,realized:true};
  const economic=proofs.find(x=>x.index===p.evm.transactions.length-1 && x.state==="confirmed");
  if(status) {
    const kind=p.kind==="borrow"?"borrow":p.kind==="repay"?"repay":"internal_transfer";
    const amount=economic?.amountRaw??p.amountRaw;
    result.push({...base,id:a.id+":"+kind,kind,asset:p.asset,amountRaw:amount,decimals:p.decimals,usdcRaw:p.asset==="USDC"?amount:p.usdcValueRaw,
      positionId:`${p.evm.venueId}:${a.accountId}:${p.tokenId}`,status,
      netWorthEffectUsdcRaw:status==="confirmed"?"0":null,
      liabilityEffectUsdcRaw:status!=="confirmed"?null:kind==="borrow"?amount:kind==="repay"?"-"+amount:"0",
      basis:"Aave canonical finalized protocol event and underlying token movement; principal stays on "+p.evm.chain});
  }
  if(proofs.some(x=>x.blockHash && !x.gasWei)) result.push({...base,id:a.id+":fee-unknown",kind:"fee",asset:"ETH",amountRaw:"0",decimals:18,usdcRaw:null,netWorthEffectUsdcRaw:null,liabilityEffectUsdcRaw:"0",status:"unresolved",basis:"Finalized EVM fee components incomplete (including Base L1 data fee); amount unavailable, not zero cost."});
  const gas=proofs.reduce((n,x)=>n+BigInt(x.gasWei??"0"),0n);
  if(gas>0n) result.push({...base,id:a.id+":fee",kind:"fee",asset:"ETH",amountRaw:gas.toString(),decimals:18,usdcRaw:null,netWorthEffectUsdcRaw:null,liabilityEffectUsdcRaw:"0",status:"confirmed",basis:"Actual finalized EVM gas; historical USDC price unavailable, never estimated as realized cost."});
  return result;
}
