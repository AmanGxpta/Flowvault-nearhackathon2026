import {test} from "node:test";
import assert from "node:assert/strict";
import {explainSaleError} from "../lib/flowvault/sale-messages.ts";
test("sale validation errors are sentences without serialized validation details",()=>{
  assert.equal(explainSaleError(JSON.stringify([{code:"custom",message:"Invalid policy USDC amount",path:["assetRows",0,"sale","maxValueUsdc"]}])),"Enter a valid USDC limit with at most six decimal places.");
  assert.equal(explainSaleError('[{"code":"too_small","message":"bad"}]'),"Check the sale quantity, USDC limit and slippage limit, then try again.");
  assert.equal(explainSaleError("Connect your wallet first."),"Connect your wallet first.");
});
