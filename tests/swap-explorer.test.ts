import {test} from "node:test";
import assert from "node:assert/strict";
import {swapCatalog,swapAmount,preview1Click,swapVenueUrl} from "../lib/flowvault/swap-explorer.ts";
const catalog=swapCatalog([{blockchain:"near",contractAddress:"wrap.near",assetId:"nep141:wrap.near",symbol:"wNEAR",decimals:24},{blockchain:"near",contractAddress:"usdc.near",assetId:"nep141:usdc.near",symbol:"USDC",decimals:6}],{});
test("the token catalog distinguishes wrapped/native identities and fails closed on contradictory decimals",()=>{
  assert.ok(catalog.find(t=>t.id==="near:native"));assert.ok(catalog.find(t=>t.id==="near:wrap.near"));
  const bad=swapCatalog([{blockchain:"near",contractAddress:"fake.near",assetId:"fake",symbol:"USDC",decimals:18}],{"fake.near":{name:"Fake",symbol:"X",decimals:6}});
  assert.equal(bad.find(t=>t.contract==="fake.near")?.assetId,undefined);
  assert.equal(swapAmount("0.000000000000000000000001",catalog[0]),"1");assert.throws(()=>swapAmount("0",catalog[0]));assert.throws(()=>swapAmount("0.0000001",catalog[1]));
});
test("dry route previews require an exact pair, amount, slippage and recipient echo",()=>{
  const sent={dry:true,swapType:"EXACT_INPUT",originAsset:"nep141:wrap.near",destinationAsset:"nep141:usdc.near",amount:"1000000000000000000000000",depositType:"ORIGIN_CHAIN",recipientType:"DESTINATION_CHAIN",refundType:"ORIGIN_CHAIN",recipient:"owner.near",refundTo:"owner.near",slippageTolerance:100};
  const good={quoteRequest:sent,quote:{amountIn:sent.amount,amountOut:"3500000",minAmountOut:"3465000",timeEstimate:12}};
  const q=preview1Click(good,sent,catalog[0],catalog[1]);assert.equal(q.output,"3.5");assert.equal(q.minimum,"3.465");assert.equal(q.execution,"external");
  for(const key of Object.keys(sent)){assert.throws(()=>preview1Click({...good,quoteRequest:{...sent,[key]:"different"}},sent,catalog[0],catalog[1]));}
  assert.throws(()=>preview1Click({...good,quote:{...good.quote,depositAddress:"send-funds.near"}},sent,catalog[0],catalog[1]));assert.throws(()=>preview1Click({...good,quote:{...good.quote,minAmountOut:"0"}},sent,catalog[0],catalog[1]));
});
test("venue handoff URLs resolve contracts, never ticker lookalikes or watched wallet identities",()=>{
  const url=swapVenueUrl(catalog[0],catalog[1]);assert.equal(url,"https://app.rhea.finance/#wrap.near|usdc.near");assert.equal(url.includes("paul.near"),false);
});
