// Isolated local session only. No wallet, provider quote creation, signing, spending or deployment.
import assert from "node:assert/strict";
const base = process.env.FLOWVAULT_TEST_URL || "http://127.0.0.1:5173";
let cookie = "";
async function request(path, method = "GET", body, expected = 200) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "X-FlowVault-Workspace": "example",
      ...(cookie ? { cookie } : {}),
      ...(method === "GET"
        ? {}
        : { origin: base, "content-type": "application/json" }),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
let state = await request("/api/workspace");
assert.ok(Array.isArray(state.workspace.obligations));
const initial = (await request("/api/obligations")).holdback;
const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
state = await request("/api/obligations", "POST", {
  revision: state.revision,
  obligation: {
    id: "mechanics-smoke",
    label: "Isolated test obligation",
    recipient: "0x" + "12".repeat(20),
    destination: "base",
    token: "USDC",
    amount: "50",
    dueDate: due,
    status: "pending",
  },
});
const protectedCash = await request("/api/obligations");
assert.equal(Number(protectedCash.holdback), Number(initial) + 50);
await request(
  "/api/obligations",
  "DELETE",
  { revision: state.revision - 1, obligation: { id: "mechanics-smoke" } },
  400,
);
state = await request("/api/obligations", "PUT", {
  revision: state.revision,
  obligation: {
    id: "mechanics-smoke",
    label: "Changed test obligation",
    recipient: "0x" + "12".repeat(20),
    destination: "base",
    token: "USDC",
    amount: "60",
    dueDate: due,
    status: "pending",
  },
});
assert.equal(
  state.workspace.obligations.find((o) => o.id === "mechanics-smoke").amount,
  "60",
);
const before = await request("/api/policy");
const risk = await request("/api/policy/test", "POST", {
  kind: "supply",
  asset: "USDC",
  amount: "999999",
  recipient: "owner.near",
  accountId: "owner.near",
  venue: "contract.main.burrow.near",
  source: "demo",
  movingCost: "0",
  gasNear: "0.25",
  methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
});
assert.equal(risk.allowed, false);
assert.ok(risk.violations.some((v) => v.code === "PER_ACTION_CAP"));
assert.deepEqual((await request("/api/policy")).ledger, before.ledger);
const market = {
  id: "example",
  source: "demo",
  capturedAt: new Date().toISOString(),
  existingDebt: "0",
  protocolLimit: "2000",
  liquidity: "2000",
  assets: [
    {
      assetId: "TOKEN",
      collateralId: "position",
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
};
assert.equal(
  (await request("/api/credit", "POST", { markets: [market] })).capacityDisplay,
  "106.67",
);
for (const path of [
  "/api/plan",
  "/api/strategies",
  "/api/timeline",
  "/api/payments",
])
  await request(path);
assert.equal((await request("/api/replays")).replays.length, 15);
assert.equal(
  (await request("/api/replays?kind=pay&outcome=refunded")).replays.length,
  1,
);
await request("/api/replays?kind=borrow", "GET", undefined, 400);
await request(
  "/api/transactions",
  "POST",
  { id: "simulated:pay:success", action: "authorize" },
  400,
);
await request(
  "/api/payments",
  "POST",
  { key: crypto.randomUUID(), obligationId: "mechanics-smoke" },
  400,
);
state = await request("/api/obligations", "DELETE", {
  revision: state.revision,
  obligation: { id: "mechanics-smoke" },
});
assert.equal(
  state.workspace.obligations.some((o) => o.id === "mechanics-smoke"),
  false,
);
console.log(
  "PASS: obligations/revisions/holdback, read-only policy caps, exact credit example, plans, timeline, simulated/live isolation, demo-payment refusal. No wallet or live execution.",
);
