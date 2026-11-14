import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionHash, addressOf, approveAgentAction, bytesToHex, checkPerpOrder, l1TypedData, msgpack, orderAction, orderStatus,
  orderWire, parseClearinghouse, parseMeta, perpLedger, perpPortfolioPositions, protectiveOrders, realizedPerpResult,
  recoverTyped, resolveHedge, roundPx, roundSz, signTyped, toRaw, tpslProblem, userTypedData, withdrawAction, wire, type OrderIntent,
} from "../lib/flowvault/hyperliquid.ts";
import { draftMandate, mandateDigest, transition } from "../lib/flowvault/mandate.ts";
import { authorityFor } from "../lib/flowvault/mandate-authority.ts";
import { STRATEGY_SPECS } from "../lib/flowvault/strategy-spec.ts";
import type { AgentMandate } from "../lib/flowvault/contracts.ts";

// The hyperliquid-python-sdk test key and expected signatures (tests/signing_test.py).
const SDK_KEY = Uint8Array.from(Buffer.from("0123456789012345678901234567890123456789012345678901234567890123", "hex"));

test("signing matches the official SDK vectors: L1 order (mainnet + testnet) and user-signed withdraw", () => {
  const action = { type: "order", orders: [{ a: 1, b: true, p: "100", s: "100", r: false, t: { limit: { tif: "Gtc" } } }], grouping: "na" };
  const main = signTyped(l1TypedData(action, 0, true), SDK_KEY);
  assert.deepEqual(main, { r: "0xd65369825a9df5d80099e513cce430311d7d26ddf477f5b3a33d2806b100d78e", s: "0x2b54116ff64054968aa237c20ca9ff68000f977c93289157748a3162b6ea940e", v: 28 });
  const testnet = signTyped(l1TypedData(action, 0, false), SDK_KEY);
  assert.deepEqual(testnet, { r: "0x82b2ba28e76b3d761093aaded1b1cdad4960b3af30212b343fb2e6cdfa4e3d54", s: "0x6b53878fc99d26047f4d7e8c90eb98955a109f44209163f52d8dc4278cbbd9f5", v: 27 });
  const w = { ...withdrawAction("0x5e9ee1089755c3435139848e47e6635505d5a13a", "1", 1687816341423, 0x66eee), hyperliquidChain: "Testnet" };
  assert.deepEqual(signTyped(userTypedData(w), SDK_KEY), { r: "0x8363524c799e90ce9bc41022f7c39b4e9bdba786e5f9c72b20e43e1462c37cf9", s: "0x58b1411a775938b83e29182e8ef74975f9054c8e97ebf5ec2dc8d51bfc893881", v: 28 });
});

test("approveAgent typed data recovers to the master; a different signer is detected", () => {
  const master = SDK_KEY;
  const agentKey = Uint8Array.from(Buffer.alloc(32, 7));
  const a = approveAgentAction(addressOf(agentKey), "flowvault valid_until 1790000000000", 1763000000000, 42161);
  assert.equal(a.signatureChainId, "0xa4b1");
  const t = userTypedData(a);
  assert.equal(t.primaryType, "HyperliquidTransaction:ApproveAgent");
  assert.equal(recoverTyped(t, signTyped(t, master)), addressOf(master));
  assert.notEqual(recoverTyped(t, signTyped(t, agentKey)), addressOf(master));
});

test("msgpack: smallest encodings, insertion order, no floats", () => {
  assert.equal(bytesToHex(msgpack({ a: 1, b: true })), "0x82a16101a162c3");
  assert.equal(bytesToHex(msgpack(200)), "0xcc" + "c8");
  assert.equal(bytesToHex(msgpack(-1)), "0xff");
  assert.equal(bytesToHex(msgpack("x".repeat(40))).slice(0, 6), "0xd928");
  assert.throws(() => msgpack(1.5), /Floats/);
  // vault flag and expiresAfter change the hash
  const h = (v: string | null, e: number | null) => bytesToHex(actionHash({ type: "cancel" }, 5, v, e));
  assert.notEqual(h(null, null), h("0x" + "11".repeat(20), null));
  assert.notEqual(h(null, null), h(null, 99));
});

test("wire numbers and price/size rules (5 significant figures, 6 − szDecimals decimals)", () => {
  assert.equal(wire("100.000"), "100");
  assert.equal(wire("-0.0"), "0");
  assert.equal(roundPx("1234.567", 2, "down"), "1234.5");
  assert.equal(roundPx("1234.567", 2, "up"), "1234.6");
  assert.equal(roundPx("123456.7", 5, "down"), "123456");
  assert.equal(roundPx("0.0123456", 0, "down"), "0.012345");
  assert.equal(roundSz("0.123456", 4), "0.1234");
  assert.throws(() => roundSz("0.00001", 4), /rounds to zero/);
  assert.equal(toRaw("1.0000009", 6, "up"), 1000001n);
  assert.equal(toRaw("-2.5", 6), -2500000n);
});

const META = parseMeta({ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }, { name: "ETH", szDecimals: 4, maxLeverage: 25 }, { name: "OLD", szDecimals: 1, maxLeverage: 3, isDelisted: true }] });
const CLOID = "0x" + "ab".repeat(16);
const intent = (over: Partial<OrderIntent> = {}): OrderIntent => ({ coin: "ETH", isBuy: true, size: "0.05", kind: "market", reduceOnly: false, cloid: CLOID, ...over });

test("order wire: market = IOC bounded by slippage; triggers bound the fill; delisted and bad cloids refused", () => {
  const eth = META[1];
  const w = orderWire(intent(), eth, "3000", 50);
  assert.deepEqual(w, { a: 1, b: true, p: "3015", s: "0.05", r: false, t: { limit: { tif: "Ioc" } }, c: CLOID });
  assert.equal(orderWire(intent({ isBuy: false }), eth, "3000", 50).p, "2985");
  const sl = orderWire(intent({ kind: "stop_loss", isBuy: false, price: "2800", reduceOnly: true }), eth, null, 100);
  assert.deepEqual(sl.t, { trigger: { isMarket: true, triggerPx: "2800", tpsl: "sl" } });
  assert.equal(sl.p, "2772");
  assert.throws(() => orderWire(intent(), eth, null, 50), /No mid price/);
  assert.throws(() => orderWire(intent(), META[2], "1", 50), /delisted/);
  assert.throws(() => orderWire(intent({ cloid: "x" }), eth, "1", 50), /cloid/);
  assert.equal(orderAction([w]).grouping, "na");
});

test("exchange responses: filled, resting, rejected; anything else is unknown, never failed", () => {
  assert.deepEqual(orderStatus({ status: "ok", response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.05", avgPx: "3001", oid: 9 } }] } } }), { state: "filled", oid: 9, avgPx: "3001", filledSz: "0.05" });
  assert.equal(orderStatus({ status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 1 } }] } } }).state, "resting");
  assert.equal(orderStatus({ status: "ok", response: { type: "order", data: { statuses: [{ error: "Insufficient margin" }] } } }).state, "rejected");
  assert.equal(orderStatus({ status: "err", response: "User or API Wallet does not exist." }).state, "rejected");
  assert.equal(orderStatus(undefined).state, "unknown");
  assert.equal(orderStatus({ status: "ok", response: { data: { statuses: [{ waitingForTrigger: {} }] } } }).state, "unknown");
});

const CH = (over: { value?: string; upnl?: string; szi?: string } = {}) => ({
  marginSummary: { accountValue: over.value ?? "1000.5", totalNtlPos: "1500.0", totalMarginUsed: "300.0" },
  crossMaintenanceMarginUsed: "30.0",
  withdrawable: "700.25",
  assetPositions: [{ position: { coin: "ETH", szi: over.szi ?? "-0.5", entryPx: "3100.0", positionValue: "1500.0", unrealizedPnl: over.upnl ?? "50.0", liquidationPx: "4800.0", leverage: { type: "cross", value: 5 }, marginUsed: "300.0", cumFunding: { sinceOpen: "-1.25" } } }],
  time: Date.parse("2026-11-13T10:00:00Z"),
});

test("snapshot: USDC base units; positive uPnL never counts as equity or spendable; margin is collateral", () => {
  const s = parseClearinghouse("0xABC", CH());
  assert.equal(s.accountValueUsdcRaw, "1000500000");
  assert.equal(s.unrealizedPnlUsdcRaw, "50000000");
  assert.equal(s.realizedEquityUsdcRaw, "950500000");
  assert.equal(s.positions[0].markPx, "3000");
  const [p] = perpPortfolioPositions(s, "evm:0xabc");
  assert.equal(p.kind, "collateral");
  assert.equal(p.amount, "950.5");
  // A loss already reduces account value and is not added back.
  assert.equal(parseClearinghouse("0xabc", CH({ value: "900", upnl: "-50" })).realizedEquityUsdcRaw, "900000000");
  assert.deepEqual(perpPortfolioPositions(parseClearinghouse("0xabc", { ...CH({ value: "0" }), assetPositions: [] }), "x"), []);
});

const NOW = Date.parse("2026-11-13T10:00:30Z");
function perpMandate(over: Partial<AgentMandate> = {}): AgentMandate {
  const d = draftMandate({ id: "p1", accountId: "alice.near", source: "live", now: NOW - 3600_000, reserveUsdcRaw: "0", strategy: STRATEGY_SPECS[0] });
  const m: AgentMandate = {
    ...d,
    scope: { ...d.scope, actions: ["perp_order", "perp_reduce"], assets: [{ asset: "ETH", chain: "hyperliquid" }] },
    limits: { ...d.limits, capitalUsdcRaw: "600000000", perActionUsdcRaw: "500000000", dailyUsdcRaw: "1000000000", maxSlippageBps: 50, maxStrategyLossUsdcRaw: "100000000" },
    authority: { ...authorityFor("hyperliquid_agent"), status: "verified" },
    perps: { assets: ["ETH"], maxLeverage: 5, maxNotionalUsdcRaw: "500000000", minLiquidationDistanceBps: 2000 },
    ...over,
  };
  const s = { ...m, approval: { digest: mandateDigest(m), signedBy: "alice.near", publicKey: "k", signedAt: "", method: "nep413" as const } };
  return transition(transition(s, "approved", new Date(NOW).toISOString()), "active", new Date(NOW).toISOString());
}
const ids = (r: ReturnType<typeof checkPerpOrder>) => r.checks.filter((c) => c.ok !== true).map((c) => c.id);
const base = (over: Partial<Parameters<typeof checkPerpOrder>[0]> = {}) => ({
  mandate: perpMandate(), limits: perpMandate().perps, snapshot: parseClearinghouse("0xabc", CH({ upnl: "-5" })), meta: META, midPx: "3000",
  intent: intent({ size: "0.05" }), leverage: 3, todayNotionalUsdcRaw: "0", realizedLossUsdcRaw: "0", now: NOW, agentVerified: true, ...over,
});

test("perp checks: leverage, order size, margin, loss stop, liquidation cushion, agent and freshness", () => {
  assert.deepEqual(ids(checkPerpOrder(base())), []);
  assert.equal(checkPerpOrder(base()).notionalUsdcRaw, "150000000");
  assert.ok(ids(checkPerpOrder(base({ leverage: 10 }))).includes("leverage"));
  assert.ok(ids(checkPerpOrder(base({ intent: intent({ size: "0.2" }) }))).includes("notional"));
  assert.ok(ids(checkPerpOrder(base({ intent: intent({ size: "0.15" }), leverage: 1 }))).includes("capital"));
  assert.ok(ids(checkPerpOrder(base({ realizedLossUsdcRaw: "96000000" }))).includes("strategy_loss"));
  assert.ok(ids(checkPerpOrder(base({ snapshot: parseClearinghouse("0xabc", CH({ value: "200", upnl: "-5" })) }))).includes("liquidation_distance"));
  assert.ok(ids(checkPerpOrder(base({ agentVerified: false }))).includes("agent"));
  assert.ok(ids(checkPerpOrder(base({ now: NOW + 600_000 }))).includes("snapshot_fresh"));
  assert.ok(ids(checkPerpOrder(base({ intent: intent({ coin: "BTC" }) }))).includes("asset"));
  // Reduce-only must actually reduce: position is short 0.5 ETH, so a buy of ≤ 0.5 reduces.
  assert.deepEqual(ids(checkPerpOrder(base({ intent: intent({ reduceOnly: true, size: "0.5" }) }))), []);
  assert.ok(ids(checkPerpOrder(base({ intent: intent({ reduceOnly: true, isBuy: false, size: "0.1" }) }))).includes("reduces_position"));
  assert.ok(ids(checkPerpOrder(base({ intent: intent({ reduceOnly: true, size: "0.6" }) }))).includes("reduces_position"));
  // Reduce-only is allowed even when the loss stop is hit (it lowers risk).
  assert.deepEqual(ids(checkPerpOrder(base({ realizedLossUsdcRaw: "999000000", intent: intent({ reduceOnly: true, size: "0.5" }) }))), []);
});

test("protective deleveraging: loss stop closes all; thin cushion halves the largest; healthy does nothing", () => {
  const limits = perpMandate().perps!;
  const cloid = () => CLOID;
  const stop = protectiveOrders({ snapshot: parseClearinghouse("0xabc", CH({ upnl: "-120" })), meta: META, limits, maxLossUsdcRaw: "100000000", realizedLossUsdcRaw: "0", cloid });
  assert.match(stop.reason!, /closing every position/);
  assert.deepEqual(stop.orders.map((o) => [o.coin, o.isBuy, o.size, o.reduceOnly]), [["ETH", true, "0.5", true]]);
  const thin = protectiveOrders({ snapshot: parseClearinghouse("0xabc", CH({ value: "250", upnl: "-1" })), meta: META, limits, maxLossUsdcRaw: "100000000", realizedLossUsdcRaw: "0", cloid });
  assert.match(thin.reason!, /halving ETH/);
  assert.equal(thin.orders[0].size, "0.25");
  assert.deepEqual(protectiveOrders({ snapshot: parseClearinghouse("0xabc", CH({ upnl: "-1" })), meta: META, limits, maxLossUsdcRaw: "100000000", realizedLossUsdcRaw: "0", cloid }).orders, []);
});

test("hedge legs: unreachable leg freezes; known failure unwinds only the excess; never retries the missing leg", () => {
  assert.equal(resolveHedge([{ venue: "near-spot", targetRaw: "100", filledRaw: "100", state: "filled" }, { venue: "hyperliquid", targetRaw: "-100", filledRaw: null, state: "unknown" }]).action, "freeze");
  const r = resolveHedge([{ venue: "near-spot", targetRaw: "100", filledRaw: "100", state: "filled" }, { venue: "hyperliquid", targetRaw: "-100", filledRaw: "-40", state: "partial" }]);
  assert.deepEqual([r.action, r.venue, r.excessRaw], ["unwind_excess", "near-spot", "60"]);
  assert.equal(resolveHedge([{ venue: "a", targetRaw: "1", filledRaw: "1", state: "filled" }, { venue: "b", targetRaw: "-1", filledRaw: "0", state: "failed" }]).excessRaw, "1");
  assert.equal(resolveHedge([{ venue: "a", targetRaw: "1", filledRaw: "1", state: "filled" }, { venue: "b", targetRaw: "-1", filledRaw: "-1", state: "filled" }]).action, "none");
  assert.equal(resolveHedge([{ venue: "a", targetRaw: "1", filledRaw: "0", state: "pending" }, { venue: "b", targetRaw: "-1", filledRaw: "-1", state: "filled" }]).action, "wait");
});

test("reconciliation: fees, realized PnL, funding and transfers become ledger entries with stable ids", () => {
  const fills = [
    { coin: "ETH", px: "3000", sz: "0.5", side: "A", time: NOW, dir: "Open Short", closedPnl: "0.0", hash: "0xh1", oid: 1, fee: "0.675", feeToken: "USDC", tid: 11 },
    { coin: "ETH", px: "2900", sz: "0.5", side: "B", time: NOW + 1, dir: "Close Short", closedPnl: "50.0", hash: "0xh2", oid: 2, fee: "0.6525", feeToken: "USDC", tid: 12 },
  ];
  const funding = [{ time: NOW, hash: "0xf1", delta: { type: "funding", coin: "ETH", usdc: "-0.42", szi: "-0.5", fundingRate: "0.0000125" } }];
  const transfers = [{ time: NOW - 10, hash: "0xd", delta: { type: "deposit", usdc: "1000.0" } }, { time: NOW + 5, hash: "0xw", delta: { type: "withdraw", usdc: "100.0", fee: "1.0" } }];
  const l = perpLedger("0xABC", fills, funding, transfers);
  const by = Object.fromEntries(l.map((e) => [e.id, e]));
  assert.equal(by["hl:11:fee"].netWorthEffectUsdcRaw, "-675000");
  assert.equal(by["hl:12:fee"].netWorthEffectUsdcRaw, "-652500");
  assert.equal(by["hl:12:pnl"].kind, "valuation_change");
  assert.equal(by["hl:12:pnl"].netWorthEffectUsdcRaw, "50000000");
  assert.equal(by["hl:11:pnl"], undefined);
  const f = l.find((e) => e.id.startsWith("hl:funding"))!;
  assert.deepEqual([f.kind, f.netWorthEffectUsdcRaw], ["interest", "-420000"]);
  assert.equal(by["hl:deposit:0xd"].netWorthEffectUsdcRaw, "0");
  assert.equal(by["hl:withdraw:0xw:fee"].netWorthEffectUsdcRaw, "-1000000");
  // Realized result = 50 − 0.675 − 0.6525 − 0.42 − 1 (withdraw fee); transfers excluded.
  assert.equal(realizedPerpResult(l), 47252500n);
  assert.deepEqual(perpLedger("0xabc", fills, funding, transfers).map((e) => e.id), l.map((e) => e.id));
});

import { DatabaseSync } from "node:sqlite";
import { newAgentKey, openAgentKey } from "../lib/flowvault/perps-keys.ts";
import { PERP_TABLES, ORDER_INSERT, ORDER_ADVANCE, ORDER_OPEN, LINK_UPSERT, LINK_GET } from "../lib/flowvault/perps-sql.ts";
import { draftPerpMandate } from "../lib/flowvault/hyperliquid.ts";
import { validateMandate } from "../lib/flowvault/mandate.ts";

test("agent key custody: sealed under the server secret and its row binding; no secret, no key", async () => {
  const secret = "x".repeat(40);
  const k = await newAgentKey(secret, (a) => "ws|0xmaster|" + a);
  const priv = await openAgentKey(secret, "ws|0xmaster|" + k.address, k.sealed, k.address);
  assert.equal(addressOf(priv), k.address);
  await assert.rejects(openAgentKey(secret, "other|0xmaster|" + k.address, k.sealed, k.address));
  await assert.rejects(openAgentKey("y".repeat(40), "ws|0xmaster|" + k.address, k.sealed, k.address));
  await assert.rejects(newAgentKey("short", (a) => a), /FLOWVAULT_AGENT_KEY_SECRET/);
  const k2 = await newAgentKey(secret, (a) => a);
  assert.notEqual(k2.address, k.address);
});

test("order journal: cloid is the idempotency key; state advances only from the state read", () => {
  const db = new DatabaseSync(":memory:");
  for (const s of PERP_TABLES) db.exec(s);
  assert.equal(db.prepare(ORDER_INSERT).run(CLOID, "ws", "0xm", "prepared", "{}", "t").changes, 1);
  assert.equal(db.prepare(ORDER_INSERT).run(CLOID, "ws", "0xm", "prepared", "{}", "t").changes, 0);
  assert.equal(db.prepare(ORDER_ADVANCE).run("submitted", "{}", CLOID, "ws", "prepared").changes, 1);
  assert.equal(db.prepare(ORDER_ADVANCE).run("filled", "{}", CLOID, "ws", "prepared").changes, 0);
  assert.equal(db.prepare(ORDER_ADVANCE).run("unknown", "{}", CLOID, "ws", "submitted").changes, 1);
  assert.equal(db.prepare(ORDER_OPEN).all("ws").length, 1);
  assert.equal(db.prepare(LINK_UPSERT).run("ws", "0xm", '{"v":1}', "sealed", 0).changes, 1);
  assert.equal(db.prepare(LINK_UPSERT).run("ws", "0xm", '{"v":2}', null, 0).changes, 1);
  assert.equal(db.prepare(LINK_UPSERT).run("ws", "0xm", '{"v":3}', null, 0).changes, 0); // stale revision
  assert.equal((db.prepare(LINK_GET).get("ws", "0xm") as { payload: string }).payload, '{"v":2}');
});

test("perps mandate draft: names the agent in the signed terms, validates, and perp actions need limits", () => {
  const base = draftMandate({ id: "x", accountId: "alice.near", source: "live", now: NOW, reserveUsdcRaw: "0", strategy: STRATEGY_SPECS[0] });
  const m = draftPerpMandate({ id: "x", accountId: "alice.near", master: "0xABCDEF0000000000000000000000000000000001", agent: { address: "0x1111111111111111111111111111111111111111", name: "flowvault valid_until 1", validUntil: NOW + 10 * 864e5 }, now: NOW, base });
  assert.deepEqual(validateMandate(m, STRATEGY_SPECS), []);
  assert.equal(m.validUntil, new Date(NOW + 10 * 864e5).toISOString()); // never outlives the agent
  assert.ok(m.scope.accounts.includes("evm:0xabcdef0000000000000000000000000000000001"));
  const other = { ...m, authority: { ...m.authority, delegate: { ...m.authority.delegate!, address: "0x2222222222222222222222222222222222222222" } } };
  assert.notEqual(mandateDigest(m), mandateDigest(other));
  assert.match(validateMandate({ ...m, perps: undefined }).join(), /need perp limits/);
  assert.match(validateMandate({ ...m, perps: { ...m.perps!, maxLeverage: 50 } }).join(), /1 to 20/);
});

test("take profit and stop loss have to sit on the right side of the entry for a long and a short", () => {
  assert.equal(tpslProblem(true, "3000", "3300", "2900"), null);
  assert.equal(tpslProblem(false, "3000", "2700", "3100"), null);
  assert.equal(tpslProblem(true, "3000", undefined, "2900"), null);
  assert.match(tpslProblem(true, "3000", "2950")!, /Take profit 2950 has to be above/);
  assert.match(tpslProblem(true, "3000", undefined, "3000")!, /Stop loss 3000 has to be below/);
  assert.match(tpslProblem(false, "3000", "3100")!, /Take profit 3100 has to be below/);
  assert.match(tpslProblem(false, "3000", undefined, "2900")!, /Stop loss 2900 has to be above/);
  assert.match(tpslProblem(true, "0", "1")!, /No entry price/);
});
