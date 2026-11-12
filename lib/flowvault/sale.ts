import type { SaleQuote, SaleRequest, SaleReconciliation, FundingChoice, VenueAsset } from "./contracts.ts";
import type { Policy, PolicyAction } from "./policy.ts";
import { units,decimal } from "./money.ts";
export interface SaleEvidence {
  asset: VenueAsset; accountId: string; walletRaw: bigint;
  /** Verified price upper/lower for ONE token, USDC raw × 10^asset.decimals / raw quantity. */
  valueUpper: (qty:bigint)=>bigint;
  valueLower: (qty:bigint)=>bigint;
  gasUsdcRaw: bigint; gasNativeRaw: bigint; nativeBalanceRaw: bigint;
  capturedAt:string; policy:Policy;
}
export interface SaleExecution {
  quote:SaleQuote;
  workspaceRevision:number; policyVersion:number; mandateVersion:number;
  sourceFinalized?:boolean;
  refundedRaw?:string;
  result?:SaleReconciliation;
  providerReport?:unknown;
  evmTx?:{chainId:string;from:string;to:string;value:"0x0";data:string};
}
export interface SalePreparation {
  kind:"sell"; accountId:string;asset:string;tokenId:string;amount:string;amountRaw:string;decimals:number;usdcValueRaw:string;
  transactions: {receiverId:string;actions:{type:"FunctionCall";params:{methodName:string;args:Record<string,unknown>;gas:string;deposit:string}}[]}[];
  expiresAt:string;policyAction:PolicyAction;sale:SaleExecution;warning:string;
}
export function salePermission(policy:Policy,asset:VenueAsset) {
  const row=policy.assetRows?.find(r=>r.asset.toLowerCase()===asset.symbol.toLowerCase() && r.chain===asset.chain);
  const reasons:string[]=[];
  if(!row?.uses.includes("sell")) reasons.push("SALE_PERMISSION_REQUIRED");
  if(policy.protectedAssets.some(s=>s.toLowerCase()===asset.symbol.toLowerCase())) reasons.push("PROTECTED_ASSET");
  if(!row?.sale || row.sale.tokenId.toLowerCase()!==asset.id.toLowerCase() || row.sale.decimals!==asset.decimals) reasons.push("SALE_IDENTITY_OR_LIMITS_UNVERIFIED");
  return {row,reasons,allowed:reasons.length===0};
}
export function guardSaleRequest(r:SaleRequest,e:SaleEvidence,now=Date.now()) {
  if(r.asset.id!==e.asset.id || r.asset.chain!==e.asset.chain || r.asset.decimals!==e.asset.decimals || r.asset.symbol!==e.asset.symbol || r.accountId!==e.accountId) throw new Error("Sale asset/account identity changed.");
  if(!/^\d+$/.test(r.netUsdcRaw)||BigInt(r.netUsdcRaw)<=0n||!/^\d+$/.test(r.maxInputRaw)||BigInt(r.maxInputRaw)<=0n)throw new Error("Invalid sale units.");
  if(!Number.isFinite(Date.parse(e.capturedAt))||Math.abs(now-Date.parse(e.capturedAt))>180000) throw new Error("Stale sale evidence.");
  const p=salePermission(e.policy,r.asset);
  if(!p.allowed)throw new Error(p.reasons.join("; "));
  if(!Number.isInteger(r.slippageBps)||r.slippageBps<0||r.slippageBps>p.row!.sale!.maxSlippageBps)throw new Error("Sale slippage limit exceeded.");
  if(BigInt(r.maxInputRaw)>BigInt(p.row!.sale!.maxQuantityRaw))throw new Error("Sale quantity limit exceeded.");
  if(e.gasUsdcRaw<0n||e.gasNativeRaw<=0n||e.nativeBalanceRaw<e.gasNativeRaw)throw new Error("Sale gas evidence unavailable/insufficient.");
}
export function guardSaleQuote(q:SaleQuote,e:SaleEvidence,now=Date.now()) {
  guardSaleRequest(q.request,e,now);
  if(!Number.isFinite(Date.parse(q.expiresAt))||Date.parse(q.expiresAt)<=now)throw new Error("Sale quote expired.");
  for(const n of [q.inputRaw,q.minInputRaw,q.minProceedsUsdcRaw,q.inputValueUsdcRaw,q.costsUsdcRaw,q.refundableBufferUsdcRaw])if(!/^\d+$/.test(n))throw new Error("Unverified sale amount.");
  const input=BigInt(q.inputRaw),lo=BigInt(q.minInputRaw);
  if(input<=0n||lo<=0n||input<lo||input>BigInt(q.request.maxInputRaw)||input>e.walletRaw||BigInt(q.minProceedsUsdcRaw)<BigInt(q.request.netUsdcRaw))throw new Error("Sale lacks exact-net liquidity or exceeds wallet/size limit.");
  const permission=salePermission(e.policy,q.request.asset);
  if(e.valueUpper(input)>units(permission.row!.sale!.maxValueUsdc)||e.valueUpper(input)>units(e.policy.perActionCap))throw new Error("Sale USDC size limit exceeded.");
  if(e.valueUpper(input)>BigInt(q.inputValueUsdcRaw))throw new Error("Sale valuation increased; review again.");
  if(BigInt(q.costsUsdcRaw)+e.gasUsdcRaw>units(e.policy.maxMoveCost))throw new Error("Sale cost limit exceeded.");
  // Route price versus verified spot bounds: reject illiquidity/price impact outside saved slippage.
  const lower=e.valueLower(lo),net=BigInt(q.minProceedsUsdcRaw);
  if(lower>net && (lower-net)*10000n>lower*BigInt(q.request.slippageBps))throw new Error("Sale price impact exceeds saved slippage.");
}
export function reconcileSale(q:SaleQuote,p:{inputRaw:string;refundRaw:string|null;proceedsUsdcRaw:string|null;finalized:boolean}):SaleReconciliation {
  const reasons:string[]=[];
  if(!p.finalized)reasons.push("FINALIZED_SALE_PROOF_REQUIRED");
  if(p.refundRaw===null)reasons.push("LEFTOVERS_UNVERIFIED");
  if(p.proceedsUsdcRaw===null)reasons.push("PROCEEDS_UNVERIFIED");
  const valid=/^\d+$/.test(p.inputRaw)&&p.inputRaw===q.inputRaw&&p.refundRaw!==null&&/^\d+$/.test(p.refundRaw)&&BigInt(p.refundRaw)<=BigInt(p.inputRaw);
  if(!valid)reasons.push("SOLD_QUANTITY_UNVERIFIED");
  if(p.proceedsUsdcRaw!==null&&(!/^\d+$/.test(p.proceedsUsdcRaw)||BigInt(p.proceedsUsdcRaw)<BigInt(q.request.netUsdcRaw)))reasons.push("NET_PAYMENT_SHORT");
  const complete=reasons.length===0;
  return {soldRaw:valid&&p.finalized?(BigInt(p.inputRaw)-BigInt(p.refundRaw!)).toString():null,proceedsUsdcRaw:p.finalized?p.proceedsUsdcRaw:null,leftoversRaw:p.finalized?p.refundRaw:null,acquisitionHistoryMissing:true,realizedPnlUsdcRaw:null,complete,reasons};
}
export function saleFundingChoice(q:SaleQuote):FundingChoice {
  return {id:`sell:${q.venueId}:${q.request.asset.chain}:${q.request.asset.id}`,kind:"sell",eligible:true,reasons:[],amountUsdcRaw:q.request.netUsdcRaw,costsUsdcRaw:q.costsUsdcRaw,foregoneUsdcRaw:null,interestUsdcRaw:null,healthAfter:null,availableAt:q.capturedAt.slice(0,10),steps:["sell","pay_quote","pay_deposit","verify_payout"],venueId:q.venueId,accountId:q.request.accountId,chain:q.request.asset.chain,saleQuote:q};
}
export function salePreparation(q:SaleQuote,e:SaleEvidence,transactions:SalePreparation["transactions"],evmTx?:SaleExecution["evmTx"]):SalePreparation {
  guardSaleQuote(q,e);
  const near=q.request.asset.chain==="near",r=q.request;
  const method=q.venueId==="rhea-ref"?"ft_transfer_call":near?"ft_transfer":"0xa9059cbb";
  const venue=q.venueId==="rhea-ref"?"v2.ref-finance.near":"1click";
  return {kind:"sell",accountId:r.accountId,asset:r.asset.symbol,tokenId:r.asset.id,amount:decimal(BigInt(q.inputRaw),r.asset.decimals),amountRaw:q.inputRaw,decimals:r.asset.decimals,usdcValueRaw:q.inputValueUsdcRaw,transactions,expiresAt:q.expiresAt,
    policyAction:{kind:"sell",asset:r.asset.symbol,amount:decimal(BigInt(q.inputValueUsdcRaw)),recipient:r.accountId,venue,movingCost:decimal(BigInt(q.costsUsdcRaw)+e.gasUsdcRaw),gasNear:near?decimal(e.gasNativeRaw,24):"0",source:"live",accountId:r.accountId,chain:r.asset.chain,methods:[{receiver:r.asset.id,method,...(q.venueId==="rhea-ref"?{nestedReceiver:venue}:{})}]},
    sale:{quote:q,workspaceRevision:-1,policyVersion:e.policy.version,mandateVersion:-1,evmTx},warning:"Owner-approved asset sale. Acquisition history missing: realized PnL unavailable. Payment waits for verified net USDC; uncertain/refund states never auto-resubmit."};
}
