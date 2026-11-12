import test from "node:test";
import assert from "node:assert/strict";
import { strategyEligibility } from "../lib/flowvault/strategy-eligibility.ts";
import { STRATEGY_SPECS } from "../lib/flowvault/strategy-spec.ts";

const byId = (r: ReturnType<typeof strategyEligibility>, id: string) => r.find((x) => x.spec.id === id)!;

test("LiNEAR spec becomes eligible only once stake, unstake and withdraw_unstaked adapters are registered", () => {
  const before = strategyEligibility(["supply", "withdraw"]);
  assert.equal(byId(before, "rhea-usdc-surplus").eligible, true);
  const linear = byId(before, "linear-staking-with-exit-reserve");
  assert.equal(linear.eligible, false);
  assert.deepEqual(linear.missingAdapters.sort(), ["stake", "unstake", "withdraw_unstaked"]);
  const after = strategyEligibility(["supply", "withdraw", "stake", "unstake", "withdraw_unstaked"]);
  assert.equal(byId(after, "linear-staking-with-exit-reserve").eligible, true);
});

test("pooled vaults, paused specs and missing adapters are never eligible", () => {
  const vault = { ...STRATEGY_SPECS[0], id: "v", kind: "pooled_vault" as const };
  const paused = { ...STRATEGY_SPECS[0], id: "p", status: "paused" as const };
  const r = strategyEligibility(["supply", "withdraw"], [vault, paused]);
  assert.equal(byId(r, "v").eligible, false);
  assert.ok(byId(r, "v").problems.some((p) => /Pooled vaults/.test(p)));
  assert.equal(byId(r, "p").eligible, false);
  assert.equal(byId(strategyEligibility([]), "rhea-usdc-surplus").eligible, false);
});
