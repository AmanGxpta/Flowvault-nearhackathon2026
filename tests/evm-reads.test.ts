import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvmUsdc, EVM_CHAINS } from "../lib/flowvault/evm.ts";
const address = "0x" + "12".repeat(20);
async function mockReads(
  t: any,
  chain: "base" | "arb",
  mutate?: (method: string, params: any[], result: any) => any,
) {
  const calls: any[] = [];
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = (async (url: any, options: any) => {
    assert.equal(String(url), EVM_CHAINS[chain].rpc);
    const { method, params } = JSON.parse(options.body);
    calls.push({ method, params });
    let result: any =
      method === "eth_chainId"
        ? "0x" + EVM_CHAINS[chain].chainId.toString(16)
        : method === "eth_getBlockByNumber"
          ? { number: "0x100", hash: "0x" + "ab".repeat(32) }
          : params[0].data === "0x313ce567"
            ? "0x6"
            : "0x20000000000001";
    if (mutate) result = mutate(method, params, result);
    return Response.json({ jsonrpc: "2.0", id: "flowvault", result });
  }) as typeof fetch;
  return calls;
}
for (const chain of ["base", "arb"] as const)
  test(
    "public " +
      chain +
      " USDC read pins finalized state/native token/precision and preserves bigint",
    async (t) => {
      const calls = await mockReads(t, chain);
      const p = await readEvmUsdc(chain, address);
      assert.equal(p.rawAmount, "9007199254740993");
      assert.equal(p.amount, "9007199254.740993");
      assert.equal(p.source, "live");
      assert.deepEqual(
        calls.find((c) => c.method === "eth_getBlockByNumber").params,
        ["finalized", false],
      );
      for (const c of calls.filter((c) => c.method === "eth_call")) {
        assert.equal(c.params[0].to, EVM_CHAINS[chain].usdc);
        assert.equal(c.params[1], "0x100");
      }
      assert.ok(
        calls.some(
          (c) =>
            c.params[0]?.data ===
            "0x70a08231" + address.slice(2).padStart(64, "0"),
        ),
      );
    },
  );
test("wrong EVM chain cannot be reported as a known balance", async (t) => {
  await mockReads(t, "base", (method, _p, r) =>
    method === "eth_chainId" ? "0x1" : r,
  );
  await assert.rejects(readEvmUsdc("base", address), /wrong chain/);
});
test("unknown decimals and missing finalized block fail closed", async (t) => {
  await mockReads(t, "base", (method, p, r) =>
    method === "eth_call" && p[0].data === "0x313ce567" ? "0x12" : r,
  );
  await assert.rejects(readEvmUsdc("base", address), /precision/);
});
test("missing finalized block fails closed", async (t) => {
  await mockReads(t, "arb", (method, _p, r) =>
    method === "eth_getBlockByNumber" ? null : r,
  );
  await assert.rejects(readEvmUsdc("arb", address), /Finalized/);
});
