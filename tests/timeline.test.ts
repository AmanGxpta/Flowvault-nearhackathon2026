import type { HasTimeline } from "../lib/flowvault/timeline.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendStep,
  outcomeFee,
  syncTimeline,
} from "../lib/flowvault/timeline.ts";
const attempt = (): HasTimeline => ({
  state: "prepared",
  message: "Prepared",
  hashes: [] as string[],
  createdAt: "2026-11-12T12:00Z",
  updatedAt: "2026-11-12T12:00Z",
});
test("Timeline persists chronological steps and deduplicates unchanged polls without claiming a signature", () => {
  const a = syncTimeline(attempt());
  assert(a.timeline!.some((x) => x.message.includes("Unsigned")));
  const n = a.timeline!.length;
  appendStep(a, "poll", "pending", "Waiting");
  appendStep(a, "poll", "pending", "Waiting");
  assert.equal(a.timeline!.length, n + 1);
  assert.equal(a.timeline!.at(-1)!.sequence, n + 1);
});
test("Final fees use bigint burned amounts and unknown data never becomes zero", () => {
  assert.equal(
    outcomeFee({
      final_execution_status: "FINAL",
      transaction_outcome: { outcome: { tokens_burnt: "9007199254740993" } },
      receipts_outcome: [{ outcome: { tokens_burnt: "2" } }],
    }).amount,
    "9007199254740995",
  );
  assert.equal(outcomeFee({ receipts_outcome: [] }).amount, null);
  assert.equal(
    outcomeFee({
      final_execution_status: "EXECUTED",
      transaction_outcome: { outcome: { tokens_burnt: "1" } },
      receipts_outcome: [],
    }).verified,
    false,
  );
});
test("Timeline keeps refund evidence and source-specific explorer proof", () => {
  const a = syncTimeline(attempt());
  appendStep(a, "refund", "failed", "Refunded", {
    refund: { amount: "10", unit: "USDC" },
    evidence: { phase: "REFUNDED" },
    explorerLinks: ["https://nearblocks.io/txns/test"],
  });
  assert.deepEqual(a.timeline!.at(-1)!.refund, { amount: "10", unit: "USDC" });
  assert.equal(a.timeline!.at(-1)!.evidence !== null, true);
});

test("fee/refund evidence changes persist even when the phase and message are unchanged", () => {
  const a: HasTimeline = {
    state: "processing",
    message: "",
    hashes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  appendStep(a, "provider", "refunded", "Refund reported", {
    refund: { reportedAmount: "1" },
  });
  appendStep(a, "provider", "refunded", "Refund reported", {
    refund: { reportedAmount: "2" },
  });
  assert.equal(a.timeline?.length, 2);
  appendStep(a, "provider", "refunded", "Refund reported", {
    refund: { reportedAmount: "2" },
    fees: [{ unit: "USDC", amount: "0.1", verified: false }],
  });
  assert.equal(a.timeline?.length, 3);
});
