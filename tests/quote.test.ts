import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleCashQuote } from "../lib/flowvault/example-quote.ts";
import { units } from "../lib/flowvault/money.ts";
import { compareCash } from "../lib/flowvault/planner.ts";
import { seed, demoMarket, demoPortfolio } from "./fixtures/legacy-example.ts";
import {
  friendlyQuoteError,
  QuoteUpstreamError,
} from "../lib/flowvault/quote-errors.ts";
import { dryCashQuote, USDC } from "../lib/flowvault/near.ts";
const context = { destination: "base" as const, stage: "quote" as const };
test("Fictional routes differ by chain while comparing the same net USDC payout", () => {
  const now = Date.now();
  const arb = exampleCashQuote("5000", "arb", now),
    base = exampleCashQuote("5000", "base", now);
  assert.equal(arb.amountOut, base.amountOut);
  assert.equal(arb.amountOut, "5000");
  assert.equal(arb.minInput, "5005.0053");
  assert.equal(base.minInput, "5003.58");
  assert.notEqual(arb.maxInput, base.maxInput);
  assert.notEqual(arb.buffer, base.buffer);
  assert.equal(arb.destination, "arb");
  assert.equal(base.destination, "base");
  assert.equal(arb.capturedAt, base.capturedAt);
  for (const q of [arb, base]) {
    assert.equal(q.source, "demo");
    assert.match(q.exampleLabel, /fictional.*example data/i);
    assert.match(q.exampleLabel, /not a live quote/i);
    assert.equal((q.raw as any).kind, "fictional-example-route");
  }
});
test("Fictional route fees and refundable buffer remain separate in comparisons", () => {
  for (const destination of ["arb", "base"] as const) {
    const q = exampleCashQuote("5000", destination);
    const c = compareCash(
      "5000",
      30,
      q,
      demoMarket(),
      demoPortfolio(),
      seed().mandate,
    );
    assert.equal(c.amountOut, "5000");
    assert.equal(c.executable, false);
    assert.equal(
      units(q.minInput) - units(q.amountOut),
      units(c.routingShortfall),
    );
    assert.equal(units(q.maxInput) - units(q.minInput), units(c.buffer));
  }
});
test("Example model keeps precision for large amounts and tiny payouts without Number coercion", () => {
  for (const amount of ["0.000001", "9007199254740993.123456"]) {
    for (const destination of ["arb", "base"] as const) {
      const q = exampleCashQuote(amount, destination);
      assert.equal(q.amountOut, amount);
      assert(units(q.minInput) >= units(amount));
      assert.equal(units(q.maxInput), units(q.minInput) + units(q.buffer));
    }
  }
  for (const amount of ["0", "-1", "1e6", "1.0000001"])
    assert.throws(() => exampleCashQuote(amount, "base"));
  assert.throws(
    () => exampleCashQuote("1", "unsupported" as any),
    /supported example/,
  );
});
for (const [raw, status, match] of [
  ["recipient is not valid", 400, /Base destination address.*control on Base/],
  ["invalid recipient", 400, /destination address/],
  ["refundTo is invalid", 400, /NEAR refund account/],
  ["amount is too small", 400, /swap limits/],
  ["maximum swap amount exceeded", 400, /swap limits/],
  ["insufficient liquidity", 400, /No quote is available/],
  ["no quotes available", 400, /No quote is available/],
  ["route is not supported", 400, /No quote is available/],
  ["slippage tolerance", 400, /fresh quote/],
  ["fetch failed", null, /could not be reached/],
  ["timed out", null, /could not be reached/],
  ["rate limited", 429, /busy/],
  ["internal error", 503, /temporarily unavailable/],
  ["unauthorized", 401, /not available for this request/],
  ["unknown provider failure", 400, /not available right now/],
] as const)
  test("1Click maps " + raw + " to actionable text", () =>
    assert.match(friendlyQuoteError(raw, status, context), match),
  );
test("Raw JSON/array/plain/HTML provider errors are retained in debug, never exposed as the primary error", () => {
  for (const raw of [
    '{"message":"recipient is not valid"}',
    '{"message":["recipient is not valid"]}',
    "recipient is not valid",
    "<html>internal provider trace</html>",
  ]) {
    const e = new QuoteUpstreamError(raw, 400, context);
    assert.equal(e.debug.rawResponse, raw);
    assert.equal(e.debug.status, 400);
    assert.equal(e.debug.provider, "1Click");
    assert.notEqual(e.message, raw);
  }
  const e = new QuoteUpstreamError(
    '{"message":"recipient is not valid"}',
    400,
    { ...context, destination: "arb" },
  );
  assert.equal(e.debug.rawMessage, "recipient is not valid");
  assert.match(e.message, /Arbitrum/);
  assert.match(
    friendlyQuoteError("unknown", 400, { ...context, stage: "assets" }),
    /Supported cross-chain assets/,
  );
});
async function withMockProvider(
  reply: () => Response | Promise<Response>,
  fn: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (
      url.includes("rpc.mainnet.near.org") ||
      url.includes("free.rpc.fastnear.com")
    )
      return Response.json({ result: { amount: "1", block_height: 1 } });
    if (url.endsWith("/tokens"))
      return Response.json([
        {
          assetId: "nep141:" + USDC,
          symbol: "USDC",
          blockchain: "near",
          decimals: 6,
        },
        {
          assetId:
            "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
          symbol: "USDC",
          blockchain: "base",
          decimals: 6,
          contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ]);
    assert(url.endsWith("/quote"));
    const request = JSON.parse(String(init?.body));
    assert.equal(request.dry, true);
    assert.equal(request.swapType, "EXACT_OUTPUT");
    assert.equal(
      request.destinationAsset,
      "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    );
    assert.equal(request.recipient, "0x" + "2".repeat(40));
    const response = await reply();
    if (response.ok) {
      const body: any = await response.json();
      body.quoteRequest = { ...request, ...body.quoteRequest };
      return Response.json(body);
    }
    return response;
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}
const dry = () =>
  dryCashQuote("example.near", "0x" + "2".repeat(40), "base", "5000000000");
test("Live dry quote preserves upstream prices and request semantics, without example model data", async () => {
  await withMockProvider(
    () =>
      Response.json({
        quoteRequest: { dry: true },
        timestamp: new Date().toISOString(),
        quote: {
          amountIn: "5020000000",
          minAmountIn: "5010000000",
          amountOut: "5000000000",
          minAmountOut: "5000000000",
          timeEstimate: 17,
        },
      }),
    async () => {
      const q = await dry();
      assert.equal(q.source, "live");
      assert.equal(q.amountOut, "5000");
      assert.equal(q.minInput, "5010");
      assert.equal(q.maxInput, "5020");
      assert.equal(q.buffer, "10");
      assert.equal(q.seconds, 17);
      assert(!("exampleLabel" in q));
    },
  );
});
test("Live provider validation errors carry friendly text plus the exact raw response", async () => {
  const raw = '{"message":"recipient is not valid","statusCode":400}';
  await withMockProvider(
    () => new Response(raw, { status: 400 }),
    async () => {
      await assert.rejects(dry, (e) => {
        assert(e instanceof QuoteUpstreamError);
        assert.match(e.message, /Base destination address/);
        assert.equal(e.debug.rawResponse, raw);
        assert.equal(e.debug.rawMessage, "recipient is not valid");
        return true;
      });
    },
  );
});
test("Non-JSON provider outages and network failures preserve diagnostics", async () => {
  await withMockProvider(
    () => new Response("<html>upstream unavailable</html>", { status: 502 }),
    async () => {
      await assert.rejects(dry, (e) => {
        assert(e instanceof QuoteUpstreamError);
        assert.match(e.message, /temporarily unavailable/);
        assert.equal(e.debug.rawResponse, "<html>upstream unavailable</html>");
        return true;
      });
    },
  );
  await withMockProvider(
    () => {
      throw Error("fetch failed");
    },
    async () => {
      await assert.rejects(dry, (e) => {
        assert(e instanceof QuoteUpstreamError);
        assert.match(e.message, /could not be reached/);
        assert.equal(e.debug.rawMessage, "fetch failed");
        return true;
      });
    },
  );
});

test("Malformed supported-assets replies retain their raw text with an assets-specific error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) =>
    String(input).endsWith("/tokens")
      ? new Response("{broken-json", { status: 200 })
      : Response.json({ result: { amount: "1", block_height: 1 } });
  try {
    await assert.rejects(dry, (e) => {
      assert(e instanceof QuoteUpstreamError);
      assert.match(e.message, /Supported cross-chain assets/);
      assert.equal(e.debug.rawResponse, "{broken-json");
      assert.equal(e.debug.stage, "assets");
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});
