import {test} from "node:test";
import assert from "node:assert/strict";
import {indexedHoldings,tokenMetadata,pricedValue,walletActivity,safeTokenIcon} from "../lib/flowvault/wallet-research.ts";
const meta=tokenMetadata({"cookie.nekotoken.near":{symbol:"COOKIE",name:"NEKO Cookie",decimals:24},"fake.near":{symbol:"COOKIE",name:"Same ticker",decimals:6}});
test("indexed research resolves exact contracts and computes portfolio shares without rounding base units",()=>{
  const inv=indexedHoldings({account_id:"paul.near",state:{balance:"4000000000000000000000000"},tokens:[{contract_id:"cookie.nekotoken.near",balance:"1000000000000000000000000000000"},{contract_id:"fake.near",balance:"1000000"},{contract_id:"unknown.near",balance:"1234"}],pools:[{pool_id:"astro-stakers.poolv1.near"}]},meta,{"wrap.near":{price:"3",decimal:24},"cookie.nekotoken.near":{price:"0.0001",decimal:24}},"paul.near");
  assert.equal(inv.pricedTotal,"112");assert.equal(inv.holdings[0].symbol,"COOKIE");assert.equal(inv.holdings[0].amount,"1000000");assert.equal(inv.holdings[0].usd,"100");assert.equal(inv.holdings[0].share,89.28);
  assert.equal(inv.holdings.find(h=>h.contract==="fake.near")?.usd,null);assert.equal(inv.holdings.find(h=>h.contract==="unknown.near")?.amount,null);assert.equal(inv.unpriced,2);assert.deepEqual(inv.pools,["astro-stakers.poolv1.near"]);
  assert.equal("proof" in inv,false);assert.equal("spendable" in inv,false);
});
test("a foreign inventory or invalid amount never masquerades as a public wallet balance",()=>{
  assert.throws(()=>indexedHoldings({account_id:"other.near",tokens:[]},meta,{},"paul.near"));
  const inv=indexedHoldings({account_id:"paul.near",state:{balance:"0"},tokens:[{contract_id:"fake.near",balance:1000000},{contract_id:"fake.near",balance:"NaN"}]},meta,{},"paul.near");assert.equal(inv.holdings.length,0);
  for(const p of [{price:"Infinity",decimal:24},{price:"1",decimal:6},{price:"0",decimal:24}])assert.equal(pricedValue("1000000000000000000000000",24,p),null);
});
test("token metadata rejects invalid precision and dangerous image protocols",()=>{
  assert.equal(tokenMetadata({x:{symbol:"A",decimals:400}}).x,undefined);
  assert.equal(safeTokenIcon("javascript:alert(1)"),undefined);assert.equal(safeTokenIcon("data:image/svg+xml,<svg>"),undefined);assert.equal(safeTokenIcon("https://images.example/a.png"),"https://images.example/a.png");
});
test("receipt rows group into transactions while retaining the user action and token transfer direction",()=>{
  const hash="HLFJDBc3w4KepyrWGEJMTsZR4DWsnqtupb3mZvonQLSC";
  const rows=walletActivity({txns:[{transaction_hash:hash,predecessor_account_id:"system",receiver_account_id:"paul.near",actions:[{action:"TRANSFER"}],block_timestamp:"1790604207082319292",outcomes:{status:true}},{transaction_hash:hash,predecessor_account_id:"paul.near",receiver_account_id:"cookie.nekotoken.near",actions:[{method:"claim_neko"}]}]},{txns:[{transaction_hash:hash,ft:{contract:"cookie.nekotoken.near"},affected_account_id:"paul.near",delta_amount:"-1000000000000000000000000"}]},meta,"paul.near");
  assert.equal(rows.length,1);assert.equal(rows[0].from,"paul.near");assert.equal(rows[0].to,"cookie.nekotoken.near");assert.deepEqual(rows[0].actions,["TRANSFER","claim_neko"]);assert.equal(rows[0].tokens[0].direction,"Out");assert.equal(rows[0].tokens[0].amount,"1");assert.equal(rows[0].status,"Succeeded");assert.equal(rows[0].at,1790604207082);
});
