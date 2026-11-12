import test from "node:test";
import assert from "node:assert/strict";
import {applyPerpLimitTerms,perpLimitForm,perpLimitUpdate} from "../lib/flowvault/perps-limits.ts";
import {draftMandate,mandateDigest,transition} from "../lib/flowvault/mandate.ts";
import {draftPerpMandate} from "../lib/flowvault/hyperliquid.ts";
import {STRATEGY_SPECS} from "../lib/flowvault/strategy-spec.ts";
const now=Date.parse("2026-11-13T00:00:00Z");
function fixture(){const base=draftMandate({id:"p",accountId:"alice.near",source:"live",now,reserveUsdcRaw:"0",strategy:STRATEGY_SPECS[0]});return draftPerpMandate({id:"p",accountId:"alice.near",master:"0x"+"12".repeat(20),agent:{address:"0x"+"34".repeat(20),name:"test",validUntil:now+86400000},now,base});}
test("perps form round-trips bigint limits and updates all five signed limits",()=>{const m=fixture(),v=perpLimitForm(m);assert.equal(v.margin,"50");const t=perpLimitUpdate({...v,leverage:"4",notional:"150.000001",daily:"300",margin:"75",loss:"12.5"});assert.equal(t.perAction,"150.000001");assert.equal(t.daily,"300");assert.equal(t.capital,"75");assert.equal(t.maxLoss,"12.5");assert.equal(applyPerpLimitTerms(m,t.perps)?.maxNotionalUsdcRaw,"150000001");assert.equal(m.perps?.maxLeverage,3);});
test("perps limit edits invalidate the digest; activation cannot reuse the old signature",()=>{const m=fixture();m.approval={digest:mandateDigest(m),signedBy:m.accountId,publicKey:"key",signedAt:new Date(now).toISOString(),method:"nep413"};const approved=transition(m,"approved",new Date(now).toISOString());const changed={...approved,perps:applyPerpLimitTerms(approved,{maxLeverage:4})};assert.notEqual(mandateDigest(changed),mandateDigest(approved));assert.throws(()=>transition(changed,"active",new Date(now).toISOString()),/signed terms/);});
test("invalid limits and editing a non-perps mandate fail closed",()=>{const m=fixture(),v=perpLimitForm(m);for(const patch of [{leverage:"21"},{leverage:"1.5"},{notional:"1.0000001"},{daily:"1"},{margin:"0"},{loss:"-1"}])assert.throws(()=>perpLimitUpdate({...v,...patch}));assert.throws(()=>applyPerpLimitTerms({...m,authority:{...m.authority,kind:"owner_signs_each"}},{maxLeverage:4}),/existing Hyperliquid/);});
