import { test } from "node:test";
import assert from "node:assert/strict";
import { missingEntries, withEntries, stepEntries, planPolicySteps } from "../lib/flowvault/plans-policy.ts";
import { defaultPolicy, policySchema } from "../lib/flowvault/policy.ts";

test("default policy stays default-deny for Rhea execute_with_pyth and LST ft_transfer_call/deposit_and_stake", () => {
  const p = defaultPolicy("5");
  const miss = missingEntries(p, [{ kind: "borrow" }, { kind: "collateral_add", asset: "LiNEAR" }, { kind: "stake", strategy: "rnear" }, { kind: "repay" }]);
  assert.deepEqual(miss.map((e) => (e.type === "venue" ? e.venue : e.receiver + "." + e.method)), [
    "contract.main.burrow.near.execute_with_pyth",
    "linear-protocol.near.ft_transfer_call",
    "lst.rhealab.near",
    "lst.rhealab.near.deposit_and_stake",
  ]);
});

test("allowing adds exactly the missing entries as the next revision's content and passes the policy schema", () => {
  const p = defaultPolicy("5");
  const miss = missingEntries(p, [{ kind: "borrow" }, { kind: "collateral_release" }]);
  assert.equal(miss.length, 1, "deduplicated across steps");
  const next = withEntries(p, miss);
  assert.equal(next.methods.length, p.methods.length + 1);
  assert.deepEqual(next.venues, p.venues);
  assert.deepEqual({ ...next, methods: p.methods }, p, "nothing else changes");
  assert.deepEqual(missingEntries(next, [{ kind: "borrow" }]), []);
  assert.doesNotThrow(() => policySchema.parse(next));
  assert.equal(p.methods.length, next.methods.length - 1, "the current policy object is not mutated");
});

test("steps without new entries need nothing; unknown collateral or native staking add nothing", () => {
  assert.deepEqual(stepEntries("supply"), []);
  assert.deepEqual(stepEntries("collateral_add", { asset: "ETH" }), []);
  assert.deepEqual(stepEntries("stake", { strategy: "native" }), []);
});

test("plan steps come from the chosen or recommended alternative, with collateral in order", () => {
  const steps = planPolicySteps({
    recommendedChoiceId: "add-collateral",
    alternatives: [{ id: "add-collateral", steps: ["collateral_add", "borrow"] }, { id: "linear", steps: ["stake"] }],
    collateral: [{ asset: "rNEAR" }],
  });
  assert.deepEqual(steps, [{ kind: "collateral_add", asset: "rNEAR" }, { kind: "borrow" }]);
  assert.deepEqual(planPolicySteps({ selectedChoiceId: "linear", alternatives: [{ id: "linear", steps: ["stake"] }] }), [{ kind: "stake", strategy: "linear" }]);
});
