import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payoutAsset,
  matchPayoutToken,
  verifyDestinationReceipt,
  destinationProof,
  evmRpc,
  TRANSFER_TOPIC,
} from "../lib/flowvault/evm.ts";
import {
  paymentRequest,
  verifyPaymentQuote,
  paymentCosts,
} from "../lib/flowvault/payments.ts";
import {
  payoutValuation,
  assertFreshValuation,
  movingCost,
} from "../lib/flowvault/payout-valuation.ts";
import { exampleCreditRows } from "../lib/flowvault/example-credit.ts";
import { stressCapacity } from "../lib/flowvault/credit.ts";
const now = Date.parse("2026-11-12T12:00:00Z"),
  recipient = "0x" + "12".repeat(20),
  hash = "0x" + "ab".repeat(32);
const obligation = {
  id: "aman",
  label: "Aman",
  recipient,
  destination: "bnb" as const,
  token: "USDT" as const,
  amount: "1000",
  dueDate: "2026-11-23",
  status: "pending" as const,
};
test("BNB USDT request binds exact 18-decimal output, omdep asset and owner refund; Ethereum tokens use 6 decimals", () => {
  const r = payoutAsset("bnb", "USDT");
  assert.equal(r.decimals, 18);
  assert.equal(r.blockchain, "bsc");
  assert.match(r.assetId, /bnb-0x55d398.*\.omdep.near$/);
  const req = paymentRequest("owner.near", obligation, r.assetId, now);
  assert.equal(req.amount, "1000000000000000000000");
  assert.equal(req.refundTo, "owner.near");
  for (const token of ["USDC", "USDT"])
    assert.equal(payoutAsset("eth", token).decimals, 6);
  assert.throws(() => payoutAsset("bnb", "USDC"), /Unsupported/);
  assert.throws(
    () =>
      paymentRequest(
        "owner.near",
        obligation,
        payoutAsset("eth", "USDT").assetId,
        now,
      ),
    /asset/,
  );
  const row = {
    ...r,
    assetId: r.assetId,
    symbol: r.token,
    contractAddress: r.address,
  };
  assert.equal(matchPayoutToken([row], "bnb", "USDT"), row);
  for (const change of [
    { decimals: 6 },
    { blockchain: "bnb" },
    { contractAddress: payoutAsset("eth", "USDT").address },
    { symbol: "USDC" },
    { assetId: r.assetId.replace("omdep", "omft") },
  ])
    assert.throws(
      () => matchPayoutToken([{ ...row, ...change }], "bnb", "USDT"),
      /metadata changed/,
    );
});
test("18-decimal quote echo cannot be replaced by another chain, token or six-decimal output", () => {
  const req = paymentRequest(
    "owner.near",
    obligation,
    payoutAsset("bnb", "USDT").assetId,
    now,
  );
  const response = {
    timestamp: new Date(now).toISOString(),
    signature: "SIMULATED_NOT_VALID_SIGNATURE",
    quoteRequest: { ...req },
    quote: {
      depositAddress: "a".repeat(64),
      amountIn: "1004000000",
      minAmountIn: "999200000",
      amountOut: req.amount,
      minAmountOut: req.amount,
    },
  };
  assert.equal(
    verifyPaymentQuote(req, response, [], 25, now).amountIn,
    "1004000000",
  );
  for (const change of [
    { destinationAsset: payoutAsset("eth", "USDT").assetId },
    { amount: "1000000000" },
    { recipient: "0x" + "34".repeat(20) },
  ])
    assert.throws(
      () =>
        verifyPaymentQuote(
          req,
          { ...response, quoteRequest: { ...req, ...change } },
          [],
          25,
          now,
        ),
      /Unsafe/,
    );
  assert.throws(
    () =>
      verifyPaymentQuote(
        req,
        { ...response, quote: { ...response.quote, amountOut: "1000000000" } },
        [],
        25,
        now,
      ),
    /exact-output/,
  );
  const fx = payoutValuation(
    { price: 1, priceUpdatedAt: new Date(now).toISOString() },
    { price: 0.999, priceUpdatedAt: new Date(now).toISOString() },
    "1000",
    now,
  );
  assert.equal(fx.outputValueUsdc, "999");
  assert.equal(
    paymentCosts(response.quote, fx.outputValueUsdc).maximumInputMinusNet,
    "5",
  );
  assert.equal(movingCost("998", "999"), "0");
  assert.throws(() => assertFreshValuation(fx, now + 180001), /stale/);
  assert.throws(() => payoutValuation({ price: 0 }, { price: 1 }, "1000", now));
  assert.throws(
    () =>
      payoutValuation(
        { price: 1, priceUpdatedAt: "invalid" },
        { price: 1, priceUpdatedAt: new Date(now).toISOString() },
        "1000",
        now,
      ),
    /stale/,
  );
});
function receipt(chain: "bnb" | "eth", token: "USDC" | "USDT") {
  const a = payoutAsset(chain, token),
    block = {
      number: "0x100",
      hash: "0x" + "bc".repeat(32),
      timestamp: "0x" + BigInt(now / 1000).toString(16),
    },
    raw = (1000n * 10n ** BigInt(a.decimals)).toString();
  return {
    block,
    raw,
    receipt: {
      status: "0x1",
      transactionHash: hash,
      blockNumber: block.number,
      blockHash: block.hash,
      logs: [
        {
          address: a.address,
          transactionHash: hash,
          blockHash: block.hash,
          logIndex: "0x0",
          topics: [
            TRANSFER_TOPIC,
            "0x" + "00".repeat(32),
            "0x" + recipient.slice(2).padStart(64, "0"),
          ],
          data: "0x" + BigInt(raw).toString(16).padStart(64, "0"),
        },
      ],
    },
  };
}
test("BSC/Ethereum destination proof requires exact configured token amount, recipient and canonical finality", () => {
  for (const [chain, token] of [
    ["bnb", "USDT"],
    ["eth", "USDC"],
    ["eth", "USDT"],
  ] as const) {
    const f = receipt(chain, token),
      created = new Date(now).toISOString();
    assert.equal(
      verifyDestinationReceipt(
        chain,
        f.receipt,
        f.block,
        f.block,
        recipient,
        f.raw,
        created,
        token,
      ).token,
      payoutAsset(chain, token).address,
    );
    for (const mutate of [
      (r: any) => (r.logs[0].address = "0x" + "11".repeat(20)),
      (r: any) =>
        (r.logs[0].data =
          "0x" + (1000n * 1000000n).toString(16).padStart(64, "0")),
      (r: any) => (r.logs[0].topics[2] = "0x" + "00".repeat(32)),
      (r: any) => (r.status = "0x0"),
      (r: any) => (r.blockHash = "0x" + "12".repeat(32)),
    ]) {
      const r = structuredClone(f.receipt);
      mutate(r);
      if (JSON.stringify(r) === JSON.stringify(f.receipt)) continue;
      assert.throws(() =>
        verifyDestinationReceipt(
          chain,
          r,
          f.block,
          f.block,
          recipient,
          f.raw,
          created,
          token,
        ),
      );
    }
    assert.throws(
      () =>
        verifyDestinationReceipt(
          chain,
          f.receipt,
          f.block,
          { number: "0xff" },
          recipient,
          f.raw,
          created,
          token,
        ),
      /finalized/,
    );
  }
});
test("BSC public RPC falls back and proof checks chain ID and actual token decimals", async (t) => {
  let calls = 0,
    wrongChain = false,
    wrongDecimals = false;
  const f = receipt("bnb", "USDT");
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, options?: RequestInit) => {
      calls++;
      if (String(url).includes("bnbchain.org")) throw Error("primary offline");
      const req = JSON.parse(String(options?.body));
      const result =
        req.method === "eth_chainId"
          ? wrongChain
            ? "0x1"
            : "0x38"
          : req.method === "eth_getTransactionReceipt"
            ? f.receipt
            : req.method === "eth_getBlockByNumber"
              ? f.block
              : req.method === "eth_call"
                ? wrongDecimals
                  ? "0x6"
                  : "0x12"
                : null;
      return Response.json({ result });
    },
  );
  assert.equal(await evmRpc("bnb", "eth_chainId", []), "0x38");
  assert.equal(calls, 2);
  assert.equal(
    (
      await destinationProof(
        "bnb",
        hash,
        recipient,
        f.raw,
        new Date(now).toISOString(),
        "USDT",
      )
    ).decimals,
    18,
  );
  wrongChain = true;
  await assert.rejects(
    () =>
      destinationProof(
        "bnb",
        hash,
        recipient,
        f.raw,
        new Date(now).toISOString(),
        "USDT",
      ),
    /wrong chain/,
  );
  wrongChain = false;
  wrongDecimals = true;
  await assert.rejects(
    () =>
      destinationProof(
        "bnb",
        hash,
        recipient,
        f.raw,
        new Date(now).toISOString(),
        "USDT",
      ),
    /decimals/,
  );
});
test("illustrative supported Rhea LST credit is nonzero while permissions still gate capacity", () => {
  const market = {
    id: "illustrative",
    source: "demo" as const,
    capturedAt: new Date(now).toISOString(),
    existingDebt: "0",
    protocolLimit: "50000",
    liquidity: "50000",
    assets: exampleCreditRows(),
  };
  assert.equal(stressCapacity([market], now).capacity, "54.536533");
  assert.equal(stressCapacity([market], now).capacityDisplay, "54.54");
  market.assets = market.assets.map((a) => ({
    ...a,
    permissions: ["hold", "pledge"],
  }));
  assert.equal(stressCapacity([market], now).capacity, "0");
});
