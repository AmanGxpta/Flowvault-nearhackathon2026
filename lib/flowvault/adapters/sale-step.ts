import type {StepAdapter} from "../contracts";
import {journalCall,stepContext,stepKey} from "../step-adapters";
import {readAttempt} from "../attempts";
import {saleLedger} from "../sale-ledger";
import type {SalePreparation} from "../sale";
export const saleStepAdapter:StepAdapter={kinds:["sell"],
  async prepare(step,plan){const p=await journalCall(stepContext(plan),"sales","/api/sales",{action:"prepare",key:await stepKey(plan,step),planId:plan.id,stepId:step.id});return {attemptId:p.attemptId,expiresAt:p.expiresAt,state:"prepared"};},
  async check(step,plan){if(!step.attemptId)return {patch:{},ledger:[]};const ctx=stepContext(plan);let {attempt:a}=await readAttempt(ctx.sessionId,step.attemptId);if(a.kind!=="sell")throw new Error("Sale step linked to another operation.");if(["submitted","unknown","partial"].includes(a.state)&&a.hashes.length)a=(await journalCall(ctx,"transactions","/api/transactions",{id:a.id,action:"check"})).attempt;const p=a.preparation as SalePreparation;return {patch:{state:a.state,...(a.state==="confirmed"?{actual:{amountRaw:p.sale.result?.soldRaw??undefined,asset:p.asset,usdcRaw:p.sale.result?.proceedsUsdcRaw??undefined,evidence:p.sale.result}}:{})},ledger:a.state==="confirmed"&&step.state!=="confirmed"?saleLedger(a).map(x=>({...x,planId:plan.id,stepId:step.id})):[]};},
};
