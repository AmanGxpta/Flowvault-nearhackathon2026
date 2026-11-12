import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, defaultPolicy } from "../lib/flowvault/policy.ts";
import type { PolicyAction, LedgerEntry } from "../lib/flowvault/policy.ts";
const now = Date.parse("2026-11-12T12:00Z");
const a: PolicyAction = {
  kind: "supply",
  asset: "USDC",
  amount: "10",
  recipient: "owner.near",
  accountId: "owner.near",
  venue: "contract.main.burrow.near",
  source: "live",
  movingCost: "0",
  gasNear: "0.25",
  methods: [{ receiver: "contract.main.burrow.near", method: "execute" }],
};
test("Policy allows matching method/receiver, owner and bounded fees", () =>
  assert(evaluatePolicy(a, defaultPolicy(), [], now).allowed));
test("Policy names all independently violated constraints and refuses unknown fees", () => {
  const p = defaultPolicy();
  p.perActionCap = "1";
  p.dailyCap = "5";
  p.protectedAssets = ["USDC"];
  const r = evaluatePolicy(
    {
      ...a,
      venue: "evil",
      recipient: "other",
      movingCost: null,
      gasNear: null,
      methods: [
        { receiver: "evil", method: "execute", nestedReceiver: "evil" },
      ],
    },
    p,
    [],
    now,
  );
  for (const c of [
    "PER_ACTION_CAP",
    "DAILY_CAP",
    "PROTECTED_ASSET",
    "VENUE_NOT_ALLOWED",
    "RECIPIENT_NOT_ALLOWED",
    "COST_UNVERIFIED",
    "GAS_UNVERIFIED",
    "METHOD_NOT_ALLOWED",
    "NESTED_RECEIVER_NOT_ALLOWED",
  ])
    assert(r.violations.some((x) => x.code === c));
});
test("Daily totals count authorized/unknown attempts, scope by account/source/day, and do not double-count same operation", () => {
  const rows: LedgerEntry[] = [
    {
      operationId: "a",
      amount: "49995",
      source: "live",
      accountId: "owner.near",
      createdAt: "2026-11-12T01:00Z",
      state: "unknown",
    },
    {
      operationId: "b",
      amount: "9999",
      source: "demo",
      accountId: "owner.near",
      createdAt: "2026-11-12",
      state: "confirmed",
    },
  ];
  assert(!evaluatePolicy(a, defaultPolicy(), rows, now).allowed);
  assert(evaluatePolicy({ ...a, id: "a" }, defaultPolicy(), rows, now).allowed);
  assert(evaluatePolicy(a, defaultPolicy(), rows, now + 86400000).allowed);
});
test("Protected assets may be returned by withdrawal but cannot be supplied/spent", () => {
  const p = defaultPolicy();
  p.protectedAssets = ["USDC"];
  assert(!evaluatePolicy(a, p, [], now).allowed);
  assert(evaluatePolicy({ ...a, kind: "withdraw" }, p, [], now).allowed);
});

test("Unknown action kind, simulated source, absent methods and malformed ledger time cannot pass policy", () => {
  for (const patch of [
    { kind: "teleport" },
    { source: "simulated" },
    { methods: [] },
  ])
    assert(
      evaluatePolicy(
        { ...a, ...patch } as any,
        defaultPolicy(),
        [],
        now,
      ).violations.some((x) => x.code === "INVALID_ACTION"),
    );
  assert(
    evaluatePolicy(
      a,
      defaultPolicy(),
      [
        {
          operationId: "bad",
          accountId: a.accountId,
          source: "live",
          amount: "1",
          createdAt: "unknown",
          state: "authorized",
        },
      ],
      now,
    ).violations.some((x) => x.code === "LEDGER_UNVERIFIED"),
  );
});
