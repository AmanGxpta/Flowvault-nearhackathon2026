import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent, validateModelIntent } from "../lib/flowvault/assistant.ts";

const NOW = Date.parse("2026-11-12T10:00:00Z");

test("the five plan intents parse to their engine objectives", () => {
  const cases: [string, string][] = [
    ["Put my eligible surplus to work until my next payment", "allocate_surplus"],
    ["Pay Aman 1,000 USDT on BNB without touching my protected assets", "pay"],
    ["What can I borrow under my stress limits?", "borrow"],
    ["Repay this loan using available cash", "repay"],
    ["My payment moved forward, what needs to change?", "respond_to_change"],
  ];
  for (const [q, kind] of cases) assert.equal(parseIntent(q, NOW).kind, kind, q);
  const pay = parseIntent("Pay Aman 1,000 USDT on BNB without touching my protected assets", NOW);
  assert.deepEqual([pay.amount, pay.asset, pay.chain, pay.recipientLabel], ["1000", "USDT", "bnb", "Aman"]);
});

test("existing intents are unchanged by the new kinds", () => {
  assert.equal(parseIntent("Why was my 6000 USDC supply blocked?", NOW).kind, "explain_block");
  assert.equal(parseIntent("Why can't I borrow?", NOW).kind, "explain_block");
  assert.equal(parseIntent("What if ETH drops 50%?", NOW).kind, "stress");
  assert.equal(parseIntent("Can I pay 1,000 USDT on BNB by Nov 23 without touching my ETH?", NOW).dueDate, "2026-11-23");
});

test("a changed-payment question keeps the named payment; the model cannot change the kind", () => {
  assert.equal(parseIntent("My rent payment moved forward, what changes?", NOW).recipientLabel, "rent");
  assert.throws(() =>
    validateModelIntent({ ...parseIntent("What can I borrow under my stress limits?", NOW), kind: "pay" }, "What can I borrow under my stress limits?", NOW),
  /changed explicit question field: kind/);
});
