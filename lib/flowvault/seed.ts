import { exampleCreditRows } from "./example-credit.ts";
import type {
  MarketSnapshot,
  Portfolio,
  Workspace,
  Position,
} from "./types.ts";
import { SUPPLY_USDC as USDC } from "./supply.ts";
import { defaultPolicy } from "./policy.ts";
const day = 86400000;
export const FICTIONAL =
  "FICTIONAL EXAMPLE — no funds, accounts, prices or returns verified";
export function exampleDate(offset: number, now = Date.now()) {
  return new Date(now + offset * day).toISOString().slice(0, 10);
}
export function seed(now = Date.now()): Workspace {
  const obligations = [
    {
      id: "studio-rent",
      label: "Studio rent",
      amount: "2500",
      token: "USDC" as const,
      destination: "base" as const,
      recipient: "0x" + "11".repeat(20),
      dueDate: exampleDate(2, now),
      note: "Fictional landlord invoice",
      recurrence: "monthly" as const,
      status: "pending" as const,
    },
    {
      id: "rent-aman",
      label: "Rent to Aman",
      amount: "1000",
      token: "USDT" as const,
      destination: "bnb" as const,
      recipient: "0x" + "22".repeat(20),
      dueDate: exampleDate(11, now),
      note: "Fictional USDT obligation; example valuation assumes 1 USDT = 1 USDC; live BNB execution unsupported.",
      recurrence: "monthly" as const,
      status: "pending" as const,
    },
    {
      id: "design-software",
      label: "Design software",
      amount: "50",
      token: "USDC" as const,
      destination: "arb" as const,
      recipient: "0x" + "33".repeat(20),
      dueDate: exampleDate(13, now),
      recurrence: "yearly" as const,
      status: "pending" as const,
    },
    {
      id: "payroll",
      label: "Payroll to aman.near",
      amount: "6000",
      token: "USDC" as const,
      destination: "near" as const,
      recipient: "aman.near",
      dueDate: exampleDate(19, now),
      recurrence: "monthly" as const,
      note: "Fictional payroll, not a real recipient instruction",
      status: "pending" as const,
    },
  ];
  const policy = {
    ...defaultPolicy("5"),
    version: 4,
    creditRows: exampleCreditRows(),
    methods: [
      ...defaultPolicy().methods,
      { receiver: USDC, method: "ft_transfer" },
      { receiver: "linear-protocol.near", method: "deposit_and_stake" },
      { receiver: "lst.rhealab.near", method: "deposit_and_stake" },
    ],
    perActionCap: "5000",
    dailyCap: "8000",
    protectedAssets: ["ETH"],
    venues: [
      "contract.main.burrow.near",
      "1click",
      "native",
      "linear-protocol.near",
      "lst.rhealab.near",
    ],
    recipients: ["$owner", ...obligations.map((o) => o.recipient)],
    assetRows: [
      {
        asset: "USDC",
        priority: "P1" as const,
        uses: ["hold", "supply", "pay", "fees"] as const,
      },
      {
        asset: "NEAR",
        priority: "P2" as const,
        uses: ["hold", "stake", "fees"] as const,
      },
      { asset: "ETH", priority: "P1" as const, uses: ["hold"] as const },
      {
        asset: "LiNEAR",
        priority: "P3" as const,
        uses: ["hold", "pledge", "borrow"] as const,
      },
      {
        asset: "rNEAR",
        priority: "P3" as const,
        uses: ["hold", "pledge", "borrow"] as const,
      },
    ].map((r) => ({ ...r, uses: [...r.uses] })),
  };
  return {
    schemaVersion: 3,
    exampleSeed: "design-v1",
    exampleCreditVersion: 1,
    fictional: true,
    exampleAnchorDate: exampleDate(0, now),
    mode: "demo",
    accountId: null,
    obligations,
    mandate: {
      source: "demo",
      reserve: "2000",
      cashAmount: "9550",
      cashDate: obligations[0].dueDate,
      destination: "base",
      horizon: 30,
      leadDays: 3,
      maxMoveCost: "5",
      approved: ["rhea-usdc", "usdc-vault", "native", "linear", "rnear"],
      borrowing: false,
      version: 1,
      obligations,
    },
    policy,
    policyHistory: [
      {
        version: 4,
        savedAt: new Date(now).toISOString(),
        summary:
          "Fictional policy: daily cap, ETH protected, venue and per-asset rules",
      },
    ],
    operations: [],
    watchedAccounts: [],
  };
}
export function personalSeed(): Workspace {
  const example = seed();
  return {
    schemaVersion: 3,
    mode: "live",
    accountId: null,
    mandate: {
      ...example.mandate,
      source: "live",
      cashAmount: "0",
      obligations: [],
      approved: ["rhea-usdc"],
      version: 1,
    },
    obligations: [],
    operations: [],
    policy: defaultPolicy(),
    evmAddresses: {},
    watchedAccounts: [],
    policyHistory: [
      {
        version: 1,
        savedAt: new Date().toISOString(),
        summary: "Default personal policy created",
      },
    ],
  };
}
export function demoMarket(now = Date.now()): MarketSnapshot {
  return {
    source: "demo",
    capturedAt: new Date(now).toISOString(),
    warnings: [FICTIONAL],
    markets: [
      {
        id: "rhea-usdc",
        name: "Rhea Lending",
        asset: "USDC",
        token: "USDC",
        family: "lending",
        apr: "0.084",
        borrowApr: "0.126",
        exitDays: 0,
        exitLabel: "Fictional available-liquidity scenario",
        available: true,
        note: FICTIONAL,
      },
      {
        id: "usdc-vault",
        name: "USDC vault",
        asset: "USDC",
        token: "USDC",
        family: "vault",
        apr: "0.108",
        borrowApr: null,
        exitDays: 7,
        exitLabel: "Fictional seven-day redemption; misses first obligation",
        available: true,
        note: FICTIONAL,
      },
      ...(["native", "linear", "rnear"] as const).map((id) => ({
        id,
        name:
          id === "native"
            ? "Native NEAR"
            : id === "linear"
              ? "LiNEAR"
              : "rNEAR",
        asset: "NEAR" as const,
        token: "NEAR",
        family: "staking" as const,
        apr: id === "native" ? "0.082" : "0.086",
        borrowApr: null,
        exitDays: 3,
        exitLabel:
          "Fictional four-epoch unstaking estimate; not a USDC guarantee",
        available: true,
        note: FICTIONAL,
      })),
    ],
  };
}
export function demoPortfolio(now = Date.now()): Portfolio {
  const capturedAt = new Date(now).toISOString();
  const valuation = (amount: string) => ({
    amount,
    unit: "USD" as const,
    source: "demo" as const,
    capturedAt,
    basis: FICTIONAL,
  });
  const row = (
    id: string,
    label: string,
    asset: string,
    amount: string,
    kind: Position["kind"],
    chain: Position["chain"],
    value: string | null,
    extra: Partial<Position> = {},
  ): Position => ({
    id,
    label,
    asset,
    amount,
    kind,
    chain,
    source: "demo",
    capturedAt,
    fictional: true,
    ownership: "owner",
    valuation: value === null ? null : valuation(value),
    ...extra,
  });
  return {
    source: "demo",
    accountId: null,
    capturedAt,
    errors: [],
    positions: [
      row(
        "cash",
        "NEAR wallet USDC · fictional",
        "USDC",
        "14240",
        "wallet",
        "near",
        "14240",
      ),
      row(
        "base-usdc",
        "Base wallet USDC · fictional",
        "USDC",
        "640",
        "wallet",
        "base",
        "640",
      ),
      row(
        "arb-usdc",
        "Arbitrum wallet USDC · fictional",
        "USDC",
        "310",
        "wallet",
        "arb",
        "310",
      ),
      row(
        "rhea",
        "Rhea USDC supply · fictional",
        "USDC",
        "7500",
        "supplied",
        "near",
        "7500",
        { venue: "contract.main.burrow.near", availableAt: capturedAt },
      ),
      row(
        "native-staked",
        "Staked NEAR · fictional",
        "NEAR",
        "120",
        "staking",
        "near",
        "384",
        { venue: "example-validator.poolv1.near" },
      ),
      row(
        "native-unstaking",
        "Unstaking NEAR · fictional",
        "NEAR",
        "8",
        "staking",
        "near",
        "25.6",
        {
          availableAt: exampleDate(2, now) + "T00:00:00Z",
          availabilityIsEstimate: true,
        },
      ),
      row(
        "linear-shares",
        "LiNEAR · fictional",
        "LiNEAR",
        "60",
        "staking",
        "near",
        "207.36",
        { venue: "linear-protocol.near" },
      ),
      row(
        "rnear-shares",
        "rNEAR · fictional",
        "rNEAR",
        "25",
        "staking",
        "near",
        "84.8",
        { venue: "lst.rhealab.near" },
      ),
      row(
        "near-wallet",
        "NEAR for gas · fictional",
        "NEAR",
        "42.1",
        "wallet",
        "near",
        "134.72",
      ),
      row(
        "arb-eth",
        "Protected ETH · fictional",
        "ETH",
        "0.62",
        "wallet",
        "arb",
        "2000",
      ),
    ],
  };
}
