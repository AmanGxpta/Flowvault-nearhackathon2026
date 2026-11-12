import test from "node:test";
import assert from "node:assert/strict";
import { planFromPolicy, ownerCall, policyContractId, readPolicyContract, NOT_DEPLOYED_NOTE } from "../lib/flowvault/policy-contract.ts";
import { defaultPolicy } from "../lib/flowvault/policy.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ws = (obligations: any[] = []): any => ({
  mode: "live",
  accountId: "owner.near",
  mandate: { source: "live", reserve: "2000", horizon: 30, leadDays: 3, version: 2, obligations: [] },
  obligations,
});
const usdcBill = { id: "rent", token: "USDC", amount: "1500", destination: "base", dueDate: "2026-11-20", status: "scheduled", recipient: "0x" + "1".repeat(40) };

test("not deployed is reported, never faked", async () => {
  assert.equal(policyContractId(() => undefined), null);
  assert.equal(policyContractId(() => "  "), null);
  const s = await readPolicyContract(null, "owner.near");
  assert.equal(s.status, "not_deployed");
  assert.equal(s.note, NOT_DEPLOYED_NOTE);
  assert.match(s.authority, /holds no funds.*cannot restrict a wallet with a full-access key/);
  assert.throws(() => ownerCall(s, "owner.near", "approve", { op_id: "1" }), /Not deployed/);
  assert.equal((await readPolicyContract("policy.testnet", "owner.near")).status, "unreachable");
});

test("owner calls: only the contract owner, exactly 1 yocto, no funds", () => {
  const configured: any = { status: "configured", contractId: "policy.owner.near", owner: "owner.near", ownerIsAccount: true, note: "", authority: "", capturedAt: "" };
  const c = ownerCall(configured, "owner.near", "approve", { op_id: "4" });
  assert.equal(c.transactions[0].receiverId, "policy.owner.near");
  assert.deepEqual(c.transactions[0].actions[0].params, { methodName: "approve", args: { op_id: "4" }, gas: "30000000000000", deposit: "1" });
  assert.throws(() => ownerCall({ ...configured, ownerIsAccount: false, owner: "else.near" }, "owner.near", "approve", {}), /Only the contract owner \(else.near\)/);
});

test("planFromPolicy mirrors the saved policy exactly or fails closed", () => {
  const policy = { ...defaultPolicy("5"), protectedAssets: ["LiNEAR"] };
  const plan = planFromPolicy(ws([usdcBill]), policy, 3n, NOW);
  assert.equal(plan.version, "3");
  assert.equal(plan.reserve_floor, "2000000000");
  assert.equal(plan.per_action_cap, "10000000000");
  assert.equal(plan.max_moving_cost, "5000000");
  assert.equal(plan.max_gas_yocto, "500000000000000000000000");
  assert.deepEqual(plan.obligations, [{ id: "rent", net_amount: "1500000000", due_at_ms: String(Date.parse("2026-11-20T23:59:59.999Z")) }]);
  assert.deepEqual(plan.protected_assets, ["linear-protocol.near"]);
  assert.ok(!plan.recipients.includes("$owner"));
  // An obligation without valuation evidence cannot be published as a number.
  assert.throws(() => planFromPolicy(ws([{ ...usdcBill, token: "USDT", destination: "bnb" }]), policy, 3n, NOW), /unavailable/i);
  assert.throws(() => planFromPolicy(ws(), { ...policy, protectedAssets: ["Gold bar"] }, 3n, NOW), /no NEAR token id/);
});
