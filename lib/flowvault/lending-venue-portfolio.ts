import { AAVE_MARKETS, type AaveChain } from "./aave-markets.ts";
import { aaveVenue, aaveRisk } from "./aave.ts";
import { proven } from "./account-registry.ts";
import { decimal } from "./money.ts";
import type { Workspace, Position, PortfolioSection } from "./types.ts";
/** Explicitly allowlisted pools are observed for every proven account. Unread pools are not zero.
 * Position values come from the venue's verified oracle and flow into the ONE capitalView pass. */
export async function lendingVenuePortfolio(w:Workspace) {
  const snapshots: import("./contracts.ts").LendingVenueSnapshot[]=[];
  const rows=await Promise.all((w.accounts??[]).filter(a=>a.chain==="evm" && proven(a)).flatMap(a=>(Object.keys(AAVE_MARKETS) as AaveChain[]).filter(c=>w.policy?.venues.includes(AAVE_MARKETS[c].pool)).map(async chain=>{
    const v=aaveVenue(chain),id=`${v.id}:${a.address}`,at=new Date().toISOString();
    const section:PortfolioSection={id,status:"observed",capturedAt:at,reasons:[],positionIds:[],affects:["netWorth","committedCapital","borrowingHeadroom"]};
    const positions:Position[]=[];
    try{
      const st=await v.read(a.address),snapshot=v.inspect(st,w.policy),risk=aaveRisk(st,w.policy);snapshots.push(snapshot);
      for(const r of st.reserves) for(const side of ["asset","debt"] as const){
        const qty=side==="debt"?r.debt:r.supplied;if(qty===0n)continue;
        const pid=id+":"+r.asset.id+":"+side;
        positions.push({id:pid,label:`${r.asset.symbol} · ${v.id} · ${side}`,asset:r.asset.symbol,amount:decimal(qty,r.asset.decimals),rawAmount:qty.toString(),decimals:r.asset.decimals,
          kind:side==="debt"?"debt":r.collateralEnabled?"collateral":"supplied",chain,venue:AAVE_MARKETS[chain].pool,accountId:a.address,ownership:"owner",source:"live",capturedAt:st.capturedAt,
          venueValuation:{usdcRaw:risk.value(r,qty,side==="debt").toString(),basis:`Aave oracle in finalized ${st.blockHash}; USDC relative price`,freshUntil:snapshot.freshUntil}});
        section.positionIds.push(pid);
      }
    }catch(e){section.status="unavailable";section.reasons=[(e as Error).message];}
    return {positions,section};
  })));
  return {positions:rows.flatMap(x=>x.positions),sections:rows.map(x=>x.section),snapshots};
}
