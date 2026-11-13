import { test } from "node:test";
import assert from "node:assert/strict";
import { researchAddress, parseResearch, displayQuantity, publicWatchlistUrl, researchPortfolioView } from "../lib/flowvault/research.ts";

test("research accepts public addresses without creating an owned account record", () => {
  const address = researchAddress("base", " 0xABCDEF1234567890abcdef1234567890ABCDEF12 ");
  assert.equal(address, "0xabcdef1234567890abcdef1234567890abcdef12");
  const research = parseResearch(JSON.stringify({ wallets: [{ network: "base", address, label: "Public fund", notes: "Private idea", proof: { verified: true }, ownership: "owner", balance: "999999" }] }));
  assert.deepEqual(Object.keys(research.wallets[0]).sort(), ["address", "id", "label", "network", "notes"]);
  assert.equal(research.wallets[0].id, "base:" + address);
  assert.equal(research.wallets[0].notes, "Private idea");
  assert.equal("proof" in research.wallets[0], false);
});
test("research rejects malformed addresses, URL injection and unsupported networks", () => {
  for (const [network, address] of [["near", "https://bad.example"], ["near", "UPPER.near"], ["base", "0x1234"], ["solana", "wrap.near"], ["arb", "javascript:alert(1)"]]) {
    assert.throws(() => researchAddress(network, address));
  }
  assert.equal(researchAddress("near", "wrap.near"), "wrap.near");
  assert.equal(researchAddress("near", "a".repeat(64)), "a".repeat(64));
});
test("corrupt browser storage cannot grant authority or break Research", () => {
  for (const raw of ["null", "not json", "[]", '{"wallets":[null,42,{}],"saved":null}']) assert.deepEqual(parseResearch(raw), { wallets: [], saved: [] });
  const one = { network: "near", address: "wrap.near", label: "A".repeat(200), notes: "B".repeat(2000) };
  const value = parseResearch(JSON.stringify({ wallets: [one, one, { ...one, network: "base" }], saved: ["near:native", 123, null] }));
  assert.equal(value.wallets.length, 1);
  assert.equal(value.wallets[0].label.length, 80);
  assert.equal(value.wallets[0].notes.length, 1000);
  assert.deepEqual(value.saved, ["near:native"]);
});
test("quantity display distinguishes nonzero dust, zero and unknown", () => {
  assert.equal(displayQuantity("0.000000000000000000000001", "NEAR"), "<0.0001 NEAR");
  assert.equal(displayQuantity("0", "ETH"), "0 ETH");
  assert.equal(displayQuantity("0.001764", "ETH"), "0.001764 ETH");
  assert.equal(displayQuantity("unknown", "ETH"), "Quantity unavailable");
  assert.equal(displayQuantity("NaN", "ETH"), "Quantity unavailable");
});

test("public watchlist links strip wallet redirect parameters, fragments and unsupported identities", () => {
  const url = new URL(publicWatchlistUrl("https://flowvault.example/?transactionHashes=private&fv_attempt=secret#my-wallet", ["near:native", "near:native", "private-note:do-not-share"]));
  assert.equal(url.searchParams.get("view"), "research");
  assert.equal(url.searchParams.get("list"), "near:native");
  assert.deepEqual([...url.searchParams.keys()], ["view", "list"]);
  assert.equal(url.hash, "");
  assert.equal(url.toString().includes("private"), false);
});

test("partial public research reads retain warnings and cannot masquerade as known zero holdings", () => {
  const view = researchPortfolioView({ accountId: "wrap.near", source: "live", capturedAt: "2026-11-13T08:00:00Z", positions: [], errors: ["Rhea read failed"], sections: [{ id: "rhea", status: "unavailable", capturedAt: "2026-11-13T08:00:00Z", reasons: ["RPC unavailable"], positionIds: [], affects: ["netWorth"] }] });
  assert.equal(view.incomplete, true);
  assert.deepEqual(view.warnings, ["Rhea read failed", "RPC unavailable"]);
  assert.deepEqual(view.positions, []);
  assert.equal("accountId" in view, false);
  assert.equal("ownership" in view, false);
});
