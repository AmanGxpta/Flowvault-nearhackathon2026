import test from "node:test";
import assert from "node:assert/strict";
import { exampleChecks, examplePasses } from "../lib/flowvault/demo-sim.ts";
import { seed } from "../lib/flowvault/seed.ts";
import { workspaceLedger } from "../lib/flowvault/policy-context.ts";

const NOW = Date.UTC(2026, 10, 15, 12);

test("Demo Mode's hazard scan quotes the example policy's own caps and prior usage", () => {
  const w = seed(NOW), used = Number(workspaceLedger(w, [], "fictional-example", NOW)[0].amount);
  const checks = exampleChecks(100), cap = checks.find((c) => c.id === "per-action")!, daily = checks.find((c) => c.id === "daily")!;
  assert.match(cap.label, new RegExp("\\$" + Number(w.policy!.perActionCap).toLocaleString("en-US")));
  assert.match(daily.label, new RegExp("\\$" + (Number(w.policy!.dailyCap) - used - 100).toLocaleString("en-US") + " left today"));
  assert.equal(w.mandate.reserve, "2000");
});

test("a demo action over the example caps is refused, like the policy page refuses it", () => {
  assert.equal(examplePasses(exampleChecks(5_000)), true);
  const over = exampleChecks(6_000);
  assert.equal(examplePasses(over), false);
  assert.equal(over.find((c) => c.id === "per-action")!.ok, false);
  // $1,250 is already used of the $8,000 daily cap: $6,750 is left.
  assert.equal(exampleChecks(4_000, []).find((c) => c.id === "daily")!.ok, true);
  assert.equal(exampleChecks(4_000, []).find((c) => c.id === "daily")!.label, "$2,750 left today after this (within limit)");
});
