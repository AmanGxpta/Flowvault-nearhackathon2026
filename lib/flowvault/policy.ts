import type { PayPreparation } from "./payments.ts";
import { creditRowSchema } from "./credit.ts";
import { z } from "zod";
import { units, decimal } from "./money.ts";
import { SUPPLY_RHEA as RHEA, SUPPLY_USDC as USDC } from "./supply.ts";
import type { WalletPreparation, WalletAttempt } from "./execution.ts";
const amount = z.string().refine((v) => {
  try {
    return units(v) >= 0n;
  } catch {
    return false;
  }
}, "Invalid policy USDC amount.");
export const assetPolicyRowSchema = z
  .object({
    asset: z.string().min(1).max(100),
    chain: z.enum(["near", "base", "arb", "bnb", "eth"]).optional(),
    sale: z.object({
      tokenId: z.string().min(1).max(150),
      decimals: z.number().int().min(0).max(36),
      maxQuantityRaw: z.string().regex(/^[1-9]\d{0,37}$/),
      maxValueUsdc: amount,
      maxSlippageBps: z.number().int().min(0).max(1000),
    }).strict().optional(),
    priority: z.enum(["P1", "P2", "P3"]),
    uses: z
      .array(
        z.enum([
          "hold",
          "sell",
          "supply",
          "pledge",
          "borrow",
          "stake",
          "pay",
          "fees",
        ]),
      )
      .max(8),
  })
  .strict();
export const VENUE_IDS = {
  rhea: RHEA,
  oneclick: "1click",
  native: "native",
  linear: "linear-protocol.near",
  rnear: "lst.rhealab.near",
} as const;
export const policySchema = z.object({
  assetRows: z
    .array(assetPolicyRowSchema)
    .max(50)
    .refine(
      (rows) =>
        new Set(
          rows.map((r) =>
            JSON.stringify([r.asset.toLowerCase(), r.chain ?? null]),
          ),
        ).size === rows.length,
      "Duplicate asset policy row.",
    )
    .optional(),
  version: z.number().int().positive(),
  providerFeeRecipients: z.array(z.string()).max(10).optional(),
  maxProviderFeeBps: z.number().int().min(0).max(100).optional(),
  creditRows: z.array(creditRowSchema).max(50).optional(),
  perActionCap: amount,
  dailyCap: amount,
  maxMoveCost: amount,
  maxGasNear: z.string().refine((v) => {
    try {
      return units(v, 24) >= 0n;
    } catch {
      return false;
    }
  }),
  protectedAssets: z.array(z.string().max(100)).max(50),
  venues: z.array(z.string().max(100)).max(30),
  recipients: z.array(z.string().max(100)).max(50),
  methods: z
    .array(z.object({ receiver: z.string(), method: z.string() }))
    .max(50),
});
export type Policy = z.infer<typeof policySchema>;
export interface PolicyAction {
  id?: string;
  chain?: "near" | "base" | "arb" | "bnb" | "eth" | "pol";
  kind: string;
  asset: string;
  amount: string;
  recipient: string;
  venue: string;
  movingCost: string | null;
  gasNear: string | null;
  source: "demo" | "live";
  accountId: string;
  methods: { receiver: string; method: string; nestedReceiver?: string }[];
}
export interface LedgerEntry {
  operationId: string;
  amount: string;
  source: "demo" | "live";
  accountId: string;
  createdAt: string;
  state: string;
}
export function defaultPolicy(maxMoveCost = "20"): Policy {
  return {
    version: 1,
    perActionCap: "10000",
    dailyCap: "50000",
    maxMoveCost,
    maxGasNear: "0.5",
    protectedAssets: [],
    venues: [RHEA],
    recipients: ["$owner"],
    methods: [
      { receiver: RHEA, method: "execute" },
      { receiver: RHEA, method: "storage_deposit" },
      { receiver: USDC, method: "ft_transfer_call" },
    ],
  };
}
export function evaluatePolicy(
  action: PolicyAction,
  policy: Policy,
  ledger: LedgerEntry[],
  now = Date.now(),
) {
  const violations: { code: string; message: string }[] = [];
  const fail = (code: string, message: string) =>
    violations.push({ code, message });
  if (
    ![
      "supply",
      "withdraw",
      "pay",
      "stake",
      "sell",
      "pledge",
      "borrow",
      "repay",
      "swap",
    ].includes(action.kind) ||
    !["live", "demo"].includes(action.source) ||
    !action.asset ||
    !action.accountId ||
    !Array.isArray(action.methods) ||
    action.methods.length === 0 ||
    action.methods.some((m) => !m?.receiver || !m?.method)
  ) {
    fail(
      "INVALID_ACTION",
      "Action kind, source, identity or methods are invalid.",
    );
    return {
      allowed: false,
      violations,
      dailyTotal: null,
      remainingDaily: null,
    };
  }
  let n = 0n,
    total = 0n;
  try {
    policySchema.parse(policy);
    n = units(action.amount);
    if (n <= 0n) throw Error();
  } catch {
    fail("INVALID_AMOUNT_OR_POLICY", "Policy or action amount is invalid.");
    return {
      allowed: false,
      violations,
      dailyTotal: null,
      remainingDaily: null,
    };
  }
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    for (const row of ledger) {
      if (
        row.accountId === action.accountId &&
        row.source === action.source &&
        !Number.isFinite(Date.parse(row.createdAt))
      )
        throw new Error("Invalid ledger timestamp");
      if (
        row.source === action.source &&
        row.accountId === action.accountId &&
        row.createdAt.slice(0, 10) === day &&
        row.operationId !== action.id &&
        row.state !== "cancelled-before-wallet"
      )
        total += units(row.amount);
    }
  } catch {
    fail("LEDGER_UNVERIFIED", "Daily running total is unavailable.");
  }
  const rows =
    policy.assetRows?.filter(
      (r) =>
        r.asset.toLowerCase() === action.asset.toLowerCase() &&
        (!r.chain || r.chain === action.chain),
    ) ?? [];
  const scoped =
    rows.find((r) => r.chain === action.chain) ?? rows.find((r) => !r.chain);
  if (policy.assetRows && !scoped)
    fail("ASSET_SCOPE_UNVERIFIED", "No matching asset/chain permission row.");
  // A swap sells its input asset, so it needs the same asset permission as a sale.
  const required =
    action.kind === "withdraw" || action.kind === "repay" ? "hold" : action.kind === "swap" ? "sell" : action.kind;
  if (scoped && !scoped.uses.includes(required as any))
    fail(
      "ASSET_USE_NOT_ALLOWED",
      `${action.asset} is not permitted for ${required}.`,
    );
  if (n > units(policy.perActionCap))
    fail("PER_ACTION_CAP", "Amount exceeds your per-action cap.");
  if (total + n > units(policy.dailyCap))
    fail("DAILY_CAP", "Amount exceeds your remaining daily cap.");
  if (
    action.kind !== "withdraw" &&
    policy.protectedAssets.some(
      (a) => a.toLowerCase() === action.asset.toLowerCase(),
    )
  )
    fail(
      "PROTECTED_ASSET",
      "This asset is protected from deployment or spending.",
    );
  if (!policy.venues.includes(action.venue))
    fail("VENUE_NOT_ALLOWED", "Venue is outside your allowlist.");
  if (
    !policy.recipients.some(
      (r) =>
        r === action.recipient ||
        (r === "$owner" && action.recipient === action.accountId),
    )
  )
    fail("RECIPIENT_NOT_ALLOWED", "Recipient is outside your allowlist.");
  if (action.movingCost === null)
    fail("COST_UNVERIFIED", "USDC moving cost is unverified.");
  else
    try {
      if (units(action.movingCost) > units(policy.maxMoveCost))
        fail("MOVING_COST_CAP", "USDC moving cost exceeds your limit.");
    } catch {
      fail("COST_UNVERIFIED", "USDC moving cost is unverified.");
    }
  if (action.gasNear === null)
    fail("GAS_UNVERIFIED", "NEAR fee budget is unverified.");
  else
    try {
      if (units(action.gasNear, 24) > units(policy.maxGasNear, 24))
        fail("GAS_CAP", "NEAR fee/storage budget exceeds your limit.");
    } catch {
      fail("GAS_UNVERIFIED", "NEAR fee budget is unverified.");
    }
  for (const m of action.methods) {
    if (
      !policy.methods.some(
        (a) => a.receiver === m.receiver && a.method === m.method,
      )
    )
      fail(
        "METHOD_NOT_ALLOWED",
        `Method ${m.method} on ${m.receiver} is outside your allowlist.`,
      );
    if (m.nestedReceiver && !policy.venues.includes(m.nestedReceiver))
      fail(
        "NESTED_RECEIVER_NOT_ALLOWED",
        "Token transfer targets an unapproved venue.",
      );
  }
  return {
    allowed: violations.length === 0,
    violations,
    dailyTotal: decimal(total),
    remainingDaily: decimal(
      units(policy.dailyCap) > total ? units(policy.dailyCap) - total : 0n,
    ),
  };
}
export function preparationAction(
  preparation: WalletPreparation,
  kind: string,
  id?: string,
): PolicyAction {
  if (kind === "pay") {
    const p = preparation as PayPreparation;
    return {
      id,
      kind,
      asset: "USDC",
      amount: p.amount,
      recipient: p.recipient.toLowerCase(),
      venue: "1click",
      movingCost: decimal(units(p.amount) - units(p.netAmount)),
      gasNear: "0.250000000000000000000001",
      source: "live",
      accountId: p.accountId,
      chain: "near",
      methods: [{ receiver: USDC, method: "ft_transfer" }],
    };
  }
  // Engines E2: lending preparations carry their own USDC-valued policy action.
  if ("policyAction" in preparation) return { ...preparation.policyAction, id };
  const txs = preparation.transactions;
  let attached = 0n;
  for (const tx of txs)
    for (const a of tx.actions) attached += BigInt(a.params.deposit);
  return {
    id,
    kind,
    asset: "USDC",
    amount: preparation.amount,
    recipient: preparation.accountId,
    venue: RHEA,
    movingCost: "0",
    gasNear: decimal(250000000000000000000000n + attached, 24),
    source: "live",
    accountId: preparation.accountId,
    chain: "near",
    methods: txs.flatMap((tx) =>
      tx.actions.map((a) => ({
        receiver: tx.receiverId,
        method: a.params.methodName,
        nestedReceiver:
          "receiver_id" in a.params.args
            ? String(a.params.args.receiver_id)
            : undefined,
      })),
    ),
  };
}
