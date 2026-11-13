import test from "node:test";
import assert from "node:assert/strict";
import { deriveFlow, nearText, type StakeFlow, type AttemptView } from "../lib/flowvault/stake-flow.ts";

const N = 10n ** 24n;
const flow = (source: StakeFlow["source"], extra: Partial<StakeFlow> = {}): StakeFlow => ({ id: "f1", accountId: "owner.near", venue: "linear", source, createdAt: "x", updatedAt: "x", cancelledAt: null, links: {}, ...extra });
const swapFlow = flow({ kind: "swap", from: "eth:0xa0b8", fromSymbol: "USDC", fromNetwork: "Ethereum", amount: "5", expectedNearRaw: (1427n * N / 1000n).toString() });
const att = (o: Partial<AttemptView>): AttemptView => ({ id: "a", state: "prepared", message: "", hashes: 0, ...o });

test("a new swap-funded flow starts at the payment, with the owner's turn", () => {
  const d = deriveFlow(swapFlow, {});
  assert.deepEqual(d.steps.map((s) => s.id), ["pay", "swap", "stake", "staked"]);
  assert.equal(d.status, "your_turn"); assert.equal(d.current, "pay"); assert.equal(d.done, 0);
  assert.match(d.steps[1].detail, /About 1.427 NEAR expected/);
});
test("a declined payment can be resumed; it never reads as sent", () => {
  const d = deriveFlow(swapFlow, { pay: att({ state: "failed", hashes: 0, message: "Not sent." }) });
  assert.equal(d.current, "pay"); assert.equal(d.status, "your_turn"); assert.match(d.steps[0].detail, /Not sent/);
});
test("while NEAR Intents delivers, the flow is in progress and nothing is the owner's turn", () => {
  const d = deriveFlow(swapFlow, { pay: att({ state: "submitted", hashes: 1, message: "Deposit seen; swapping." }) });
  assert.equal(d.status, "working"); assert.equal(d.current, "swap"); assert.equal(d.steps[0].state, "done");
});
test("staking uses the NEAR that actually arrived, not the quote", () => {
  const delivered = (1401n * N / 1000n).toString();
  const d = deriveFlow(swapFlow, { pay: att({ state: "confirmed", hashes: 1, deliveredRaw: delivered }) });
  assert.equal(d.stakeRaw, delivered); assert.equal(d.current, "stake"); assert.equal(d.status, "your_turn");
  assert.match(d.steps[2].title, /Stake 1.401 NEAR/);
});
test("a refund needs attention and stops before staking", () => {
  const d = deriveFlow(swapFlow, { pay: att({ state: "failed", hashes: 1, message: "Refunded to your Ethereum wallet.", refundedRaw: "5000000" }) });
  assert.equal(d.status, "attention"); assert.equal(d.stakeRaw, null); assert.equal(d.steps[2].state, "waiting");
});
test("NEAR-funded flows are two steps and finish when the stake is confirmed", () => {
  const f = flow({ kind: "near", amountRaw: N.toString() });
  assert.equal(deriveFlow(f, {}).current, "stake");
  const d = deriveFlow(f, { stake: att({ state: "confirmed", hashes: 1, stakedRaw: N.toString() }) });
  assert.equal(d.status, "done"); assert.equal(d.done, d.total);
});
test("cancelled flows say so; NEAR amounts format from base units", () => {
  assert.equal(deriveFlow({ ...swapFlow, cancelledAt: "x" }, {}).status, "cancelled");
  assert.equal(nearText((1427n * N / 1000n).toString()), "1.427");
  assert.equal(nearText(null), "—");
});
