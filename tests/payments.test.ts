import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paymentRequest,
  paymentCosts,
  nativePaymentAsset,
  verifyPaymentQuote,
  ECHO_FIELDS,
  paymentPhase,
  paymentSources,
  assertStatusQuote,
  otherObligationHoldback,
  obligationIdentity,
  assertDepositStorage,
} from "../lib/flowvault/payments.ts";
import {
  assertPaymentContext,
  assertDepositBinding,
  assertDepositFunds,
} from "../lib/flowvault/payment-guards.ts";
import {
  verifyDestinationReceipt,
  EVM_CHAINS,
  TRANSFER_TOPIC,
} from "../lib/flowvault/evm.ts";
import {
  verifyOutcome,
  summarizeOutcomes,
  assertSignable,
} from "../lib/flowvault/execution.ts";
import { keyedAttemptId } from "../lib/flowvault/preparation-key.ts";
import { SUPPLY_USDC as USDC } from "../lib/flowvault/supply.ts";
import type { PayPreparation } from "../lib/flowvault/payments.ts";
const now = Date.parse("2026-11-12T12:00:00Z");
const recipient = "0x" + "12".repeat(20),
  hash = "0x" + "ab".repeat(32);
const obligation = {
  id: "rent",
  label: "Rent",
  recipient,
  destination: "base" as const,
  token: "USDC" as const,
  amount: "10",
  dueDate: "2026-11-14",
  status: "pending" as const,
};
function fixture() {
  const request = paymentRequest(
    "owner.near",
    obligation,
    nativePaymentAsset("base"),
    now,
  );
  return {
    request,
    response: {
      timestamp: new Date(now).toISOString(),
      signature: "SIMULATED_SIGNATURE_NOT_VALID",
      quoteRequest: structuredClone(request),
      quote: {
        depositAddress: "1".repeat(64),
        amountIn: "10100000",
        minAmountIn: "10050000",
        amountOut: "10000000",
        minAmountOut: "10000000",
        deadline: request.deadline,
      },
    },
  };
}
test("non-dry exact-output request binds native amount, recipient and owner refund", () => {
  const { request, response } = fixture();
  assert.equal(request.swapType, "EXACT_OUTPUT");
  assert.equal(request.dry, false);
  assert.equal(request.amount, "10000000");
  assert.equal(request.refundTo, "owner.near");
  assert.deepEqual(request.appFees, []);
  const checked = verifyPaymentQuote(request, response, [], 25, now);
  assert.equal(checked.signatureVerified, false);
  assert.equal(checked.depositCutoff, "2026-11-12T12:55:00.000Z");
});
for (const field of ECHO_FIELDS)
  test("quote echo refuses changed " + field, () => {
    const { request, response } = fixture();
    (response.quoteRequest as any)[field] = "changed";
    assert.throws(
      () => verifyPaymentQuote(request, response, [], 25, now),
      /Unsafe payment quote/,
    );
  });
test("quote rejects unapproved fees, raised fees, messages and malformed bounds", () => {
  for (const mutate of [
    (r: any) =>
      (r.quoteRequest.appFees = [{ recipient: "unknown-provider", fee: 1 }]),
    (r: any) =>
      (r.quoteRequest.appFees = [{ recipient: "approved-provider", fee: 26 }]),
    (r: any) => (r.quote.depositMemo = "memo"),
    (r: any) => (r.quoteRequest.customRecipientMsg = "msg"),
    (r: any) => (r.quoteRequest.referral = "competitor"),
    (r: any) => (r.quote.amountOut = "9999999"),
    (r: any) => (r.quote.minAmountOut = "9999999"),
    (r: any) => (r.quote.minAmountIn = "20000000"),
    (r: any) => (r.quote.amountIn = "-1"),
    (r: any) => (r.quote.depositAddress = "bad"),
    (r: any) => (r.signature = ""),
    (r: any) => (r.timestamp = "2026-01-01"),
    (r: any) => (r.quote.deadline = "2026-11-12T12:03:00Z"),
    (r: any) => (r.quoteRequest.deadline = "2026-11-13T12:00:00Z"),
  ]) {
    const { request, response } = fixture();
    mutate(response);
    assert.throws(
      () =>
        verifyPaymentQuote(request, response, ["approved-provider"], 25, now),
      /Unsafe payment quote/,
    );
  }
});
test("explicit owner fee allowlist accepts provider fee without inheriting a recipient", () => {
  const { request, response } = fixture();
  (response.quoteRequest as any).appFees = [
    { recipient: "owner-approved-provider", fee: 25 },
  ];
  assert.doesNotThrow(() =>
    verifyPaymentQuote(request, response, ["owner-approved-provider"], 25, now),
  );
  assert.throws(() => verifyPaymentQuote(request, response, [], 25, now));
});
test("payment request refuses unsupported assets, invalid recipient, late/short deadline", () => {
  for (const o of [
    { ...obligation, token: "USDT" },
    { ...obligation, destination: "near" },
    { ...obligation, recipient: "owner.near" },
    { ...obligation, dueDate: "2026-11-11" },
  ])
    assert.throws(() =>
      paymentRequest("owner.near", o as any, nativePaymentAsset("base"), now),
    );
  assert.throws(
    () =>
      paymentRequest(
        "owner.near",
        obligation,
        nativePaymentAsset("base"),
        Date.parse("2026-11-14T23:57:00Z"),
      ),
    /too close/,
  );
});
test("provider SUCCESS requires destination proof; refund, partial, failed and deadline are distinct", () => {
  for (const [status, phase] of Object.entries({
    PENDING_DEPOSIT: "awaiting-deposit",
    KNOWN_DEPOSIT_TX: "deposit-detected",
    INCOMPLETE_DEPOSIT: "partial",
    PROCESSING: "processing",
    SUCCESS: "destination-proof-required",
    REFUNDED: "refunded",
    FAILED: "failed",
    OTHER: "unknown",
  }))
    assert.equal(paymentPhase({ status }, "2026-11-12T13:00:00Z", now), phase);
  assert.equal(
    paymentPhase({ status: "INCOMPLETE_DEPOSIT" }, "2026-11-12T11:00:00Z", now),
    "deadline-passed",
  );
  assert.equal(
    paymentPhase({ status: "PROCESSING" }, "2026-11-12T11:00:00Z", now),
    "processing",
  );
});
test("status must echo the retained signed quote and deposit", () => {
  const { request, response } = fixture();
  const p = { quoteRequest: request, retainedSignedQuote: response };
  assert.doesNotThrow(() => assertStatusQuote({ quoteResponse: response }, p));
  for (const mutate of [
    (r: any) => (r.signature = "other"),
    (r: any) => (r.quote.depositAddress = "2".repeat(64)),
    (r: any) => (r.quoteRequest.amount = "1"),
  ]) {
    const r = structuredClone(response);
    mutate(r);
    assert.throws(() => assertStatusQuote({ quoteResponse: r }, p));
  }
  assert.throws(() => assertStatusQuote({ status: "SUCCESS" }, p));
});
test("source selection protects other cash; unknown Rhea is not zero", () => {
  assert.equal(
    paymentSources("50", "100", 20_000000n, "60").withdrawalNeeded,
    "30",
  );
  assert.equal(paymentSources("10", null, 0n, "20").covered, false);
  assert.equal(paymentSources("30", null, 0n, "20").covered, true);
  assert.equal(paymentSources("0", "10", 0n, "20").covered, false);
});
test("payment horizon protection excludes only the target obligation", () => {
  const w: any = {
    mandate: { reserve: "5", cashAmount: "0", horizon: 30 },
    obligations: [obligation, { ...obligation, id: "other", amount: "7" }],
  };
  assert.equal(otherObligationHoldback(w, obligation, now), 12_000000n);
});
test("payment context refuses changed source, owner, plan, obligation, status or terminal plan", () => {
  const p: any = {
    state: "planned",
    accountId: "owner.near",
    obligationId: "rent",
    obligationIdentity: obligationIdentity(obligation),
    mandateVersion: 3,
  };
  const w: any = {
    mode: "live",
    accountId: "owner.near",
    mandate: { version: 3 },
    obligations: [obligation],
  };
  assert.equal(assertPaymentContext(p, w).id, "rent");
  for (const mutate of [
    (x: any) => (x.mode = "demo"),
    (x: any) => (x.accountId = "different.near"),
    (x: any) => x.mandate.version++,
    (x: any) => (x.obligations[0].amount = "11"),
    (x: any) => (x.obligations[0].status = "paid"),
    (x: any) => (x.obligations = []),
  ]) {
    const x = structuredClone(w);
    mutate(x);
    assert.throws(() => assertPaymentContext(p, x));
  }
  assert.throws(() => assertPaymentContext({ ...p, state: "cancelled" }, w));
});
function prep(): PayPreparation {
  const { request, response } = fixture();
  return {
    kind: "pay",
    paymentId: crypto.randomUUID(),
    accountId: "owner.near",
    amount: "10.1",
    netAmount: "10",
    asset: "USDC",
    recipient,
    destination: "base",
    depositAddress: response.quote.depositAddress,
    refundDeadline: request.deadline,
    depositCutoff: "2026-11-12T12:55:00Z",
    quoteRequest: request,
    retainedSignedQuote: response,
    expiresAt: request.deadline,
    collateral: false,
    registrationNear: "0",
    warning: "",
    transactions: [
      {
        receiverId: USDC,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "ft_transfer",
              args: {
                receiver_id: response.quote.depositAddress,
                amount: "10100000",
                memo: "FlowVault payment",
              },
              gas: "50000000000000",
              deposit: "1",
            },
          },
        ],
      },
    ],
  };
}
test("deposit binding and funds guard refuses changed payload, moving cost, protected cash and gas", () => {
  const p = prep();
  assert.doesNotThrow(() => assertDepositBinding(p, p, "1"));
  for (const mutate of [
    (x: any) => (x.amount = "10.2"),
    (x: any) => (x.recipient = "other"),
    (x: any) =>
      (x.transactions[0].actions[0].params.args.receiver_id = "other"),
    (x: any) => (x.retainedSignedQuote.signature = "changed"),
  ]) {
    const x = structuredClone(p);
    mutate(x);
    assert.throws(() => assertDepositBinding(x, p, "1"));
  }
  assert.throws(() => assertDepositBinding(p, p, "0.01"), /moving cost/);
  assert.doesNotThrow(() =>
    assertDepositFunds(
      "20000000",
      { amount: "1000000000000000000000000", storage_usage: 100 },
      "10.1",
      5_000000n,
    ),
  );
  assert.throws(
    () =>
      assertDepositFunds(
        "15000000",
        { amount: "1000000000000000000000000", storage_usage: 100 },
        "10.1",
        5_000000n,
      ),
    /preserving/,
  );
  assert.throws(
    () =>
      assertDepositFunds(
        "20000000",
        { amount: "250000000000000000000000", storage_usage: 0 },
        "10.1",
        0n,
      ),
    /NEAR/,
  );
  assert.throws(
    () =>
      assertDepositFunds(
        "20000000",
        { amount: "1000000000000000000000000", storage_usage: -1 },
        "10.1",
        0n,
      ),
    /unverified/,
  );
});
function outcome() {
  const p = prep();
  const a: any = {
    id: crypto.randomUUID(),
    kind: "pay",
    accountId: p.accountId,
    amount: p.amount,
    preparation: p,
    mandateVersion: 1,
    state: "prepared",
    expiresAt: p.expiresAt,
  };
  const action = p.transactions[0].actions[0].params;
  const r: any = {
    transaction: {
      signer_id: p.accountId,
      receiver_id: USDC,
      actions: [
        {
          FunctionCall: {
            method_name: action.methodName,
            args: btoa(JSON.stringify(action.args)),
            gas: action.gas,
            deposit: action.deposit,
          },
        },
      ],
    },
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    receipts_outcome: [
      {
        outcome: {
          executor_id: USDC,
          status: { SuccessValue: "" },
          logs: [
            "EVENT_JSON:" +
              JSON.stringify({
                standard: "nep141",
                version: "1.0.0",
                event: "ft_transfer",
                data: [
                  {
                    old_owner_id: p.accountId,
                    new_owner_id: p.depositAddress,
                    amount: "10100000",
                  },
                ],
              }),
          ],
        },
      },
    ],
  };
  return { a, r };
}
test("pay source deposit needs FINAL successful exact NEP141 transfer; never means paid", () => {
  const { a, r } = outcome();
  assert.equal(verifyOutcome(r, a).state, "confirmed");
  assert.match(
    summarizeOutcomes(a, [verifyOutcome(r, a)]).message,
    /destination payment remains unverified/,
  );
  for (const mutate of [
    (x: any) => (x.final_execution_status = "EXECUTED"),
    (x: any) => (x.receipts_outcome[0].outcome.status = {}),
    (x: any) => (x.receipts_outcome = []),
  ]) {
    const x = structuredClone(r);
    mutate(x);
    assert.equal(verifyOutcome(x, a).state, "pending");
  }
  for (const mutate of [
    (x: any) => (x.receipts_outcome[0].outcome.status = { Failure: {} }),
    (x: any) => (x.receipts_outcome[0].outcome.executor_id = "fake.near"),
    (x: any) => (x.receipts_outcome[0].outcome.logs = []),
    (x: any) => x.receipts_outcome.push(x.receipts_outcome[0]),
  ]) {
    const x = structuredClone(r);
    mutate(x);
    assert.equal(verifyOutcome(x, a).state, "failed");
  }
  const wrong = structuredClone(r);
  wrong.transaction.signer_id = "other.near";
  assert.throws(() => verifyOutcome(wrong, a), /signer/);
  assert.throws(
    () =>
      assertSignable(
        { ...a, state: "awaiting_wallet" },
        a.accountId,
        "live",
        1,
        now,
      ),
    /already reached/,
  );
});
function destination() {
  const block = {
    number: "0x100",
    hash: "0x" + "bc".repeat(32),
    timestamp: "0x" + BigInt(now / 1000).toString(16),
  };
  const receipt = {
    status: "0x1",
    transactionHash: hash,
    blockNumber: block.number,
    blockHash: block.hash,
    logs: [
      {
        address: EVM_CHAINS.base.usdc,
        transactionHash: hash,
        blockHash: block.hash,
        logIndex: "0x0",
        topics: [
          TRANSFER_TOPIC,
          "0x" + "00".repeat(32),
          "0x" + recipient.slice(2).padStart(64, "0"),
        ],
        data: "0x" + BigInt(10000000).toString(16).padStart(64, "0"),
      },
    ],
  };
  return { block, receipt };
}
test("destination proof needs finalized canonical exact native USDC transfer to recipient", () => {
  const { block, receipt } = destination();
  assert.equal(
    verifyDestinationReceipt(
      "base",
      receipt,
      block,
      block,
      recipient,
      "10000000",
      new Date(now).toISOString(),
    ).finalized,
    true,
  );
  for (const mutate of [
    (r: any) => (r.status = "0x0"),
    (r: any) => (r.blockHash = "wrong"),
    (r: any) => (r.logs[0].address = EVM_CHAINS.arb.usdc),
    (r: any) => (r.logs[0].data = "0x1"),
    (r: any) => (r.logs[0].topics[2] = "0x" + "00".repeat(32)),
    (r: any) => r.logs.push(r.logs[0]),
    (r: any) => (r.logs[0].removed = true),
    (r: any) => delete r.logs[0].logIndex,
  ]) {
    const r = structuredClone(receipt);
    mutate(r);
    assert.throws(() =>
      verifyDestinationReceipt(
        "base",
        r,
        block,
        block,
        recipient,
        "10000000",
        new Date(now).toISOString(),
      ),
    );
  }
  assert.throws(
    () =>
      verifyDestinationReceipt(
        "base",
        receipt,
        block,
        { number: "0xff" },
        recipient,
        "10000000",
        new Date(now).toISOString(),
      ),
    /finalized/,
  );
  assert.throws(
    () =>
      verifyDestinationReceipt(
        "base",
        receipt,
        block,
        block,
        recipient,
        "10000000",
        new Date(now + 2000).toISOString(),
      ),
    /predates/,
  );
});
test("withdrawal/deposit idempotency keys are distinct and session fenced", async () => {
  assert.notEqual(
    await keyedAttemptId("session", "payment:withdraw"),
    await keyedAttemptId("session", "payment:deposit"),
  );
  assert.notEqual(
    await keyedAttemptId("session", "payment:deposit"),
    await keyedAttemptId("other", "payment:deposit"),
  );
});

test("provider deposit token storage must be proven before owner handoff", () => {
  assert.doesNotThrow(() => assertDepositStorage({ total: "1" }));
  for (const x of [null, {}, { total: "0" }, { total: 1 }, { total: "bad" }])
    assert.throws(() => assertDepositStorage(x), /not registered/);
});

test("quote request pins native destination asset and refuses zero amount or invalid owner refund", () => {
  assert.throws(
    () => paymentRequest("owner.near", obligation, "unverified-asset", now),
    /destination asset/i,
  );
  assert.throws(
    () =>
      paymentRequest("INVALID!", obligation, nativePaymentAsset("base"), now),
    /refund account/,
  );
  assert.throws(
    () =>
      paymentRequest(
        "owner.near",
        { ...obligation, amount: "0" },
        nativePaymentAsset("base"),
        now,
      ),
    /greater than zero/,
  );
  assert.notEqual(nativePaymentAsset("base"), nativePaymentAsset("arb"));
});

test("destination proof normalizes RPC log indexes for unique transfer claims", () => {
  const { block, receipt } = destination();
  receipt.logs[0].logIndex = "0x00";
  assert.equal(
    verifyDestinationReceipt(
      "base",
      receipt,
      block,
      block,
      recipient,
      "10000000",
      new Date(now).toISOString(),
    ).logIndex,
    "0",
  );
});

test("funding buffer is separate from actual fees and the gas budget includes the attached yocto", () => {
  const { response } = fixture();
  const c = paymentCosts(response.quote);
  assert.equal(c.refundableBuffer, "0.05");
  assert.equal(c.maximumFunding, "10.1");
  assert.equal(c.maximumInputMinusNet, "0.1");
  assert.equal(c.actualUsdcFee, null);
  assert.equal(c.nearGasBudget, "0.250000000000000000000001");
  assert.throws(() =>
    paymentCosts({ amountIn: "1", minAmountIn: "2", amountOut: "1" }),
  );
});
