import { decimal, units } from "./money.ts";
import { safeTokenIcon, type TokenMetadata } from "./wallet-research.ts";
export interface SwapToken { id:string; network:string; contract:string; symbol:string; name:string; decimals:number; assetId?:string; icon?:string; price?:string }
export function swapCatalog(raw:unknown, metadata:Record<string,TokenMetadata>):SwapToken[] {
  if(!Array.isArray(raw))throw new Error("Token catalog unavailable.");
  const all=new Map<string,SwapToken>();
  for(const t of raw.slice(0,2000)) {
    if(!t || typeof t.assetId!=="string" || typeof t.blockchain!=="string" || !/^[a-z0-9_-]{2,30}$/.test(t.blockchain) || typeof t.symbol!=="string" || !Number.isInteger(t.decimals)||t.decimals<0||t.decimals>36)continue;
    const contract=typeof t.contractAddress==="string"?t.contractAddress:"native",id=t.blockchain+":"+contract;
    const m=t.blockchain==="near"?metadata[contract]:undefined;
    if(m && m.decimals!==t.decimals)continue;
    all.set(id,{id,network:t.blockchain,contract,symbol:t.symbol.slice(0,32),name:m?.name || t.symbol,decimals:t.decimals,assetId:t.assetId,icon:safeTokenIcon(m?.icon),price:typeof t.price==="number"&&Number.isFinite(t.price)&&t.price>0?String(t.price):undefined});
  }
  for(const [contract,m] of Object.entries(metadata)) {
    if(!/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(contract))continue;
    const id="near:"+contract;
    if(!all.has(id))all.set(id,{id,network:"near",contract,...m});
  }
  // Native NEAR quotes on NEAR Intents as wNEAR (nep141:wrap.near), the asset 1Click settles NEAR in.
  const wrapped=all.get("near:wrap.near");
  all.set("near:native",{id:"near:native",network:"near",contract:"native",symbol:"NEAR",name:"NEAR Protocol · native",decimals:24,...(wrapped?.assetId?{assetId:wrapped.assetId}:{}),...(wrapped?.price?{price:wrapped.price}:{})});
  return [...all.values()];
}
export function swapAmount(amount:string,token:SwapToken) {const raw=units(amount,token.decimals);if(raw<=0n)throw new Error("Enter an amount above zero.");return raw.toString();}
export function swapVenueUrl(from:SwapToken,to:SwapToken):string {
  if(from.network==="near" && to.network==="near")return "https://app.rhea.finance/#"+encodeURIComponent(from.contract==="native"?"near":from.contract)+"|"+encodeURIComponent(to.contract==="native"?"near":to.contract);
  return "https://near-intents.org/";
}
export function preview1Click(body:unknown,sent:Record<string,unknown>,from:SwapToken,to:SwapToken) {
  const b=body as {quoteRequest?:Record<string,unknown>;quote?:Record<string,unknown>};
  const q=b?.quote,e=b?.quoteRequest;
  if(!q||!e)throw new Error("NEAR Intents returned no usable quote.");
  for(const k of ["dry","swapType","originAsset","destinationAsset","amount","depositType","recipientType","refundType","recipient","refundTo","slippageTolerance"])if(e[k]!==sent[k])throw new Error("Quote does not match the requested pair, amount or addresses.");
  if(q.depositAddress || q.depositMemo || q.amountIn!==sent.amount || !/^\d{1,80}$/.test(String(q.amountOut))||!/^\d{1,80}$/.test(String(q.minAmountOut)))throw new Error("Invalid preview bounds.");
  const out=BigInt(String(q.amountOut)),min=BigInt(String(q.minAmountOut));
  if(min<=0n||out<min)throw new Error("Invalid minimum received.");
  return {venue:"NEAR Intents",output:decimal(out,to.decimals),minimum:decimal(min,to.decimals),eta:typeof q.timeEstimate==="number"&&Number.isFinite(q.timeEstimate)?q.timeEstimate:null,
    input:decimal(BigInt(String(q.amountIn)),from.decimals),execution:"external" as const,url:"https://near-intents.org/",feeNote:"Output reflects the provider quote. Source-chain gas is additional; inspect the final fee breakdown at the venue."};
}
