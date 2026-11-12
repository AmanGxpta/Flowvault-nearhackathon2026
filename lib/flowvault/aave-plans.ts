import { newPlan } from "./plans.ts";
import { isAave } from "./aave.ts";
import type { ActionPlan, FundingChoice } from "./contracts.ts";
import type { LendingPreparation } from "./lending.ts";
export function aaveOperationPlan(id:string,key:string,p:LendingPreparation,context:ActionPlan["context"]):ActionPlan {
  if(!isAave(p)) throw new Error("Aave operation plan requires a venue-bound preparation.");
  const choice:FundingChoice={id:"aave-operation",kind:p.kind==="borrow"?"borrow":"idle_cash",eligible:true,reasons:[],amountUsdcRaw:p.usdcValueRaw,costsUsdcRaw:null,foregoneUsdcRaw:null,interestUsdcRaw:null,healthAfter:p.stressedHealthAfter,availableAt:null,steps:[p.kind],venueId:p.evm.venueId,accountId:p.accountId,chain:p.evm.chain};
  return newPlan({id,key,source:"live",accountId:p.accountId,createdBy:"user",objective:p.kind==="borrow"?"borrow":p.kind==="repay"?"repay":"access_cash",context,
    request:{amountRaw:p.amountRaw,asset:p.asset,chain:p.evm.chain,venue:p.evm.venueId},alternatives:[choice],
    effects:{reserveAfterUsdcRaw:null,debtAfterUsdcRaw:p.debtBeforeUsdcRaw===undefined?null:(BigInt(p.debtBeforeUsdcRaw)+(p.kind==="borrow"?BigInt(p.amountRaw):p.kind==="repay"?-BigInt(p.amountRaw):0n)).toString(),costsUsdcRaw:null,exposure:[{asset:`${p.asset} · ${p.evm.venueId}`,deltaRaw:(p.kind==="repay"||p.kind==="collateral_release"?"-":"")+p.amountRaw,decimals:p.decimals}]}});
}
