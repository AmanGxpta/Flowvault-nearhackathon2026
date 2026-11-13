import test from "node:test";
import assert from "node:assert/strict";
import { NearRpcError } from "@anywalletkit/wallet-near";
import { stakingReadProvider } from "../lib/flowvault/staking-rpc.ts";
import { readRpc, RpcResponseError } from "../lib/flowvault/rpc-transport.ts";
test("staking shares identical reads per operation and does not retain failed reads or allow broadcasts",async()=>{
  let calls=0; const provider=stakingReadProvider(async()=>{calls++;await Promise.resolve();return {raw:"7"};});
  const [a,b]=await Promise.all([provider("query",{x:1}),provider("query",{x:1})]);assert.deepEqual(a,b);assert.equal(calls,1);
  await provider("query",{x:2});assert.equal(calls,2);
  let tries=0;const retry=stakingReadProvider(async()=>{if(++tries===1)throw Error("offline");return "fresh";});
  await assert.rejects(retry("query",{}),/offline/);assert.equal(await retry("query",{}),"fresh");
  await assert.rejects(provider("send_tx",{}),/read-only/);
});
test("SDK contract errors retain NearRpcError identity while public RPC throttling still fails over",async()=>{
  const p=stakingReadProvider(async()=>{throw new RpcResponseError({name:"HANDLER_ERROR",cause:{name:"CONTRACT_EXECUTION_ERROR"},message:"Method missing"});});
  await assert.rejects(p("query",{}),NearRpcError);
  let calls=0;const r=await readRpc("query",{},async()=>++calls===1 ? new Response("",{status:429}) : Response.json({result:{live:true}}),async()=>{});
  assert.equal(r.live,true);assert.equal(calls,2);
});
