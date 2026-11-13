import test from "node:test";
import assert from "node:assert/strict";
import {borrowAprLabel,borrowHealth,collateralValue} from "../lib/flowvault/borrow-display.ts";
import type {LendingVenueSnapshot} from "../lib/flowvault/contracts.ts";
test("fractional borrowing rates display as percent and unknown is distinct from a free loan",()=>{
 assert.equal(borrowAprLabel("0.175881492270300860321571541"),"17.59%");assert.equal(borrowAprLabel("0"),"0.00%");assert.equal(borrowAprLabel("0.000001"),"<0.01%");assert.equal(borrowAprLabel(null),"Unavailable");assert.equal(borrowAprLabel("oops"),"Unavailable");
});
test("health distinguishes liquidation, configured stress, no debt and missing evidence",()=>{
 assert.equal(borrowHealth({health:"no debt",stressedHealth:"no debt",minHealth:"1.15"}).label,"No debt");
 assert.equal(borrowHealth({health:"0.99",stressedHealth:"0.9",minHealth:"1.15"}).tone,"danger");
 assert.equal(borrowHealth({health:"1.8",stressedHealth:"1.1",minHealth:"1.15"}).tone,"warning");
 assert.equal(borrowHealth({health:"1.8",stressedHealth:null,minHealth:"1.15"}).tone,"unknown");
});
test("collateral total excludes supplied-but-unpledged funds and never turns an unpriced asset into zero",()=>{
 const snapshot={positions:[{asset:{id:"near",decimals:24},suppliedRaw:"9000000000000000000000000",collateralRaw:"2000000000000000000000000"}],pricesAndRisk:[{assetId:"near",priceUsdcRaw:"3500000"}]} as LendingVenueSnapshot;
 assert.equal(collateralValue(snapshot),"7000000");
 snapshot.pricesAndRisk=[];assert.equal(collateralValue(snapshot),null);
 snapshot.pricesAndRisk=[{assetId:"near",priceUsdcRaw:"0"}] as LendingVenueSnapshot["pricesAndRisk"];assert.equal(collateralValue(snapshot),null);
 snapshot.positions[0].collateralRaw="0";assert.equal(collateralValue(snapshot),"0");
});
