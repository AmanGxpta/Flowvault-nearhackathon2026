import { test } from "node:test";
import assert from "node:assert/strict";
import { usableBalances } from "../lib/flowvault/usable.ts";
import { demoPortfolio } from "./fixtures/legacy-example.ts";
import { hexQuantity, validEvm } from "../lib/flowvault/evm.ts";
test("Five balances keep unknown borrowing/valuation/withdrawal separate from known subtotal", () => {
  const p = demoPortfolio();
  const b = usableBalances(p, ["2026-11-25"], "100");
  assert.equal(b.cashNow.amount, "11900");
  assert.equal(b.netWorth.amount, "48000");
  assert.equal(b.borrowingHeadroom.amount, null);
  assert.equal(b.withdrawableByDate[0].amount, null);
  assert.equal(b.committedCapital.amount, "36100");
});
test("Stale/failed reads never masquerade as zero and non-USDC assets stay unvalued", () => {
  const p = demoPortfolio();
  p.errors = ["RPC failed"];
  let b = usableBalances(p, []);
  assert.equal(b.cashNow.amount, null);
  assert.equal(b.cashNow.knownSubtotal, "12000");
  p.errors = [];
  p.positions.push({
    id: "near",
    asset: "NEAR",
    amount: "1",
    kind: "wallet",
    label: "NEAR",
  });
  b = usableBalances(p, []);
  assert.equal(b.netWorth.amount, null);
  assert.equal(b.unvaluedAssets[0].valuation, null);
  p.capturedAt = new Date(0).toISOString();
  assert.equal(usableBalances(p, []).cashNow.fresh, false);
});
test("EVM quantity decoding preserves bigint; malformed responses and zero addresses are rejected", () => {
  assert.equal(hexQuantity("0x20000000000001"), 9007199254740993n);
  assert.throws(() => hexQuantity("garbage"));
  assert(!validEvm("0x" + "0".repeat(40)));
  assert(validEvm("0x" + "2".repeat(40)));
});

test("Known credit cannot override stale/failed/empty evidence or mixed position sources", () => {
  const p = demoPortfolio();
  p.errors = ["RPC failed"];
  assert.equal(
    usableBalances(p, [], "0", "100").borrowingHeadroom.amount,
    null,
  );
  p.errors = [];
  p.capturedAt = new Date(0).toISOString();
  assert.equal(
    usableBalances(p, [], "0", "100").borrowingHeadroom.amount,
    null,
  );
  p.capturedAt = new Date().toISOString();
  p.positions[0].source = "live";
  assert.equal(usableBalances(p, []).cashNow.amount, null);
  p.positions = [];
  assert.equal(usableBalances(p, []).cashNow.amount, null);
});
