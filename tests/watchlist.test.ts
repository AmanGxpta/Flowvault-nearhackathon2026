import test from "node:test";
import assert from "node:assert/strict";
import { applyWatchOp, cleanWatchlist, emptyWatchlist, MAX_SAVED } from "../lib/flowvault/watchlist.ts";

test("starring adds a token once, case-insensitively, and unstarring removes it", () => {
  let w = applyWatchOp(emptyWatchlist(), { op: "star", id: "near:wrap.near" });
  w = applyWatchOp(w, { op: "star", id: "near:WRAP.NEAR" });
  assert.deepEqual(w.saved, ["near:wrap.near"]);
  assert.deepEqual(applyWatchOp(w, { op: "unstar", id: "near:WRAP.near" }).saved, []);
});

test("an invalid token id is refused and the list is unchanged", () => {
  assert.throws(() => applyWatchOp(emptyWatchlist(), { op: "star", id: "not a token" }), /isn't valid/);
});

test("the token list is capped", () => {
  const full = { wallets: [], saved: Array.from({ length: MAX_SAVED }, (_, i) => "near:t" + i + ".near") };
  assert.throws(() => applyWatchOp(full, { op: "star", id: "near:one-more.near" }), /up to 100/);
});

test("watching a wallet normalizes the address, defaults the label and refuses a duplicate", () => {
  const w = applyWatchOp(emptyWatchlist(), { op: "watch_wallet", network: "base", address: " 0xAbCDEF0123456789abcdef0123456789ABCDEF01 " });
  assert.equal(w.wallets[0].id, "base:0xabcdef0123456789abcdef0123456789abcdef01");
  assert.equal(w.wallets[0].label, "0xabcdef0123456789abcdef0123456789abcdef01");
  assert.throws(() => applyWatchOp(w, { op: "watch_wallet", network: "base", address: "0xabcdef0123456789abcdef0123456789abcdef01" }), /already saved/);
  assert.throws(() => applyWatchOp(w, { op: "watch_wallet", network: "near", address: "Not Valid!" }), /valid NEAR account/);
});

test("updating a wallet changes only the given fields; unwatching removes it", () => {
  let w = applyWatchOp(emptyWatchlist(), { op: "watch_wallet", network: "near", address: "paul.near", label: "Paul", notes: "fund" });
  w = applyWatchOp(w, { op: "update_wallet", id: "near:paul.near", notes: "early backer" });
  assert.equal(w.wallets[0].label, "Paul");
  assert.equal(w.wallets[0].notes, "early backer");
  assert.throws(() => applyWatchOp(w, { op: "update_wallet", id: "near:nobody.near", label: "x" }), /isn't on your watchlist/);
  assert.deepEqual(applyWatchOp(w, { op: "unwatch_wallet", id: "near:paul.near" }).wallets, []);
});

test("importing merges a browser list without replacing or duplicating what the account already has", () => {
  let w = applyWatchOp(emptyWatchlist(), { op: "watch_wallet", network: "near", address: "paul.near", label: "Paul (account)" });
  w = applyWatchOp(w, { op: "star", id: "near:wrap.near" });
  const merged = applyWatchOp(w, { op: "import", data: { saved: ["near:wrap.near", "ethereum:0xabc", 42], wallets: [{ network: "near", address: "paul.near", label: "Paul (browser)" }, { network: "near", address: "jun.near", label: "Jun" }, { network: "zz", address: "x" }] } });
  assert.deepEqual(merged.saved, ["near:wrap.near", "ethereum:0xabc"]);
  assert.deepEqual(merged.wallets.map((x) => x.label), ["Paul (account)", "Jun"]);
});

test("a stored list is cleaned of junk", () => {
  assert.deepEqual(cleanWatchlist({ saved: ["near:a.near", "bad id", null], wallets: "nope" }), { wallets: [], saved: ["near:a.near"] });
  assert.deepEqual(cleanWatchlist(null), emptyWatchlist());
});
