import type { VenueAsset, SaleQuote, FundingChoice } from "./contracts.ts";
import type { Workspace } from "./types.ts";
import type { SaleEvidence, SalePreparation } from "./sale.ts";
import { salePermission,saleFundingChoice } from "./sale.ts";
import { proven,mayRead } from "./account-registry.ts";
import { readPriceEvidence } from "./valuation-evidence.ts";
import { valuePosition,actionValuation,usdcValue } from "./valuation.ts";
import { decimal,units } from "./money.ts";
import { view,rpc } from "./near.ts";
import { readAaveState } from "./aave-live.ts";
import { aaveRisk } from "./aave.ts";
import { AAVE_MARKETS, type AaveChain } from "./aave-markets.ts";
import { oneClickSaleVenue } from "./venues/sale-oneclick.ts";
import { rheaSaleVenue } from "./venues/sale-rhea.ts";
import { LENDING_USDC,COLLATERAL_FAMILY } from "./lending.ts";
const NEAR_ASSETS:Record<string,string>={"wrap.near":"wNEAR",[COLLATERAL_FAMILY.LiNEAR]:"LiNEAR",[COLLATERAL_FAMILY.rNEAR]:"rNEAR","usdt.tether-token.near":"USDT"};
export function saleVenue(id:string){if(id==="1click")return oneClickSaleVenue;if(id==="rhea-ref")return rheaSaleVenue;throw new Error("Unsupported sale venue.");}
export async function readSaleEvidence(w:Workspace,asset:VenueAsset,account:string):Promise<SaleEvidence> {
  if(w.mode!=="live"||!w.accountId||!w.policy||!mayRead(w,asset.chain==="near"?"near":"evm",account))throw new Error("Sales need saved policy, a proven source account and your NEAR proceeds account.");
  const p=salePermission(w.policy,asset);if(!p.allowed)throw new Error(p.reasons.join("; "));
  const storage=await view<any>(LENDING_USDC,"storage_balance_of",{account_id:w.accountId});if(!storage.data)throw new Error("Register native USDC storage before receiving sale proceeds.");
  if(asset.chain==="near") {
    if(account!==w.accountId||NEAR_ASSETS[asset.id]!==asset.symbol||asset.decimals!==(asset.symbol==="USDT"?6:24))throw new Error("Unsupported NEAR sale asset identity.");
    const [meta,wallet,native,prices]=await Promise.all([view<any>(asset.id,"ft_metadata"),view<string>(asset.id,"ft_balance_of",{account_id:account}),rpc({request_type:"view_account",account_id:account}),readPriceEvidence()]);
    if(prices.source!=="live" || Date.parse(prices.freshUntil)<=Date.now()) throw new Error("Sale oracle price is stale.");
    if(meta.data?.decimals!==asset.decimals||meta.data?.symbol!==asset.symbol||!/^\d+$/.test(wallet.data))throw new Error("Sale token metadata/balance changed.");
    const symbol=asset.symbol==="wNEAR"?"NEAR":asset.symbol;
    const upper=(qty:bigint)=>{if(symbol==="USDT")return usdcValue(qty,6,"USDT",prices,"liability");const v=actionValuation(qty,symbol as "NEAR"|"LiNEAR"|"rNEAR",prices);if(v.usdcRaw===null)throw new Error("Sale price unavailable.");return BigInt(v.usdcRaw);};
    const lower=(qty:bigint)=>{const v=valuePosition({id:"sale",label:asset.symbol,asset:symbol,kind:"wallet",amount:decimal(qty,asset.decimals),rawAmount:qty.toString(),decimals:asset.decimals,source:"live"},"live",prices,new Date().toISOString());if(v.usdcRaw===null)throw new Error("Sale price unavailable.");return BigInt(v.usdcRaw);};
    const gas=250000000000000000000000n;
    const gasValue=actionValuation(gas,"NEAR",prices);if(gasValue.usdcRaw===null)throw new Error("Sale gas price unknown.");
    return {asset,accountId:account,walletRaw:BigInt(wallet.data),valueUpper:upper,valueLower:lower,gasUsdcRaw:BigInt(gasValue.usdcRaw),gasNativeRaw:gas,nativeBalanceRaw:BigInt(native.amount)-BigInt(native.storage_usage)*10n**19n,capturedAt:new Date().toISOString(),policy:w.policy};
  }
  if(!["eth","base","arb"].includes(asset.chain))throw new Error("Unsupported sale chain.");
  const m=AAVE_MARKETS[asset.chain as AaveChain],known=m.collateral.find(x=>x.id.toLowerCase()===asset.id.toLowerCase());
  if(!known||known.symbol!==asset.symbol||known.decimals!==asset.decimals)throw new Error("Sale asset has no verified onchain oracle/identity adapter.");
  const st=await readAaveState(asset.chain as AaveChain,account),risk=aaveRisk(st,w.policy),r=st.reserves.find(x=>x.asset.id===known.id)!,eth=st.reserves.find(x=>x.asset.symbol==="WETH")!;
  if(!eth)throw new Error("Sale gas valuation unavailable.");
  const gas=st.gasPrice*160000n+st.l1FeeUpperWei*2n;
  return {asset:known,accountId:account.toLowerCase(),walletRaw:r.wallet,valueUpper:q=>risk.value(r,q,true),valueLower:q=>risk.value(r,q),gasUsdcRaw:risk.value(eth,gas,true),gasNativeRaw:gas,nativeBalanceRaw:st.nativeBalance,capturedAt:st.capturedAt,policy:w.policy};
}
export async function quoteSales(w:Workspace,asset:VenueAsset,account:string,net:bigint,dry=true,maxInputRaw?:string) {
  const e=await readSaleEvidence(w,asset,account),row=salePermission(e.policy,asset).row!;
  const max=BigInt(row.sale!.maxQuantityRaw),balance=e.walletRaw;
  const r={asset:e.asset,accountId:e.accountId,recipient:w.accountId!,netUsdcRaw:net.toString(),maxInputRaw:maxInputRaw??(max<balance?max:balance).toString(),slippageBps:row.sale!.maxSlippageBps};
  const results=await Promise.all([oneClickSaleVenue,rheaSaleVenue].filter(v=>v.supports(e.asset)).map(async v=>{
    try{return {quote:await v.quoteExactNet(r,e,dry),error:null};}catch(error){return {quote:null,error:v.id+": "+(error as Error).message};}
  }));
  const quotes=results.flatMap(x=>x.quote?[x.quote]:[]).sort((a,b)=>BigInt(a.inputValueUsdcRaw)<BigInt(b.inputValueUsdcRaw)?-1:1);
  return {evidence:e,quotes,reasons:results.flatMap(x=>x.error?[x.error]:[])};
}
/** One alternative per explicitly approved source asset/account, priority from the saved asset policy. */
export async function approvedSaleChoices(w:Workspace,net:bigint):Promise<FundingChoice[]> {
  if(w.mode!=="live"||!w.accountId||net<=0n)return [];
  const rows=(w.policy?.assetRows??[]).filter(r=>r.uses.includes("sell")&&r.sale&&r.chain).sort((a,b)=>a.priority.localeCompare(b.priority));
  const choices=await Promise.all(rows.flatMap(row=>(w.accounts??[]).filter(a=>proven(a)&&(row.chain==="near"?a.chain==="near"&&a.address===w.accountId:a.chain==="evm")).map(async a=>{
    const asset:VenueAsset={id:row.sale!.tokenId.toLowerCase(),symbol:row.asset,decimals:row.sale!.decimals,chain:row.chain!};
    try{const r=await quoteSales(w,asset,a.address,net),q=r.quotes[0];if(!q)throw new Error(r.reasons.join("; "));return {...saleFundingChoice(q),id:`sell:${a.id}:${asset.chain}:${asset.id}`,costsUsdcRaw:(BigInt(q.costsUsdcRaw)+r.evidence.gasUsdcRaw).toString()};}
    catch(e){return {id:`sell:${a.id}:${asset.chain}:${asset.id}`,kind:"sell" as const,eligible:false,reasons:[(e as Error).message],amountUsdcRaw:net.toString(),costsUsdcRaw:null,foregoneUsdcRaw:null,interestUsdcRaw:null,healthAfter:null,availableAt:null,steps:[]};}
  })));
  return choices;
}
