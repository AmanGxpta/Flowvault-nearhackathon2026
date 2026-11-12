import { NEAR_READ_PROVIDERS as URLS } from "./rpc-endpoints.ts";
const pending = new Map<string, Promise<any>>();
export async function readRpc(
  method: string,
  params: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
) {
  const key = JSON.stringify([method, params]);
  if (fetcher === fetch && pending.has(key))
    return structuredClone(await pending.get(key));
  const run = (async () => {
    let failure = "NEAR public RPC unavailable.";
    for (let round = 0; round < 2; round++) {
      if (round) await pause(250);
      for (const url of URLS) {
        try {
          const r = await fetcher(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: "flowvault",
              method,
              params,
            }),
            signal: AbortSignal.timeout(7000),
          });
          if (!r.ok) throw new Error("RPC returned " + r.status);
          const body = (await r.json()) as any;
          if (body.error)
            throw new Error(
              typeof body.error.data === "string"
                ? body.error.data
                : (body.error.message ?? "RPC error"),
            );
          if (!("result" in body)) throw new Error("Missing RPC result.");
          return body.result;
        } catch (e) {
          failure = String(e);
        }
      }
    }
    throw new Error(failure);
  })();
  if (fetcher === fetch) pending.set(key, run);
  try {
    return structuredClone(await run);
  } finally {
    if (pending.get(key) === run) pending.delete(key);
  }
}
