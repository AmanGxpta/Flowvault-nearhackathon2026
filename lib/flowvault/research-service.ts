import { snapshot } from "./snapshot-cache.ts";
import { indexedHoldings, tokenMetadata, walletActivity } from "./wallet-research.ts";
import { fetchPortfolio, view } from "./near.ts";
import { researchPortfolioView } from "./research.ts";
import { decimal } from "./money.ts";
export async function publicJson(url: string): Promise<unknown> {
  const r = await fetch(url, {signal:AbortSignal.timeout(7000),headers:{Accept:"application/json"}});
  if (!r.ok) throw new Error("Public indexer returned " + r.status);
  return r.json();
}
export async function refMetadata() {
  return snapshot("research:ref-metadata",async()=>tokenMetadata(await publicJson("https://indexer.ref.finance/list-token")),old=>old);
}
export async function readWatchedNear(address: string) {
  const id=encodeURIComponent(address);
  const result=await Promise.allSettled([
    publicJson("https://api.fastnear.com/v1/account/"+id+"/full"), refMetadata(),
    publicJson("https://indexer.ref.finance/list-token-price"),
    publicJson("https://api.nearblocks.io/v1/account/"+id+"/txns?per_page=25"),
    publicJson("https://api.nearblocks.io/v1/account/"+id+"/ft-txns?per_page=25"),
    publicJson("https://api.nearblocks.io/v1/account/"+id+"/txns/count"),
    fetchPortfolio(address),
  ]);
  if(result[0].status!=="fulfilled") throw new Error("Wallet inventory is unavailable. Try again shortly.");
  const meta=result[1].status==="fulfilled"?result[1].value:{};
  const inv=indexedHoldings(result[0].value,meta,result[2].status==="fulfilled"?result[2].value:{},address);
  const warnings:string[]=[];
  if(result[1].status!=="fulfilled")warnings.push("Token metadata unavailable; raw units retained.");
  if(result[2].status!=="fulfilled")warnings.push("Prices unavailable. Holdings have not been valued.");
  if(result[4].status!=="fulfilled")warnings.push("Token transfer details unavailable.");
  let transactions:ReturnType<typeof walletActivity>=[];
  try {transactions=walletActivity(result[3].status==="fulfilled"?result[3].value:null,result[4].status==="fulfilled"?result[4].value:null,meta,address);}catch{warnings.push("Recent activity is unavailable.");}
  const base=result[6].status==="fulfilled"?researchPortfolioView(result[6].value):null;
  if(!base)warnings.push("Supported DeFi positions unavailable.");else warnings.push(...base.warnings);
  const staking=await Promise.all(inv.pools.slice(0,5).map(async pool=>{
    try {
      const r=await view<{account_id:string;staked_balance:string;unstaked_balance:string;can_withdraw:boolean}>(pool,"get_account",{account_id:address});
      const p=r.data;
      if(p.account_id!==address || !/^\d+$/.test(p.staked_balance)||!/^\d+$/.test(p.unstaked_balance))throw new Error();
      return {pool,staked:decimal(BigInt(p.staked_balance),24),unstaked:decimal(BigInt(p.unstaked_balance),24),canWithdraw:p.can_withdraw===true,block:r.blockHeight};
    }catch{return {pool,error:"Pool balance unavailable"};}
  }));
  if(inv.pools.length>5)warnings.push("Showing balances for the first five discovered staking pools.");
  if(inv.inventoryTruncated)warnings.push("Inventory exceeds the 1,000-token display limit.");
  const counts=result[5].status==="fulfilled"?result[5].value as {txns?:{count?:string}[]}:null;
  const count=counts?.txns?.[0]?.count;
  return {...inv,transactions,transactionCount:typeof count==="string"&&/^\d+$/.test(count)?count:null,staking,
    positions:base?.positions.filter(p=>p.kind!=="wallet"&&p.amount!=="0")??[],
    capturedAt:new Date().toISOString(),incomplete:warnings.length>0,warnings,
    coverage:"FastNEAR indexed NEAR + fungible tokens · Ref contract prices · NearBlocks recent activity · supported Rhea/LiNEAR and discovered staking pools. Prices are estimates; indexers can lag. LPs, NFTs and unsupported DeFi positions are not comprehensively valued."};
}
