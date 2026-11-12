import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy,policySchema } from "../lib/flowvault/policy.ts";
import { salePermission,guardSaleQuote,reconcileSale,saleFundingChoice } from "../lib/flowvault/sale.ts";
import type { SaleEvidence } from "../lib/flowvault/sale.ts";
import type { SaleQuote,SaleRequest } from "../lib/flowvault/contracts.ts";
import { catalogAsset,saleQuoteBody,checkSaleQuote,oneClickSaleVenue } from "../lib/flowvault/venues/sale-oneclick.ts";
import { refInputForNet } from "../lib/flowvault/venues/sale-rhea.ts";
import { LENDING_USDC } from "../lib/flowvault/lending.ts";
const e24=10n**24n,now=Date.now(),asset={id:"linear-protocol.near",symbol:"LiNEAR",chain:"near" as const,decimals:24};
function evidence():SaleEvidence{return {asset,accountId:"owner.near",walletRaw:100n*e24,valueUpper:q=>q*2_000000n/e24,valueLower:q=>q*2_000000n/e24,gasUsdcRaw:50000n,gasNativeRaw:250000000000000000000000n,nativeBalanceRaw:e24,capturedAt:new Date(now).toISOString(),policy:{...defaultPolicy("5"),assetRows:[{asset:"LiNEAR",chain:"near",priority:"P1",uses:["sell"],sale:{tokenId:asset.id,decimals:24,maxQuantityRaw:(100n*e24).toString(),maxValueUsdc:"200",maxSlippageBps:100}}]}};}
const request=():SaleRequest=>({asset,accountId:"owner.near",recipient:"owner.near",netUsdcRaw:"10000000",maxInputRaw:(100n*e24).toString(),slippageBps:100});
const quote=():SaleQuote=>({venueId:"1click",request:request(),dry:true,inputRaw:(5n*e24+e24/100n).toString(),minInputRaw:(5n*e24).toString(),minProceedsUsdcRaw:"10000000",inputValueUsdcRaw:"10020000",costsUsdcRaw:"0",refundableBufferUsdcRaw:"20000",capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+180000).toISOString(),evidence:{}});
test("sales require chain-specific permission, identity, decimals and saved limits; protected wins",()=>{
  const e=evidence();assert.ok(policySchema.safeParse(e.policy).success);assert.equal(salePermission(e.policy,asset).allowed,true);
  assert.equal(salePermission({...e.policy,protectedAssets:["LiNEAR"]},asset).allowed,false);
  assert.equal(salePermission(e.policy,{...asset,id:"spoof.near"}).allowed,false);
  assert.equal(salePermission(e.policy,{...asset,decimals:6}).allowed,false);
  assert.equal(salePermission({...e.policy,assetRows:[]},asset).allowed,false);
  assert.equal(policySchema.safeParse({...e.policy,assetRows:[{...e.policy.assetRows![0],sale:{...e.policy.assetRows![0].sale,maxQuantityRaw:"1.5"}}]}).success,false);
});
test("sale caps use bigint quantities, price upper bounds, gas and exact net output",()=>{
  const e=evidence(),q=quote();assert.doesNotThrow(()=>guardSaleQuote(q,e,now));
  assert.throws(()=>guardSaleQuote({...q,inputRaw:(101n*e24).toString()},e,now),/size/);
  assert.throws(()=>guardSaleQuote({...q,minProceedsUsdcRaw:"9999999"},e,now),/exact-net/);
  assert.throws(()=>guardSaleQuote(q,{...e,walletRaw:1n},now),/wallet/);
  assert.throws(()=>guardSaleQuote(q,{...e,capturedAt:new Date(now-200000).toISOString()},now),/Stale/);
  assert.throws(()=>guardSaleQuote(q,{...e,nativeBalanceRaw:0n},now),/gas/);
  assert.throws(()=>guardSaleQuote(q,{...e,valueUpper:x=>e.valueUpper(x)+1n},now),/valuation increased/);
  assert.throws(()=>guardSaleQuote({...q,expiresAt:new Date(now-1).toISOString()},e,now),/expired/);
});
test("1Click catalog validates exact contract/chain/symbol/precision and rejects duplicate identities",()=>{
  const token={assetId:"nep141:"+asset.id,blockchain:"near",contractAddress:asset.id,symbol:"LiNEAR",decimals:24};
  assert.equal(catalogAsset([token],request()).assetId,token.assetId);
  for(const wrong of [{...token,decimals:6},{...token,contractAddress:"spoof.near"},{...token,blockchain:"eth"}])assert.throws(()=>catalogAsset([wrong],request()),/identity/);
  assert.throws(()=>catalogAsset([token,token],request()),/uniquely/);
});
test("1Click exact-output sale echoes the full request; previews never have deposit addresses",()=>{
  const e=evidence(),r=request(),sent=saleQuoteBody(r,"nep141:"+asset.id,"nep141:"+LENDING_USDC,true,now);
  const body={quoteRequest:sent,quote:{amountIn:quote().inputRaw,minAmountIn:quote().minInputRaw,amountOut:r.netUsdcRaw,minAmountOut:r.netUsdcRaw}};
  assert.equal(checkSaleQuote(r,sent,body,e).request.netUsdcRaw,r.netUsdcRaw);
  assert.throws(()=>checkSaleQuote(r,sent,{...body,quoteRequest:{...sent,refundTo:"attacker.near"}},e),/echo/);
  assert.throws(()=>checkSaleQuote(r,sent,{...body,quote:{...body.quote,depositAddress:"deposit.near"}},e),/deposit/);
  assert.throws(()=>oneClickSaleVenue.prepareOperation(quote(),e),/dry/);
});
test("Ref/Rhea inverse simple pool sizing rounds up, respects liquidity and refuses other pool types",()=>{
  const pool={id:1,pool_kind:"SIMPLE_POOL",token_account_ids:[asset.id,LENDING_USDC],amounts:[(1000n*e24).toString(),"2000000000"],total_fee:30};
  const input=refInputForNet(pool,asset.id,10_000000n,100);
  const afterFee=input*9970n;
  const out=afterFee*2_000_000000n/(1000n*e24*10000n+afterFee);
  assert.ok(out>=10_000000n);assert.ok(input>5n*e24);
  assert.throws(()=>refInputForNet(pool,asset.id,2000_000000n,100),/liquidity/);
  assert.throws(()=>refInputForNet({...pool,pool_kind:"STABLE_SWAP"},asset.id,10n,0),/Unsupported/);
});
test("sale reconciliation keeps unproven leftovers/PnL unknown and requires exact-net finalized proceeds",()=>{
  const q=quote();const partial=reconcileSale(q,{inputRaw:q.inputRaw,refundRaw:null,proceedsUsdcRaw:q.request.netUsdcRaw,finalized:true});
  assert.equal(partial.complete,false);assert.equal(partial.soldRaw,null);assert.equal(partial.acquisitionHistoryMissing,true);assert.equal(partial.realizedPnlUsdcRaw,null);
  const done=reconcileSale(q,{inputRaw:q.inputRaw,refundRaw:(e24/100n).toString(),proceedsUsdcRaw:q.request.netUsdcRaw,finalized:true});
  assert.equal(done.complete,true);assert.equal(done.soldRaw,(5n*e24).toString());assert.equal(done.leftoversRaw,(e24/100n).toString());
  assert.equal(reconcileSale(q,{inputRaw:q.inputRaw,refundRaw:"0",proceedsUsdcRaw:"9999999",finalized:true}).complete,false);
  assert.equal(reconcileSale(q,{inputRaw:q.inputRaw,refundRaw:"0",proceedsUsdcRaw:q.request.netUsdcRaw,finalized:false}).complete,false);
  const choice=saleFundingChoice(q);assert.equal(choice.amountUsdcRaw,q.request.netUsdcRaw);assert.equal(choice.kind,"sell");assert.equal(choice.steps[0],"sell");
});

test("sale receipts bind exact source signer/call and finalized token transfer; sale ledger keeps PnL unavailable",async()=>{
  const {verifySaleNearSource}=await import("../lib/flowvault/sale-receipts.ts");
  const {saleLedger}=await import("../lib/flowvault/sale-ledger.ts");
  const q={...quote(),dry:false,evidence:{quote:{depositAddress:"deposit.near"}}};
  const p=oneClickSaleVenue.prepareOperation(q,evidence()),hash="A".repeat(44),c=p.transactions[0].actions[0].params;
  const result={transaction:{hash,signer_id:p.accountId,receiver_id:p.tokenId,actions:[{FunctionCall:{method_name:c.methodName,deposit:c.deposit,gas:c.gas,args:btoa(JSON.stringify(c.args))}}]},transaction_outcome:{block_hash:"block",outcome:{tokens_burnt:"10"}},final_execution_status:"FINAL",status:{SuccessValue:""},receipts_outcome:[{id:"source",outcome:{executor_id:p.tokenId,status:{SuccessValue:""},tokens_burnt:"20",logs:["EVENT_JSON:"+JSON.stringify({standard:"nep141",version:"1.0.0",event:"ft_transfer",data:[{old_owner_id:p.accountId,new_owner_id:"deposit.near",amount:p.amountRaw}]})]}}]};
  const source=verifySaleNearSource(result,p,hash);assert.equal(source?.state,"confirmed");assert.equal(source?.gasNativeRaw,"30");
  assert.throws(()=>verifySaleNearSource({...result,transaction:{...result.transaction,signer_id:"attacker.near"}},p,hash),/reviewed source/);
  assert.equal(verifySaleNearSource({...result,final_execution_status:"EXECUTED"},p,hash),null);
  assert.equal(verifySaleNearSource({...result,receipts_outcome:[]},p,hash),null);
  p.sale.result=reconcileSale(q,{inputRaw:q.inputRaw,refundRaw:"0",proceedsUsdcRaw:q.request.netUsdcRaw,finalized:true});
  const entries=saleLedger({id:"sale",kind:"sell",preparation:p,state:"confirmed",hashes:[hash],updatedAt:new Date(now).toISOString(),verificationEvidence:[source]} as unknown as import("../lib/flowvault/execution.ts").WalletAttempt);
  assert.equal(entries[0].amountRaw,q.inputRaw);assert.equal(entries[0].acquisitionHistoryMissing,true);assert.equal(entries[0].realizedPnlUsdcRaw,null);assert.equal(entries[0].netWorthEffectUsdcRaw,null);assert.equal(entries[1].asset,"USDC");assert.equal(entries[1].amountRaw,q.request.netUsdcRaw);
  const {validateSaleWallet}=await import("../lib/flowvault/sale-wallet.ts");assert.doesNotThrow(()=>validateSaleWallet(p));
  assert.throws(()=>validateSaleWallet({...p,amountRaw:"1"}),/reviewed asset/);
});
