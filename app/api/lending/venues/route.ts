import { planGet, planIdFor, planInsert } from "@/lib/flowvault/plans-store";
import { planContext } from "@/lib/flowvault/plans";
import { aaveOperationPlan } from "@/lib/flowvault/aave-plans";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { mayRead } from "@/lib/flowvault/account-registry";
import { AAVE_MARKETS, type AaveChain } from "@/lib/flowvault/aave-markets";
import { aaveVenue, isAave } from "@/lib/flowvault/aave";
import { aaveHoldback } from "@/lib/flowvault/aave-journal";
import { createAttempt, preparationRetry } from "@/lib/flowvault/attempts";
import { checkPolicy } from "@/lib/flowvault/policy-store";
import { defaultPolicy, preparationAction } from "@/lib/flowvault/policy";
import { units, decimal } from "@/lib/flowvault/money";
import { LENDING_KINDS, type LendingKind } from "@/lib/flowvault/lending";
const chainSchema=z.enum(["eth","base","arb"]);
export async function GET(r:Request) {
  try {
    const s=await session(r), u=new URL(r.url);
    if(s.workspace.mode!=="live") return json({source:s.workspace.mode,markets:AAVE_MARKETS,snapshot:null,reasons:["EXAMPLE_WORKSPACE_NO_LIVE_CREDIT"]},s.cookie);
    const chain=chainSchema.parse(u.searchParams.get("chain")),account=u.searchParams.get("account")??"";
    if(!mayRead(s.workspace,"evm",account)) throw new Error("Prove this EVM account through its wallet first.");
    const v=aaveVenue(chain), state=await v.read(account);
    return json({source:"live",snapshot:v.inspect(state,s.workspace.policy),eMode:state.eMode,markets:AAVE_MARKETS,revision:s.revision},s.cookie);
  }catch(e){return failure(e);}
}
export async function POST(r:Request) {
  try {
    mutation(r); const s=await session(r);
    const b=z.object({action:z.enum(["plan","prepare"]).default("prepare"),chain:chainSchema,account:z.string(),kind:z.enum(LENDING_KINDS as [LendingKind,...LendingKind[]]),asset:z.string(),amount:z.string(),key:z.string().uuid(),approveNewDebt:z.boolean().default(false)}).strict().parse(await r.json());
    if(s.workspace.mode!=="live" || !mayRead(s.workspace,"evm",b.account)) throw new Error("Open the proven EVM account in your live workspace.");
    const m=AAVE_MARKETS[b.chain as AaveChain], asset=[...m.collateral,m.debt].find(x=>x.symbol===b.asset);
    if(!asset) throw new Error("Unsupported collateral/debt asset.");
    const amount=units(b.amount,asset.decimals),account=b.account.toLowerCase();
    if(b.action==="plan") {
      const id=await planIdFor(s.id,b.key),old=await planGet(s.id,id);
      if(old) {
        if(old.plan.accountId!==account || old.plan.request.venue!==m.id || old.plan.request.asset!==b.asset || old.plan.request.amountRaw!==amount.toString() || old.plan.alternatives[0]?.steps[0]!==b.kind) throw new Error("Plan idempotency conflict.");
        return json({plan:old.plan},s.cookie);
      }
      const v=aaveVenue(b.chain),st=await v.read(account);
      const p=v.prepareOperation(st,s.workspace.policy,{kind:b.kind,asset:b.asset,amountRaw:amount,approveNewDebt:true,holdbackRaw:b.kind==="repay"?await aaveHoldback(s.workspace):undefined});
      const current=await session(r);
      if(current.revision!==s.revision) throw new Error("Workspace changed while evaluating Aave plan.");
      return json({plan:await planInsert(s.id,aaveOperationPlan(id,b.key,p,planContext(s.workspace,s.revision)))},s.cookie);
    }
    const retry=await preparationRetry(s.id,b.key,{kind:b.kind,accountId:account,mandateVersion:s.workspace.mandate.version,amount:decimal(amount,asset.decimals)});
    if(retry) {
      if(!isAave(retry.preparation) || retry.preparation.evm.chain!==b.chain || retry.preparation.asset!==b.asset) throw new Error("Lending idempotency conflict.");
      return json({...retry.preparation,attemptId:retry.id},s.cookie);
    }
    const v=aaveVenue(b.chain),p=v.prepareOperation(await v.read(account),s.workspace.policy,{kind:b.kind,asset:b.asset,amountRaw:amount,approveNewDebt:b.approveNewDebt,holdbackRaw:b.kind==="repay"?await aaveHoldback(s.workspace):undefined});
    p.evm!.workspaceRevision=s.revision;p.evm!.policyVersion=s.workspace.policy?.version??1;
    await checkPolicy(s.id,preparationAction(p,b.kind),s.workspace.policy??defaultPolicy());
    const current=await session(r);
    if(current.revision!==s.revision || !mayRead(current.workspace,"evm",account)) throw new Error("Workspace changed during preparation.");
    const a=await createAttempt(s.id,s.workspace.mandate.version,p,b.kind,b.key);
    return json({...a.preparation,attemptId:a.id},s.cookie);
  }catch(e){return failure(e);}
}
