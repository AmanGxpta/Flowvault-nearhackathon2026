// One fresh local cookie, no wallet/provider model call/quote signing or external account read.
import assert from "node:assert/strict";
const base = process.env.FLOWVAULT_TEST_URL || "http://127.0.0.1:5173";
let cookie = "";
async function call(
  path,
  body,
  expected = 200,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { origin: base, "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const json = await r.json();
  assert.equal(r.status, expected, JSON.stringify(json));
  return json;
}
const ex = "?workspace=example";
let personal = await call("/api/workspace");
personal = await call(
  "/api/workspace",
  {
    revision: personal.revision,
    mode: "live",
    accountId: "fixture-api-smoke.near",
    evmAddresses: { base: "0x" + "99".repeat(20) },
    watchedAccounts: [
      {
        id: "watch",
        chain: "near",
        address: "watch-fixture.near",
        label: "Unowned watch",
      },
    ],
  },
  200,
  "PUT",
);
const before = JSON.stringify(personal.workspace);
const rev = personal.revision;
const toggled = await call(
  "/api/workspace",
  { revision: personal.revision, mode: "demo" },
  200,
  "PUT",
);
assert.equal(toggled.workspace.exampleSeed, "design-v1");
assert.equal(toggled.workspaceSlot, "example");
let current = await call("/api/workspace");
assert.equal(JSON.stringify(current.workspace), before);
assert.equal(current.revision, rev);
const example = await call("/api/workspace" + ex);
assert.equal(example.workspace.mandate.reserve, "2000");
assert.equal(example.workspace.obligations.length, 4);
assert.equal((await call("/api/obligations" + ex)).holdback, "11550");
const portfolio = await call("/api/portfolio" + ex);
assert.equal(portfolio.source, "demo");
assert.equal(portfolio.usable.netWorth.amount, "25526.48");
assert.equal(portfolio.usable.cashNow.amount, "15190");
assert.ok(portfolio.positions.some((p) => p.ownership === "watched"));
const policyBefore = await call("/api/policy" + ex);
const risk = await call("/api/policy/test" + ex, {
  kind: "supply",
  asset: "USDC",
  chain: "near",
  amount: "2",
  recipient: "fictional-example",
  accountId: "fictional-example",
  source: "demo",
  venue: "contract.main.burrow.near",
  movingCost: "0",
  gasNear: "0.25",
  methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
  draftPolicy: { ...policyBefore.policy, perActionCap: "1" },
});
assert.equal(risk.evaluatedAgainst, "unsaved-draft");
assert.equal(risk.allowed, false);
assert.ok(risk.violations.some((v) => v.code === "PER_ACTION_CAP"));
assert.equal((await call("/api/policy" + ex)).revision, policyBefore.revision);
assert.equal(
  (await call("/api/strategies" + ex + "&amount=1000")).comparisonAmount,
  "1000",
);
for (const q of [
  "What if ETH falls 50%?",
  "Why was my 6,000 USDC supply blocked?",
  "Where should my surplus go?",
  "Can I pay 1000 USDT on BNB in 11 days?",
]) {
  const answer = await call("/api/assistant" + ex, {
    question: q,
    useModel: false,
  });
  assert.equal(answer.source, "demo");
  assert.equal(answer.signable, false);
  assert.equal(answer.dataSent.sent, false);
  if (q.startsWith("What"))
    assert.equal(answer.evaluation.stress.stressedValue, "1000");
  if (q.startsWith("Why"))
    assert.ok(answer.evaluation.reasons.includes("PER_ACTION_CAP"));
  if (q.startsWith("Can")) {
    assert.equal(answer.evaluation.allowed, true);
    assert.equal(answer.evaluation.executionSupported, false);
  }
}
assert.equal((await call("/api/market" + ex)).source, "demo");
assert.equal((await call("/api/credit/config" + ex)).source, "demo");
assert.equal((await call("/api/replays" + ex)).source, "simulated");
const st = await call("/api/staking/options" + ex);
assert.equal(st.source, "demo");
assert.equal(st.signable, false);
assert.equal(
  (await call("/api/staking/prepare" + ex, { kind: "linear", amount: "1" }))
    .signable,
  false,
);
await call(
  "/api/portfolio" + ex + "&mode=live&account=fixture.near",
  undefined,
  400,
);
await call("/api/prepare" + ex, { kind: "supply", amount: "1" }, 400);
await call(
  "/api/assistant" + ex,
  { question: "What if ETH falls 50%?", useModel: false, authorize: true },
  400,
);
const saved = await call(
  "/api/policy" + ex,
  {
    revision: policyBefore.revision,
    policy: { ...policyBefore.policy, maxMoveCost: "4" },
  },
  200,
  "PUT",
);
assert.equal(saved.workspace.policy.version, 5);
assert.ok(
  (await call("/api/policy" + ex)).history.some((h) => h.version === 5),
);
current = await call("/api/workspace");
assert.equal(JSON.stringify(current.workspace), before);
assert.equal(current.revision, rev);
assert.equal((await call("/api/transactions")).attempts.length, 0);
console.log(
  "PASS: isolated Judge/personal slots, exact fictional design totals, draft-only policy/history, custom ranking, four assistant questions with no model call, unsigned staking preview, no journal or live revision mutation.",
);
