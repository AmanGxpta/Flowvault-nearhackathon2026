// A borrow-to-payment choice carries its own future settlement leg, never current-wallet cash.
import type { FundingChoice, FundingLeg, MultiSourceFunding, ActionPlan } from "./contracts.ts";
import type { AaveState } from "./aave-live.ts";
import { aaveVenue, aaveRisk } from "./aave.ts";
import type { Workspace } from "./types.ts";
import { accountId } from "./account-registry.ts";
import { EVM_CHAINS } from "./evm.ts";
import { units, decimal } from "./money.ts";
import { carry } from "./money.ts";
export interface CreditSettlement { leg: FundingLeg; debtBeforeUsdcRaw: string; borrowApr: string; minHealth: string }
export interface CreditFundingChoice extends FundingChoice { creditSettlement?: CreditSettlement }
export async function aavePaymentChoice(st:AaveState,w:Workspace,net:bigint,date:string|null,approved:boolean,now=Date.now()):Promise<CreditFundingChoice> {
  const venue=aaveVenue(st.chain),base=venue.fundingChoice(st,w.policy,net,date,approved,now),cap=aaveRisk(st,w.policy,now);
  if(!w.accountId || net<=0n || base.reasons.some(x=>x!=="CROSS_CHAIN_USDC_SETTLEMENT_REQUIRED")) return base;
  try{
    const {legQuote,legRequest,evmGasNeed,nearUsdcRegistered}=await import("./funding-mesh-live.ts");
    const {rateFromQuote,sendFor}=await import("./funding-mesh.ts");
    const network=st.chain==="eth"?"ethereum":st.chain==="arb"?"arbitrum":"base";
    if(!await nearUsdcRegistered(w.accountId)) throw new Error("NEAR_USDC_STORAGE_REQUIRED");
    const first=await legQuote(await legRequest(network,st.accountId,w.accountId,net.toString()),true);
    let amount=sendFor(net,rateFromQuote(BigInt(first.amountInRaw),BigInt(first.minAmountOutRaw)));
    let q=await legQuote(await legRequest(network,st.accountId,w.accountId,amount.toString()),true);
    if(BigInt(q.minAmountOutRaw)<net){amount=sendFor(net,rateFromQuote(amount,BigInt(q.minAmountOutRaw)));q=await legQuote(await legRequest(network,st.accountId,w.accountId,amount.toString()),true);}
    if(BigInt(q.minAmountOutRaw)<net) throw new Error("SETTLEMENT_NET_SHORT");
    const c=venue.fundingChoice(st,w.policy,amount,date,approved,now);
    const reasons=c.reasons.filter(x=>x!=="CROSS_CHAIN_USDC_SETTLEMENT_REQUIRED");
    const gas=(await evmGasNeed(network))+st.l1FeeUpperWei*2n,eth=st.reserves.find(x=>x.asset.symbol==="WETH");
    if(!eth || st.nativeBalance<gas+st.gasPrice*2_000_000n+st.l1FeeUpperWei*2n) reasons.push("BORROW_AND_SETTLEMENT_GAS_SHORT");
    const gasUsdc=eth?cap.value(eth,gas,true):null;
    if(gasUsdc===null) reasons.push("SETTLEMENT_GAS_UNKNOWN");
    const borrowFee=eth?cap.value(eth,st.gasPrice*2_000_000n+st.l1FeeUpperWei*2n,true):null;
    const cost=amount-BigInt(q.minAmountOutRaw)+(gasUsdc??0n)+(borrowFee??0n);
    if(w.policy && cost>units(w.policy.maxMoveCost)) reasons.push("BORROW_SETTLEMENT_COST_CAP");
    const leg:FundingLeg={id:`credit:${st.chain}:${st.accountId}`,accountId:accountId("evm",st.accountId),network,address:st.accountId,label:venue.id+" borrowed USDC",asset:"USDC",operation:"oneclick_deposit",signer:accountId("evm",st.accountId),signing:"eip1193",amountRaw:amount.toString(),minNetRaw:net.toString(),costsUsdcRaw:cost.toString(),gas:{asset:"ETH",amountRaw:gas.toString(),usdcRaw:gasUsdc?.toString()??null},stepKind:"fund_transfer",rationale:"After the confirmed Aave borrow, owner signs the EVM USDC settlement. Payment waits for canonical NEAR-USDC delivery proof.",eligible:reasons.length===0,reasons};
    return {...c,eligible:reasons.length===0,reasons,steps:["borrow","fund_transfer","credit_settlement","pay_quote","pay_deposit","verify_payout"],costsUsdcRaw:(cost+BigInt(c.interestUsdcRaw??"0")).toString(),availableAt:new Date(now).toISOString().slice(0,10),creditSettlement:{leg,debtBeforeUsdcRaw:cap.debtRaw.toString(),borrowApr:decimal(cap.debt.aprRay,27),minHealth:decimal(cap.minHealth)}};
  }catch(e){return {...base,reasons:[...base.reasons,"SETTLEMENT_UNAVAILABLE: "+(e as Error).message]};}
}
/** Keep the borrow → transfer → independent delivery → payment dependency chain intact. */
export function wireCreditSettlement(plan:ActionPlan & {funding?:MultiSourceFunding},choice:CreditFundingChoice) {
  const s=choice.creditSettlement;if(!s || !plan.accountId) throw new Error("Reviewed credit settlement missing.");
  const leg=s.leg;
  plan.funding={target:{accountId:plan.accountId,network:"near",asset:"USDC",amountRaw:leg.minNetRaw},mode:"single",legs:[leg],netToTargetRaw:leg.minNetRaw,costsUsdcRaw:leg.costsUsdcRaw,comparison:[],atomic:false,explanation:[leg.rationale],capturedAt:plan.createdAt};
  const borrow=plan.steps.find(x=>x.kind==="borrow")!,transfer=plan.steps.find(x=>x.kind==="fund_transfer")!,verify=plan.steps.find(x=>x.kind==="credit_settlement")!;
  borrow.signer=leg.address;borrow.expected.venue=choice.venueId;borrow.expected.amountRaw=choice.amountUsdcRaw;borrow.expected.asset="USDC";
  transfer.signer=leg.signer;transfer.expected={amountRaw:leg.amountRaw,asset:"USDC",usdcRaw:leg.amountRaw,legId:leg.id,venue:leg.network,note:leg.rationale};
  verify.expected={amountRaw:leg.minNetRaw,asset:"USDC",legId:leg.id,note:"Independent source payload and canonical NEAR USDC receipt proof"};
  plan.effects.debtAfterUsdcRaw=(BigInt(s.debtBeforeUsdcRaw)+BigInt(choice.amountUsdcRaw)).toString();
  plan.effects.costsUsdcRaw=choice.costsUsdcRaw;
}
