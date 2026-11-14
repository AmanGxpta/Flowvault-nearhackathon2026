import test from "node:test";
import assert from "node:assert/strict";
import { simAttempt, simDelivered, exampleHash } from "../lib/flowvault/demo-sim.ts";

test("a simulated step waits in the wallet, runs, then lands with what was delivered", () => {
  assert.equal(simAttempt("f:pay", null, 1000), null, "nothing until approved");
  assert.equal(simAttempt("f:pay", 1000, 1500)?.state, "awaiting_wallet");
  const running = simAttempt("f:pay", 1000, 5000)!;
  assert.equal(running.state, "submitted");
  assert.match(running.hash!, /^example-[0-9a-f]{16}$/);
  const done = simAttempt("f:pay", 1000, 20_000, { deliveredRaw: "99" })!;
  assert.equal(done.state, "confirmed");
  assert.equal(done.deliveredRaw, "99");
  assert.equal(exampleHash("a"), exampleHash("a"), "hashes are stable across reloads");
});

test("example delivery never exceeds the quote", () => {
  assert.equal(simDelivered("1000000"), "999200");
  assert.equal(simDelivered(null), null);
});
