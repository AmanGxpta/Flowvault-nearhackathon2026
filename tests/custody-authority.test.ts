import {test} from "node:test";
import assert from "node:assert/strict";
import {checkCustodyKey,custodyProblems,boundCustodyAuthority,custodyCall} from "../lib/flowvault/custody-authority.ts";
import {draftMandate,mandateDigest,approvalMessage} from "../lib/flowvault/mandate.ts";
import {STRATEGY_SPECS} from "../lib/flowvault/strategy-spec.ts";
import {custodyReceiptState} from "../lib/flowvault/custody-receipts.ts";
const now=Date.parse("2026-11-13T10:00:00Z");
const m=draftMandate({id:"m",accountId:"alice.near",source:"live",now,reserveUsdcRaw:"0",strategy:STRATEGY_SPECS.find(x=>x.id==="rhea-usdc-surplus")!});
const c:any={owner_id:"alice.near",single_depositor:"alice.near",asset_id:"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",asset_decimals:6,share_decimals:18,performance_fee_bps:0,management_fee_bps:0,max_nav_age_ms:"180000",max_position_bps:m.concentration.maxPositionBps,max_protocol_bps:m.concentration.maxProtocolBps,max_chain_bps:m.concentration.maxChainBps,disclosed_upgrade_keys:[]};
const o:any={policy:{account_id:"operator.near",valid_until_ms:String(now+100000),max_per_action_raw:m.limits.perActionUsdcRaw,max_daily_raw:m.limits.dailyUsdcRaw,max_cumulative_raw:m.limits.cumulativeUsdcRaw,max_deployed_raw:m.limits.capitalUsdcRaw,min_idle_raw:"0",paused:false},version:"1",usage_day:String(BigInt(now)/86400000n),daily_used_raw:"0",cumulative_used_raw:"0",deployed_raw:"0",liquid_sync_required:false};
const b={contractId:"vault.near",operatorId:"operator.near",publicKey:"ed25519:public",operatorVersion:"1",codeHash:"code",configDigest:"config"};
const bound={...m,authority:boundCustodyAuthority(b,c,now),scope:{...m.scope,methods:[{receiver:"vault.near",method:"curator_supply"},{receiver:"vault.near",method:"curator_withdraw"}]}};
const n:any={nav_raw:"1000000",liquid_assets_raw:"1000000",queued_shares:"0",report_required:false,busy:null,status:"running",report:{observed_at_ms:String(now)}};
test("only exact finite-allowance custody function-call keys are accepted",()=>{
 const p={FunctionCall:{receiver_id:"vault.near",method_names:["curator_supply","curator_withdraw"],allowance:"1"}};
 assert.equal(checkCustodyKey(p,"vault.near"),true);
 for(const permission of ["FullAccess",{FunctionCall:{...p.FunctionCall,allowance:null}},{FunctionCall:{...p.FunctionCall,method_names:[]}},{FunctionCall:{...p.FunctionCall,method_names:[...p.FunctionCall.method_names,"upgrade"]}},{FunctionCall:{...p.FunctionCall,receiver_id:"other.near"}}])assert.equal(checkCustodyKey(permission,"vault.near"),false);
});
test("custody requires same owner, zero-fee native-USDC and contract budgets no wider than signed terms",()=>{
 assert.deepEqual(custodyProblems(m,c,o,now),[]);
 for(const config of [{...c,single_depositor:null},{...c,owner_id:"other.near"},{...c,performance_fee_bps:1},{...c,max_nav_age_ms:"3600000"}])assert.ok(custodyProblems(m,config,o,now).length);
 assert.ok(custodyProblems(m,c,{...o,policy:{...o.policy,max_daily_raw:(BigInt(m.limits.dailyUsdcRaw)+1n).toString()}},now).length);
});
test("custody identity, code, policy and key are covered by mandate signature; disclosure names custody",()=>{
 assert.match(approvalMessage(bound),/vault.near/);
 const original=mandateDigest(bound);
 for(const field of ["codeHash","contractId","publicKey","operatorVersion","configDigest"] as const)assert.notEqual(original,mandateDigest({...bound,authority:{...bound.authority,custodyContract:{...b,[field]:"changed"}}}));
});
test("typed zero-deposit calls refuse changed operator, stale NAV, queues, reserve and raw budgets",()=>{
 assert.deepEqual(custodyCall(bound,o,n,"1",false,now),{receiverId:"vault.near",methodName:"curator_supply",args:{amount:"1"},gas:"300000000000000",deposit:"0"});
 for(const nav of [{...n,queued_shares:"1"},{...n,unresolved:{}},{...n,nav_raw:null},{...n,report:{observed_at_ms:"0"}}])assert.throws(()=>custodyCall(bound,o,nav,"1",false,now));
 assert.throws(()=>custodyCall(bound,{...o,version:"2"},n,"1",false,now));
 assert.throws(()=>custodyCall(bound,{...o,daily_used_raw:o.policy.max_daily_raw},n,"1",false,now));
 assert.equal(custodyCall(bound,o,{...n,status:"shutdown"},"1",true,now).methodName,"curator_withdraw");
});
test("custody receipt verification never infers withdrawal wallet cash and rejects wrong calldata",()=>{
 const op:any={hash:"hash",signerId:"operator.near",contractId:"vault.near",call:{methodName:"curator_withdraw",args:{amount:"10"},deposit:"0",gas:"300000000000000"}};
 const tx:any={final_execution_status:"FINAL",transaction:{hash:op.hash,signer_id:op.signerId,receiver_id:op.contractId,actions:[{FunctionCall:{method_name:op.call.methodName,args:btoa(JSON.stringify(op.call.args)),deposit:"0",gas:op.call.gas}}]},status:{SuccessValue:""},receipts_outcome:[{outcome:{executor_id:"vault.near",status:{SuccessValue:""},logs:["EVENT_JSON:"+JSON.stringify({standard:"flowvault_vault",event:"curator_result",data:[{kind:"withdraw",status:"payout_unverified"}]})]}}]};
 const result=custodyReceiptState(tx,op);assert.equal(result.state,"confirmed");assert.match(result.reason!,/cash remains unverified/);
 tx.transaction.actions[0].FunctionCall.deposit="1";assert.throws(()=>custodyReceiptState(tx,op),/exact reviewed call/);
});

test("custody journal locks unknown operations across mandates and sessions and terminal outcomes are immutable",async()=>{
 const {DatabaseSync}=await import("node:sqlite");
 const {CUSTODY_TABLE,CUSTODY_START,CUSTODY_FINISH}=await import("../lib/flowvault/custody-sql.ts");
 const db=new DatabaseSync(":memory:");db.exec(CUSTODY_TABLE);
 const start=(id:string,session:string,contract="vault.near")=>db.prepare(CUSTODY_START).run(id,session,"mandate",contract,"hash:"+id,"unknown",JSON.stringify({id}),contract).changes;
 assert.equal(start("one","alice"),1);assert.equal(start("two","bob"),0);
 assert.equal(db.prepare(CUSTODY_FINISH).run("confirmed","confirmed","one","bob").changes,0);
 assert.equal(db.prepare(CUSTODY_FINISH).run("confirmed","confirmed","one","alice").changes,1);
 assert.equal(db.prepare(CUSTODY_FINISH).run("unknown","oops","one","alice").changes,0);
 assert.equal(start("two","bob"),1);assert.equal(start("two","bob"),0);db.close();
});

test("final refused custody root without any external start is failed, never a capital return guess",()=>{
 const op:any={hash:"h",signerId:"operator.near",contractId:"vault.near",call:{methodName:"curator_supply",args:{amount:"1"},gas:"300000000000000",deposit:"0"}};
 const result:any={final_execution_status:"FINAL",transaction:{hash:"h",signer_id:"operator.near",receiver_id:"vault.near",actions:[{FunctionCall:{method_name:"curator_supply",args:btoa('{"amount":"1"}'),gas:op.call.gas,deposit:"0"}}]},status:{Failure:{}},receipts_outcome:[{outcome:{executor_id:"vault.near",status:{Failure:{}},logs:[]}}]};
 assert.equal(custodyReceiptState(result,op).state,"failed");
 result.receipts_outcome[0].outcome.logs=['EVENT_JSON:{"event":"curator_started"}'];
 assert.equal(custodyReceiptState(result,op).state,"unknown");
});

test("atomic custody insert preserves the daily action count even after earlier operations finish",async()=>{
 const {DatabaseSync}=await import("node:sqlite");const {CUSTODY_TABLE,CUSTODY_START_BOUNDED}=await import("../lib/flowvault/custody-sql.ts");
 const db=new DatabaseSync(":memory:");db.exec(CUSTODY_TABLE);
 const start=(id:string,method:string,day="2026-11-13")=>db.prepare(CUSTODY_START_BOUNDED).run(id,"s","m","vault.near",id,"unknown",JSON.stringify({at:day+"T10:00:00Z",call:{methodName:method}}),"vault.near",method,"s","m",day,1).changes;
 assert.equal(start("1","curator_supply"),1);db.exec("UPDATE custody_ops SET state='confirmed'");
 assert.equal(start("2","curator_supply"),0);assert.equal(start("3","curator_withdraw"),1);db.exec("UPDATE custody_ops SET state='confirmed'");assert.equal(start("4","curator_supply","2026-11-14"),1);db.close();
});
