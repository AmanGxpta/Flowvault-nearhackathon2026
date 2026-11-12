import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  personalSeed,
  demoPortfolio,
  demoMarket,
  exampleDate,
} from "../lib/flowvault/seed.ts";
import { holdback, editObligation } from "../lib/flowvault/obligations.ts";
import { usableBalances } from "../lib/flowvault/usable.ts";
import { calendarRanking } from "../lib/flowvault/calendar.ts";
import {
  evaluatePolicy,
  defaultPolicy,
  policySchema,
} from "../lib/flowvault/policy.ts";
import {
  watchedAccountsSchema,
  evmAddressesSchema,
  ownerPositions,
} from "../lib/flowvault/accounts.ts";
import { readRpc } from "../lib/flowvault/rpc-transport.ts";
import { snapshot, clearSnapshots } from "../lib/flowvault/snapshot-cache.ts";
const now = Date.parse("2026-11-12T12:00:00Z");
test("design seed has exact fictional four-obligation story and relative dates", () => {
  const w = seed(now);
  assert.equal(w.exampleSeed, "design-v1");
  assert.equal(w.mandate.reserve, "2000");
  assert.deepEqual(
    w.obligations.map((o) => [
      o.label,
      o.amount,
      o.token,
      o.destination,
      o.dueDate,
    ]),
    [
      ["Studio rent", "2500", "USDC", "base", "2026-11-14"],
      ["Rent to Aman", "1000", "USDT", "bnb", "2026-11-23"],
      ["Design software", "50", "USDC", "arb", "2026-11-25"],
      ["Payroll to aman.near", "6000", "USDC", "near", "2026-12-01"],
    ],
  );
  assert.equal(holdback(w.mandate, now), 11550_000000n);
  assert.equal(
    seed(now + 400 * 86400000).obligations[0].dueDate,
    exampleDate(402, now),
  );
  assert.equal(personalSeed().obligations.length, 0);
  assert.equal(personalSeed().fictional, undefined);
  assert.equal(personalSeed().accountId, null);
});
test("fictional valuations yield design totals; watched assets never contribute; live USDT reservation refuses unverified FX", () => {
  const p = demoPortfolio(now);
  const u = usableBalances(p, ["2026-11-14"], "0", null, now);
  assert.equal(u.cashNow.amount, "15190");
  assert.equal(u.netWorth.amount, "25526.48");
  assert.equal(u.committedCapital.amount, "8201.76");
  p.positions.push({
    id: "watch-cash",
    asset: "USDC",
    label: "Watched",
    amount: "9999999",
    kind: "wallet",
    ownership: "watched",
  });
  assert.equal(usableBalances(p, [], "0", null, now).cashNow.amount, "15190");
  const w = seed(now);
  w.mandate.source = "live";
  assert.throws(() => holdback(w.mandate, now), /valuation unavailable/);
});
test("obligation planning persists BNB/Ethereum, recurrence and notes without enabling payment execution", () => {
  const w = editObligation(personalSeed(), "create", {
    id: "bill",
    label: "Subscription",
    recipient: "",
    destination: "eth",
    amount: "5",
    token: "USDT",
    dueDate: "2026-12-01",
    note: "Monthly seat",
    recurrence: "monthly",
  });
  assert.equal(w.obligations[0].recurrence, "monthly");
  assert.equal(w.obligations[0].note, "Monthly seat");
});
test("asset permissions, chain scope and priority are persisted and enforced read-only", () => {
  const p = defaultPolicy();
  p.assetRows = [
    { asset: "USDC", chain: "near", priority: "P2", uses: ["hold"] },
  ];
  const a = {
    kind: "supply",
    asset: "USDC",
    amount: "1",
    recipient: "owner.near",
    accountId: "owner.near",
    venue: "contract.main.burrow.near",
    source: "live" as const,
    movingCost: "0",
    gasNear: "0.25",
    chain: "near" as const,
    methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
  };
  assert.ok(
    evaluatePolicy(a, p, []).violations.some(
      (v) => v.code === "ASSET_USE_NOT_ALLOWED",
    ),
  );
  assert.ok(
    evaluatePolicy({ ...a, chain: undefined }, p, []).violations.some(
      (v) => v.code === "ASSET_SCOPE_UNVERIFIED",
    ),
  );
  assert.equal(policySchema.parse(p).assetRows![0].priority, "P2");
});
test("owner address/watch schemas validate source and never infer ownership from reading", () => {
  assert.throws(() => evmAddressesSchema.parse({ base: "bad" }));
  assert.throws(() =>
    watchedAccountsSchema.parse([
      { id: "x", chain: "near", address: "INVALID!", label: "x" },
    ]),
  );
  assert.equal(
    ownerPositions([
      {
        id: "x",
        asset: "USDC",
        amount: "1000",
        kind: "wallet",
        label: "x",
        ownership: "watched",
      },
    ]).length,
    0,
  );
});
test("custom comparison cannot exceed surplus and saved lead window affects dated staking fit", () => {
  const w = seed(now);
  let r = calendarRanking(
    w.mandate,
    demoMarket(now),
    demoPortfolio(now),
    {},
    now,
    { amount: "1000" },
  );
  assert.equal(r.comparisonAmount, "1000");
  assert.equal(r.surplus, "2690");
  r = calendarRanking(w.mandate, demoMarket(now), demoPortfolio(now), {}, now, {
    amount: "99999",
  });
  assert.equal(r.chosen, null);
  assert.ok(r.strategies[0].reasons.includes("AMOUNT_EXCEEDS_SURPLUS"));
  assert.equal(r.leadDays, 3);
});
test("RPC 429 retries across fallback before bounded backoff and never fabricates a result", async () => {
  let calls = 0;
  const urls: string[] = [];
  const sleeps: number[] = [];
  const result = await readRpc(
    "query",
    {},
    (async (url: any) => {
      urls.push(String(url));
      calls++;
      return calls < 3
        ? new Response("", { status: 429 })
        : Response.json({ result: { value: "exact" } });
    }) as typeof fetch,
    async (ms) => {
      sleeps.push(ms);
    },
  );
  assert.equal(result.value, "exact");
  assert.equal(calls, 3);
  assert.notEqual(urls[0], urls[1]);
  assert.deepEqual(sleeps, [250]);
  await assert.rejects(
    readRpc(
      "query",
      {},
      (async () => new Response("", { status: 503 })) as typeof fetch,
      async () => {},
    ),
    /503/,
  );
});
test("last-good snapshots keep original capture time, isolate mutations and degrade on read failure", async () => {
  clearSnapshots();
  const at = Date.now();
  let loads = 0;
  const load = async () => ({
    capturedAt: new Date(at).toISOString(),
    amount: "100",
    errors: [] as string[],
  });
  const one = await snapshot(
    "test",
    async () => {
      loads++;
      return load();
    },
    (old, e) => ({ ...old, errors: [e] }),
    at,
  );
  one.amount = "999";
  assert.equal(
    (await snapshot("test", load, (old) => old, at + 10)).amount,
    "100",
  );
  const degraded = await snapshot<{
    capturedAt: string;
    amount: string;
    errors: string[];
  }>(
    "test",
    async () => {
      throw Error("429");
    },
    (old, e) => ({ ...old, errors: [e] }),
    at + 16000,
  );
  assert.equal(degraded.capturedAt, new Date(at).toISOString());
  assert.match(degraded.errors[0], /429/);
  assert.equal(loads, 1);
});

test("example daily usage is deterministic within its UTC day and never joins a live ledger", async () => {
  const { workspaceLedger } = await import(
    "../lib/flowvault/policy-context.ts"
  );
  assert.deepEqual(
    workspaceLedger(seed(now), [], "example", now),
    workspaceLedger(seed(now), [], "example", now + 1000),
  );
  assert.deepEqual(workspaceLedger(personalSeed(), []), []);
});

test("asset symbols are case insensitive for protection and conflicting permission rows cannot duplicate by case", () => {
  const p = defaultPolicy();
  p.protectedAssets = ["usdc"];
  const action = {
    kind: "supply",
    asset: "USDC",
    amount: "1",
    recipient: "owner.near",
    accountId: "owner.near",
    venue: "contract.main.burrow.near",
    source: "live" as const,
    movingCost: "0",
    gasNear: "0.25",
    methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
  };
  assert.ok(
    evaluatePolicy(action, p, []).violations.some(
      (v) => v.code === "PROTECTED_ASSET",
    ),
  );
  assert.throws(
    () =>
      policySchema.parse({
        ...p,
        assetRows: [
          { asset: "USDC", priority: "P1", uses: ["hold"] },
          { asset: "usdc", priority: "P2", uses: ["pay"] },
        ],
      }),
    /Duplicate asset/,
  );
});
