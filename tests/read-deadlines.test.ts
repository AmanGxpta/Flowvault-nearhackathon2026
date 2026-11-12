// R22 regression: a shared in-flight read that never settles (a workerd request cancelled mid-read) must
// not wedge later reads, and every read has a hard deadline.
import test from "node:test";
import assert from "node:assert/strict";
import { readRpc } from "../lib/flowvault/rpc-transport.ts";
import { snapshot, clearSnapshots } from "../lib/flowvault/snapshot-cache.ts";
import { withDeadline, DeadlineError } from "../lib/flowvault/deadline.ts";
import { workspacePortfolio } from "../lib/flowvault/portfolio-service.ts";

const never = <T,>() => new Promise<T>(() => {});
const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }), { status: 200 });
const budget = { attempt: 60, call: 200, shared: 40 };

test("withDeadline rejects a promise that never settles", async () => {
  await assert.rejects(withDeadline(never(), 20, "stuck"), DeadlineError);
  assert.equal(await withDeadline(Promise.resolve(7), 20, "fine"), 7);
});

test("readRpc: a never-answering provider is bounded by the call budget", async () => {
  const t = Date.now();
  await assert.rejects(
    readRpc("query", { r22: "bounded" }, (() => never()) as unknown as typeof fetch, async () => {}, budget),
  );
  assert.ok(Date.now() - t < 1000);
});

test("readRpc: a stuck shared in-flight read is skipped and the caller runs its own", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => (++calls === 1 ? never() : ok({ fresh: true }))) as unknown as typeof fetch;
  try {
    const stuck = readRpc("query", { r22: "shared" }, undefined, undefined, { ...budget, call: 800 });
    stuck.catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    const t = Date.now();
    const second = await readRpc("query", { r22: "shared" }, undefined, undefined, { ...budget, call: 800 });
    assert.deepEqual(second, { fresh: true });
    assert.ok(Date.now() - t < 1000, "second caller must not wait for the stuck read");
  } finally {
    globalThis.fetch = real;
  }
});

test("snapshot: a never-settling load does not wedge later callers", async () => {
  clearSnapshots();
  const first = snapshot("r22", () => never<{ v: number }>(), (o) => o, Date.now(), 800, 30);
  first.catch(() => {});
  const t = Date.now();
  const second = await snapshot("r22", async () => ({ v: 2 }), (o) => o, Date.now(), 800, 30);
  assert.equal(second.v, 2);
  assert.ok(Date.now() - t < 1000);
  // The fresh value is cached for the next caller.
  assert.equal((await snapshot("r22", () => never<{ v: number }>(), (o) => o)).v, 2);
  clearSnapshots();
});

test("snapshot: a load is bounded and fails closed without a last-good value", async () => {
  clearSnapshots();
  await assert.rejects(snapshot("r22-bound", () => never(), (o) => o, Date.now(), 30, 10), DeadlineError);
  clearSnapshots();
});

test("portfolio sections start together: total time is the slowest section, not the sum", async () => {
  const w = {
    mode: "live",
    accountId: "datamastr3.near",
    evmAddresses: { base: "0x" + "1".repeat(40) },
    watchedAccounts: [],
  } as any;
  const wait = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const t = Date.now();
  const { portfolio } = await workspacePortfolio(w, { watch: false }, {
    readPortfolio: (async (a: string) =>
      wait(150, { source: "live", accountId: a, capturedAt: new Date().toISOString(), positions: [], errors: [], sections: [] })) as any,
    readEvmUsdc: (async () => wait(150, { id: "base-usdc", label: "Base USDC", asset: "USDC", amount: "1", kind: "wallet" })) as any,
    readStaking: (async () => wait(150, { source: "live", capturedAt: new Date().toISOString(), native: { status: "unknown", error: "x" }, liquid: [] })) as any,
  });
  const took = Date.now() - t;
  assert.ok(took < 400, "sections ran sequentially: " + took + " ms");
  assert.ok(portfolio.positions.some((p) => p.id === "base-usdc"));
});
