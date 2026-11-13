import { NearRpcError, type NearFetch } from "@anywalletkit/wallet-near";
import { readRpc, RpcResponseError } from "./rpc-transport.ts";

/** Each SDK operation shares identical reads within that request only. Rejections are evicted so Retry does fresh
 * work. Shared transport supplies bounded failover/backoff; SDK-specific contract errors retain their identity. */
export function stakingReadProvider(read: (method:string, params:Record<string,unknown>)=>Promise<unknown> = readRpc): NearFetch {
  const reads = new Map<string, Promise<unknown>>();
  return async (method, params) => {
    if(!["query","block","status","gas_price","EXPERIMENTAL_protocol_config","validators"].includes(method)) throw new Error("Staking provider is read-only.");
    const key=JSON.stringify([method,params]);
    let run=reads.get(key);
    if(!run) {
      run=Promise.resolve().then(()=>read(method, params as Record<string,unknown>)).catch(e=>{
        reads.delete(key);
        if(e instanceof RpcResponseError) throw new NearRpcError(method,e.rpcError);
        throw e;
      }); reads.set(key,run);
    }
    return structuredClone(await run);
  };
}
