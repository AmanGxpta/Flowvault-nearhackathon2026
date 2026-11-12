import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIntent,
  proposalSchema,
  evaluateAssistant,
  validateModelIntent,
  questionDate,
} from "../lib/flowvault/assistant.ts";
import { assistantIntent } from "../lib/flowvault/assistant-provider.ts";
import {
  seed,
  demoPortfolio,
  demoMarket,
  personalSeed,
} from "../lib/flowvault/seed.ts";
const now = Date.parse("2026-11-12T12:00:00Z");
const context = () => ({
  workspace: seed(now),
  portfolio: demoPortfolio(now),
  market: demoMarket(now),
  ledger: [],
  creditCapacity: null,
});
test("deterministic parser covers exact pay chain/date/token without inventing recipients", () => {
  const p = parseIntent(
    "Can I pay 1,000 USDT on BNB by Nov 23 without touching my ETH?",
    now,
  );
  assert.equal(p.kind, "pay");
  assert.equal(p.amount, "1000");
  assert.equal(p.asset, "USDT");
  assert.equal(p.chain, "bnb");
  assert.equal(p.dueDate, "2026-11-23");
  assert.deepEqual(p.sources, ["wallet-usdc", "rhea-usdc"]);
  assert.equal(questionDate("next week", now), "2026-11-19");
  assert.equal(questionDate("tomorrow", now), "2026-11-13");
  assert.throws(() => questionDate("by 2026-02-31", now));
});
test("four supported questions are evaluated from engine figures only and never prepare an operation", () => {
  const c = context();
  const questions = [
    "Can I pay 1,000 USDT on BNB by Nov 23 without touching my ETH?",
    "Where should my surplus go?",
    "What if ETH falls 50%?",
    "Why was my 6,000 USDC supply blocked?",
  ];
  for (const q of questions) {
    const r = evaluateAssistant(parseIntent(q, now), c, now);
    assert.equal(r.readOnly, true);
    assert.equal(r.prepares, false);
    assert.equal(r.authorizes, false);
    assert.equal(r.signable, false);
    assert.equal(r.source, "demo");
    assert.ok(r.label.includes("FICTIONAL"));
    assert.ok(!("transactions" in r));
  }
  const stress = evaluateAssistant(parseIntent(questions[2], now), c, now);
  assert.equal(stress.evaluation.stress.valueBefore, "2000");
  assert.equal(stress.evaluation.stress.stressedValue, "1000");
  assert.equal(stress.evaluation.stress.loss, "1000");
  assert.equal(stress.evaluation.cashNow, "15190");
  const blocked = evaluateAssistant(parseIntent(questions[3], now), c, now);
  assert.ok(blocked.evaluation.reasons.includes("PER_ACTION_CAP"));
  assert.equal(blocked.evaluation.limits.perAction, "5000");
});
test("BNB/USDT planning declares route support without preparing or authorizing", () => {
  const c = context();
  const r = evaluateAssistant(
    parseIntent("Can I pay 1000 USDT on BNB by Nov 23?", now),
    c,
    now,
  );
  assert.equal(r.evaluation.allowed, true);
  assert.equal(r.evaluation.executionSupported, true);
  assert.equal(r.signable, false);
  assert.equal(r.prepares, false);
  const unknown = evaluateAssistant(
    parseIntent("Can I pay 999 USDC on Base tomorrow?", now),
    c,
    now,
  );
  assert.equal(unknown.evaluation.allowed, false);
  assert.ok(
    unknown.evaluation.reasons.includes("MATCHING_CALENDAR_RECIPIENT_REQUIRED"),
  );
});
test("protected/watched assets, stale snapshots and mixed sources cannot become payable funds", () => {
  const c = context();
  const p = parseIntent("Can I pay 1000 USDT on BNB next week?", now);
  p.sources.push("ETH");
  assert.ok(
    evaluateAssistant(p, c, now).evaluation.reasons.includes("PROTECTED_ASSET"),
  );
  c.portfolio.errors.push("RPC failed");
  assert.ok(
    evaluateAssistant(p, c, now).evaluation.reasons.includes(
      "CASH_COVERAGE_UNVERIFIED",
    ),
  );
  c.portfolio.source = "live";
  assert.throws(() => evaluateAssistant(p, c, now), /cannot be mixed/);
});
test("unknown live valuations stay unknown in the stress answer", () => {
  const c = context();
  c.workspace.mode = "live";
  c.workspace.mandate.source = "live";
  c.portfolio.source = "live";
  c.market.source = "live";
  c.portfolio.positions = c.portfolio.positions.map((x) => ({
    ...x,
    source: "live",
    valuation: null,
  }));
  const r = evaluateAssistant(
    parseIntent("What if ETH falls 50%?", now),
    c,
    now,
  );
  assert.equal(r.evaluation.stress.stressedValue, null);
  assert.match(r.answer, /no verified valuation/);
});
test("proposal schema rejects tool arguments, unknown kinds and changed explicit intent", () => {
  const p = parseIntent("Can I pay 1000 USDT on BNB tomorrow?", now);
  assert.throws(() => proposalSchema.parse({ ...p, transactions: [] }));
  assert.throws(() => proposalSchema.parse({ ...p, kind: "execute" }));
  assert.throws(
    () =>
      validateModelIntent(
        { ...p, amount: "1" },
        "Can I pay 1000 USDT on BNB tomorrow?",
        now,
      ),
    /changed explicit/,
  );
  assert.throws(
    () =>
      validateModelIntent(
        { ...p, chain: "base" },
        "Can I pay 1000 USDT on BNB tomorrow?",
        now,
      ),
    /changed explicit/,
  );
});
test("no-key fallback sends no data or network requests", async () => {
  let called = false;
  const r = await assistantIntent(
    "Where should my surplus go?",
    {},
    now,
    (async () => {
      called = true;
      throw Error();
    }) as typeof fetch,
  );
  assert.equal(called, false);
  assert.equal(r.dataSent.sent, false);
  assert.equal(r.provider.name, "deterministic");
});
test("NEAR AI request exposes exactly what was sent, excludes stored financial context and cannot execute model prose", async () => {
  let body: any;
  const q = "What if ETH falls 50%?";
  const r = await assistantIntent(
    q,
    { key: "TEST_SECRET_NOT_REAL" },
    now,
    (async (url: any, init: any) => {
      assert.equal(
        String(url),
        "https://cloud-api.near.ai/v1/chat/completions",
      );
      body = JSON.parse(init.body);
      assert.equal(init.headers.Authorization, "Bearer TEST_SECRET_NOT_REAL");
      assert.ok(!("tools" in body));
      return Response.json({
        id: "test",
        choices: [
          { message: { content: JSON.stringify(parseIntent(q, now)) } },
        ],
      });
    }) as typeof fetch,
  );
  assert.equal(r.provider.usedModel, true);
  assert.equal(r.dataSent.sent, true);
  assert.equal(body.messages[1].content, q);
  assert.ok(!JSON.stringify(r).includes("TEST_SECRET_NOT_REAL"));
  assert.equal(r.provider.attestationVerified, false);
  assert.ok(!JSON.stringify(body).includes("14240"));
});
test("unsafe, malformed and unavailable model results degrade to deterministic extraction without model prose", async () => {
  const q = "Can I pay 1000 USDT on BNB tomorrow?";
  for (const content of [
    '{"answer":"Send 999999 now"}',
    JSON.stringify({ ...parseIntent(q, now), amount: "1" }),
    "not-json",
  ]) {
    const r = await assistantIntent(q, { key: "TEST" }, now, (async () =>
      Response.json({ choices: [{ message: { content } }] })) as typeof fetch);
    assert.equal(r.provider.usedModel, false);
    assert.equal(r.proposal.amount, "1000");
    assert.ok(r.warning);
    assert.ok(!JSON.stringify(r).includes("999999"));
  }
  const r = await assistantIntent(
    q,
    { key: "TEST" },
    now,
    (async () => new Response("", { status: 429 })) as typeof fetch,
  );
  assert.equal(r.provider.name, "deterministic-fallback");
});

test("missing blocked-action context and native amount/currency mismatch are never filled by invented figures", () => {
  const c = context();
  const empty = evaluateAssistant(
    parseIntent("Why was this blocked?", now),
    c,
    now,
  );
  assert.ok(empty.evaluation.reasons.includes("MISSING_ACTION_CONTEXT"));
  assert.match(empty.answer, /Specify the amount/);
  const stake = evaluateAssistant(
    parseIntent("Why was my 1 NEAR stake blocked?", now),
    c,
    now,
  );
  assert.ok(stake.evaluation.reasons.includes("AMOUNT_VALUATION_UNVERIFIED"));
  assert.equal(stake.evaluation.allowed, false);
  const p = parseIntent("Can I pay 1000 USDT on BNB?", now);
  assert.throws(
    () =>
      validateModelIntent(
        { ...p, dueDate: "2027-01-01" },
        "Can I pay 1000 USDT on BNB?",
        now,
      ),
    /changed explicit/,
  );
});

test("financial text normalizes exact units, ambiguous recipients and unsupported funding sources stay blocked", () => {
  const c = context();
  c.workspace.obligations[1].amount = "1000.00";
  const p = parseIntent("Can I pay 1,000.00 USDT on BNB?", now);
  assert.equal(p.amount, "1000");
  assert.equal(evaluateAssistant(p, c, now).evaluation.allowed, true);
  c.workspace.obligations.push({
    ...c.workspace.obligations[1],
    id: "second-rent",
    recipient: "0x" + "88".repeat(20),
  });
  assert.ok(
    evaluateAssistant(p, c, now).evaluation.reasons.includes(
      "AMBIGUOUS_CALENDAR_RECIPIENT",
    ),
  );
  c.workspace.obligations.pop();
  c.workspace.policy!.protectedAssets = [];
  p.sources = ["ETH"];
  assert.ok(
    evaluateAssistant(p, c, now).evaluation.reasons.includes(
      "UNSUPPORTED_FUNDING_SOURCE",
    ),
  );
});
test("provider configuration cannot disclose embedded credentials", async () => {
  await assert.rejects(
    assistantIntent(
      "What if ETH falls 50%?",
      { key: "TEST", baseUrl: "https://user:secret@example.com/v1" },
      now,
    ),
    /must not contain/,
  );
  await assert.rejects(
    assistantIntent(
      "What if ETH falls 50%?",
      { key: "TEST", baseUrl: "http://example.com/v1" },
      now,
    ),
    /HTTPS/,
  );
});
