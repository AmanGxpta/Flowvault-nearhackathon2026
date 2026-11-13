import test from "node:test";
import assert from "node:assert/strict";
import { availableToStake, estimatedLinearShares, estimatedYearlyNear, stakeAttemptMode } from "../lib/flowvault/staking-ui.ts";
import { nearText } from "../lib/flowvault/stake-flow.ts";
const N = 10n ** 24n;
test("staking allowance preserves reserve and fee room without confusing missing balances with zero", () => {
  assert.equal(availableToStake(), null);
  assert.equal(availableToStake("invalid"), null);
  assert.equal(availableToStake("0"), 0n);
  assert.equal(availableToStake((N / 2n).toString()), 0n);
  assert.equal(availableToStake((1405n * N / 1000n).toString()), 855n * N / 1000n);
});
test("LiNEAR estimates keep base-unit precision and require a valid live exchange rate", () => {
  assert.equal(estimatedLinearShares(N, (15n * N / 10n).toString()), "666666666666666666666666");
  assert.equal(estimatedLinearShares(N, null), null);
  assert.equal(estimatedLinearShares(N, "0"), null);
  assert.equal(estimatedLinearShares(null, N.toString()), null);
  assert.equal(estimatedYearlyNear(N, "4.31"), 431n * N / 10000n);
  assert.equal(estimatedYearlyNear(N, "unknown"), null);
  assert.equal(nearText("1"), "<0.0001");
});
test("reopening a flow restores prepared review and never offers a fresh stake for uncertain sends", () => {
  assert.equal(stakeAttemptMode(null), "new");
  assert.equal(stakeAttemptMode({state:"prepared", hashes:0}), "resume");
  assert.equal(stakeAttemptMode({state:"failed", hashes:0}), "new");
  for(const state of ["awaiting_wallet", "submitted", "unknown", "partial"]) assert.equal(stakeAttemptMode({state, hashes:1}), "track");
  assert.equal(stakeAttemptMode({state:"failed", hashes:1}), "attention");
  assert.equal(stakeAttemptMode({state:"confirmed", hashes:1}), "done");
});
