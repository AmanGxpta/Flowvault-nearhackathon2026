import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  newPlan, review, assertPreparable, applyFence, applyExpiry, settle, cancel, rebase,
  stepGeneration, planTarget, assertSameIntent, planContext,
} from "../lib/flowvault/plans.ts";
import { PLAN_TABLES, PLAN_LOCK, PLAN_INSERT, PLAN_SAVE, PLAN_UNLOCK } from "../lib/flowvault/plans-sql.ts";
import type { FundingChoice } from "../lib/flowvault/contracts.ts";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const ctx = { workspaceRevision: 7, mandateVersion: 3, policyVersion: 2 };
function choice(id: string, eligible: boolean, steps: FundingChoice["steps"], reasons: string[] = []): FundingChoice {
  return { id, kind: id === "idle-cash" ? "idle_cash" : "withdraw", eligible, reasons, amountUsdcRaw: "1001610000", costsUsdcRaw: "1610000", foregoneUsdcRaw: null, interestUsdcRaw: null, healthAfter: null, availableAt: null, steps };
}
function payPlan(source: "live" | "demo" = "live") {
  return newPlan({
    id: "11111111-2222-4333-8444-555555555555", key: "k", source, accountId: source === "live" ? "owner.near" : null,
    objective: "pay_obligation", createdBy: "assistant",
    request: { obligationId: "aman", amountRaw: "1000000000000000000000", asset: "USDT", chain: "bnb", deadline: "2026-11-23" },
    context: { ...ctx },
    alternatives: [
      choice("idle-cash", true, ["pay_quote", "pay_deposit", "verify_payout"]),
      choice("withdraw-then-pay", false, ["withdraw", "pay_quote", "pay_deposit", "verify_payout"], ["NOT_NEEDED_IDLE_CASH_COVERS"]),
    ],
  }, T0);
}
const specs = (kinds: FundingChoice["steps"]) => kinds.map((kind) => ({ kind, expected: {} }));

test("a plan with no eligible alternative is blocked and explains why", () => {
  const p = newPlan({ ...payPlan(), id: "x", key: "x", source: "live", accountId: "a", objective: "deploy_surplus", createdBy: "user", request: {}, context: ctx,
    alternatives: [choice("rhea", false, ["supply"], ["NO_ELIGIBLE_SURPLUS"])] }, T0);
  assert.equal(p.state, "blocked");
  assert.deepEqual(p.blockedReasons, ["NO_ELIGIBLE_SURPLUS"]);
  assert.equal(payPlan().state, "evaluated");
});

test("review builds explicit dependencies, signer and approval per step", () => {
  const p = payPlan();
  assert.throws(() => review(p, "withdraw-then-pay", specs(["withdraw"]), T0), /not eligible/);
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  assert.equal(p.state, "reviewed");
  const [q, d, v] = p.steps;
  assert.deepEqual(q.dependsOn, []);
  assert.deepEqual(d.dependsOn, [q.id]);
  assert.deepEqual(v.dependsOn, [d.id]);
  assert.equal(q.signer, null); assert.equal(q.approval, "none");
  assert.equal(d.signer, "owner.near"); assert.equal(d.approval, "owner_wallet");
  assert.equal(v.signer, null);
  assert.deepEqual([q.state, d.state, v.state], ["ready", "pending", "pending"]);
  assert.deepEqual(p.approvals.map((a) => [a.stepId, a.kind]), [[d.id, "spend"]]);
});

test("preparation guards: example, review, dependencies, fences and duplicate execution", () => {
  const demo = payPlan("demo");
  review(demo, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  assert.throws(() => assertPreparable(demo, demo.steps[0].id, ctx, T0), /Example plans are fictional/);

  const p = payPlan();
  assert.throws(() => assertPreparable(p, "nope", ctx, T0), /Review the plan/);
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  assert.throws(() => assertPreparable(p, p.steps[1].id, ctx, T0), /Earlier steps/);
  assert.throws(() => assertPreparable(p, p.steps[0].id, { ...ctx, policyVersion: 3 }, T0), /POLICY_CHANGED/);
  assert.equal(assertPreparable(p, p.steps[0].id, ctx, T0).kind, "prepare");

  p.steps[0].state = "confirmed";
  settle(p, T0);
  Object.assign(p.steps[1], { state: "prepared", attemptId: "att-1", expiresAt: new Date(T0 + 60_000).toISOString() });
  const again = assertPreparable(p, p.steps[1].id, ctx, T0);
  assert.equal(again.kind, "existing", "a retry returns the same prepared journal record");
  p.steps[1].state = "awaiting_wallet";
  assert.throws(() => assertPreparable(p, p.steps[1].id, ctx, T0), /already reached the wallet/);
});

test("new debt needs explicit approval before preparation", () => {
  const p = newPlan({ ...payPlan(), alternatives: [{ ...choice("borrow", true, ["borrow"]), kind: "borrow" }] }, T0);
  review(p, "borrow", specs(["borrow"]), T0);
  assert.equal(p.approvals[0].kind, "new_debt");
  assert.throws(() => assertPreparable(p, p.steps[0].id, ctx, T0), /new debt/);
  p.approvals[0].grantedAt = new Date(T0).toISOString();
  assert.equal(assertPreparable(p, p.steps[0].id, ctx, T0).kind, "prepare");
});

test("fencing supersedes unhanded steps, keeps in-flight steps and payout verification", () => {
  const p = payPlan();
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  p.steps[0].state = "confirmed";
  p.steps[1].state = "awaiting_wallet";
  assert.deepEqual(applyFence(p, ctx, T0), []);
  const changes = applyFence(p, { ...ctx, mandateVersion: 4 }, T0);
  assert.match(changes[0], /CASH_PLAN_CHANGED/);
  assert.equal(p.state, "superseded");
  assert.equal(p.steps[1].state, "awaiting_wallet", "the wallet request keeps being tracked");
  assert.equal(p.steps[2].state, "pending", "verification of money in motion is never skipped");
  p.steps[1].state = "confirmed";
  p.steps[2].state = "confirmed";
  settle(p, T0);
  assert.equal(p.state, "completed");

  const q = payPlan();
  review(q, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  applyFence(q, { ...ctx, workspaceRevision: 8 }, T0);
  assert.equal(q.steps[0].state, "skipped");
  assert.match(q.blockedReasons.join(), /WORKSPACE_CHANGED/);
});

test("the executor's own journal write rebases the workspace revision but not mandate or policy changes", () => {
  const p = payPlan();
  rebase(p, { ...ctx, workspaceRevision: 9 });
  assert.equal(p.context.workspaceRevision, 9);
  rebase(p, { ...ctx, workspaceRevision: 10, policyVersion: 5 });
  assert.equal(p.context.workspaceRevision, 9);
});

test("expiry: a prepared step returns to ready with a new idempotency generation; stale plans expire", () => {
  const p = payPlan();
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  Object.assign(p.steps[0], { state: "prepared", attemptId: "a", expiresAt: new Date(T0 + 1000).toISOString() });
  assert.equal(stepGeneration(p.steps[0]), 0);
  applyExpiry(p, T0 + 2000);
  assert.equal(p.steps[0].state, "ready");
  assert.equal(p.steps[0].attemptId, undefined);
  assert.equal(stepGeneration(p.steps[0]), 1);
  applyExpiry(p, T0 + 25 * 3600_000);
  assert.equal(p.state, "expired");
  const d = payPlan();
  applyExpiry(d, Date.parse("2026-11-24T00:00:01Z"));
  assert.equal(d.state, "expired");
  assert.ok(d.blockedReasons.includes("PLAN_EXPIRED") || d.blockedReasons.includes("DEADLINE_PASSED"));
});

test("plan state follows step states, including partial and failed", () => {
  const p = payPlan();
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  p.steps[0].state = "confirmed";
  assert.equal(settle(p, T0), "executing");
  assert.equal(p.steps[1].state, "ready");
  p.steps[1].state = "unknown";
  assert.equal(settle(p, T0), "partial");
  p.steps[1].state = "failed";
  assert.equal(settle(p, T0), "partial");
  const f = payPlan();
  review(f, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  f.steps[0].state = "failed";
  assert.equal(settle(f, T0), "failed");
});

test("cancel refuses while a step is in the wallet", () => {
  const p = payPlan();
  review(p, "idle-cash", specs(["pay_quote", "pay_deposit", "verify_payout"]), T0);
  p.steps[0].state = "confirmed";
  p.steps[1].state = "submitted";
  assert.throws(() => cancel(p, T0), /already in your wallet/);
  p.steps[1].state = "prepared";
  cancel(p, T0);
  assert.equal(p.state, "cancelled");
  assert.equal(p.steps[1].state, "skipped");
});

test("idempotency key replay must describe the same intent", () => {
  const p = payPlan();
  assert.doesNotThrow(() => assertSameIntent(p, "pay_obligation", { obligationId: "aman", amountRaw: p.request.amountRaw }, "live"));
  assert.throws(() => assertSameIntent(p, "deploy_surplus", {}, "live"), /different request/);
  assert.equal(planTarget("pay_obligation", { obligationId: "aman" }), "obligation:aman");
  assert.deepEqual(planContext({ mandate: { version: 3 }, policy: { version: 2 } }, 7), ctx);
});

test("SQL: one active plan per target, and compare-and-swap saves", () => {
  const d = new DatabaseSync(":memory:");
  for (const sql of PLAN_TABLES) d.exec(sql);
  const insert = (id: string) => {
    d.prepare(PLAN_LOCK).run("s", "obligation:aman", id);
    d.prepare(PLAN_INSERT).run(id, "s", "key-" + id, "{}", "s", "obligation:aman", id);
  };
  insert("p1");
  insert("p2");
  assert.deepEqual(d.prepare("SELECT id FROM action_plans").all().map((r) => r.id), ["p1"]);
  assert.equal(d.prepare(PLAN_SAVE).run('{"v":2}', "p1", "s", "{}").changes, 1);
  assert.equal(d.prepare(PLAN_SAVE).run('{"v":3}', "p1", "s", "{}").changes, 0, "a stale tab cannot overwrite");
  d.prepare(PLAN_UNLOCK).run("s", "obligation:aman", "p1");
  insert("p2");
  assert.deepEqual(d.prepare("SELECT id FROM action_plans ORDER BY id").all().map((r) => r.id), ["p1", "p2"]);
});

test("borrow-to-payment continuity: the borrow source's liability is carried into the reviewed effects", async () => {
  const { applyCreditEffects } = await import("../lib/flowvault/plans.ts");
  const p = newPlan({ ...payPlan(), alternatives: [{ ...choice("borrow", true, ["borrow", "pay_quote", "pay_deposit", "verify_payout"]), kind: "borrow" }] }, T0) as ReturnType<typeof newPlan> & { credit?: { debtBeforeUsdcRaw: string | null; newDebtUsdcRaw: string } };
  p.credit = { debtBeforeUsdcRaw: "50000000", newDebtUsdcRaw: "0" };
  applyCreditEffects(p, p.alternatives[0]);
  review(p, "borrow", specs(["borrow", "pay_quote", "pay_deposit", "verify_payout"]), T0);
  assert.equal(p.effects.debtAfterUsdcRaw, "1051610000");
  assert.equal(p.credit.newDebtUsdcRaw, "1001610000");
  assert.ok(p.effects.exposure.some((x) => x.asset === "USDC debt · Rhea" && x.deltaRaw === "1001610000"));
  assert.deepEqual(p.approvals.map((a) => a.kind), ["new_debt", "spend"], "the debt approval travels with the payment");
  const q = newPlan({ ...payPlan(), alternatives: [{ ...choice("borrow", true, ["borrow"]), kind: "borrow" }] }, T0) as typeof p;
  q.credit = { debtBeforeUsdcRaw: null, newDebtUsdcRaw: "0" };
  applyCreditEffects(q, q.alternatives[0]);
  assert.equal(q.effects.debtAfterUsdcRaw, null, "unknown prior debt stays unknown, never 0");
});
