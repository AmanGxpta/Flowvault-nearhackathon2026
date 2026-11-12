import type { StepAdapter } from "../contracts";
import { journalCall, stepContext, stepKey } from "../step-adapters";
import { readAttempt } from "../attempts";
import { newDebtApproved } from "../lending-step";
import { decimal } from "../money";
import { aaveLedger } from "../aave-ledger";
import { isAave } from "../aave";
import { AAVE_MARKETS, type AaveChain } from "../aave-markets";
export const aaveStepAdapter: StepAdapter={
  kinds:["collateral_add","borrow","repay","collateral_release"],
  async prepare(step,plan) {
    const ctx=stepContext(plan), chain=step.expected.venue?.split(":")[1] as AaveChain;
    const m=AAVE_MARKETS[chain];
    if(!m || !step.signer || !step.expected.amountRaw) throw new Error("Missing reviewed Aave venue, signer or amount.");
    if(step.kind==="borrow" && !newDebtApproved(plan,step)) throw new Error("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL");
    const asset=[...m.collateral,m.debt].find(x=>x.symbol===step.expected.asset);
    if(!asset) throw new Error("Unknown reviewed Aave asset.");
    const p=await journalCall(ctx,"aave","/api/lending/venues",{chain,account:step.signer,kind:step.kind,asset:asset.symbol,amount:decimal(BigInt(step.expected.amountRaw),asset.decimals),key:await stepKey(plan,step),approveNewDebt:step.kind==="borrow"});
    return {attemptId:p.attemptId,expiresAt:p.expiresAt,state:"prepared"};
  },
  async check(step,plan) {
    if(!step.attemptId) return {patch:{},ledger:[]};
    const ctx=stepContext(plan);let {attempt:a}=await readAttempt(ctx.sessionId,step.attemptId);
    if(!isAave(a.preparation)) throw new Error("Aave step linked to a different venue journal.");
    if(["submitted","partial","unknown"].includes(a.state) && a.hashes.length) a=(await journalCall(ctx,"transactions","/api/transactions",{id:a.id,action:"check"})).attempt;
    if(!isAave(a.preparation)) throw new Error("Venue journal changed.");
    return {patch:{state:a.state,...(a.state==="confirmed"?{actual:{amountRaw:aaveLedger(a).find(x=>x.kind!=="fee")?.amountRaw,asset:a.preparation.asset,usdcRaw:a.preparation.usdcValueRaw,evidence:a.verificationEvidence}}:{})},ledger:step.state!=="confirmed"&&a.state==="confirmed"?aaveLedger(a).map(e=>({...e,planId:plan.id,stepId:step.id})):[]};
  },
};
