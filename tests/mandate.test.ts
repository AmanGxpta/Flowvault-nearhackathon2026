import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  applyClock, approvalMessage, canonicalJson, checkAction, decide, draftMandate, mandateDigest, planOutcome,
  transition, usageFrom, validateMandate, type MandateObservation, type ProposedAction, type UsageEvent,
} from "../lib/flowvault/mandate.ts";
import { authorityFor, functionCallKeyCanCall, DELEGATION_OPTIONS } from "../lib/flowvault/mandate-authority.ts";
import { MANDATE_TABLES, MANDATE_INSERT, MANDATE_CAS, MANDATE_DUE, AUDIT_APPEND, AUDIT_LIST, KILL_SET, KILL_GET } from "../lib/flowvault/mandate-sql.ts";
import { STRATEGY_SPECS } from "../lib/flowvault/strategy-spec.ts";
import type { ActionPlan, AgentMandate, PlanStep } from "../lib/flowvault/contracts.ts";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const AT = new Date(NOW).toISOString();
const M = 1_000000n;
const RHEA = "contract.main.burrow.near";
const rhea = STRATEGY_SPECS.find((s) => s.id === "rhea-usdc-surplus")!;

function signed(over: Partial<AgentMandate> = {}): AgentMandate {
  const m = { ...draftMandate({ id: "m1", accountId: "alice.near", source: "live", now: NOW - 3600_000, reserveUsdcRaw: (50n * M).toString(), strategy: rhea }), ...over };
  return { ...m, approval: { digest: mandateDigest(m), signedBy: "alice.near", publicKey: "ed25519:x", signedAt: AT, method: "nep413" } };
}
function active(over: Partial<AgentMandate> = {}) {
  return transition(transition(signed(over), "approved", AT), "active", AT);
}
function obs(over: Partial<MandateObservation> = {}, cap: Partial<MandateObservation["capital"]> = {}, usage: Partial<MandateObservation["usage"]> = {}): MandateObservation {
  return {
    now: NOW,
    capital: {
      spendableNowUsdcRaw: (500n * M).toString(), holdbackUsdcRaw: (200n * M).toString(), surplusUsdcRaw: (300n * M).toString(),
      reserveUsdcRaw: (50n * M).toString(), netWorthUsdcRaw: (1000n * M).toString(), debtUsdcRaw: "0", blocksAutomation: false, capturedAt: AT, reasons: [], ...cap,
    },
    horizonDays: 30,
    obligations: [{ id: "rent", dueDate: "2026-11-20", reserveUsdcRaw: (150n * M).toString() }],
    exposure: [{ positionId: "w", venue: "wallet", protocol: "wallet", chain: "near", usdcRaw: (500n * M).toString() }],
    recallable: [],
    uncertain: [],
    killSwitch: false,
    usage: { cumulativeUsdcRaw: "0", todayUsdcRaw: "0", todayActions: 0, deployedUsdcRaw: "0", realizedLossUsdcRaw: "0", unrealizedLossUsdcRaw: "0", openPlanIds: [], ...usage },
    ...over,
  };
}
const failed = (r: ReturnType<typeof checkAction>) => r.checks.filter((c) => c.ok !== true).map((c) => c.id);

test("lifecycle: draft → approved needs a signature; active needs signed terms that match; terminal states stay terminal", () => {
  const d = draftMandate({ id: "m1", accountId: "alice.near", source: "live", now: NOW, reserveUsdcRaw: "0", strategy: rhea });
  assert.throws(() => transition(d, "approved", AT), /signature/);
  assert.throws(() => transition(d, "active", AT), /cannot become active/);
  const s = signed();
  const a = active();
  assert.equal(a.state, "active");
  assert.ok(a.schedule.nextRunAt);
  // Changing a term after signing breaks activation.
  const changed = { ...transition(s, "approved", AT), limits: { ...s.limits, capitalUsdcRaw: (999n * M).toString() } };
  assert.throws(() => transition(changed, "active", AT), /signed terms don't match/);
  const p = transition(a, "paused", AT);
  assert.equal(p.schedule.nextRunAt, null);
  const r = transition(p, "revoked", AT);
  assert.throws(() => transition(r, "active", AT), /revoked mandate cannot/);
  assert.throws(() => transition({ ...transition(s, "approved", AT), frozen: { at: AT, reason: "x", ref: null } }, "active", AT), /frozen/);
  // Back to draft drops the approval.
  assert.equal(transition(p, "draft", AT).approval, null);
  // The clock expires it.
  assert.equal(applyClock(a, Date.parse(a.validUntil) + 1).state, "expired");
});

test("digest: canonical (key order independent), covers terms but not runtime fields; message names the digest", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const a = active();
  assert.equal(mandateDigest(a), mandateDigest({ ...a, state: "paused", schedule: { ...a.schedule, lastRunAt: AT }, frozen: { at: AT, reason: "x", ref: null } }));
  assert.notEqual(mandateDigest(a), mandateDigest({ ...a, borrowing: { ...a.borrowing, allowed: true } }));
  assert.notEqual(mandateDigest(a), mandateDigest({ ...a, version: 2 }));
  assert.match(approvalMessage(a), new RegExp(mandateDigest(a)));
  assert.match(approvalMessage(a), /Borrowing: not allowed/);
});

test("validation: contradictory limits, scope and authority are refused", () => {
  assert.deepEqual(validateMandate(signed(), STRATEGY_SPECS), []);
  const bad = signed({
    limits: { ...signed().limits, perActionUsdcRaw: (200n * M).toString(), dailyUsdcRaw: (100n * M).toString() },
    scope: { ...signed().scope, recipients: ["$owner", "bob.near"], actions: ["perp_order"], strategies: ["nope"] },
  });
  const p = validateMandate(bad, STRATEGY_SPECS).join(" | ");
  assert.match(p, /Per-action limit is above the daily limit/);
  assert.match(p, /need spending to be allowed/);
  assert.match(p, /Hyperliquid agent wallet/);
  assert.match(p, /Unknown strategy nope/);
  assert.match(validateMandate(signed({ validUntil: new Date(NOW + 200 * 864e5).toISOString() })).join(), /at most 90 days/);
  assert.match(validateMandate(signed({ borrowing: { allowed: false, maxDebtUsdcRaw: "5", minHealth: "1.5" } })).join(), /contradictory/);
  assert.match(validateMandate(signed({ source: "demo", authority: authorityFor("hyperliquid_agent") })).join(), /Example mandates cannot hold delegated authority/);
});

test("decide: stops before anything on kill switch, open plan or missing evidence; freezes on uncertain operations", () => {
  const m = active();
  assert.match(decide(m, obs({ killSwitch: true }), STRATEGY_SPECS).stop!, /Kill switch/);
  assert.match(decide(m, obs({ uncertain: [{ ref: "attempt a1", state: "unknown" }] }), STRATEGY_SPECS).freeze!, /uncertain/);
  assert.match(decide(m, obs({}, {}, { openPlanIds: ["p1"] }), STRATEGY_SPECS).stop!, /still open/);
  assert.match(decide(m, obs({}, { holdbackUsdcRaw: null, blocksAutomation: true, reasons: ["rent: unvalued"] }), STRATEGY_SPECS).stop!, /Missing evidence: rent: unvalued/);
  assert.match(decide(m, obs({}, { capturedAt: new Date(NOW - 3600_000).toISOString() }), STRATEGY_SPECS).stop!, /older than the mandate allows/);
  assert.match(decide(transition(m, "paused", AT), obs(), STRATEGY_SPECS).stop!, /paused/);
});

test("decide: deploys the smallest of surplus, capital room, per-action, daily and lifetime room — never more", () => {
  const m = active(); // capital 100, per action 50, daily 100, lifetime 1000
  let d = decide(m, obs(), STRATEGY_SPECS);
  assert.equal(d.actions[0].kind, "deploy_surplus");
  assert.equal(d.actions[0].amountUsdcRaw, (50n * M).toString());
  assert.deepEqual(d.actions[0].methods, [{ receiver: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", method: "ft_transfer_call" }]);
  d = decide(m, obs({}, { surplusUsdcRaw: (12n * M).toString() }), STRATEGY_SPECS);
  assert.equal(d.actions[0].amountUsdcRaw, (12n * M).toString());
  d = decide(m, obs({}, {}, { deployedUsdcRaw: (90n * M).toString() }), STRATEGY_SPECS);
  assert.equal(d.actions[0].amountUsdcRaw, (10n * M).toString());
  d = decide(m, obs({}, {}, { todayUsdcRaw: (95n * M).toString() }), STRATEGY_SPECS);
  assert.equal(d.actions[0].amountUsdcRaw, (5n * M).toString());
  d = decide(m, obs({}, { surplusUsdcRaw: "500000" }), STRATEGY_SPECS); // 0.5 USDC < 1 USDC strategy minimum
  assert.equal(d.actions.length, 0);
  assert.match(d.notes.join(), /below its 1 minimum/);
});

test("decide: recalls for obligations, keeps allocation, exits on the loss limit; research can only veto with a source", () => {
  const m = active();
  const deployed = { deployedUsdcRaw: (80n * M).toString() };
  const rec = [{ venue: RHEA, strategyId: rhea.id, usdcRaw: (80n * M).toString() }];
  let d = decide(m, obs({ recallable: rec }, { spendableNowUsdcRaw: (150n * M).toString(), holdbackUsdcRaw: (200n * M).toString(), surplusUsdcRaw: "0" }, deployed), STRATEGY_SPECS);
  assert.equal(d.actions[0].kind, "recall_for_obligation");
  assert.equal(d.actions[0].amountUsdcRaw, (50n * M).toString());
  assert.equal(d.actions[0].deadline, "2026-11-20");
  assert.deepEqual(d.actions[0].methods, [{ receiver: RHEA, method: "execute" }]);
  const lowered = active({ limits: { ...signed().limits, capitalUsdcRaw: (60n * M).toString(), perActionUsdcRaw: (50n * M).toString() } });
  d = decide(lowered, obs({ recallable: rec }, {}, deployed), STRATEGY_SPECS);
  assert.equal(d.actions[0].kind, "keep_allocation");
  assert.equal(d.actions[0].amountUsdcRaw, (20n * M).toString());
  d = decide(m, obs({ recallable: rec }, {}, { ...deployed, realizedLossUsdcRaw: (3n * M).toString(), unrealizedLossUsdcRaw: (2n * M).toString() }), STRATEGY_SPECS);
  assert.equal(d.actions[0].kind, "protective_exit");
  assert.equal(d.actions[0].amountUsdcRaw, (80n * M).toString());
  // Unknown position value with capital deployed → protective exit, not more risk.
  d = decide(m, obs({ recallable: rec }, {}, { ...deployed, unrealizedLossUsdcRaw: null }), STRATEGY_SPECS);
  assert.equal(d.actions[0].kind, "protective_exit");
  // Advice: unsourced is ignored; sourced pause stops new risk but never sizes anything.
  d = decide(m, obs(), STRATEGY_SPECS, [{ claim: "Rhea looks risky", sourceUrl: null, capturedAt: AT, effect: "pause_new_risk" }]);
  assert.equal(d.actions[0].kind, "deploy_surplus");
  assert.match(d.notes.join(), /Ignored unsourced advice/);
  d = decide(m, obs(), STRATEGY_SPECS, [{ claim: "Oracle incident", sourceUrl: "https://status.example/incident", capturedAt: AT, effect: "pause_new_risk" }]);
  assert.equal(d.actions.length, 0);
  assert.match(d.stop!, /paused new risk/);
});

const deployAction = (amount: bigint, over: Partial<ProposedAction> = {}): ProposedAction => ({
  kind: "deploy_surplus", strategyId: rhea.id, asset: "USDC", chain: "near", venue: RHEA, protocol: RHEA,
  methods: [{ receiver: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", method: "ft_transfer_call" }],
  recipient: "$owner", amountUsdcRaw: amount.toString(), costUsdcRaw: "0", slippageBps: 0, quoteCapturedAt: AT, borrows: false, spends: false, exitHours: 0, reason: "t", ...over,
});

test("check: a clean deploy passes; limits, reserve floor and concentration block", () => {
  const m = active();
  assert.deepEqual(failed(checkAction(m, obs(), deployAction(50n * M))), []);
  assert.ok(failed(checkAction(m, obs(), deployAction(60n * M))).includes("per_action"));
  assert.ok(failed(checkAction(m, obs({}, {}, { todayActions: 2 }), deployAction(10n * M))).includes("actions_per_day"));
  assert.ok(failed(checkAction(m, obs({}, {}, { cumulativeUsdcRaw: (995n * M).toString() }), deployAction(10n * M))).includes("cumulative"));
  // Mandate floor stricter than the workspace holdback.
  const strict = active({ protection: { reserveFloorUsdcRaw: (480n * M).toString(), protectObligations: true, obligationBufferDays: 1 } });
  assert.ok(failed(checkAction(strict, obs(), deployAction(30n * M))).includes("reserve_floor"));
  // Surplus unknown → blocks (null is never treated as zero or as enough).
  assert.ok(failed(checkAction(m, obs({}, { surplusUsdcRaw: null }), deployAction(10n * M))).includes("surplus"));
  // Concentration: 450 already on Rhea + 50 = 50% of 1000 is allowed; 451 + 50 is not.
  const onRhea = (n: bigint) => obs({ exposure: [{ positionId: "r", venue: RHEA, protocol: RHEA, chain: "near", usdcRaw: (n * M).toString() }] });
  assert.ok(!failed(checkAction(m, onRhea(450n), deployAction(50n * M))).includes("concentration_position"));
  assert.ok(failed(checkAction(m, onRhea(451n), deployAction(50n * M))).includes("concentration_position"));
  assert.ok(failed(checkAction(m, obs({}, { netWorthUsdcRaw: null }), deployAction(5n * M))).includes("concentration_protocol"));
  // Long exits can't outlast the protected horizon.
  assert.ok(failed(checkAction(m, obs({ horizonDays: 2 }), deployAction(5n * M, { exitHours: 72 }))).includes("exit_before_obligations"));
  // Stale evidence, scope and recipient.
  assert.ok(failed(checkAction(m, obs({}, { capturedAt: new Date(NOW - 600_000).toISOString() }), deployAction(5n * M))).includes("evidence_fresh"));
  assert.ok(failed(checkAction(m, obs(), deployAction(5n * M, { venue: "other.near" }))).includes("scope_venue"));
  assert.ok(failed(checkAction(m, obs(), deployAction(5n * M, { recipient: "bob.near" }))).includes("scope_recipient"));
  assert.ok(failed(checkAction(m, obs(), deployAction(5n * M, { methods: [{ receiver: RHEA, method: "execute_with_pyth" }] }))).includes("scope_methods"));
});

test("check: borrowing and spending are separate permissions; debt limit needs a known debt", () => {
  const m = active();
  assert.ok(failed(checkAction(m, obs(), deployAction(5n * M, { borrows: true }))).includes("borrowing"));
  assert.ok(!failed(checkAction(m, obs(), deployAction(5n * M, { borrows: true }))).includes("spending"));
  assert.ok(failed(checkAction(m, obs(), deployAction(5n * M, { spends: true }))).includes("spending"));
  const b = active({ borrowing: { allowed: true, maxDebtUsdcRaw: (20n * M).toString(), minHealth: "1.5" } });
  assert.ok(!failed(checkAction(b, obs(), deployAction(5n * M, { borrows: true }))).includes("borrowing"));
  assert.ok(failed(checkAction(b, obs({}, { debtUsdcRaw: (18n * M).toString() }), deployAction(5n * M, { borrows: true }))).includes("debt_limit"));
  assert.ok(failed(checkAction(b, obs({}, { debtUsdcRaw: null }), deployAction(5n * M, { borrows: true }))).includes("debt_limit"));
});

test("check: risk-reducing actions skip budgets but never scope, freshness or authority; unquoted cost defers only for owner signing", () => {
  const m = active();
  const exit = deployAction(400n * M, { kind: "recall_for_obligation", methods: [{ receiver: RHEA, method: "execute" }] });
  assert.deepEqual(failed(checkAction(m, obs({}, {}, { todayActions: 9 }), exit)), []);
  assert.ok(failed(checkAction(m, obs({}, { capturedAt: new Date(NOW - 600_000).toISOString() }), exit)).includes("evidence_fresh"));
  assert.ok(failed(checkAction(active({ scope: { ...signed().scope, actions: ["deploy_surplus"] } }), obs(), exit)).includes("scope_action"));
  // Unquoted: owner-signed plans re-quote in the journal, so it may proceed; a delegated key may not.
  const unquoted = deployAction(5n * M, { costUsdcRaw: null, quoteCapturedAt: null });
  assert.equal(checkAction(m, obs(), unquoted).allowed, true);
  const delegated = { ...m, authority: { ...authorityFor("near_custody_contract"), status: "verified" as const } };
  assert.equal(checkAction(delegated, obs(), unquoted).allowed, false);
  // A delegated authority that isn't provisioned blocks everything.
  assert.ok(failed(checkAction({ ...m, authority: authorityFor("near_custody_contract") }, obs(), deployAction(5n * M))).includes("authority"));
  // Signature must match the current terms.
  assert.ok(failed(checkAction({ ...m, limits: { ...m.limits, capitalUsdcRaw: "1" } }, obs(), deployAction(5n * M))).includes("signed_terms"));
});

test("authority: function-call keys can't attach deposits, so Rhea and token transfers are rejected honestly", () => {
  assert.deepEqual(functionCallKeyCanCall([{ method: "ft_transfer_call" }, { method: "execute" }]).blocked, ["ft_transfer_call", "execute"]);
  assert.equal(functionCallKeyCanCall([{ method: "curator_execute" }]).ok, true);
  assert.equal(authorityFor("near_function_call_key").status, "unsupported");
  const hl = DELEGATION_OPTIONS.find((o) => o.kind === "hyperliquid_agent")!;
  assert.match(hl.bounds.join(" "), /cannot withdraw/);
  assert.match(hl.unbounded.join(" "), /NOT limited by Hyperliquid/);
  assert.equal(authorityFor("owner_signs_each").status, "verified");
});

const step = (kind: PlanStep["kind"], state: PlanStep["state"], usdcRaw?: string): PlanStep => ({
  id: kind, planId: "p", kind, dependsOn: [], signer: "alice.near", approval: "owner_wallet", state, expected: {}, timeline: [],
  ...(usdcRaw ? { actual: { usdcRaw, evidence: ["hash1"] } } : {}),
});
test("accounting: plan outcomes come from journal-verified steps; released budgets are returned", () => {
  const p = (state: ActionPlan["state"], steps: PlanStep[]) => ({ state, steps, ledgerEntryIds: ["e1"] });
  assert.equal(planOutcome(p("reviewed", [step("supply", "prepared")])).status, "open");
  assert.equal(planOutcome(p("executing", [step("supply", "unknown")])).status, "uncertain");
  const ok = planOutcome(p("completed", [step("supply", "confirmed", (40n * M).toString())]));
  assert.deepEqual([ok.status, ok.deployedDeltaUsdcRaw, ok.txHashes], ["confirmed", (40n * M).toString(), ["hash1"]]);
  assert.equal(planOutcome(p("completed", [step("withdraw", "confirmed", (15n * M).toString())])).deployedDeltaUsdcRaw, (-15n * M).toString());
  assert.equal(planOutcome(p("expired", [step("supply", "skipped")])).status, "released");

  const ev: UsageEvent[] = [
    { at: AT, kind: "deploy_surplus", amountUsdcRaw: (40n * M).toString(), status: "committed", planId: "a" },
    { at: AT, kind: "deploy_surplus", amountUsdcRaw: (40n * M).toString(), status: "confirmed", deployedDeltaUsdcRaw: (40n * M).toString(), planId: "a" },
    { at: AT, kind: "deploy_surplus", amountUsdcRaw: (30n * M).toString(), status: "committed", planId: "b" },
    { at: AT, kind: "deploy_surplus", amountUsdcRaw: (30n * M).toString(), status: "released", planId: "b" },
    { at: AT, kind: "recall_for_obligation", amountUsdcRaw: (10n * M).toString(), status: "committed", planId: "c" },
    { at: AT, kind: "recall_for_obligation", amountUsdcRaw: (10n * M).toString(), status: "confirmed", deployedDeltaUsdcRaw: (-10n * M).toString(), planId: "c" },
    { at: "2026-11-12T09:00:00.000Z", kind: "deploy_surplus", amountUsdcRaw: (5n * M).toString(), status: "committed", planId: "d" },
  ];
  const u = usageFrom(ev, NOW, "0", []);
  assert.equal(u.todayUsdcRaw, (40n * M).toString()); // released b and risk-reducing c don't count
  assert.equal(u.todayActions, 1);
  assert.equal(u.cumulativeUsdcRaw, (45n * M).toString());
  assert.equal(u.deployedUsdcRaw, (30n * M).toString());
});

test("store SQL: compare-and-set loses a concurrent write; audit is append-only; due query and kill switch", () => {
  const db = new DatabaseSync(":memory:");
  for (const s of MANDATE_TABLES) db.exec(s);
  db.prepare(MANDATE_INSERT).run("m1", "ws", "{}", "active", "2026-11-13T09:00:00.000Z", AT);
  assert.equal(db.prepare(MANDATE_CAS).run('{"v":1}', "active", "2026-11-13T11:00:00.000Z", AT, "m1", "ws", 0).changes, 1);
  assert.equal(db.prepare(MANDATE_CAS).run('{"v":2}', "active", "2026-11-13T11:00:00.000Z", AT, "m1", "ws", 0).changes, 0); // stale revision
  assert.equal(db.prepare(MANDATE_CAS).run('{"v":2}', "active", null, AT, "m1", "other-ws", 1).changes, 0); // other workspace
  assert.deepEqual(db.prepare(MANDATE_DUE).all("2026-11-13T10:30:00.000Z", 10), []);
  assert.equal(db.prepare(MANDATE_DUE).all("2026-11-13T11:00:00.000Z", 10).length, 1);
  db.prepare(AUDIT_APPEND).run("a1", "ws", "m1", AT, "decide", '{"summary":"first"}');
  db.prepare(AUDIT_APPEND).run("a1", "ws", "m1", AT, "decide", '{"summary":"rewrite"}');
  const rows = db.prepare(AUDIT_LIST).all("ws", "m1", 10) as { payload: string }[];
  assert.deepEqual(rows.map((r) => JSON.parse(r.payload).summary), ["first"]);
  db.prepare(KILL_SET).run("ws", AT, AT);
  assert.equal((db.prepare(KILL_GET).get("ws") as { kill_switch_at: string }).kill_switch_at, AT);
  db.prepare(KILL_SET).run("ws", null, AT);
  assert.equal((db.prepare(KILL_GET).get("ws") as { kill_switch_at: string | null }).kill_switch_at, null);
});
