import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeMarketFrame} from "../lib/flowvault/market-stream.ts";
import type {DisplayMarket} from "../lib/flowvault/market-display.ts";
const empty=():DisplayMarket=>({coin:"ETH",interval:"15m",capturedAt:"",bookAt:null,mid:null,candles:[],bids:[],asks:[],warnings:[],stale:false});
test("live candles update the open candle, append a new candle, and retain history",()=>{
  const frame=(t:number,c:number)=>({channel:"candle",data:{s:"ETH",i:"15m",t,o:2000,h:2100,l:1900,c,v:3}});
  let m=mergeMarketFrame(empty(),frame(1000,2010),100);
  m=mergeMarketFrame(m,frame(1000,2020),200);assert.equal(m.candles.length,1);assert.equal(m.candles[0].close,2020);
  m=mergeMarketFrame(m,frame(2000,2030),300);assert.deepEqual(m.candles.map(c=>c.close),[2020,2030]);
  assert.equal(m.capturedAt,new Date(300).toISOString());
});
test("live market switching rejects foreign candles and books without overwriting the active market",()=>{
  const m=empty();for(const frame of [null,{channel:"candle",data:{s:"BTC",i:"15m",t:1,o:"1",h:"2",l:"1",c:"2"}},{channel:"candle",data:{s:"ETH",i:"4h",t:1,o:"1",h:"2",l:"1",c:"2"}},{channel:"l2Book",data:{coin:"BTC",time:1,levels:[[],[]]}},{channel:"allMids",data:{mids:{BTC:"5"}}}])assert.equal(mergeMarketFrame(m,frame),m);
});
test("out-of-order books and malformed frames preserve the last good read",()=>{
  const frame=(time:number,px:string)=>({channel:"l2Book",data:{coin:"ETH",time,levels:[[{px,sz:"2"}],[{px:"2100",sz:"3"}]]}});
  const m=mergeMarketFrame(empty(),frame(200,"2000"));assert.equal(mergeMarketFrame(m,frame(100,"1800")),m);
  assert.equal(mergeMarketFrame(m,{channel:"l2Book",data:"broken"}),m);
  const next=mergeMarketFrame(m,{channel:"allMids",data:{mids:{ETH:"2050"}}});assert.equal(next.mid,"2050");assert.equal(next.bids[0].price,"2000");
});
