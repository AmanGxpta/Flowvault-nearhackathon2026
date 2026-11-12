import { payoutAsset, matchPayoutToken } from "./evm";
import {
  payoutValuation,
  movingCost,
  assertFreshValuation,
} from "./payout-valuation";
import {
  assertPaymentContext,
  assertDepositFunds,
  assertDepositBinding,
} from "./payment-guards";
export { assertPaymentContext } from "./payment-guards";
import { view, rpc, USDC, RHEA, dryCashQuote } from "./near";
import { paymentInventory } from "./payment-inventory";
export { paymentInventory } from "./payment-inventory";
import { freshWithdraw } from "./prepare";
import {
  paymentRequest,
  paymentCosts,
  nativePaymentAsset,
  verifyPaymentQuote,
  paymentSources,
  otherObligationHoldback,
  obligationIdentity,
  paymentPhase,
  paymentPolicyAction,
  assertStatusQuote,
  assertDepositStorage,
} from "./payments";
import type { PaymentPlan, PayPreparation } from "./payments";
import { units, decimal } from "./money";
import { EVM_CHAINS, destinationProof } from "./evm";
import { validAccount } from "./near";
import { QuoteUpstreamError } from "./quote-errors";
import { readAttempt, createAttempt, listActiveAttempts } from "./attempts";
import { checkPolicy, readLedger } from "./policy-store";
import { defaultPolicy, preparationAction, evaluatePolicy } from "./policy";
import { appendStep } from "./timeline";
import type { Workspace, Obligation } from "./types";
export async function createPaymentPlan(
  w: Workspace,
  id: string,
  key: string,
  obligationId: string,
  sessionId: string,
): Promise<PaymentPlan> {
  if (w.mode !== "live" || !w.accountId)
    throw new Error("Open your live source account before planning a payment.");
  const o = w.obligations.find((x) => x.id === obligationId);
  if (!o || o.status !== "pending")
    throw new Error("Choose an outstanding pending obligation.");
  const route = payoutAsset(o.destination, o.token);
  paymentRequest(w.accountId, o, nativePaymentAsset(o.destination, o.token));
  const inventory = await paymentInventory(w.accountId);
  const quote = await dryCashQuote(
    w.accountId,
    o.recipient,
    o.destination,
    units(o.amount, route.decimals).toString(),
    route.token,
  );
  const sources = paymentSources(
    inventory.wallet,
    inventory.rhea,
    otherObligationHoldback(w, o),
    quote.maxInput,
  );
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const ledger = await readLedger(sessionId);
  const action = {
    kind: "pay",
    asset: "USDC",
    amount: quote.maxInput,
    recipient: o.recipient.toLowerCase(),
    venue: "1click",
    movingCost: movingCost(quote.maxInput, quote.outputValueUsdc ?? o.amount),
    gasNear: "0.250000000000000000000001",
    source: "live" as const,
    accountId: w.accountId,
    methods: [{ receiver: USDC, method: "ft_transfer" }],
  };
  const paymentPolicy = evaluatePolicy(action, policy, ledger);
  const withdrawalPolicy =
    units(sources.withdrawalNeeded) > 0n
      ? evaluatePolicy(
          {
            ...action,
            kind: "withdraw",
            amount: sources.withdrawalNeeded,
            recipient: w.accountId,
            venue: RHEA,
            movingCost: "0",
            methods: [{ receiver: RHEA, method: "execute" }],
          },
          policy,
          ledger,
        )
      : { allowed: true, violations: [] };
  Object.assign(sources, {
    paymentPolicy,
    withdrawalPolicy,
    rheaUnknownReason: inventory.reason,
  });
  if (!paymentPolicy.allowed || !withdrawalPolicy.allowed)
    throw new Error(
      "Policy blocked: " +
        [...paymentPolicy.violations, ...withdrawalPolicy.violations]
          .map((x) => x.code + ": " + x.message)
          .join("; "),
    );
  if (!sources.covered)
    throw new Error(
      "Eligible cash and Rhea supply do not cover this payment while preserving other obligations.",
    );
  const now = new Date().toISOString();
  const p: PaymentPlan = {
    id,
    key,
    source: "live",
    accountId: w.accountId,
    obligationId: o.id,
    obligationSnapshot: structuredClone(o),
    obligationIdentity: obligationIdentity(o),
    mandateVersion: w.mandate.version,
    state:
      units(sources.withdrawalNeeded) > 0n ? "needs-withdrawal" : "planned",
    createdAt: now,
    updatedAt: now,
    message:
      "Payment planned, not signed or paid. Source figures use a dry quote and must be refreshed.",
    timeline: [],
    hashes: [],
    sources,
  };
  appendStep(p, "plan", p.state, p.message, { evidence: { dryQuote: quote } });
  return p;
}
export async function preparePaymentWithdrawal(
  sessionId: string,
  w: Workspace,
  p: PaymentPlan,
) {
  assertPaymentContext(p, w);
  if (p.withdrawAttemptId)
    return (await readAttempt(sessionId, p.withdrawAttemptId)).attempt;
  if (!["needs-withdrawal", "planned"].includes(p.state))
    throw new Error("Payment is not awaiting a source withdrawal.");
  if (units(p.sources.withdrawalNeeded) === 0n)
    throw new Error("No source withdrawal is needed.");
  const prep = await freshWithdraw(p.accountId, p.sources.withdrawalNeeded);
  await checkPolicy(
    sessionId,
    preparationAction(prep, "withdraw"),
    w.policy ?? defaultPolicy(w.mandate.maxMoveCost),
  );
  const a = await createAttempt(
    sessionId,
    p.mandateVersion,
    prep,
    "withdraw",
    p.id + ":withdraw",
  );
  p.withdrawAttemptId = a.id;
  p.state = "withdrawal-prepared";
  p.message =
    "Approve and verify the Rhea withdrawal through the normal wallet-attempt endpoint.";
  appendStep(p, "withdrawal", "prepared", p.message, {
    evidence: { attemptId: a.id },
  });
  return a;
}
export async function providerStatus(address: string) {
  if (!/^[a-f0-9]{64}$/.test(address))
    throw new Error("Invalid NEAR provider deposit address.");
  const r = await fetch(
    "https://1click.chaindefuser.com/v0/status?" +
      new URLSearchParams({ depositAddress: address }),
    { signal: AbortSignal.timeout(12000) },
  );
  if (r.status === 404) return null;
  const raw = await r.text();
  if (!r.ok)
    throw new QuoteUpstreamError(raw, r.status, {
      stage: "quote",
      destination: "base",
    });
  return JSON.parse(raw);
}
export async function executableQuote(
  sessionId: string,
  w: Workspace,
  p: PaymentPlan,
) {
  const o = assertPaymentContext(p, w);
  if (p.retainedSignedQuote) return p.retainedSignedQuote;
  if (
    p.withdrawAttemptId &&
    (await readAttempt(sessionId, p.withdrawAttemptId)).attempt.state !==
      "confirmed"
  )
    throw new Error(
      "Verify the Rhea withdrawal before requesting a payment quote.",
    );
  if (!["planned", "withdrawal-prepared", "needs-withdrawal"].includes(p.state))
    throw new Error("Payment is not ready for an executable quote.");
  const inventory = await paymentInventory(p.accountId);
  const tokensResponse = await fetch(
    "https://1click.chaindefuser.com/v0/tokens",
    { signal: AbortSignal.timeout(10000) },
  );
  if (!tokensResponse.ok)
    throw new Error("Supported payment assets unavailable.");
  const tokens = (await tokensResponse.json()) as any[];
  const chain = payoutAsset(o.destination, o.token).chain;
  const destination = matchPayoutToken(tokens, o.destination, o.token);
  const valuation =
    o.token === "USDT"
      ? payoutValuation(
          tokens.find((t) => t.assetId === "nep141:" + USDC),
          destination,
          o.amount,
        )
      : undefined;
  const req = paymentRequest(p.accountId, o, destination.assetId);
  const response = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new QuoteUpstreamError(raw, response.status, {
      stage: "quote",
      destination: chain,
    });
  const body = JSON.parse(raw);
  const checked = verifyPaymentQuote(
    req,
    body,
    w.policy?.providerFeeRecipients ?? [],
    w.policy?.maxProviderFeeBps ?? 25,
  );
  const sources = paymentSources(
    inventory.wallet,
    inventory.rhea,
    otherObligationHoldback(w, o),
    decimal(BigInt(checked.amountIn)),
  );
  if (units(sources.withdrawalNeeded) > 0n)
    throw new Error(
      "Fresh quote needs more wallet USDC. Replan the source withdrawal; nothing was sent.",
    );
  p.sources = sources;
  p.quoteRequest = req;
  p.retainedSignedQuote = body;
  p.valuation = valuation;
  p.outputValueUsdc = valuation?.outputValueUsdc ?? o.amount;
  p.costBreakdown = paymentCosts(body.quote, p.outputValueUsdc);
  p.refundDeadline = checked.refundDeadline;
  p.depositCutoff = checked.depositCutoff;
  p.state = "quoted";
  p.message =
    "Executable quote retained. No funds sent. Owner review and source deposit approval required.";
  appendStep(p, "quote", "quoted", p.message, {
    evidence: {
      signatureRetained: true,
      signatureVerified: false,
      request: req,
      depositAddress: checked.depositAddress,
      refundDeadline: p.refundDeadline,
      depositCutoff: p.depositCutoff,
    },
  });
  return body;
}
export function depositPreparation(p: PaymentPlan): PayPreparation {
  if (
    !p.retainedSignedQuote ||
    !p.quoteRequest ||
    !p.refundDeadline ||
    !p.depositCutoff
  )
    throw new Error(
      "Request a checked executable quote before preparing a deposit.",
    );
  if (Date.now() >= Date.parse(p.depositCutoff))
    throw new Error(
      "Payment deposit cutoff passed. Do not send funds; keep polling for refunds.",
    );
  if (p.obligationSnapshot.token === "USDT") assertFreshValuation(p.valuation);
  const q = p.retainedSignedQuote.quote;
  return {
    kind: "pay",
    paymentId: p.id,
    accountId: p.accountId,
    asset: "USDC",
    amount: decimal(BigInt(q.amountIn)),
    netAmount: p.obligationSnapshot.amount,
    recipient: p.obligationSnapshot.recipient,
    destination: payoutAsset(
      p.obligationSnapshot.destination,
      p.obligationSnapshot.token,
    ).chain,
    destinationToken: p.obligationSnapshot.token as "USDC" | "USDT",
    outputValueUsdc: p.outputValueUsdc,
    valuation: p.valuation,
    depositAddress: q.depositAddress,
    refundDeadline: p.refundDeadline,
    depositCutoff: p.depositCutoff,
    quoteRequest: p.quoteRequest,
    retainedSignedQuote: p.retainedSignedQuote,
    costBreakdown: paymentCosts(p.retainedSignedQuote.quote, p.outputValueUsdc),
    expiresAt: new Date(
      Math.min(
        Date.now() + 180000,
        Date.parse(p.depositCutoff),
        ...(p.valuation
          ? [
              Date.parse(p.valuation.originUpdatedAt) + 180000,
              Date.parse(p.valuation.destinationUpdatedAt) + 180000,
            ]
          : []),
      ),
    ).toISOString(),
    collateral: false,
    registrationNear: "0",
    transactions: [
      {
        receiverId: USDC,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "ft_transfer",
              args: {
                receiver_id: q.depositAddress,
                amount: q.amountIn,
                memo: "FlowVault payment " + p.id,
              },
              gas: "50000000000000",
              deposit: "1",
            },
          },
        ],
      },
    ],
    warning:
      "Owner-signed source deposit only. This is not paid until exact destination ERC-20 transfer proof is finalized.",
  };
}
export async function freshPaymentDeposit(
  prep: PayPreparation,
  w: Workspace,
  sessionId: string,
) {
  if (
    Date.now() >= Date.parse(prep.expiresAt) ||
    Date.now() >= Date.parse(prep.depositCutoff)
  )
    throw new Error("Payment deposit preparation expired.");
  const [wallet, native, metadata, status, depositStorage] = await Promise.all([
    view<string>(USDC, "ft_balance_of", { account_id: prep.accountId }),
    rpc({ request_type: "view_account", account_id: prep.accountId }),
    view<{ decimals: number }>(USDC, "ft_metadata"),
    providerStatus(prep.depositAddress),
    view<any>(USDC, "storage_balance_of", { account_id: prep.depositAddress }),
  ]);
  if (metadata.data.decimals !== 6)
    throw new Error("USDC precision does not match this adapter.");
  if (status?.status !== "PENDING_DEPOSIT")
    throw new Error(
      "Provider is not freshly awaiting a deposit. Do not pay again.",
    );
  assertStatusQuote(status, prep);
  assertDepositStorage(depositStorage.data);
  const { paymentGet } = await import("./payment-store");
  const { plan } = await paymentGet(sessionId, prep.paymentId);
  const obligation = assertPaymentContext(plan, w);
  assertDepositBinding(prep, depositPreparation(plan), w.mandate.maxMoveCost);
  const other = otherObligationHoldback(w, obligation);
  const attempts = await listActiveAttempts(sessionId);
  const committed = attempts
    .filter(
      (a) =>
        a.kind === "pay" &&
        a.accountId === prep.accountId &&
        a.id !== plan.depositAttemptId &&
        ["awaiting_wallet", "submitted", "unknown", "partial"].includes(
          a.state,
        ),
    )
    .reduce((n, a) => n + units(a.amount), 0n);
  assertDepositFunds(wallet.data, native, prep.amount, other + committed);
  return prep;
}
export async function prepareDepositAttempt(
  sessionId: string,
  w: Workspace,
  p: PaymentPlan,
) {
  assertPaymentContext(p, w);
  if (p.depositAttemptId)
    return (await readAttempt(sessionId, p.depositAttemptId)).attempt;
  const prep = depositPreparation(p);
  await freshPaymentDeposit(prep, w, sessionId);
  await checkPolicy(
    sessionId,
    paymentPolicyAction(prep),
    w.policy ?? defaultPolicy(w.mandate.maxMoveCost),
  );
  if (
    units(movingCost(prep.amount, prep.outputValueUsdc ?? prep.netAmount)) >
    units(w.mandate.maxMoveCost)
  )
    throw new Error("Payment moving cost exceeds the mandate limit.");
  const a = await createAttempt(
    sessionId,
    p.mandateVersion,
    prep,
    "pay",
    p.id + ":deposit",
  );
  p.depositAttemptId = a.id;
  p.state = "deposit-prepared";
  p.message =
    "Source deposit prepared. Use /api/transactions authorize, then the owner wallet.";
  appendStep(p, "deposit", "prepared", p.message, {
    evidence: { attemptId: a.id },
  });
  return a;
}
export async function pollPayment(sessionId: string, p: PaymentPlan) {
  if (!p.retainedSignedQuote || !p.refundDeadline)
    throw new Error("Payment has no executable quote to track.");
  const status = await providerStatus(
    p.retainedSignedQuote.quote.depositAddress,
  );
  assertStatusQuote(status, p);
  p.lastStatus = status;
  p.state = paymentPhase(status, p.refundDeadline);
  p.message =
    p.state === "destination-proof-required"
      ? "Provider reports SUCCESS. Exact destination proof is still required."
      : "Provider phase: " + p.state;
  appendStep(p, "provider", p.state, p.message, {
    refund: status?.swapDetails?.refundedAmount
      ? {
          reportedAmount: status.swapDetails.refundedAmount,
          refundFee: status.swapDetails.refundFee ?? null,
          reason: status.swapDetails.refundReason ?? null,
          sourceProofVerified: false,
        }
      : null,
    evidence: {
      status: status?.status ?? null,
      updatedAt: status?.updatedAt ?? null,
    },
  });
  return status;
}
