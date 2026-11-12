// Wallet-free API pitch: all economic values come from the isolated fictional example.
import assert from "node:assert/strict";
import { units, decimal } from "../lib/flowvault/money.ts";
const base = process.env.FLOWVAULT_BASE_URL ?? "http://127.0.0.1:5173";
let cookie = "";
async function api(path, body, { personal = false } = {}) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "X-FlowVault-Workspace": personal ? "personal" : "example",
      ...(body ? { Origin: base, "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
const initialPersonal = await api("/api/workspace", undefined, {
  personal: true,
});
const w = (await api("/api/workspace")).workspace;
assert.equal(w.exampleSeed, "design-v1");
assert.equal(w.fictional, true);
assert.equal(w.mandate.reserve, "2000");
const obligations = await api("/api/obligations");
const p = await api("/api/portfolio");
const owned = p.positions.filter((x) => x.ownership !== "watched");
const ownedValue = owned.reduce((n, x) => {
  assert.equal(x.valuation?.source, "demo");
  return n + units(x.valuation.amount);
}, 0n);
assert.equal(p.source, "demo");
assert.ok(p.positions.every((x) => x.fictional === true));
assert.equal(ownedValue, units("25526.48"));
assert.equal(p.usable.netWorth.amount, decimal(ownedValue));
const cash = owned
  .filter((x) => x.asset === "USDC" && x.kind === "wallet")
  .reduce((n, x) => n + units(x.amount), 0n);
assert.equal(p.usable.cashNow.amount, decimal(cash));
assert.equal(p.usable.cashNow.amount, "15190");
assert.equal(p.usable.committedCapital.amount, "8201.76");
assert.equal(p.usable.borrowingHeadroom.amount, "54.536533");
assert.equal(p.credit.fictional, true);
assert.equal(p.credit.borrowExecution, false);
assert.equal(p.usable.withdrawableByDate.length, 4);
assert.ok(p.usable.withdrawableByDate.every((d) => d.amount === "22690"));
assert.ok(
  p.positions.some((x) => x.ownership === "watched" && x.valuation === null),
);
const needed = w.obligations.reduce((n, o) => n + units(o.amount), 0n);
assert.equal(obligations.obligationsInHorizon, decimal(needed));
assert.equal(obligations.holdback, decimal(needed + units(w.mandate.reserve)));
assert.equal(obligations.holdback, "11550");
console.log(
  "PASS Observe: one plan, four dated obligations, five balances, watched holdings excluded; all fictional.",
);
const policy = await api("/api/policy");
const action = {
  kind: "supply",
  asset: "USDC",
  chain: "near",
  amount: "6000",
  recipient: "fictional-example",
  accountId: "fictional-example",
  source: "demo",
  venue: "contract.main.burrow.near",
  movingCost: "0",
  gasNear: "0.25",
  methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
};
const risky = await api("/api/policy/test", action);
assert.equal(risky.allowed, false);
assert.ok(risky.violations.some((x) => x.code === "PER_ACTION_CAP"));
assert.equal(risky.dailyTotal, "1250");
assert.equal(risky.remainingDaily, "6750");
assert.equal((await api("/api/policy")).revision, policy.revision);
console.log(
  "PASS Configure: risky action refused by the saved policy, without a write or wallet.",
);
const plan = await api("/api/plan");
const ranking = await api("/api/strategies");
const nearCash = owned
  .filter(
    (x) => x.asset === "USDC" && x.kind === "wallet" && x.chain === "near",
  )
  .reduce((n, x) => n + units(x.amount), 0n);
assert.equal(plan.calendar.holdback, obligations.holdback);
assert.equal(
  plan.calendar.surplus,
  decimal(nearCash - units(obligations.holdback)),
);
assert.equal(ranking.surplus, plan.calendar.surplus);
assert.equal(ranking.chosen, plan.calendar.chosen);
assert.equal(ranking.surplus, "2690");
assert.equal(ranking.chosen, "rhea-usdc");
assert.ok(
  ranking.strategies
    .find((x) => x.id === "usdc-vault")
    .reasons.includes("EXIT_MISSES_DUE_DATE"),
);
assert.equal(
  plan.action.kind,
  "supply",
  "Plan action and eligible liquid Rhea ranking must agree in the fictional story.",
);
assert.equal(plan.action.amount, ranking.surplus);
console.log(
  "PASS Decide: Plan to action agrees with net-to-date ranking; the higher-rate vault misses the exit window.",
);
const config = await api("/api/credit/config");
for (const assetId of ["linear-protocol.near", "lst.rhealab.near"]) {
  const asset = config.assets.find((a) => a.assetId === assetId);
  assert.equal(asset.config.can_use_as_collateral, true);
  assert.equal(asset.config.can_borrow, true);
}
const illustrative = await api("/api/credit", {
  markets: [
    {
      id: "example-rhea-lst",
      source: "demo",
      capturedAt: new Date().toISOString(),
      existingDebt: "0",
      protocolLimit: "50000",
      liquidity: "50000",
      assets: policy.policy.creditRows,
    },
  ],
});
assert.equal(illustrative.capacity, p.credit.capacity);
assert.equal(illustrative.capacityDisplay, "54.54");
assert.ok(
  policy.policy.assetRows
    .filter((a) => ["LiNEAR", "rNEAR"].includes(a.asset))
    .every((a) => a.uses.includes("borrow")),
);
console.log(
  "PASS Credit story: supported Rhea LSTs, explicit illustrative 54.54 headroom, reserve USDC and ETH unpledged.",
);
const credit = await api("/api/credit", {
  markets: [
    {
      id: "pitch-example",
      source: "demo",
      capturedAt: new Date().toISOString(),
      existingDebt: "0",
      protocolLimit: "2000",
      liquidity: "2000",
      assets: [
        {
          assetId: "EXAMPLE_TOKEN",
          collateralId: "fictional-position",
          value: "2000",
          drawdownBps: 9000,
          ltvCapBps: 7000,
          liquidationThresholdBps: 8000,
          protocolLtvBps: 7000,
          minHealth: "1.5",
          priority: "P1",
          permissions: ["pledge", "borrow"],
          eligible: true,
        },
      ],
    },
  ],
});
assert.equal(credit.capacity, "106.666666");
assert.equal(credit.capacityDisplay, "106.67");
assert.equal(credit.markets[0].rows[0].stressedValue, "200");
assert.equal(credit.markets[0].rows[0].policyCeiling, "140");
assert.equal(credit.borrowExecution, false);
console.log(
  "PASS Credit: PRD stress example is exactly 200 stressed, 140 policy, 106.666666 base-unit capacity / 106.67 display.",
);
const payment = await api("/api/assistant", {
  question: "Pay Aman 1,000 USDT on BNB in 11 days without touching my ETH",
  useModel: false,
});
assert.equal(payment.evaluation.allowed, true);
assert.equal(payment.evaluation.executionSupported, true);
assert.equal(payment.evaluation.reserve, w.mandate.reserve);
assert.deepEqual(payment.evaluation.sources.priority, [
  "idle-wallet-usdc",
  "rhea-withdrawal",
]);
assert.equal(payment.evaluation.sources.withdrawalNeeded, "0");
assert.equal(payment.figures.usable.cashNow.amount, p.usable.cashNow.amount);
assert.equal(payment.figures.ranking.holdback, obligations.holdback);
assert.equal(payment.proposal.asset, "USDT");
assert.equal(payment.proposal.chain, "bnb");
assert.equal(payment.signable, false);
assert.equal(payment.dataSent.sent, false);
const quote = await api("/api/quote", {
  amount: "1000",
  days: 11,
  destination: "bnb",
  token: "USDT",
});
assert.equal(quote.quote.amountOut, payment.evaluation.amount);
assert.equal(quote.quote.maxInput, payment.evaluation.quote.maxInput);
assert.equal(quote.quote.buffer, payment.evaluation.quote.buffer);
assert.equal(
  quote.comparison.cashAvailable,
  payment.evaluation.sources.idleAvailable,
);
const structured = await api("/api/payments/compare", {
  obligationId: "rent-aman",
});
assert.equal(structured.comparison.obligationId, "rent-aman");
assert.deepEqual(structured.comparison.sources, payment.evaluation.sources);
assert.equal(structured.comparison.quote.maxInput, quote.quote.maxInput);
assert.equal(structured.comparison.signable, false);
console.log(
  "PASS Pay: identical exact-net fictional source comparison across quote and assistant; protected ETH unused, BNB route supported without example execution.",
);
const outcomes = [
  "success",
  "refunded",
  "partial",
  "failed",
  "deadline-passed",
];
const replays = await api("/api/replays");
assert.equal(replays.source, "simulated");
assert.equal(replays.replays.length, 15);
for (const kind of ["supply", "withdraw", "pay"])
  for (const outcome of outcomes) {
    const r = replays.replays.find(
      (x) => x.kind === kind && x.outcome === outcome,
    );
    assert.ok(r, kind + ":" + outcome);
    assert.equal(r.simulation, true);
    assert.equal(r.signable, false);
    assert.ok(r.label.includes("SIMULATED"));
    assert.ok(r.id.startsWith("simulated:"));
    assert.ok(!("preparation" in r));
  }
console.log(
  "PASS Replays: all fifteen outcomes remain SIMULATED and disconnected from live records.",
);
const answer = await api("/api/assistant", {
  question: "can I pay 1,000 USDT on BNB by Nov 23 without touching my ETH",
  useModel: false,
});
assert.equal(answer.evaluation.allowed, true);
assert.equal(
  answer.evaluation.quote.maxInput,
  payment.evaluation.quote.maxInput,
);
assert.equal(answer.evaluation.sources.withdrawalNeeded, "0");
assert.equal(answer.evaluation.executionSupported, true);
assert.equal(answer.figures.usable.netWorth.amount, p.usable.netWorth.amount);
assert.equal(answer.prepares, false);
assert.equal(answer.authorizes, false);
assert.equal(answer.dataSent.sent, false);
assert.equal((await api("/api/transactions")).attempts.length, 0);
assert.equal((await api("/api/payments")).payments.length, 0);
assert.deepEqual(
  await api("/api/workspace", undefined, { personal: true }),
  initialPersonal,
);
console.log(
  "PASS Ask FlowVault: exact judge prompt answered only with engine figures; personal workspace and journals untouched.",
);
const modified = await api("/api/obligations", {
  revision: (await api("/api/workspace")).revision,
  obligation: {
    id: "reset-probe",
    label: "Fictional reset check",
    recipient: "",
    destination: "base",
    token: "USDC",
    amount: "1",
    dueDate: w.obligations[0].dueDate,
  },
});
assert.equal(modified.workspace.obligations.length, 5);
const reset = await api("/api/workspace", {
  reset: true,
  revision: modified.revision,
});
assert.equal(reset.workspace.obligations.length, 4);
for (const [personal, revision, expected] of [
  [false, modified.revision, "Workspace changed"],
  [true, initialPersonal.revision, "Only the example workspace"],
]) {
  const response = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
      "X-FlowVault-Workspace": personal ? "personal" : "example",
    },
    body: JSON.stringify({ reset: true, revision }),
  });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error.includes(expected));
}

assert.equal(reset.workspace.mandate.reserve, "2000");
assert.ok(reset.workspace.mandate.version > modified.workspace.mandate.version);
assert.deepEqual(
  await api("/api/workspace", undefined, { personal: true }),
  initialPersonal,
);
console.log(
  "PASS Example reset: revision checked, four seeded obligations restored, personal workspace untouched.",
);
console.log(
  "PITCH STORY PASSED — no wallet, model credits, signatures, funds, non-dry quotes or deployments.",
);
