import test from "node:test";
import assert from "node:assert/strict";
import { AAVE_MARKETS } from "../lib/flowvault/aave-markets.ts";
import { aaveVenue, aaveRisk, prepareAave, isAave } from "../lib/flowvault/aave.ts";
import { calldata, word, hashText } from "../lib/flowvault/aave-abi.ts";
import { validateAaveWallet } from "../lib/flowvault/aave-wallet.ts";
import { verifyAaveReceipt } from "../lib/flowvault/aave-receipts.ts";
import { aaveLedger } from "../lib/flowvault/aave-ledger.ts";
import { defaultPolicy } from "../lib/flowvault/policy.ts";
import type { Policy } from "../lib/flowvault/policy.ts";
import type { AaveState, AaveReserve } from "../lib/flowvault/aave-live.ts";
import type { WalletAttempt } from "../lib/flowvault/execution.ts";
const now=Date.parse("2026-11-13T12:00:00Z"),m=AAVE_MARKETS.base,owner="0x"+"12".repeat(20),e18=10n**18n;
const config=(d:number)=>8000n+(8500n<<16n)+(10500n<<32n)+(BigInt(d)<<48n)+(1n<<56n)+(1n<<58n);
function fixture():AaveState {
  const reserve=(asset:AaveReserve["asset"],id:number):AaveReserve=>({asset,id,config:config(asset.decimals),aToken:"0x"+"34".repeat(20),debtToken:"0x"+"56".repeat(20),price:asset.symbol==="WETH"?2000_00000000n:100_000000n,supplied:0n,debt:0n,wallet:1000_000000n,liquidity:100000_000000n,totalDebt:10000_000000n,aprRay:5n*10n**25n,collateralEnabled:false,allowance:0n});
  const eth=reserve(m.collateral[0],0);eth.supplied=e18;eth.collateralEnabled=true;eth.wallet=e18;eth.liquidity=100n*e18;
  const usdc=reserve(m.debt,1);usdc.debt=500_000000n;
  return {chain:"base",accountId:owner,capturedAt:new Date(now).toISOString(),blockHash:"0x"+"ab".repeat(32),blockNumber:"0x100",nativeBalance:e18,gasPrice:1000000n,l1FeeUpperWei:100n,userConfig:6n,accountData:[2000_00000000n,500_00000000n,1100_00000000n,8500n,8000n,34n*10n**17n],reserves:[eth,usdc],eMode:0,mode:null};
}
const policy=():Policy=>({...defaultPolicy(),venues:[m.pool],creditRows:[{assetId:"WETH",collateralId:"ignored-policy-id",value:null,drawdownBps:3000,ltvCapBps:5000,liquidationThresholdBps:null,protocolLtvBps:null,minHealth:"1.5",priority:"P1",permissions:["pledge","borrow"],eligible:true}]});
const req={kind:"borrow" as const,asset:"USDC",amountRaw:100_000000n,approveNewDebt:true};
test("Aave posted collateral only; independent venue health and stressed capacity",()=>{
  const st=fixture(),v=aaveVenue("base"),s=v.inspect(st,policy(),now);
  assert.equal(s.stressedCapacityUsdcRaw,"200000000");assert.equal(s.debtUsdcRaw,"500000000");assert.equal(s.health,"3.4");assert.equal(s.stressedHealth,"2.38");
  st.reserves[0].wallet=1000n*e18;
  assert.equal(v.inspect(st,policy(),now).stressedCapacityUsdcRaw,s.stressedCapacityUsdcRaw);
  assert.notEqual(v.id,aaveVenue("eth").id);assert.ok(s.positions.every(x=>x.asset.chain==="base"));
});
test("Aave refuses unknown policy, stale reads, unavailable borrow and protected collateral",()=>{
  assert.equal(aaveRisk(fixture(),undefined,now).capacity,null);
  assert.equal(aaveRisk(fixture(),policy(),now+200000).capacity,null);
  assert.equal(aaveRisk(fixture(),{...policy(),protectedAssets:["WETH"]},now).capacity,0n);
  const st=fixture();st.reserves[1].config|=1n<<60n;assert.equal(aaveRisk(st,policy(),now).capacity,null);
  assert.throws(()=>prepareAave(fixture(),policy(),{...req,approveNewDebt:false},now),/APPROVAL/);
  assert.throws(()=>prepareAave(fixture(),policy(),{...req,amountRaw:201_000000n},now),/capacity/);
});
test("eMode borrow bitmap controls USDC; ltv-zero overrides collateral",()=>{
  const st=fixture();st.eMode=10;st.mode={ltv:9000,threshold:9500,bonus:10200,collateral:1n,borrowable:1n,ltvZero:0n,isolated:false};
  assert.equal(aaveRisk(st,policy(),now).capacity,null);
  st.mode.borrowable=2n;assert.ok(aaveRisk(st,policy(),now).capacity!==null);
  st.mode.ltvZero=1n;assert.equal(aaveRisk(st,policy(),now).capacity,0n);
});
test("Aave repayment keeps holdback; release preserves stressed health; no implicit native ETH",()=>{
  assert.throws(()=>prepareAave(fixture(),policy(),{kind:"repay",asset:"USDC",amountRaw:500_000000n,holdbackRaw:600_000000n},now),/reserved/);
  assert.throws(()=>prepareAave(fixture(),policy(),{kind:"collateral_release",asset:"WETH",amountRaw:e18},now),/health/);
  assert.throws(()=>prepareAave(fixture(),policy(),{kind:"collateral_add",asset:"ETH",amountRaw:e18},now),/Unsupported/);
  const p=prepareAave(fixture(),policy(),{kind:"repay",asset:"USDC",amountRaw:100_000000n,holdbackRaw:500_000000n},now);
  assert.ok(isAave(p));assert.equal(p.evm.transactions.length,2);assert.equal(p.evm.transactions[0].data,calldata("approve(address,uint256)",m.pool,100_000000n));
});
test("wallet rejects tampered amount, network, target and unlimited approval",()=>{
  const p=prepareAave(fixture(),policy(),req,now);assert.doesNotThrow(()=>validateAaveWallet(p));
  for(const mutate of [(q:typeof p)=>q.evm!.transactions[0].to=owner,(q:typeof p)=>q.amountRaw="1",(q:typeof p)=>q.evm!.transactions[0].chainId="0x1"]) {
    const q=structuredClone(p);mutate(q);assert.throws(()=>validateAaveWallet(q));
  }
});
test("final receipt requires exact pool economic event AND underlying payout; ledger adds matching liability",()=>{
  const p=prepareAave(fixture(),policy(),req,now),hash="0x"+"aa".repeat(32),blockHash="0x"+"bb".repeat(32);
  const tx={...p.evm!.transactions[0],input:p.evm!.transactions[0].data,hash,value:"0x0"};
  const topic=(x:string)=>"0x"+word(x);
  const log=(address:string,sig:string,topics:string[],data:bigint[])=>({address,topics:["0x"+hashText(sig),...topics],data:"0x"+data.map(word).join(""),transactionHash:hash,blockHash});
  const receipt={transactionHash:hash,from:owner,to:m.pool,blockHash,status:"0x1",gasUsed:"0x5208",effectiveGasPrice:"0x1",l1Fee:"0x64",logs:[
    log(m.pool,"Borrow(address,address,address,uint256,uint8,uint256,uint16)",[topic(m.debt.id),topic(owner),"0x"+word(0n)],[BigInt(owner),100_000000n,2n,0n]),
    log(m.debt.id,"Transfer(address,address,uint256)",[topic("0x"+"34".repeat(20)),topic(owner)],[100_000000n]) ]};
  const proof=verifyAaveReceipt(tx,receipt,p);assert.equal(proof.state,"confirmed");
  const a={id:"attempt",preparation:p,kind:"borrow",state:"confirmed",hashes:[hash],updatedAt:new Date(now).toISOString(),verificationEvidence:[proof]} as WalletAttempt;
  const entries=aaveLedger(a);assert.equal(entries[0].liabilityEffectUsdcRaw,"100000000");assert.equal(entries[0].netWorthEffectUsdcRaw,"0");assert.equal(entries[0].chain,"base");assert.equal(entries[1].asset,"ETH");
  assert.equal(verifyAaveReceipt(tx,{...receipt,logs:receipt.logs.slice(0,1)},p).state,"pending");
  assert.throws(()=>verifyAaveReceipt({...tx,from:m.pool},receipt,p),/match/);
  assert.equal(verifyAaveReceipt(tx,{...receipt,status:"0x0"},p).state,"failed");
});
test("Aave payment choice cannot pretend EVM USDC is NEAR cash",()=>{
  const c=aaveVenue("base").fundingChoice(fixture(),policy(),100_000000n,"2026-11-20",true,now);
  assert.equal(c.eligible,false);assert.ok(c.reasons.includes("CROSS_CHAIN_USDC_SETTLEMENT_REQUIRED"));assert.equal(c.accountId,owner);
});

test("NEAR settlement proof refuses provider-only success, short/foreign/duplicate payouts and unfinished receipts",async()=>{
  const {nearUsdcProof}=await import("../lib/flowvault/lending-venue-proof.ts");
  const {LENDING_USDC}=await import("../lib/flowvault/lending.ts");
  const hash="A".repeat(44),amount=100_000000n;
  const r={transaction:{hash},final_execution_status:"FINAL",status:{SuccessValue:""},receipts_outcome:[{id:"payout",outcome:{executor_id:LENDING_USDC,status:{SuccessValue:""},logs:["EVENT_JSON:"+JSON.stringify({standard:"nep141",version:"1.0.0",event:"ft_transfer",data:[{old_owner_id:"solver.near",new_owner_id:"owner.near",amount:amount.toString()}]})]}}]};
  assert.equal(nearUsdcProof(r,hash,"owner.near",amount)?.amountRaw,amount.toString());
  assert.equal(nearUsdcProof(r,hash,"foreign.near",amount),null);
  assert.equal(nearUsdcProof(r,hash,"owner.near",amount+1n),null);
  assert.equal(nearUsdcProof({...r,final_execution_status:"EXECUTED"},hash,"owner.near",amount),null);
  assert.equal(nearUsdcProof({...r,receipts_outcome:[...r.receipts_outcome,...r.receipts_outcome]},hash,"owner.near",amount),null);
  assert.equal(nearUsdcProof({status:"SUCCESS"},hash,"owner.near",amount),null);
});

test("Aave plan policy approval names the exact Aave pool/method, never Rhea",async()=>{
  const {stepEntries,planPolicySteps}=await import("../lib/flowvault/plans-policy.ts");
  const entries=stepEntries("borrow",{venue:"aave-v3:base",asset:"USDC"});
  assert.ok(entries.some(e=>e.type==="venue"&&e.venue===m.pool));
  assert.ok(entries.every(e=>e.type!=="venue"||!e.venue.endsWith("near")));
  const steps=planPolicySteps({alternatives:[{id:"aave",steps:["borrow"],venueId:"aave-v3:base"}],selectedChoiceId:"aave",request:{asset:"USDC"}});
  assert.equal(steps[0].venue,"aave-v3:base");
});
