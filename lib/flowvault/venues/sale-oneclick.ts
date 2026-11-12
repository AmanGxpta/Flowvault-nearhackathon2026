import type { SaleVenueAdapter, SaleRequest, SaleQuote } from "../contracts.ts";
import type { SalePreparation, SaleEvidence } from "../sale.ts";
import { guardSaleRequest, guardSaleQuote, reconcileSale, salePreparation } from "../sale.ts";
import { calldata } from "../aave-abi.ts";
import { EVM_CHAINS, validEvm } from "../evm.ts";
import { validAccount } from "../near.ts";
import { LENDING_USDC } from "../lending.ts";
const URL="https://1click.chaindefuser.com/v0";
export interface SaleToken {assetId:string;blockchain:string;contractAddress:string;decimals:number;symbol:string}
export async function saleCatalog():Promise<SaleToken[]> {
  const r=await fetch(URL+"/tokens",{signal:AbortSignal.timeout(10000)}),v=await r.json();
  if(!r.ok||!Array.isArray(v))throw new Error("Sale token catalog unavailable.");return v;
}
export function catalogAsset(tokens:SaleToken[],r:SaleRequest) {
  const a=r.asset;
  const matches=tokens.filter(t=>t.blockchain===a.chain&&t.contractAddress?.toLowerCase()===a.id.toLowerCase()&&t.symbol===a.symbol&&t.decimals===a.decimals);
  if(matches.length!==1 || !matches[0].assetId.startsWith("nep141:"))throw new Error("Sale token identity/decimals not uniquely present in 1Click catalog.");
  return matches[0];
}
export function saleQuoteBody(r:SaleRequest,origin:string,destination:string,dry:boolean,now=Date.now()) {
  return {dry,swapType:"EXACT_OUTPUT",originAsset:origin,destinationAsset:destination,amount:r.netUsdcRaw,slippageTolerance:r.slippageBps,depositType:"ORIGIN_CHAIN",recipient:r.recipient,recipientType:"DESTINATION_CHAIN",refundTo:r.accountId,refundType:"ORIGIN_CHAIN",deadline:new Date(now+180000).toISOString()};
}
export function checkSaleQuote(r:SaleRequest,sent:ReturnType<typeof saleQuoteBody>,body:any,e:SaleEvidence):SaleQuote {
  const q=body?.quote,echo=body?.quoteRequest;
  if(!q||!echo)throw new Error("1Click sale has no quote.");
  for(const k of Object.keys(sent) as (keyof typeof sent)[])if(echo[k]!==sent[k])throw new Error("Sale quote echo mismatch: "+k);
  for(const k of ["amountIn","minAmountIn","amountOut","minAmountOut"])if(typeof q[k]!=="string"||!/^\d+$/.test(q[k]))throw new Error("Sale quote amount unverified.");
  if(q.amountOut!==r.netUsdcRaw||BigInt(q.minAmountOut)<BigInt(r.netUsdcRaw)||BigInt(q.amountIn)<BigInt(q.minAmountIn))throw new Error("Sale exact-net output mismatch.");
  if(sent.dry ? !!q.depositAddress : !(typeof q.depositAddress==="string"&&(r.asset.chain==="near"?validAccount(q.depositAddress):validEvm(q.depositAddress))))throw new Error("Sale deposit address unavailable/unsafe.");
  const max=e.valueUpper(BigInt(q.amountIn)),lo=e.valueUpper(BigInt(q.minAmountIn)),net=BigInt(r.netUsdcRaw);
  const result:SaleQuote={venueId:"1click",request:r,dry:sent.dry,inputRaw:q.amountIn,minInputRaw:q.minAmountIn,minProceedsUsdcRaw:q.minAmountOut,inputValueUsdcRaw:max.toString(),costsUsdcRaw:(lo>net?lo-net:0n).toString(),refundableBufferUsdcRaw:(max-lo).toString(),capturedAt:new Date().toISOString(),expiresAt:sent.deadline,evidence:body};
  guardSaleQuote(result,e);return result;
}
export const oneClickSaleVenue:SaleVenueAdapter<SalePreparation,SaleEvidence>={
  id:"1click",supports:a=>["near","eth","base","arb"].includes(a.chain),
  async quoteExactNet(r,e,dry){
    guardSaleRequest(r,e);if(!validAccount(r.recipient))throw new Error("Sale proceeds must reach your NEAR account.");
    const tokens=await saleCatalog(),origin=catalogAsset(tokens,r),destination=catalogAsset(tokens,{...r,asset:{id:LENDING_USDC,symbol:"USDC",decimals:6,chain:"near"}});
    const sent=saleQuoteBody(r,origin.assetId,destination.assetId,dry);
    const res=await fetch(URL+"/quote",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(sent),signal:AbortSignal.timeout(15000)});
    const body:any=await res.json();if(!res.ok)throw new Error("Sale route unavailable: "+(body?.message??res.status));
    return checkSaleQuote(r,sent,body,e);
  },
  prepareOperation(q,e){
    if(q.dry)throw new Error("A dry sale quote cannot be signed.");
    const deposit=(q.evidence as any)?.quote?.depositAddress;
    const a=q.request.asset;
    if(a.chain==="near")return salePreparation(q,e,[{receiverId:a.id,actions:[{type:"FunctionCall",params:{methodName:"ft_transfer",args:{receiver_id:deposit,amount:q.inputRaw},gas:"50000000000000",deposit:"1"}}]}]);
    if(!["eth","base","arb"].includes(a.chain))throw new Error("Unsupported sale signer.");
    return salePreparation(q,e,[],{chainId:"0x"+EVM_CHAINS[a.chain as "eth"|"base"|"arb"].chainId.toString(16),from:q.request.accountId,to:a.id,value:"0x0",data:calldata("transfer(address,uint256)",deposit,BigInt(q.inputRaw))});
  },
  reconcile:reconcileSale,
};
