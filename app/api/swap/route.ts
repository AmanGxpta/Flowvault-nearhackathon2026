import { publicJson } from "@/lib/flowvault/research-service";
import { swapTokenCatalog as catalog } from "@/lib/flowvault/swap-catalog";
import { swapAmount, swapVenueUrl, preview1Click } from "@/lib/flowvault/swap-explorer";
import { researchAddress } from "@/lib/flowvault/research";
import { decimal } from "@/lib/flowvault/money";
const EVM_DEST=["eth","base","arb","bsc","op","pol","avax","gnosis","hypercore","hood","abs","bera","monad","scroll","xlayer","plasma"];
const evmAddress=(v:string)=>{const a=v.trim();if(!/^0x[0-9a-fA-F]{40}$/.test(a))throw new Error("Enter a valid Ethereum-style address.");return a.toLowerCase();};
export async function GET(){try{return Response.json({tokens:await catalog(),capturedAt:new Date().toISOString(),coverage:"1Click listed assets and Ref metadata. A listing is not a safety endorsement or a guarantee of liquidity."},{headers:{"Cache-Control":"no-store"}});}catch(e){return Response.json({error:(e as Error).message},{status:503});}}
/** Dry public quotes only. Never generates a deposit address, signs, or alters personal policy. */
export async function POST(request:Request){try{
  const body=await request.json() as {from?:string;to?:string;amount?:string;slippage?:number;sender?:string;recipient?:string};
  const tokens=await catalog(),from=tokens.find(t=>t.id===body.from),to=tokens.find(t=>t.id===body.to);
  if(!from||!to||from.id===to.id)throw new Error("Choose two different catalog assets.");
  const amount=swapAmount(String(body.amount??""),from),bps=body.slippage;
  if(!Number.isInteger(bps)||Number(bps)<10||Number(bps)>500)throw new Error("Slippage must be between 0.1% and 5%.");
  const now=Date.now(),warnings:string[]=[],routes:unknown[]=[];
  async function ref(){
    if(from!.network!=="near"||to!.network!=="near")return;
    const input=from!.contract==="native"?"wrap.near":from!.contract,output=to!.contract==="native"?"wrap.near":to!.contract;
    if(input===output){warnings.push("Wrapping and unwrapping NEAR is not a DEX swap. Use the venue’s wrap control.");return;}
    try {
      const p=new URLSearchParams({amountIn:amount,tokenIn:input,tokenOut:output,pathDeep:"3",slippage:String(Number(bps)/10000)});
      const data=await publicJson("https://smartrouter.ref.finance/findPath?"+p) as {result_code?:number;result_data?:{amount_out?:string;routes?:{pools?:{token_in?:string;token_out?:string;min_amount_out?:string}[]}[]}};
      const out=data.result_data?.amount_out;
      const paths=data.result_data?.routes;
      if(data.result_code!==0 || typeof out!=="string" || !/^\d{1,80}$/.test(out)||BigInt(out)<=0n||!paths?.length)throw new Error("No liquid Ref route for this amount.");
      // Every split must terminate in the selected output; totals remain bigint.
      let minimum=0n;
      for(const path of paths){const pools=path.pools;if(!pools?.length||pools[0].token_in!==input||pools.at(-1)?.token_out!==output)throw new Error("Ref returned a different pair.");for(let i=1;i<pools.length;i++)if(pools[i].token_in!==pools[i-1].token_out)throw new Error("Ref returned a disconnected path.");const min=pools.at(-1)?.min_amount_out;if(typeof min!=="string"||!/^\d{1,80}$/.test(min))throw new Error("Minimum received unavailable.");minimum+=BigInt(min);}
      if(minimum<=0n||minimum>BigInt(out))throw new Error("Ref bounds unavailable.");
      routes.push({venue:"Rhea / Ref",output:decimal(BigInt(out),to!.decimals),minimum:decimal(minimum,to!.decimals),eta:null,execution:"external",url:swapVenueUrl(from!,to!),feeNote:"Pool fees are reflected in the quote. Wallet gas and storage may be additional. The venue requotes before signing."});
    }catch(e){warnings.push((e as Error).message);}
  }
  async function intents(){
    if(!from!.assetId||!to!.assetId)return;
    // Deposits start from NEAR, Ethereum, Base or Arbitrum; delivery can go to NEAR or any network with Ethereum addresses (incl. Hyperliquid).
    if(!["near","eth","base","arb"].includes(from!.network)||!(to!.network==="near"||EVM_DEST.includes(to!.network))){warnings.push("Cross-chain previews start from NEAR, Ethereum, Base or Arbitrum and deliver to NEAR or Ethereum-address networks.");return;}
    if(!body.sender||!body.recipient){warnings.push("Add your sending and receiving addresses for a NEAR Intents quote.");return;}
    try{
      const sender=researchAddress(from!.network,body.sender),recipient=to!.network==="near"?researchAddress("near",body.recipient):evmAddress(body.recipient);
      const sent={dry:true,swapType:"EXACT_INPUT",slippageTolerance:bps,originAsset:from!.assetId,destinationAsset:to!.assetId,amount,depositType:"ORIGIN_CHAIN",recipient,recipientType:"DESTINATION_CHAIN",refundTo:sender,refundType:"ORIGIN_CHAIN",deadline:new Date(now+180000).toISOString()};
      const r=await fetch("https://1click.chaindefuser.com/v0/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sent),signal:AbortSignal.timeout(10000)});
      const data=await r.json() as {message?:string};if(!r.ok)throw new Error(typeof data.message==="string"?data.message:"NEAR Intents quote unavailable.");
      routes.push(preview1Click(data,sent,from!,to!));
    }catch(e){warnings.push((e as Error).message);}
  }
  await Promise.all([ref(),intents()]);
  return Response.json({from:from.id,to:to.id,amount:body.amount,slippage:bps,routes,warnings,capturedAt:new Date().toISOString(),expiresAt:new Date(now+30000).toISOString(),previewOnly:true},{headers:{"Cache-Control":"no-store"}});
}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
