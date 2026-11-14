import { movingCost, assertFreshValuation } from "./payout-valuation.ts";
import type { PayoutValuation } from "./payout-valuation.ts";
// 1Click quote-echo, deadline and status checks for exact-output USDC payments.
// No third-party accounts, fee recipients, referral fields or signing configuration.
import { units, decimal, positive } from "./money.ts";
import { holdback } from "./obligations.ts";
import { SUPPLY_USDC as USDC } from "./supply.ts";
import { payoutAsset, validEvm } from "./evm.ts";
import type { Workspace, Obligation } from "./types.ts";
import type { PolicyAction, Policy } from "./policy.ts";
import type { ExecutionStep } from "./timeline.ts";
export const ECHO_FIELDS = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "depositMode",
] as const;
export interface PaymentQuoteRequest {
  dry: false;
  swapType: "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  destinationAsset: string;
  depositType: "ORIGIN_CHAIN";
  recipientType: "DESTINATION_CHAIN";
  refundType: "ORIGIN_CHAIN";
  depositMode: "SIMPLE";
  amount: string;
  recipient: string;
  refundTo: string;
  deadline: string;
  appFees: never[];
}
export function nativePaymentAsset(chain: string, token: string = "USDC") {
  return payoutAsset(chain, token).assetId;
}
export function paymentRequest(
  accountId: string,
  o: Obligation,
  destinationAsset: string,
  now = Date.now(),
): PaymentQuoteRequest {
  const route = payoutAsset(o.destination, o.token);
  if (!validEvm(o.recipient))
    throw new Error(
      "Enter the obligation recipient’s valid destination address.",
    );
  if (!/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(accountId))
    throw new Error("Enter a valid NEAR refund account.");
  if (destinationAsset !== nativePaymentAsset(o.destination, o.token))
    throw new Error(
      "Destination asset does not match the configured chain/token.",
    );
  const due = Date.parse(o.dueDate + "T23:59:59.999Z");
  if (!Number.isFinite(due) || due <= now)
    throw new Error("Payment deadline has passed.");
  const deadline = Math.min(due, now + 3600000);
  if (deadline - now < 360000)
    throw new Error("Payment deadline is too close for a safe deposit window.");
  return {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 50,
    originAsset: "nep141:" + USDC,
    destinationAsset,
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    refundType: "ORIGIN_CHAIN",
    depositMode: "SIMPLE",
    amount: positive(o.amount, route.decimals).toString(),
    recipient: o.recipient,
    refundTo: accountId,
    deadline: new Date(Math.floor(deadline / 1000) * 1000).toISOString(),
    appFees: [],
  };
}
export function verifyPaymentQuote(
  req: PaymentQuoteRequest,
  res: any,
  feeRecipients: string[] = [],
  maxFeeBps = 25,
  now = Date.now(),
) {
  const mismatches: string[] = [];
  const echo = res?.quoteRequest,
    q = res?.quote;
  if (!echo || !q)
    throw new Error("Unsafe payment quote: missing echoed request or quote.");
  for (const field of ECHO_FIELDS) {
    const a = echo[field],
      b = req[field];
    if (
      field === "recipient" &&
      typeof a === "string" &&
      a.toLowerCase() === String(b).toLowerCase()
    )
      continue;
    if (a !== b) mismatches.push(field);
  }
  if (
    !Number.isFinite(Date.parse(echo.deadline)) ||
    Math.abs(Date.parse(echo.deadline) - Date.parse(req.deadline)) > 1000
  )
    mismatches.push("deadline");
  for (const field of [
    "customRecipientMsg",
    "virtualChainRecipient",
    "virtualChainRefundRecipient",
    "referral",
  ])
    if (echo[field] != null) mismatches.push(field);
  if (q.customRecipientMsg != null || q.depositMemo != null)
    mismatches.push("message/memo");
  const fees = echo.appFees ?? [];
  if (
    !Array.isArray(fees) ||
    fees.some(
      (f: any) =>
        !Number.isInteger(f?.fee) ||
        f.fee < 0 ||
        (f.fee > 0 && !feeRecipients.includes(f.recipient)),
    ) ||
    fees.reduce((n: number, f: any) => n + f.fee, 0) > maxFeeBps
  )
    mismatches.push("unapproved provider appFees");
  if (
    typeof q.depositAddress !== "string" ||
    !/^[0-9a-f]{64}$/.test(q.depositAddress)
  )
    mismatches.push("depositAddress");
  for (const field of ["amountIn", "minAmountIn", "amountOut", "minAmountOut"])
    if (typeof q[field] !== "string" || !/^[1-9]\d*$/.test(q[field]))
      mismatches.push("quote." + field);
  if (
    !mismatches.length &&
    (q.amountOut !== req.amount ||
      q.minAmountOut !== req.amount ||
      BigInt(q.amountIn) < BigInt(q.minAmountIn))
  )
    mismatches.push("exact-output/funding bounds");
  if (typeof res.signature !== "string" || res.signature.length < 16)
    mismatches.push("signature");
  if (
    !Number.isFinite(Date.parse(res.timestamp)) ||
    Math.abs(now - Date.parse(res.timestamp)) > 180000
  )
    mismatches.push("timestamp");
  const deadlines = [req.deadline, q.deadline, q.timeWhenInactive]
    .filter(Boolean)
    .map((x) => Date.parse(x));
  if (deadlines.some((x) => !Number.isFinite(x)))
    mismatches.push("quote deadline");
  const refundDeadline = Math.min(...deadlines);
  if (refundDeadline - now <= 300000) mismatches.push("deposit cutoff");
  if (mismatches.length)
    throw new Error("Unsafe payment quote: " + mismatches.join(", "));
  return {
    depositAddress: q.depositAddress as string,
    amountIn: q.amountIn as string,
    minAmountIn: q.minAmountIn as string,
    refundDeadline: new Date(refundDeadline).toISOString(),
    depositCutoff: new Date(refundDeadline - 300000).toISOString(),
    signatureVerified: false as const,
  };
}
export function paymentPhase(
  status: any,
  refundDeadline: string,
  now = Date.now(),
) {
  const phases: Record<string, string> = {
    PENDING_DEPOSIT: "awaiting-deposit",
    KNOWN_DEPOSIT_TX: "deposit-detected",
    INCOMPLETE_DEPOSIT: "partial",
    PROCESSING: "processing",
    SUCCESS: "destination-proof-required",
    REFUNDED: "refunded",
    FAILED: "failed",
  };
  const phase = phases[status?.status] ?? "unknown";
  return now > Date.parse(refundDeadline) &&
    ["awaiting-deposit", "partial"].includes(phase)
    ? "deadline-passed"
    : phase;
}
export function otherObligationHoldback(
  w: Workspace,
  o: Obligation,
  now = Date.now(),
) {
  return holdback(
    { ...w.mandate, obligations: w.obligations.filter((x) => x.id !== o.id) },
    now,
  );
}
export function paymentSources(
  wallet: string,
  rhea: string | null,
  protectedAmount: bigint,
  funding: string,
) {
  const raw = units(wallet) - protectedAmount;
  const idle = raw > 0n ? raw : 0n;
  const amount = units(funding);
  const withdrawal = amount > idle ? amount - idle : 0n;
  return {
    idleAvailable: decimal(idle),
    funding,
    withdrawalNeeded: decimal(withdrawal),
    covered: withdrawal === 0n || (rhea !== null && withdrawal <= units(rhea)),
    priority: ["idle-wallet-usdc", "rhea-withdrawal"],
    plans: [
      {
        id: "idle-wallet-usdc",
        available: decimal(idle),
        eligible: idle >= amount,
      },
      {
        id: "cash-plus-rhea",
        withdrawal: decimal(withdrawal),
        eligible:
          withdrawal === 0n || (rhea !== null && withdrawal <= units(rhea)),
        coverage: rhea === null ? "unknown" : "observed",
        available: rhea,
      },
    ],
  };
}
export function obligationIdentity(o: Obligation) {
  return JSON.stringify([
    o.id,
    o.amount,
    o.recipient.toLowerCase(),
    o.destination,
    o.token,
    o.dueDate,
  ]);
}
export function paymentCosts(
  q: {
    amountIn: string;
    minAmountIn: string;
    amountOut: string;
  },
  outputValueUsdc?: string,
) {
  const max = BigInt(q.amountIn),
    min = BigInt(q.minAmountIn),
    net =
      outputValueUsdc === undefined
        ? BigInt(q.amountOut)
        : units(outputValueUsdc);
  if (min > max || net <= 0n)
    throw new Error("Invalid payment funding bounds.");
  return {
    maximumFunding: decimal(max),
    minimumInput: decimal(min),
    refundableBuffer: decimal(max - min),
    maximumInputMinusNet: movingCost(decimal(max), decimal(net)),
    actualUsdcFee: null,
    nearGasBudget: "0.250000000000000000000001",
    note: "Buffer is not a fee or a guaranteed refund. Actual fees/refunds require execution evidence; policy conservatively bounds maximum input minus exact payout.",
  };
}
export interface PayPreparation {
  costBreakdown?: ReturnType<typeof paymentCosts>;
  kind: "pay";
  paymentId: string;
  accountId: string;
  asset: string;
  amount: string;
  netAmount: string;
  recipient: string;
  destination: import("./evm").PayoutChain;
  destinationToken?: "USDC" | "USDT";
  outputValueUsdc?: string;
  valuation?: PayoutValuation;
  depositAddress: string;
  refundDeadline: string;
  depositCutoff: string;
  quoteRequest: PaymentQuoteRequest;
  retainedSignedQuote: any;
  expiresAt: string;
  collateral: boolean;
  registrationNear: string;
  transactions: {
    receiverId: string;
    actions: {
      type: string;
      params: {
        methodName: string;
        args: { receiver_id: string; amount: string; memo: string };
        gas: string;
        deposit: string;
      };
    }[];
  }[];
  warning: string;
}
export interface PaymentPlan {
  valuation?: PayoutValuation;
  outputValueUsdc?: string;
  id: string;
  key: string;
  source: "live";
  accountId: string;
  obligationId: string;
  obligationSnapshot: Obligation;
  obligationIdentity: string;
  mandateVersion: number;
  state: string;
  createdAt: string;
  updatedAt: string;
  message: string;
  timeline: ExecutionStep[];
  hashes: string[];
  sources: ReturnType<typeof paymentSources>;
  withdrawAttemptId?: string;
  depositAttemptId?: string;
  quoteRequest?: PaymentQuoteRequest;
  retainedSignedQuote?: any;
  costBreakdown?: ReturnType<typeof paymentCosts>;
  refundDeadline?: string;
  depositCutoff?: string;
  lastStatus?: any;
  destinationProof?: any;
}
export function paymentPolicyAction(
  p: PayPreparation,
  id?: string,
): PolicyAction {
  return {
    id,
    kind: "pay",
    asset: "USDC",
    amount: p.amount,
    recipient: p.recipient.toLowerCase(),
    venue: "1click",
    movingCost: movingCost(p.amount, p.outputValueUsdc ?? p.netAmount),
    gasNear: "0.250000000000000000000001",
    source: "live",
    accountId: p.accountId,
    chain: "near",
    methods: [{ receiver: USDC, method: "ft_transfer" }],
  };
}

/** Provider status must describe the retained deposit, never a different request. */
export function assertStatusQuote(
  status: any,
  p: Pick<PaymentPlan, "retainedSignedQuote" | "quoteRequest">,
) {
  if (!status) return;
  const q = status.quoteResponse;
  if (
    !q ||
    q.quote?.depositAddress !== p.retainedSignedQuote?.quote?.depositAddress ||
    q.signature !== p.retainedSignedQuote?.signature
  )
    throw new Error(
      "Provider status returned a different or missing retained quote.",
    );
  for (const field of [
    "depositAddress",
    "amountIn",
    "minAmountIn",
    "amountOut",
    "minAmountOut",
    "deadline",
    "timeWhenInactive",
  ])
    if (q.quote?.[field] !== p.retainedSignedQuote.quote?.[field])
      throw new Error("Provider status quote bounds changed: " + field);
  if (
    JSON.stringify(q.quoteRequest?.appFees ?? []) !==
    JSON.stringify(p.retainedSignedQuote.quoteRequest?.appFees ?? [])
  )
    throw new Error("Provider status fees changed.");
  for (const field of ECHO_FIELDS)
    if (
      field === "recipient"
        ? String(q.quoteRequest?.[field]).toLowerCase() !==
          String(p.quoteRequest?.[field]).toLowerCase()
        : q.quoteRequest?.[field] !== p.quoteRequest?.[field]
    )
      throw new Error("Provider status quote echo changed: " + field);
}

export function assertDepositStorage(storage: unknown) {
  if (
    !storage ||
    typeof (storage as any).total !== "string" ||
    !/^\d+$/.test((storage as any).total) ||
    BigInt((storage as any).total) <= 0n
  )
    throw new Error(
      "Provider deposit address is not registered for native USDC. Nothing was sent.",
    );
}
