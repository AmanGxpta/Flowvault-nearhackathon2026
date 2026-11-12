import assert from "node:assert/strict";
const base = process.env.FLOWVAULT_BASE_URL ?? "http://127.0.0.1:5173";
function client() {
  let cookie = "";
  return async (path, body, method = "POST", origin = base) => {
    const response = await fetch(base + path, {
      method: body ? method : "GET",
      headers: {
        "X-FlowVault-Workspace": "example",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { "Content-Type": "application/json", Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const c = response.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
    return { status: response.status, body: data };
  };
}
const a = client(),
  b = client();
const first = await a("/api/workspace");
assert.equal(first.status, 200);
assert.equal(first.body.workspace.mode, "demo");
let current = first.body;
const second = await b("/api/workspace");
assert.equal(second.body.revision, 0);
const result = await a("/api/quote", {
  amount: "5000",
  days: 30,
  destination: "arb",
});
assert.equal(result.status, 200);
assert.equal(result.body.comparison.amountOut, "5000");
assert.equal(result.body.comparison.executable, false);
assert.equal(result.body.quote.source, "demo");
const invalid = await a("/api/quote", {
  amount: "1e9",
  days: 30,
  destination: "arb",
});
assert.equal(invalid.status, 400);
const key = crypto.randomUUID();
const details = {
  quote: result.body.quote,
  comparison: result.body.comparison,
};
let record = await a("/api/operations", {
  revision: current.revision,
  key,
  kind: "cash-request",
  details,
});
assert.equal(record.status, 200);
current = record.body;
const op = current.workspace.operations[0];
assert.equal(op.state, "draft");
assert.match(op.payloadHash, /^[a-f0-9]{64}$/);
const repeated = await a("/api/operations", {
  revision: first.body.revision,
  key,
  kind: "cash-request",
  details,
});
assert.equal(repeated.status, 200);
assert.equal(repeated.body.workspace.operations.length, 1);
const conflict = await a("/api/operations", {
  revision: current.revision,
  key,
  kind: "cash-request",
  details: { different: true },
});
assert.equal(conflict.status, 400);
const forbidden = await a(
  "/api/workspace",
  { revision: current.revision, mandate: current.workspace.mandate },
  "PUT",
  "https://other.example",
);
assert([400, 403].includes(forbidden.status));
const stale = await a(
  "/api/workspace",
  { revision: 0, mandate: current.workspace.mandate },
  "PUT",
);
assert.equal(stale.status, 400);
const badDate = await a(
  "/api/workspace",
  {
    revision: current.revision,
    mandate: { ...current.workspace.mandate, cashDate: "2026-02-31" },
  },
  "PUT",
);
assert.equal(badDate.status, 400);
const updated = await a(
  "/api/workspace",
  {
    revision: current.revision,
    mandate: { ...current.workspace.mandate, reserve: "11000" },
  },
  "PUT",
);
assert.equal(updated.status, 200);
current = updated.body;
assert.equal(current.workspace.operations[0].state, "superseded");
const staleReview = await a("/api/operations", {
  revision: current.revision,
  action: "transition",
  id: op.id,
  state: "reviewed",
});
assert.equal(staleReview.status, 400);
const other = await b("/api/workspace");
assert.equal(other.body.workspace.operations.length, 0);
assert.equal(other.body.workspace.mandate.reserve, "2000");
const reload = await a("/api/workspace");
assert.equal(reload.body.workspace.mandate.reserve, "11000");
assert.equal(reload.body.workspace.operations.length, 1);
const expired = await a("/api/operations", {
  revision: current.revision,
  key: crypto.randomUUID(),
  kind: "cash-request",
  details: {
    comparison: {
      ...result.body.comparison,
      validUntil: "2020-01-01T00:00:00.000Z",
    },
  },
});
assert.equal(expired.status, 400);
const arbitrary = await a("/api/operations", {
  revision: current.revision,
  action: "transition",
  id: op.id,
  state: "finalized",
});
assert.equal(arbitrary.status, 400);
const supply = await a("/api/prepare", { amount: "100" });
assert.equal(supply.status, 400);
assert.match(supply.body.error, /prepare a live supply/);
console.log(
  "PASS: example comparison, malformed input, durable journal, payload idempotency/conflicts, stale-revision/mandate fencing, invalid date, origin check, session isolation, reload persistence, forbidden finalization and demo supply refusal.",
);
const market = await a("/api/market?workspace=personal");
if (market.status === 200) {
  assert.equal(market.body.source, "live");
  assert.equal(typeof market.body.blockHeight, "number");
  assert(market.body.markets.some((x) => x.id === "rhea-usdc"));
  console.log(
    "PASS: live finalized Rhea market read at block",
    market.body.blockHeight,
  );
} else {
  console.log("LIVE DATA UNAVAILABLE:", market.body.error);
  process.exitCode = 1;
}

const raceClient = client();
const raceStart = await raceClient("/api/workspace");
const race = await Promise.all([
  raceClient(
    "/api/workspace",
    {
      revision: raceStart.body.revision,
      mandate: { ...raceStart.body.workspace.mandate, reserve: "500" },
    },
    "PUT",
  ),
  raceClient(
    "/api/workspace",
    {
      revision: raceStart.body.revision,
      mandate: { ...raceStart.body.workspace.mandate, reserve: "600" },
    },
    "PUT",
  ),
]);
assert.deepEqual(race.map((x) => x.status).sort(), [200, 400]);
console.log(
  "PASS: simultaneous workspace writes cannot silently overwrite each other.",
);

const transactions = await a("/api/transactions");
assert.equal(transactions.status, 200);
assert.deepEqual(transactions.body.attempts, []);
const missing = await a("/api/transactions", {
  id: crypto.randomUUID(),
  action: "authorize",
});
assert.equal(missing.status, 400);
assert.match(missing.body.error, /not found/);
const txOrigin = await a(
  "/api/transactions",
  { id: crypto.randomUUID(), action: "attach", hashes: [] },
  "POST",
  "https://other.example",
);
assert([400, 403].includes(txOrigin.status));
const badHash = await a("/api/transactions", {
  id: crypto.randomUUID(),
  action: "attach",
  hashes: ["not-a-transaction"],
});
assert.equal(badHash.status, 400);
console.log(
  "PASS: wallet journal initializes, unknown requests and invalid hashes are rejected, and cross-origin writes are blocked.",
);
