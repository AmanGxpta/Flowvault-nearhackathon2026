"use client";
import { useEffect, useState } from "react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
export function useTokenCatalog(){
  const [tokens,setTokens]=useState<SwapToken[]>([]),[error,setError]=useState("");
  useEffect(()=>{const abort=new AbortController();fetch("/api/swap",{signal:abort.signal,cache:"no-store"}).then(async r=>{const b=await r.json() as {tokens:SwapToken[];error?:string};if(!r.ok)throw new Error(b.error);if(!abort.signal.aborted)setTokens(b.tokens);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[]);
  return {tokens,error};
}
export function coreIdentity(t: Pick<SwapToken,"network"|"contract"|"symbol">){
  return t.network==="near" && ["native","wrap.near","17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","usdt.tether-token.near","eth.bridge.near"].includes(t.contract)
    || ["eth","base","arb"].includes(t.network)&&t.contract==="native"&&t.symbol==="ETH"
    || t.network==="base"&&t.contract.toLowerCase()==="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
    || t.network==="arb"&&t.contract.toLowerCase()==="0xaf88d065e77c8cc2239327c5edb3a432268e5831";
}
