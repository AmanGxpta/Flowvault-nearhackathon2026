import test from "node:test";
import assert from "node:assert/strict";
import { E18, assetsFor, crystallize, emptyBook, holderLedger, holderView, nav, ppsE18, requestDeposit, requestRedemption, settle, validateTerms, vaultAlerts, type VaultBook, type VaultTerms } from "../lib/flowvault/vault.ts";

const T0 = Date.parse("2026-11-13T00:00:00Z");
const DAY = 86_400_000;
const terms = (over: Partial<VaultTerms> = {}): VaultTerms => ({
  id: "v1", specId: "rhea-usdc-pool", specVersion: 1, asset: "USDC", assetDecimals: 6, shareDecimals: 12, virtualShares: 1_000_000n, virtualAssets: 1n, mode: "pooled",
  fees: { managementBps: 200, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 2000 },
  capacityRaw: 1_000_000_000000n, perDepositorCapRaw: null, maxPositionBps: 8000, redemption: { noticeSeconds: 86_400, liquidityTargetBps: 1000 },
  admin: { owner: "owner.near", curator: "curator.near", pauseGuardian: "guard.near", upgradeAuthority: null, feeRecipients: { curator: "curator.near", platform: "flowvault.near" } },
  ...over,
});
const dep = (t: VaultTerms, b: VaultBook, account: string, amount: bigint, at = T0) => settle(t, requestDeposit(t, b, { id: account + at + amount, account, amountRaw: amount, requestedAt: at }), at).book;

test("terms: fee split, offsets, disclosed keys and custody-mode rules are validated", () => {
  assert.deepEqual(validateTerms(terms()), []);
  assert.ok(validateTerms(terms({ fees: { managementBps: 200, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 1000 } })).length);
  assert.ok(validateTerms(terms({ virtualShares: 0n })).some((x) => /virtual/.test(x)));
  assert.ok(validateTerms(terms({ mode: "single_depositor" })).some((x) => /no fees/.test(x)));
});

test("first deposit and the donation attack: a donated balance can't steal a later depositor's money", () => {
  const t = terms({ fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 8000, platformShareBps: 2000 } });
  let b = dep(t, emptyBook(t, T0), "attacker", 1n);
  b = { ...b, idleRaw: b.idleRaw + 10_000_000000n }; // attacker donates 10,000 USDC straight to the vault
  b = dep(t, b, "victim", 10_000_000000n);
  const victim = assetsFor(t, b.holders.victim, nav(b).navRaw!, b.totalShares);
  assert.ok(victim >= 9_999_000000n, `victim keeps at least 99.99%: ${victim}`);
});

test("rounding always favours the remaining holders", () => {
  const t = terms({ fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 8000, platformShareBps: 2000 } });
  let b = dep(t, emptyBook(t, T0), "alice", 1_000_000001n);
  b = dep(t, b, "bob", 333_333333n);
  const before = nav(b).navRaw!;
  b = requestRedemption(t, b, { id: "r1", account: "bob", amountRaw: b.holders.bob, requestedAt: T0 });
  const s = settle(t, b, T0 + 2 * DAY);
  const paid = BigInt(s.events[0].assetsRaw);
  assert.ok(paid <= 333_333333n, "never more than deposited at an unchanged NAV");
  assert.ok(assetsFor(t, s.book.holders.alice, nav(s.book).navRaw!, s.book.totalShares) >= 1_000_000001n - 1n);
  assert.equal(nav(s.book).navRaw, before - paid);
});

test("fees: management accrues per second, performance only above the high-water mark, losses recovered first", () => {
  const t = terms();
  let b = dep(t, emptyBook(t, T0), "alice", 1_000_000_000000n / 10n); // 100,000 USDC
  // One year, no gain: 2% management only.
  let r = crystallize(t, b, nav(b).navRaw!, T0 + 365 * DAY);
  assert.equal(r.record!.performanceFeeRaw, "0");
  assert.ok(Math.abs(Number(r.record!.managementFeeRaw) - 2_000_000000) <= 1, r.record!.managementFeeRaw);
  const fees = BigInt(r.book.holders["curator.near"]) + BigInt(r.book.holders["flowvault.near"]);
  const feeValue = assetsFor(t, fees, nav(b).navRaw!, r.book.totalShares);
  assert.ok(feeValue <= 2_000_000000n && feeValue >= 1_999_990000n, "minted shares are worth the fee, never more: " + feeValue);
  assert.equal((BigInt(r.book.holders["curator.near"]) * 10n) / fees >= 7n, true, "80/20 split");
  b = r.book;
  // A 10% gain: performance fee on the gain above the mark.
  b = { ...b, idleRaw: b.idleRaw + 10_000_000000n };
  r = crystallize(t, b, nav(b).navRaw!, b.lastFeeAt + 1000);
  // Net of management fees: fee dilution lowered the price below the mark, and the mark never moves down, so only
  // the gain above the old peak (≈ 7.96%, not 10%) is charged.
  assert.ok(Number(r.record!.performanceFeeRaw) > 790_000000 && Number(r.record!.performanceFeeRaw) < 800_000000, r.record!.performanceFeeRaw);
  b = r.book;
  const hwm = b.hwmE18;
  // A loss, then a partial recovery below the mark: no performance fee, mark unchanged.
  b = { ...b, idleRaw: b.idleRaw - 20_000_000000n };
  r = crystallize(t, b, nav(b).navRaw!, b.lastFeeAt + 1000);
  b = { ...r.book, idleRaw: r.book.idleRaw + 5_000_000000n };
  r = crystallize(t, b, nav(b).navRaw!, b.lastFeeAt + 1000);
  assert.equal(r.record?.performanceFeeRaw ?? "0", "0");
  assert.equal(r.book.hwmE18, hwm);
});

test("settlement: capacity and depositor caps refuse (money claimable back), notice and liquidity limit redemptions", () => {
  const t = terms({ capacityRaw: 150_000000n, perDepositorCapRaw: 120_000000n, fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 8000, platformShareBps: 2000 } });
  let b = dep(t, emptyBook(t, T0), "alice", 100_000000n);
  let s = settle(t, requestDeposit(t, b, { id: "d2", account: "bob", amountRaw: 60_000000n, requestedAt: T0 }), T0);
  assert.equal(s.events[0].reason, "CAPACITY");
  assert.equal(s.book.claimable.bob, 60_000000n);
  s = settle(t, requestDeposit(t, b, { id: "d3", account: "alice", amountRaw: 30_000000n, requestedAt: T0 }), T0);
  assert.equal(s.events[0].reason, "DEPOSITOR_CAP");
  // 80 of 100 deployed into a position; alice redeems everything.
  b = { ...b, idleRaw: 20_000000n, positions: [{ positionId: "rhea-usdc", usdcRaw: 80_000000n, basis: "test" }] };
  b = requestRedemption(t, b, { id: "r1", account: "alice", amountRaw: b.holders.alice, requestedAt: T0 });
  assert.equal(settle(t, b, T0 + 1000).events.length, 0, "notice period not over");
  s = settle(t, b, T0 + 2 * DAY);
  assert.equal(s.events[0].kind, "redemption_partial");
  assert.equal(s.events[0].assetsRaw, "20000000");
  assert.equal(s.book.idleRaw, 0n);
  assert.equal(s.book.pendingRedemptions.length, 1, "the rest stays queued");
  assert.ok(vaultAlerts(t, s.book, T0 + 2 * DAY).some((a) => a.code === "REDEMPTION_SHORTFALL"));
});

test("an unvalued position or unknown liability makes NAV unknown and blocks settlement", () => {
  const t = terms();
  let b = dep(t, emptyBook(t, T0), "alice", 100_000000n);
  b = { ...b, positions: [{ positionId: "linear", usdcRaw: null, basis: "no oracle" }] };
  assert.equal(nav(b).navRaw, null);
  const s = settle(t, requestDeposit(t, b, { id: "d", account: "bob", amountRaw: 1_000000n, requestedAt: T0 }), T0);
  assert.equal(s.reasons[0], "NAV_UNKNOWN");
  assert.equal(s.book.pendingDeposits.length, 1, "nothing priced against an unknown NAV");
  assert.equal(vaultAlerts(t, b, T0)[0].code, "NAV_UNKNOWN");
});

test("holder view: value, ownership, attributable exposure, costs and exit terms", () => {
  const t = terms({ fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 8000, platformShareBps: 2000 } });
  let b = dep(t, emptyBook(t, T0), "alice", 75_000000n);
  b = dep(t, b, "bob", 25_000000n);
  b = { ...b, idleRaw: 10_000000n, positions: [{ positionId: "rhea-usdc", usdcRaw: 90_000000n, basis: "Rhea oracle" }] };
  const v = holderView(t, b, "bob", T0);
  assert.equal(v.ownershipBps, 2500);
  assert.ok(Number(v.valueRaw) >= 24_999990 && Number(v.valueRaw) <= 25_000000);
  assert.equal(v.exposure.find((x) => x.positionId === "rhea-usdc")!.usdcRaw, "22500000");
  assert.equal(v.exposure.find((x) => x.positionId === "idle-usdc")!.usdcRaw, "2500000");
  assert.match(v.exit.terms, /first in, first out/);
  assert.equal(v.costs.aboveHwm, false);
  assert.equal(ppsE18(t, 0n, 0n), E18 / 1_000_000n);
});

test("custody mode: only the owner deposits; holder ledger books principal as internal and fees pro rata", () => {
  const t = terms({ mode: "single_depositor", fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 10000, platformShareBps: 0 } });
  assert.throws(() => requestDeposit(t, emptyBook(t, T0), { id: "x", account: "mallory.near", amountRaw: 1n, requestedAt: T0 }), /only from its owner/);
  const s = settle(t, requestDeposit(t, emptyBook(t, T0), { id: "d1", account: "owner.near", amountRaw: 50_000000n, requestedAt: T0 }), T0);
  const l = holderLedger(t, "owner.near", s.events, null, 0n, 0n, new Date(T0).toISOString());
  assert.deepEqual(l.map((e) => [e.kind, e.amountRaw, e.netWorthEffectUsdcRaw]), [["position_entry", "50000000", "0"]]);
  const pooled = terms();
  const fee = { at: T0, navBeforeRaw: "0", ppsBeforeE18: "0", hwmBeforeE18: "0", managementFeeRaw: "1000000", performanceFeeRaw: "0", sharesMinted: { curator: "0", platform: "0" }, ppsAfterE18: "0", hwmAfterE18: "0", basis: "t" };
  const f = holderLedger(pooled, "bob", [], fee, 25n, 100n, new Date(T0).toISOString());
  assert.deepEqual(f.map((e) => [e.kind, e.amountRaw, e.netWorthEffectUsdcRaw]), [["fee", "250000", "-250000"]]);
});
