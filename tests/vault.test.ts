import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { E18, applyReport, assetsFor, cancelDeposit, crystallize, emptyBook, holderLedger, holderView, nav, ppsE18, requestDeposit, requestRedemption, settle, validateTerms, vaultAlerts, type VaultBook, type VaultTerms } from "../lib/flowvault/vault.ts";
import { bookFromViews, disclosures, queueSpots, reconcile, snapshotFrom, termsFromConfig, wasmExports, type AccountView, type ConfigView, type NavView, type RequestView } from "../lib/flowvault/vault-contract.ts";

const T0 = Date.parse("2026-11-13T00:00:00Z");
const DAY = 86_400_000;
const terms = (over: Partial<VaultTerms> = {}): VaultTerms => ({
  id: "v1", specId: "rhea-usdc-pool", specVersion: 1, asset: "USDC", assetDecimals: 6, shareDecimals: 18, virtualShares: 1_000_000_000_000n, virtualAssets: 1n, mode: "pooled",
  fees: { managementBps: 0, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 2000 },
  capacityRaw: 1_000_000_000000n, perDepositorCapRaw: null, maxPositionBps: 8000, redemption: { noticeSeconds: 86_400, liquidityTargetBps: 1000 },
  admin: { owner: "owner.near", curator: "curator.near", pauseGuardian: "guard.near", upgradeAuthority: null, feeRecipients: { curator: "curator.near", platform: "flowvault.near" } },
  ...over,
});
const dep = (t: VaultTerms, b: VaultBook, account: string, amount: bigint, at = T0) => settle(t, requestDeposit(t, b, { id: account + at + amount, account, amountRaw: amount, requestedAt: at }), at).book;

test("terms: fee split, offsets, disclosed keys and custody-mode rules are validated", () => {
  assert.deepEqual(validateTerms(terms()), []);
  assert.ok(validateTerms(terms({ fees: { managementBps: 0, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 1000 } })).length);
  assert.ok(validateTerms(terms({ fees: { managementBps: 200, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 2000 } })).some((x) => /no management fee/.test(x)), "contract v1 has none");
  assert.ok(validateTerms(terms({ virtualShares: 1_000_000n })).some((x) => /match the vault contract/.test(x)));
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

test("fees: contract rounding (up in assets and shares), only above the high-water mark, only on an owner report", () => {
  const t = terms();
  let b = dep(t, emptyBook(t, T0), "alice", 100_000_000000n);
  // A curator report of a 10% gain never mints fees.
  const pos = (usdc: bigint) => [{ positionId: "rhea", usdcRaw: usdc, basis: "t" }];
  let r = applyReport(t, b, { positions: pos(10_000_000000n), liabilitiesRaw: 0n, by: "curator", at: T0 + 1 });
  assert.equal(r.fees, null);
  assert.equal(r.book.totalShares, b.totalShares);
  const waits = settle(t, requestDeposit(t, r.book, { id: "late", account: "bob", amountRaw: 1_000000n, requestedAt: T0 + 1 }), T0 + 1);
  assert.equal(waits.events[0].reason, "OWNER_REPORT_REQUIRED_ABOVE_HWM", "a new depositor never pays a fee on gains made before it joined");
  r = applyReport(t, b, { positions: pos(10_000_000000n), liabilitiesRaw: 0n, by: "owner", at: T0 + 1 });
  assert.equal(settle(t, requestDeposit(t, r.book, { id: "late", account: "bob", amountRaw: 1_000000n, requestedAt: T0 + 1 }), T0 + 1).events[0].kind, "deposit_settled", "after the owner's report the mark equals the price");
  assert.equal(r.fees!.managementFeeRaw, "0");
  // Profit is taken at the floored price, which the virtual offset dilutes by 1e-5: 10% of ≈ 9,999.9 USDC.
  const perf = BigInt(r.fees!.performanceFeeRaw);
  assert.ok(perf >= 999_980000n && perf <= 1_000_000000n, String(perf));
  const minted = BigInt(r.fees!.sharesMinted.curator) + BigInt(r.fees!.sharesMinted.platform);
  assert.ok(assetsFor(t, minted, nav(r.book).navRaw!, r.book.totalShares) >= perf - 1n, "fee shares round up (worth the fee, less at most the floor of the conversion)");
  b = r.book;
  const hwm = b.hwmE18;
  // A loss, then a partial recovery below the mark: no fee, mark unchanged.
  r = applyReport(t, b, { positions: pos(0n), liabilitiesRaw: 0n, by: "owner", at: T0 + 2 });
  r = applyReport(t, r.book, { positions: pos(5_000_000000n), liabilitiesRaw: 0n, by: "owner", at: T0 + 3 });
  assert.equal(r.fees, null);
  assert.equal(r.book.hwmE18, hwm);
  assert.equal(crystallize(t, { ...b, totalShares: 0n }, 1_000000n, T0 + 4).record, null, "no fee minting with no real shares");
});

test("settlement: a deposit over a cap waits (cancel makes it claimable); redemptions settle whole requests strictly FIFO", () => {
  const t = terms({ capacityRaw: 150_000000n, perDepositorCapRaw: 120_000000n, fees: { managementBps: 0, performanceBps: 0, curatorShareBps: 8000, platformShareBps: 2000 } });
  let b = dep(t, emptyBook(t, T0), "alice", 100_000000n);
  let s = settle(t, requestDeposit(t, b, { id: "d2", account: "bob", amountRaw: 60_000000n, requestedAt: T0 }), T0);
  assert.deepEqual([s.events[0].kind, s.events[0].reason], ["deposit_waiting", "CAPACITY"]);
  assert.equal(s.book.pendingDeposits.length, 1, "stays queued, not refunded");
  assert.equal(cancelDeposit(s.book, "d2", "bob").claimable.bob, 60_000000n);
  assert.throws(() => cancelDeposit(s.book, "d2", "mallory"), /Only the depositor/);
  s = settle(t, requestDeposit(t, b, { id: "d3", account: "alice", amountRaw: 30_000000n, requestedAt: T0 }), T0);
  assert.equal(s.events[0].reason, "DEPOSITOR_CAP");
  s = settle(t, requestDeposit(t, b, { id: "d4", account: "carol", amountRaw: 1_000000n, requestedAt: T0, minOutputRaw: 10n ** 30n }), T0);
  assert.equal(s.events[0].reason, "MIN_SHARES");
  // 80 of 100 deployed; alice redeems everything (head), bob's small request behind her can't skip ahead.
  b = dep(t, b, "bob", 10_000000n);
  b = { ...b, idleRaw: 30_000000n, positions: [{ positionId: "rhea-usdc", usdcRaw: 80_000000n, basis: "test" }] };
  b = requestRedemption(t, b, { id: "r1", account: "alice", amountRaw: b.holders.alice, requestedAt: T0 });
  b = requestRedemption(t, b, { id: "r2", account: "bob", amountRaw: b.holders.bob / 10n, requestedAt: T0 });
  assert.equal(settle(t, b, T0 + 1000).events[0].reason, "NOTICE");
  s = settle(t, b, T0 + 2 * DAY);
  assert.deepEqual(s.events.map((e) => [e.kind, e.reason]), [["redemption_waiting", "LIQUIDITY"]], "no partial payment, nothing behind the head");
  assert.equal(s.book.idleRaw, 30_000000n);
  assert.equal(s.book.pendingRedemptions.length, 2);
  assert.ok(vaultAlerts(t, s.book, T0 + 2 * DAY).some((a) => a.code === "REDEMPTION_SHORTFALL"));
  s = settle(t, { ...b, idleRaw: 110_000000n, positions: [] }, T0 + 2 * DAY);
  assert.deepEqual(s.events.map((e) => e.kind), ["redemption_settled", "redemption_settled"]);
  assert.equal(s.book.claimable.alice, 100_000000n);
});

test("an unvalued position or unknown liability makes NAV unknown and blocks settlement", () => {
  const t = terms();
  let b = dep(t, emptyBook(t, T0), "alice", 100_000000n);
  assert.equal(nav({ ...b, navUnavailable: ["NAV_REPORT_STALE_OR_MISSING"] }).navRaw, null, "the contract's own unavailability wins");
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
  assert.match(v.exit.terms, /whole requests only/);
  assert.equal(v.costs.aboveHwm, false);
  assert.equal(ppsE18(t, 0n, 0n), E18 / 1_000_000_000_000n);
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

const fx = JSON.parse(readFileSync(new URL("./fixtures/vault/contract-views.json", import.meta.url), "utf8")) as {
  config: ConfigView; nav: NavView; requests: RequestView[]; accounts: { id: string; view: AccountView; ft: string }[]; fee_log: string[];
};

test("the model reproduces the contract's own run share for share (fixture generated from contracts/vault)", () => {
  const t = termsFromConfig(fx.config, "vault.near");
  assert.deepEqual(validateTerms(t), []);
  const ms = (n: number) => n;
  let b = emptyBook(t, ms(1001));
  b = applyReport(t, b, { positions: [], liabilitiesRaw: 0n, by: "owner", at: 1001 }).book;
  const settleOne = (bk: VaultBook, id: string, account: string, amount: bigint) => {
    const s = settle(t, requestDeposit(t, bk, { id, account, amountRaw: amount, requestedAt: 1101, minOutputRaw: 1n }), 1102);
    assert.equal(s.events[0].kind, "deposit_settled");
    return s.book;
  };
  b = settleOne(b, "0", "alice.near", 30_000000n);
  b = settleOne(b, "1", "bob.near", 10_000000n);
  const rep = applyReport(t, b, { positions: [{ positionId: "rhea", usdcRaw: 4_000000n, basis: "t" }], liabilitiesRaw: 0n, by: "owner", at: 1002 });
  const feeEvent = JSON.parse(fx.fee_log[0].replace("EVENT_JSON:", "")).data[0];
  assert.equal(rep.fees!.performanceFeeRaw, feeEvent.fee_assets_raw);
  assert.equal(rep.fees!.sharesMinted.curator, feeEvent.curator_shares_raw);
  assert.equal(rep.fees!.sharesMinted.platform, feeEvent.platform_shares_raw);
  assert.equal(rep.book.hwmE18.toString(), feeEvent.hwm_e18);
  b = settleOne(rep.book, "2", "carol.near", 7_000001n);
  b = requestRedemption(t, b, { id: "3", account: "bob.near", amountRaw: b.holders["bob.near"] / 2n, requestedAt: 1200 });
  const s = settle(t, b, 1201);
  assert.equal(s.events[0].kind, "redemption_settled");
  for (const a of fx.accounts) assert.equal((s.book.holders[a.id] ?? 0n).toString(), a.ft, a.id);
  assert.equal(s.book.totalShares.toString(), fx.nav.total_shares);
  assert.equal(s.book.idleRaw.toString(), fx.nav.liquid_assets_raw);
  assert.equal(nav(s.book).navRaw!.toString(), fx.nav.nav_raw);
  assert.equal(ppsE18(t, nav(s.book).navRaw!, s.book.totalShares).toString(), fx.nav.pps_e18);
  assert.equal(s.book.claimable["bob.near"].toString(), fx.requests[3].claimable_raw);
});

test("adapter: contract views become the model book with no differences; disclosures and queue spots", () => {
  const accts = fx.accounts.map((a) => a.view);
  const t = termsFromConfig(fx.config, "vault.near");
  const book = bookFromViews(fx.nav, fx.requests, accts);
  assert.deepEqual(reconcile(t, book, fx.nav, accts), []);
  assert.ok(reconcile(t, { ...book, idleRaw: book.idleRaw + 1n }, fx.nav, accts)[0].startsWith("NAV: contract"));
  const stale = bookFromViews({ ...fx.nav, nav_raw: null, pps_e18: null, reasons: ["NAV_REPORT_STALE_OR_MISSING"] }, fx.requests, accts);
  assert.equal(nav(stale).navRaw, null);
  const snap = snapshotFrom({ contractId: "vault.near", source: "example", config: fx.config, nav: fx.nav, requests: fx.requests, accounts: accts, mine: ["bob.near", "owner.near"], operator: null, fullAccessKeys: ["ed25519:hidden"], now: 1300 });
  const bob = snap.holders[0];
  assert.equal(bob.sharesRaw, "5000000000000000000");
  assert.equal(bob.claimableRaw, "5425000");
  assert.equal(bob.costs.managementBps, 0);
  assert.deepEqual(snap.roles, [{ account: "owner.near", role: "owner" }]);
  assert.equal(snap.disclosures.find((d) => d.label === "Code upgrade keys")!.risk, "urgent", "an undisclosed full-access key");
  assert.match(snap.disclosures.find((d) => d.label === "NAV is attested, not proven")!.value, /trusted valuation attestation/);
  assert.ok(disclosures(fx.config, { ...fx.nav, busy: { kind: "supply" } }, [], 0).some((d) => d.label === "Operation in flight"));
  const un = disclosures(fx.config, { ...fx.nav, unresolved: { operation: { kind: "supply" }, since_ms: "1000" }, exit_nav_raw: "40000000" }, [], 0).find((d) => d.label === "Operation unresolved")!;
  assert.equal(un.risk, "urgent");
  assert.match(un.value, /Exits continue.*available now/);
  assert.match(disclosures({ ...fx.config, settlement_timing: "Settlement is permissionless." }, fx.nav, [], 0).find((d) => d.label === "Settlement timing")!.value, /at most 900 s/);
  const q: RequestView[] = [
    { ...fx.requests[3], id: "7", owner_id: "zed.near", status: "queued", amount_raw: "4" },
    { ...fx.requests[3], id: "9", owner_id: "bob.near", status: "queued", amount_raw: "2" },
  ];
  assert.deepEqual(queueSpots(q, "bob.near").map((x) => [x.requestId, x.ahead, x.sharesAheadRaw]), [["9", 1, "4"]]);
});

test("wasm exports: function names are read from the export section", () => {
  const name = (s: string) => [s.length, ...new TextEncoder().encode(s)];
  const body = [2, ...name("get_config"), 0, 0, ...name("memory"), 2, 0];
  const mod = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 7, body.length, ...body]);
  assert.deepEqual(wasmExports(mod), ["get_config"]);
  assert.throws(() => wasmExports(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /Not a wasm/);
});

test("example vault: built through the model, consistent with its own contract views, never live", async () => {
  const { exampleVault, EXAMPLE_HOLDER } = await import("../lib/flowvault/vault-example.ts");
  const v = exampleVault(Date.parse("2026-11-13T12:00:00Z"));
  assert.equal(v.source, "example");
  assert.deepEqual(v.differences, []);
  const you = v.holders.find((h) => h.account === EXAMPLE_HOLDER)!;
  assert.equal(you.queue.length, 1);
  assert.equal(you.queue[0].ahead, 1, "bob's request is ahead");
  assert.ok(BigInt(you.queued.redemptionSharesRaw) > 0n);
  assert.deepEqual(v.roles.map((r) => r.role), ["curator"]);
  assert.ok(v.disclosures.every((d) => d.risk !== "urgent"));
});

test("snapshots are JSON-safe (no bigints reach the API response)", async () => {
  const { exampleVault } = await import("../lib/flowvault/vault-example.ts");
  assert.doesNotThrow(() => JSON.stringify(exampleVault()));
});
