import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stakingLedger,
  stakingFeeRaw,
} from "../lib/flowvault/staking-ledger.ts";
import {
  assertStakingWalletHandoff,
  consumeStakingWalletHandoff,
} from "../lib/flowvault/staking-wallet-guard.ts";
import type { ActionPlan, PlanStep } from "../lib/flowvault/contracts.ts";
import type { WalletAttempt } from "../lib/flowvault/execution.ts";
const now = Date.parse("2026-11-12T12:00:00Z"),
  N = 10n ** 24n;
function fixture(kind: "stake" | "unstake" | "withdraw_unstaked" = "stake") {
  const p: any = {
    kind,
    accountId: "fixture.near",
    asset: kind === "unstake" ? "LiNEAR" : "NEAR",
    amount: "3",
    amountRaw: String(N),
    decimals: 24,
    usdcValueRaw: "3000000",
    workspaceRevision: 2,
    mandateVersion: 1,
    policyVersion: 1,
    signable: true,
    valuationBasis: "Fixture Engines price",
    expiresAt: new Date(now + 180000).toISOString(),
    transactions: [
      {
        receiverId: "linear-protocol.near",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName:
                kind === "stake"
                  ? "deposit_and_stake"
                  : kind === "unstake"
                    ? "unstake"
                    : "withdraw_all",
              args: {},
              gas: "100000000000000",
              deposit: kind === "stake" ? String(N) : "0",
            },
          },
        ],
      },
    ],
  };
  const a: WalletAttempt = {
    id: crypto.randomUUID(),
    kind,
    accountId: "fixture.near",
    amount: "3",
    mandateVersion: 1,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: p.expiresAt,
    state: "confirmed",
    preparation: p,
    hashes: ["hash"],
    message: "Confirmed",
    verificationEvidence: [
      {
        hash: "hash",
        verifiedState: "confirmed",
        stakingEffect: {
          state: "confirmed",
          asset: kind === "withdraw_unstaked" ? "NEAR" : "LiNEAR",
          amountRaw: String(N),
          nearAmountRaw: String(N),
          unlockEpoch: "104",
        },
      },
    ],
    timeline: [
      {
        id: "fee",
        sequence: 1,
        at: new Date(now).toISOString(),
        phase: "receipt:hash",
        status: "confirmed",
        message: "Final receipt",
        explorerLinks: [],
        refund: null,
        evidence: null,
        fees: [
          {
            unit: "yoctoNEAR",
            amount: "10000000000000000000000",
            verified: true,
          },
        ],
      },
    ],
  };
  const plan = {
      id: "plan",
      source: "live",
      accountId: "fixture.near",
    } as ActionPlan,
    step = { id: "step", kind, state: "submitted" } as PlanStep;
  return { p, a, plan, step };
}
test("confirmed LiNEAR entry, pending exit and claim principal never become yield or change net worth", () => {
  for (const kind of ["stake", "unstake", "withdraw_unstaked"] as const) {
    const f = fixture(kind);
    const e = stakingLedger(f.plan, f.step, f.a);
    assert.equal(
      e[0].kind,
      kind === "stake"
        ? "position_entry"
        : kind === "unstake"
          ? "internal_transfer"
          : "position_exit",
    );
    assert.equal(e[0].asset, f.p.asset);
    assert.equal(e[0].netWorthEffectUsdcRaw, "0");
    assert.equal(e[0].realized, false);
    assert.equal(e[0].amountRaw, String(N));
    assert.equal(e[1].kind, "fee");
    assert.equal(e[1].usdcRaw, null);
    assert.equal(e[1].netWorthEffectUsdcRaw, null);
    assert.ok(e.every((r) => r.kind !== "yield"));
    assert.equal(stakingLedger(f.plan, f.step, f.a)[0].id, e[0].id);
  }
});
test("ledger uses only verified effects and counts actual fees once across status polling", () => {
  const f = fixture();
  f.a.timeline!.push({ ...f.a.timeline![0], id: "polled-again" });
  assert.equal(stakingFeeRaw(f.a), 10000000000000000000000n);
  const value = {
    usdcRaw: "30000",
    basis: "Engine cap upper bound",
    capturedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 180000).toISOString(),
  };
  assert.equal(
    stakingLedger(f.plan, f.step, f.a, value)[1].netWorthEffectUsdcRaw,
    "-30000",
  );
  f.a.verificationEvidence = [];
  assert.throws(() => stakingLedger(f.plan, f.step, f.a), /economic proof/);
  f.a.state = "failed";
  assert.equal(stakingLedger(f.plan, f.step, f.a, value).length, 1);
  f.a.state = "unknown";
  assert.deepEqual(stakingLedger(f.plan, f.step, f.a, value), []);
  f.a.timeline![1].fees[0].verified = false;
  assert.equal(stakingFeeRaw(f.a), null);
});
test("client handoff only accepts exact authorized LiNEAR payload and persists single use", () => {
  const f = fixture();
  f.a.state = "awaiting_wallet";
  const p = { ...f.p, attemptId: f.a.id };
  assertStakingWalletHandoff(p, f.a, now);
  const claimed = consumeStakingWalletHandoff(f.a, now);
  assert.ok(claimed.stakingWalletHandoffAt);
  assert.throws(
    () => consumeStakingWalletHandoff(claimed, now),
    /already consumed/,
  );
  for (const change of [
    { accountId: "other.near" },
    { amountRaw: "1" },
    { kind: "supply" },
    { workspaceRevision: 3 },
    { transactions: [{ receiverId: "evil.near", actions: [] }] },
    { signable: false },
  ])
    assert.throws(() =>
      assertStakingWalletHandoff({ ...p, ...change }, f.a, now),
    );
  for (const state of [
    "prepared",
    "submitted",
    "unknown",
    "confirmed",
  ] as const)
    assert.throws(() => assertStakingWalletHandoff(p, { ...f.a, state }, now));
  assert.throws(
    () => assertStakingWalletHandoff(p, f.a, now + 180001),
    /expired/,
  );
});

test("adapter and E3 journal use one canonical principal/fee key, with no duplicate statement entries", async () => {
  const { buildLedger } = await import("../lib/flowvault/ledger.ts");
  for (const kind of ["stake", "unstake", "withdraw_unstaked"] as const) {
    const f = fixture(kind);
    const outbox = stakingLedger(f.plan, f.step, f.a);
    const entries = buildLedger({
      source: "live",
      accountId: "fixture.near",
      attempts: [f.a],
      payments: [],
      outbox,
      prices: null,
    });
    assert.equal(entries.filter((e) => e.kind !== "fee").length, 1);
    assert.equal(entries.filter((e) => e.kind === "fee").length, 1);
    assert.equal(entries.find((e) => e.kind !== "fee")!.asset, f.p.asset);
    assert.equal(
      entries.find((e) => e.kind !== "fee")!.amountRaw,
      f.p.amountRaw,
    );
  }
});
