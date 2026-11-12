import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, demoPortfolio, demoMarket } from "../lib/flowvault/seed.ts";
import { nextAction } from "../lib/flowvault/action.ts";
import { calendarRanking } from "../lib/flowvault/calendar.ts";
test("pitch plan action and calendar rank share lending buffer and end-of-day deadline; staking lead does not block instant lending", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const w = seed(now);
  const p = demoPortfolio(now),
    m = demoMarket(now);
  const ranking = calendarRanking(w.mandate, m, p, {}, now);
  assert.equal(ranking.chosen, "rhea-usdc");
  const action = nextAction(w.mandate, m, p, now);
  assert.equal(action.kind, "supply");
  if (action.kind === "supply") assert.equal(action.amount, ranking.surplus);
});

test("named pitch payment resolves Aman from the calendar and refuses a different named recipient", async () => {
  const { parseIntent, evaluateAssistant } = await import(
    "../lib/flowvault/assistant.ts"
  );
  const now = Date.parse("2026-11-12T12:00:00Z");
  const c = {
    workspace: seed(now),
    portfolio: demoPortfolio(now),
    market: demoMarket(now),
    ledger: [],
    creditCapacity: null,
  };
  const aman = parseIntent(
    "Pay Aman 1,000 USDT on BNB in 11 days without touching my ETH",
    now,
  );
  assert.equal(aman.amount, "1000");
  assert.equal(aman.recipientLabel, "Aman");
  assert.equal(evaluateAssistant(aman, c, now).evaluation.allowed, true);
  const bob = parseIntent("Pay Bob 1,000 USDT on BNB in 11 days", now);
  assert.equal(evaluateAssistant(bob, c, now).evaluation.allowed, false);
  assert.equal(
    evaluateAssistant(
      parseIntent("Can I pay 1000 USDT on BNB to Bob?", now),
      c,
      now,
    ).evaluation.allowed,
    false,
  );
});
