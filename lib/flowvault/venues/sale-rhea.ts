import type { SaleVenueAdapter, SaleQuote } from "../contracts.ts";
import type { SalePreparation, SaleEvidence } from "../sale.ts";
import { guardSaleRequest,guardSaleQuote,reconcileSale,salePreparation } from "../sale.ts";
import { view } from "../near.ts";
import { LENDING_USDC } from "../lending.ts";
import { ceil } from "../aave-abi.ts";
export const REF="v2.ref-finance.near";
export interface RefPool {pool_kind:string;token_account_ids:string[];amounts:string[];total_fee:number;id:number}
let cache:{at:number;pools:RefPool[]}|null=null;
/** Real simple pools only. Stable/CLMM math is intentionally unavailable here. */
export async function refPools():Promise<RefPool[]> {
  if(cache&&Date.now()-cache.at<300000)return cache.pools;
  const n=Number((await view<string>(REF,"get_number_of_pools")).data);
  if(!Number.isSafeInteger(n)||n<0||n>20000)throw new Error("Rhea pool discovery bound exceeded.");
  const pools:RefPool[]=[];
  // Bound in-flight RPCs while covering the complete onchain simple-pool catalog.
  for(let start=0;start<n;start+=1000){
    const pages=await Promise.all(Array.from({length:Math.min(10,Math.ceil((n-start)/100))},(_,i)=>view<any[]>(REF,"get_pools",{from_index:start+i*100,limit:100}).then(r=>r.data.map((p,j)=>({...p,id:start+i*100+j})))));
    pools.push(...pages.flat());
  }
  cache={at:Date.now(),pools};return pools;
}
/** Inverse constant product, rounded UP; caller verifies via get_return before signing. */
export function refInputForNet(pool:RefPool,token:string,net:bigint,slippageBps:number) {
  if(pool.pool_kind!=="SIMPLE_POOL"||pool.token_account_ids.length!==2||pool.amounts.length!==2||!pool.amounts.every(x=>/^\d+$/.test(x))||!Number.isInteger(pool.total_fee)||pool.total_fee<0||pool.total_fee>=10000)throw new Error("Unsupported/invalid Rhea pool.");
  const i=pool.token_account_ids.indexOf(token),j=pool.token_account_ids.indexOf(LENDING_USDC);
  if(i<0||j<0||i===j||net<=0n||!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>1000)throw new Error("No direct liquid Rhea sale route.");
  const x=BigInt(pool.amounts[i]),y=BigInt(pool.amounts[j]),target=ceil(net*10000n,BigInt(10000-slippageBps));
  if(x<=0n||y<=target)throw new Error("Rhea sale liquidity insufficient.");
  return ceil(x*target*10000n,(y-target)*BigInt(10000-pool.total_fee));
}
export const rheaSaleVenue:SaleVenueAdapter<SalePreparation,SaleEvidence>={
  id:"rhea-ref",supports:a=>a.chain==="near"&&a.id!==LENDING_USDC,
  async quoteExactNet(r,e,dry){
    guardSaleRequest(r,e);if(r.asset.chain!=="near"||r.accountId!==r.recipient)throw new Error("Rhea sale requires the same proven NEAR owner.");
    const [whitelist,metadata,registration]=await Promise.all([view<string[]>(REF,"get_whitelisted_tokens"),view<any>(REF,"get_metadata"),view<any>(REF,"storage_balance_of",{account_id:r.accountId})]);
    if(metadata.data?.state!=="Running"||!registration.data||!whitelist.data.includes(r.asset.id)||!whitelist.data.includes(LENDING_USDC))throw new Error("Rhea running mode, registration or token whitelist unavailable.");
    const candidates=(await refPools()).filter(p=>p.pool_kind==="SIMPLE_POOL"&&p.token_account_ids.length===2&&p.token_account_ids.includes(r.asset.id)&&p.token_account_ids.includes(LENDING_USDC));
    const sizes=candidates.flatMap(pool=>{try{return [{pool,input:refInputForNet(pool,r.asset.id,BigInt(r.netUsdcRaw),r.slippageBps)}];}catch{return [];}}).sort((a,b)=>a.input<b.input?-1:a.input>b.input?1:0);
    if(!sizes.length)throw new Error("No liquid supported direct Rhea simple-pool sale route.");
    const selected=sizes[0],actual=(await view<string>(REF,"get_return",{pool_id:selected.pool.id,token_in:r.asset.id,amount_in:selected.input.toString(),token_out:LENDING_USDC})).data;
    if(!/^\d+$/.test(actual)||BigInt(actual)<BigInt(r.netUsdcRaw))throw new Error("Rhea exact-net liquidity unverified.");
    const minInput=refInputForNet(selected.pool,r.asset.id,BigInt(r.netUsdcRaw),0);
    const value=e.valueUpper(selected.input),minValue=e.valueUpper(minInput),net=BigInt(r.netUsdcRaw);
    const q:SaleQuote={venueId:"rhea-ref",request:r,dry,inputRaw:selected.input.toString(),minInputRaw:minInput.toString(),minProceedsUsdcRaw:r.netUsdcRaw,inputValueUsdcRaw:value.toString(),costsUsdcRaw:(minValue>net?minValue-net:0n).toString(),refundableBufferUsdcRaw:"0",capturedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+180000).toISOString(),evidence:{poolId:selected.pool.id,quotedReturnRaw:actual}};
    guardSaleQuote(q,e);return q;
  },
  prepareOperation(q,e){
    if(q.dry)throw new Error("A Rhea sale preview is not signable.");
    const pool=(q.evidence as {poolId:number}).poolId;
    if(!Number.isSafeInteger(pool)||pool<0)throw new Error("Unknown Rhea sale pool.");
    return salePreparation(q,e,[{receiverId:q.request.asset.id,actions:[{type:"FunctionCall",params:{methodName:"ft_transfer_call",args:{receiver_id:REF,amount:q.inputRaw,msg:JSON.stringify({force:0,actions:[{pool_id:pool,token_in:q.request.asset.id,token_out:LENDING_USDC,amount_in:q.inputRaw,min_amount_out:q.request.netUsdcRaw}]})},gas:"250000000000000",deposit:"1"}}]}]);
  },reconcile:reconcileSale,
};
