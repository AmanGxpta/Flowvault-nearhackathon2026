import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLifecycleQuote, RNEAR_CONTRACT } from "../lib/flowvault/staking-lifecycle.ts";
import { verifyLinearReceipts } from "../lib/flowvault/staking-receipts.ts";
import { deriveFlow, type StakeFlow } from "../lib/flowvault/stake-flow.ts";
const {result}=JSON.parse(readFileSync(new URL("./fixtures/rnear-stake-public.json",import.meta.url),"utf8"));
const call=result.transaction.actions[0].FunctionCall;
const amount=BigInt(call.deposit), shares=241423522372461643386711665n;
function quote(storageFee=0n){return normalizeLifecycleQuote("stake",{amount,shares,price:10n**24n,storageFee,fee:10n**20n,upfront:10n**21n,reserve:5n*10n**23n,maxStakeable:amount,transactions:[{receiverId:RNEAR_CONTRACT,actions:[{functionCall:{methodName:"deposit_and_stake",args:{},deposit:amount,gas:BigInt(call.gas)}}]}]},amount.toString(),"rnear");}
test("finalized public rNEAR stake confirms its own rhea_lst event and exact NEP-141 mint",()=>{
  const q=quote(); const proof=verifyLinearReceipts(result,q,result.transaction.signer_id);
  assert.equal(proof.state,"confirmed");if(proof.state==="confirmed"){assert.equal(proof.asset,"rNEAR");assert.equal(proof.amountRaw,shares.toString());}
  assert.throws(()=>verifyLinearReceipts(result,{...q,protocol:"linear"},result.transaction.signer_id),/scope/);
  const forged=structuredClone(result);forged.transaction.receiver_id="linear-protocol.near";
  assert.throws(()=>verifyLinearReceipts(forged,q,result.transaction.signer_id),/identity/);
});
test("rNEAR quote preserves first-stake storage and resumed flow venue",()=>{
  const q=quote(1250000000000000000000n);assert.equal(q.storageFeeNearRaw,"1250000000000000000000");assert.equal(q.receiverId,RNEAR_CONTRACT);assert.equal(q.protocol,"rnear");
  const f:StakeFlow={id:"rnear-flow",accountId:"owner.near",venue:"rnear",source:{kind:"near",amountRaw:amount.toString()},createdAt:"x",updatedAt:"x",cancelledAt:null,links:{}};
  assert.match(deriveFlow(f,{}).steps[0].title,/rNEAR/);
  assert.match(deriveFlow(f,{stake:{id:"a",state:"failed",hashes:0,message:"Declined"}}).steps[0].title,/rNEAR/);
});
