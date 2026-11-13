import {test} from "node:test";
import assert from "node:assert/strict";
import {holderVaultLedger} from "../lib/flowvault/holder-vault-ledger.ts";
const c={asset_id:"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",asset_decimals:6,share_decimals:18,share_symbol:"fvUSDC",curator_id:"curator.near",platform_id:"platform.near"};
const event=(event:string,data:any)=>"EVENT_JSON:"+JSON.stringify({standard:"flowvault_vault",version:"1.0.0",event,data:[data]});
function result(logs:string[],transfer?:{from:string;to:string;amount:string}){return {final_execution_status:"FINAL",transaction:{hash:"hash"},receipts_outcome:[{id:"receipt",outcome:{executor_id:"vault.near",status:{SuccessValue:""},logs}},...(transfer?[{id:"token",outcome:{executor_id:c.asset_id,status:{SuccessValue:""},logs:["EVENT_JSON:"+JSON.stringify({standard:"nep141",event:"ft_transfer",data:[{old_owner_id:transfer.from,new_owner_id:transfer.to,amount:transfer.amount}]})]}}]:[])]};}
test("vault principal stages preserve net worth and identities, never journal underlying Rhea",()=>{
 const r=result([event("deposit_queued",{owner_id:"alice.near",assets_raw:"100"}),event("deposit_settled",{owner_id:"alice.near",assets_raw:"100",shares_raw:"100000000000000"}),event("curator_started",{kind:"supply",assets_raw:"100"})],{from:"alice.near",to:"vault.near",amount:"100"});
 const rows=holderVaultLedger(r,"vault.near","alice.near",c,"2026-11-13T00:00:00Z");assert.equal(rows.length,2);assert.ok(rows.every(r=>r.netWorthEffectUsdcRaw==="0"));assert.deepEqual(rows,holderVaultLedger(r,"vault.near","alice.near",c,"2026-11-13T00:00:00Z"));
 assert.equal(holderVaultLedger(r,"vault.near","bob.near",c,"now").length,0);
});
test("claims require exact independently emitted token payout, pending is unavailable",()=>{
 const logs=[event("claim_completed",{owner_id:"alice.near",assets_raw:"100"})];
 assert.throws(()=>holderVaultLedger(result(logs),"vault.near","alice.near",c,"now"),/payout proof/);
 const r=result(logs,{from:"vault.near",to:"alice.near",amount:"100"});assert.equal(holderVaultLedger(r,"vault.near","alice.near",c,"now")[0].kind,"internal_transfer");
 r.final_execution_status="EXECUTED";assert.throws(()=>holderVaultLedger(r,"vault.near","alice.near",c,"now"),/not finalized/);
});
test("curator and platform receive only their exact unpriced fee shares",()=>{
 const r=result([event("fee_minted",{curator_shares_raw:"7",platform_shares_raw:"3"})]);
 const rows=holderVaultLedger(r,"vault.near","curator.near",c,"now");assert.equal(rows.length,1);assert.equal(rows[0].amountRaw,"7");assert.equal(rows[0].usdcRaw,null);assert.equal(rows[0].netWorthEffectUsdcRaw,null);
 assert.equal(holderVaultLedger(r,"vault.near","platform.near",c,"now")[0].amountRaw,"3");
 const holder=holderVaultLedger(r,"vault.near","alice.near",c,"now")[0];assert.equal(holder.status,"unresolved");assert.equal(holder.realized,false);assert.equal(holder.usdcRaw,null);assert.match(holder.basis,/NOT your personal quantity/);
});
