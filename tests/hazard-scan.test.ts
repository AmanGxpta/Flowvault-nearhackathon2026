import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy, evaluatePolicy, hazardChecks, type PolicyAction } from "../lib/flowvault/policy.ts";

const action = (o: Partial<PolicyAction> = {}): PolicyAction => ({ kind: "supply", asset: "USDC", amount: "250", recipient: "alice.near", venue: "contract.main.burrow.near", movingCost: "0.10", gasNear: "0.01", source: "live", accountId: "alice.near", methods: [{ receiver: "contract.main.burrow.near", method: "ft_transfer_call" }], ...o });

test("the hazard scan lists every policy check, including what's left of today's limit", () => {
  const policy = { ...defaultPolicy(), dailyCap: "1000", perActionCap: "500", venues: ["contract.main.burrow.near"], methods: [{ receiver: "contract.main.burrow.near", method: "ft_transfer_call" }] };
  const ledger = [{ operationId: "x", accountId: "alice.near", source: "live", amount: "300", createdAt: new Date().toISOString(), state: "confirmed" }] as never;
  const checks = hazardChecks(action(), policy, evaluatePolicy(action(), policy, ledger), [{ id: "health", label: "No debt", ok: true }]);
  const daily = checks.find((c) => c.id === "daily")!;
  assert.equal(daily.label, "$450.00 left today after this (within limit)");
  assert.equal(daily.ok, true);
  assert.ok(checks.some((c) => c.id === "venue" && c.ok));
  assert.equal(checks.at(-1)!.id, "health", "the card's own checks come last");
});

test("a failing check is marked with the policy's own reason", () => {
  const policy = { ...defaultPolicy(), dailyCap: "100", perActionCap: "500", venues: [] as string[] };
  const checks = hazardChecks(action(), policy, evaluatePolicy(action(), policy, []));
  const daily = checks.find((c) => c.id === "daily")!, venue = checks.find((c) => c.id === "venue")!;
  assert.equal(daily.ok, false);
  assert.match(daily.detail!, /remaining daily cap/);
  assert.equal(venue.ok, false);
});
