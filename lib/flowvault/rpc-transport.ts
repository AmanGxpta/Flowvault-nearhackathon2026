import { NEAR_READ_PROVIDERS as URLS } from "./rpc-endpoints.ts";
import { READ_BUDGET, withDeadline } from "./deadline.ts";
// R22: identical concurrent reads share one request, but a caller waits on someone else's in-flight
// read for at most READ_BUDGET.shared. On workerd a promise owned by a cancelled request never settles,
// so a stuck entry is evicted and the caller runs its own bounded read. Every call has a hard deadline.
const pending = new Map<string, { run: Promise<any>; at: number }>();
export async function readRpc(
  method: string,
  params: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
  budget: { attempt: number; call: number; shared: number } = {
    attempt: READ_BUDGET.attempt,
    call: READ_BUDGET.rpcCall,
    shared: READ_BUDGET.shared,
  },
) {
  const key = JSON.stringify([method, params]);
  const shared = fetcher === fetch ? pending.get(key) : undefined;
  if (shared && Date.now() - shared.at < budget.call) {
    try {
      return structuredClone(await withDeadline(shared.run, budget.shared, "Shared NEAR read"));
    } catch {
      // Fall through to an independent read; the stuck or failed entry is replaced below.
    }
  }
  const started = Date.now();
  const run = withDeadline(
    (async () => {
      let failure = "NEAR public RPC unavailable.";
      for (let round = 0; round < 2; round++) {
        if (round) await pause(250);
        for (const url of URLS) {
          const left = budget.call - (Date.now() - started);
          if (left <= 0) throw new Error(failure + " (read budget spent)");
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
              signal: AbortSignal.timeout(Math.min(budget.attempt, left)),
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
    })(),
    budget.call,
    "NEAR public RPC " + method,
  );
  if (fetcher === fetch) pending.set(key, { run, at: started });
  try {
    return structuredClone(await run);
  } finally {
    if (pending.get(key)?.run === run) pending.delete(key);
  }
}
