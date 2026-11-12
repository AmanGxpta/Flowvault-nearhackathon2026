import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replay,
  replays,
  REPLAY_KINDS,
  REPLAY_OUTCOMES,
} from "../lib/flowvault/replays.ts";
import { assertSignable, verifyOutcome } from "../lib/flowvault/execution.ts";
test("all 15 replay cases are labelled simulated, disconnected and unspendable", () => {
  const all = replays();
  assert.equal(all.length, 15);
  assert.equal(new Set(all.map((r) => r.id)).size, 15);
  for (const r of all) {
    assert.equal(r.source, "simulated");
    assert.equal(r.simulation, true);
    assert.equal(r.signable, false);
    assert.equal(r.readOnly, true);
    assert.equal(r.accountId, null);
    assert.match(r.id, /^simulated:/);
    assert.match(r.label, /SIMULATED/);
    assert.ok(!("preparation" in r));
    assert.equal(
      r.timeline.every(
        (s) => s.source === "simulated" && s.explorerLinks.length === 0,
      ),
      true,
    );
    assert.throws(() => assertSignable(r as any, null, "demo", 1));
    assert.throws(
      () =>
        verifyOutcome(r.evidence.sourceReceipt, {
          ...r,
          accountId: "owner.near",
        } as any),
      /signer/,
    );
  }
});
test("filters isolate kind/outcome and returned fixtures cannot mutate the next replay", () => {
  assert.equal(replays({ kind: "pay" }).length, 5);
  assert.equal(replays({ outcome: "refunded" }).length, 3);
  assert.equal(replays({ id: "simulated:pay:success" }).length, 1);
  const one = replay("pay", "success");
  one.evidence.provider!.response.status = "FAILED";
  assert.equal(
    replay("pay", "success").evidence.provider!.response.status,
    "SUCCESS",
  );
});
test("replay outcomes distinguish exact destination evidence from refund reports and incomplete funding", () => {
  for (const kind of REPLAY_KINDS)
    for (const outcome of REPLAY_OUTCOMES) {
      const r = replay(kind, outcome);
      assert.equal(r.state === "paid", kind === "pay" && outcome === "success");
      if (outcome === "refunded")
        assert.equal(r.timeline.at(-1)?.refund?.sourceProofVerified, false);
      if (kind === "pay" && outcome === "success")
        assert.equal(r.evidence.destinationProof?.finalized, false);
    }
  assert.match(replay("withdraw", "partial").message, /incomplete/);
  assert.match(replay("pay", "deadline-passed").message, /deadline passed/);
});
