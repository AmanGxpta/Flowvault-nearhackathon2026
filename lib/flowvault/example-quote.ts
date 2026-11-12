import { positive, decimal } from "./money.ts";
import type { CashQuote } from "./types.ts";
/** Fictional scenario parameters, not observed fees or a statement that either chain is cheaper. */
const EXAMPLE_ROUTES = {
  bnb: {
    name: "BNB Chain",
    feeBps: 0n,
    fixedUnits: 610000n,
    bufferBps: 10n,
    seconds: 120,
  },
  eth: {
    name: "Ethereum",
    feeBps: 0n,
    fixedUnits: 3400000n,
    bufferBps: 25n,
    seconds: 240,
  },
  near: {
    name: "NEAR",
    feeBps: 0n,
    fixedUnits: 20000n,
    bufferBps: 0n,
    seconds: 5,
  },
  arb: {
    name: "Arbitrum",
    feeBps: 10n,
    fixedUnits: 5300n,
    bufferBps: 50n,
    seconds: 30,
  },
  base: {
    name: "Base",
    feeBps: 7n,
    fixedUnits: 80000n,
    bufferBps: 40n,
    seconds: 25,
  },
} as const;
export function exampleCashQuote(
  amountText: string,
  destination: "arb" | "base" | "bnb" | "eth" | "near",
  now = Date.now(),
): CashQuote & { exampleLabel: string } {
  const route = EXAMPLE_ROUTES[destination];
  if (!route) throw new Error("Choose a supported example destination.");
  const n = positive(amountText);
  const overhead = (n * route.feeBps) / 10000n + route.fixedUnits;
  const minimum = n + overhead;
  const buffer = (minimum * route.bufferBps) / 10000n;
  return {
    source: "demo",
    exampleLabel: `Fictional ${route.name} route costs — example data, not a live quote or chain fee estimate.`,
    capturedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 180000).toISOString(),
    amountOut: decimal(n),
    minInput: decimal(minimum),
    maxInput: decimal(minimum + buffer),
    buffer: decimal(buffer),
    destination,
    seconds: route.seconds,
    raw: {
      kind: "fictional-example-route",
      modelVersion: 1,
      chain: destination,
      feeBps: route.feeBps.toString(),
      fixedCostUsdc: decimal(route.fixedUnits),
      bufferBps: route.bufferBps.toString(),
      notice:
        "Invented scenario assumptions only; refundable funding buffer is separate from the modeled routing shortfall.",
    },
  };
}
