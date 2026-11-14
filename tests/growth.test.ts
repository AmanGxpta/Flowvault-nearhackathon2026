import test from "node:test";
import assert from "node:assert/strict";
import { checkTip, inviteCode, feeShareBps, feeShareText, rankTips, type Tip } from "../lib/flowvault/growth.ts";

test("tips are plain words pointing at an action in FlowVault: no links of any kind", () => {
  const ok = { title: "Rhea USDt supply is above 9% today", detail: "Utilization is high, so the rate may not last.", action: { kind: "supply" as const, tokenId: "usdt.tether-token.near", symbol: "USDt" } };
  assert.equal(checkTip(ok), null);
  for (const bad of ["Claim at freebonus.xyz now", "see https://example.org", "join t.me/pumpgroup", "go to www.thing"]) assert.match(checkTip({ ...ok, detail: bad })!, /can't contain links/);
  assert.match(checkTip({ ...ok, title: "short" })!, /8 to 90/);
  assert.match(checkTip({ ...ok, action: { kind: "swap", to: "not an id", symbol: "X" } })!, /Choose the token/);
});

test("invite codes are stable per account and fee share is off unless set", async () => {
  const a = await inviteCode("Alice.near"), b = await inviteCode("alice.near");
  assert.equal(a, b);
  assert.match(a, /^[a-z2-9]{8}$/);
  assert.notEqual(a, await inviteCode("bob.near"));
  assert.equal(feeShareBps(undefined), 0);
  assert.equal(feeShareBps("4000"), 4000);
  assert.equal(feeShareBps("9000"), 0, "out of range is treated as off");
  assert.match(feeShareText(0), /off/);
  assert.match(feeShareText(4000), /40%.*Payouts aren't automatic/);
});

test("ranking favours votes and uses, and fades with age", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const tip = (id: string, hoursAgo: number, votes: number, used = 0): Tip => ({ id, author: "a", title: id, detail: "", action: { kind: "stake" }, createdAt: new Date(now - hoursAgo * 3_600_000).toISOString(), votes, used });
  assert.deepEqual(rankTips([tip("old-popular", 72, 6), tip("fresh", 1, 1), tip("used", 6, 0, 3)], now).map((t) => t.id), ["used", "fresh", "old-popular"]);
});
