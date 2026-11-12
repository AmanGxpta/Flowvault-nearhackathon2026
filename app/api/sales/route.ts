import {z} from "zod";
import {session,mutation,json,failure} from "@/lib/flowvault/store";
import {approvedSaleChoices,readSaleEvidence,saleVenue} from "@/lib/flowvault/sale-live";
import {planGet,planIdFor,planInsert} from "@/lib/flowvault/plans-store";
import {newPlan,planContext,assertPreparable} from "@/lib/flowvault/plans";
import {createAttempt,preparationRetry} from "@/lib/flowvault/attempts";
import {checkPolicy} from "@/lib/flowvault/policy-store";
import {decimal} from "@/lib/flowvault/money";
import type {SalePreparation} from "@/lib/flowvault/sale";
const body=z.discriminatedUnion("action",[
  z.object({action:z.literal("plan"),key:z.string().uuid(),netUsdcRaw:z.string().regex(/^[1-9]\d{0,20}$/)}).strict(),
  z.object({action:z.literal("prepare"),key:z.string().uuid(),planId:z.string().uuid(),stepId:z.string()}).strict(),
]);
export async function GET(r:Request){try{const s=await session(r),raw=new URL(r.url).searchParams.get("netUsdcRaw");if(!raw||!/^\d+$/.test(raw)||BigInt(raw)<=0n)throw new Error("Choose a positive net USDC amount.");return json({source:s.workspace.mode,choices:await approvedSaleChoices(s.workspace,BigInt(raw)),revision:s.revision},s.cookie);}catch(e){return failure(e);}}
export async function POST(r:Request){try{
  mutation(r);const b=body.parse(await r.json()),s=await session(r);
  if(s.workspace.mode!=="live"||!s.workspace.accountId)throw new Error("Use your proven personal NEAR proceeds account for asset sales.");
  if(b.action==="plan"){
    const id=await planIdFor(s.id,b.key),old=await planGet(s.id,id);
    if(old){if(old.plan.request.amountRaw!==b.netUsdcRaw||old.plan.objective!=="access_cash")throw new Error("Sale plan idempotency conflict.");return json({plan:old.plan},s.cookie);}
    const choices=(await approvedSaleChoices(s.workspace,BigInt(b.netUsdcRaw))).map(c=>({...c,steps:c.saleQuote?["sell" as const]:[]}));
    const p=newPlan({id,key:b.key,source:"live",accountId:s.workspace.accountId,createdBy:"user",objective:"access_cash",context:planContext(s.workspace,s.revision),request:{amountRaw:b.netUsdcRaw,asset:"USDC",chain:"near"},alternatives:choices,blockedReasons:choices.length?[]:["NO_APPROVED_SALE_ASSETS"]});
    const after=await session(r);if(after.revision!==s.revision)throw new Error("Workspace changed during sale evaluation.");
    return json({plan:await planInsert(s.id,p)},s.cookie);
  }
  const found=await planGet(s.id,b.planId);if(!found)throw new Error("Sale plan not found.");
  const decision=assertPreparable(found.plan,b.stepId,planContext(s.workspace,s.revision));
  const step=found.plan.steps.find(x=>x.id===b.stepId),choice=found.plan.alternatives.find(x=>x.id===found.plan.selectedChoiceId),q=choice?.saleQuote;
  if(!step||step.kind!=="sell"||!q||step.expected.amountRaw!==q.inputRaw||step.expected.asset!==q.request.asset.symbol||step.signer!==q.request.accountId)throw new Error("Sale step/source does not match the reviewed choice.");
  const retry=await preparationRetry(s.id,b.key,{kind:"sell",accountId:q.request.accountId,mandateVersion:s.workspace.mandate.version,amount:decimal(BigInt(q.inputRaw),q.request.asset.decimals)});
  if(retry){const p=retry.preparation as SalePreparation;if(!p.sale||p.sale.quote.venueId!==q.venueId||p.tokenId!==q.request.asset.id||p.sale.quote.request.netUsdcRaw!==q.request.netUsdcRaw)throw new Error("Sale idempotency conflict.");return json({...p,attemptId:retry.id},s.cookie);}
  if(decision.kind==="existing")throw new Error("Check the existing sale attempt.");
  const e=await readSaleEvidence(s.workspace,q.request.asset,q.request.accountId),v=saleVenue(q.venueId);
  const live=await v.quoteExactNet({...q.request,maxInputRaw:q.inputRaw},e,false);
  // Exact reviewed source quantity prevents silent exposure changes. Cheaper routes require a fresh review.
  if(live.inputRaw!==q.inputRaw)throw new Error("Sale input quantity changed; request a fresh plan before signing.");
  const p=v.prepareOperation(live,e);p.sale.workspaceRevision=s.revision;p.sale.mandateVersion=s.workspace.mandate.version;
  await checkPolicy(s.id,p.policyAction,s.workspace.policy!);
  const after=await session(r);if(after.revision!==s.revision)throw new Error("Workspace changed during sale preparation.");
  const a=await createAttempt(s.id,s.workspace.mandate.version,p,"sell",b.key);
  return json({...a.preparation,attemptId:a.id},s.cookie);
}catch(e){return failure(e);}}
