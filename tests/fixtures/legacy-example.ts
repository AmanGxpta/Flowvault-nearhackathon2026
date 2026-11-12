// Historical engine regression scenarios. Not the product example workspace.
import type {
  MarketSnapshot,
  Portfolio,
  Workspace,
} from "../../lib/flowvault/types";
export function seed(): Workspace {
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return {
    schemaVersion: 2,
    obligations: [
      {
        id: "example-payment",
        label: "Upcoming payment",
        recipient: "",
        destination: "arb",
        token: "USDC",
        amount: "5000",
        dueDate: due,
        status: "pending",
      },
    ],
    mode: "demo",
    accountId: null,
    mandate: {
      reserve: "10000",
      cashAmount: "5000",
      cashDate: due,
      destination: "arb",
      horizon: 30,
      maxMoveCost: "20",
      approved: ["rhea-usdc", "usdc-vault"],
      borrowing: false,
      version: 1,
    },
    operations: [],
  };
}
export function demoMarket(): MarketSnapshot {
  return {
    source: "demo",
    capturedAt: new Date().toISOString(),
    warnings: ["Example rates and exit windows. No funds are invested."],
    markets: [
      {
        id: "rhea-usdc",
        name: "Rhea Lending",
        token: "USDC",
        asset: "USDC",
        family: "lending",
        apr: "0.084",
        borrowApr: "0.126",
        exitDays: 0,
        exitLabel: "Subject to available liquidity",
        available: true,
        note: "Example supply and borrow rates for exploring the plan.",
      },
      {
        id: "usdc-vault",
        name: "USDC vault",
        token: "USDC",
        asset: "USDC",
        family: "vault",
        apr: "0.108",
        borrowApr: null,
        exitDays: 3,
        exitLabel: "3-day scenario redemption",
        available: true,
        note: "Hypothetical opportunity designed to test a deadline conflict.",
      },
      {
        id: "linear",
        name: "LiNEAR",
        token: "LiNEAR",
        asset: "NEAR",
        family: "staking",
        apr: null,
        borrowApr: null,
        exitDays: null,
        exitLabel: "Unstaking terms require verification",
        available: false,
        note: "NEAR exposure is kept separate from the USDC earning mandate.",
      },
    ],
  };
}
export function demoPortfolio(): Portfolio {
  return {
    source: "demo",
    accountId: null,
    capturedAt: new Date().toISOString(),
    errors: [],
    positions: [
      {
        id: "cash",
        label: "Available reserve",
        asset: "USDC",
        amount: "12000",
        kind: "wallet",
      },
      {
        id: "rhea",
        label: "Rhea Lending",
        asset: "USDC",
        amount: "28000",
        kind: "supplied",
      },
      {
        id: "vault",
        label: "USDC vault",
        asset: "USDC",
        amount: "8000",
        kind: "supplied",
      },
    ],
  };
}
