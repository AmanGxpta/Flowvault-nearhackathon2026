import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  buildStakingPreparation,
  assertStakingContext,
} from "../lib/flowvault/staking-execution.ts";
import {
  normalizeLifecycleQuote,
  LINEAR_CONTRACT,
} from "../lib/flowvault/staking-lifecycle.ts";
import { stakingHandoffGuard } from "../lib/flowvault/staking-guards.ts";
import { OUTGOING_HANDOFF_GUARD } from "../lib/flowvault/journal-sql.ts";
import { personalSeed } from "../lib/flowvault/seed.ts";
import { defaultPolicy, evaluatePolicy } from "../lib/flowvault/policy.ts";
import type { CapitalView } from "../lib/flowvault/contracts.ts";
const N = 10n ** 24n,
  now = Date.parse("2026-11-12T12:00:00Z");
function fixture() {
  const w = personalSeed();
  w.accountId = "fixture.near";
  w.policy = {
    ...defaultPolicy(),
    assetRows: [{ asset: "NEAR", priority: "P1", uses: ["stake", "hold"] }],
    venues: [LINEAR_CONTRACT],
    methods: [{ receiver: LINEAR_CONTRACT, method: "deposit_and_stake" }],
  };
  const quote = normalizeLifecycleQuote(
    "stake",
    {
      amount: N,
      fee: N / 100n,
      upfront: N / 50n,
      reserve: N / 2n,
      maxStakeable: 2n * N,
      shares: N,
      price: N,
      transactions: [
        {
          receiverId: LINEAR_CONTRACT,
          actions: [
            {
              functionCall: {
                methodName: "deposit_and_stake",
                args: {},
                deposit: N,
                gas: 100000000000000n,
              },
            },
          ],
        },
      ],
    },
    String(N),
  );
  const v = {
    usdcRaw: "3000000",
    basis: "Fixture Engines price",
    capturedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 180000).toISOString(),
  };
  const fee = { ...v, usdcRaw: "30000" };
  const capital: CapitalView = {
    netWorthUsdcRaw: null,
    spendableNowUsdcRaw: "10000000",
    holdbackUsdcRaw: "5000000",
    surplusUsdcRaw: "5000000",
    valuations: [],
    reservations: [],
    excluded: [],
    capturedAt: new Date(now).toISOString(),
  };
  return {
    w,
    quote,
    v,
    fee,
    capital,
    native: { amount: String(2n * N), storage_usage: 1000 },
  };
}
test("staking uses Engines values for caps, USDC journal precision and exact raw NEAR payload", () => {
  const f = fixture();
  const p = buildStakingPreparation(
    f.w,
    2,
    f.quote,
    f.v,
    f.fee,
    f.capital,
    f.native,
    now,
  );
  assert.equal(p.amount, "3");
  assert.equal(p.amountRaw, String(N));
  assert.equal(p.policyAction.amount, "3");
  assert.equal(p.policyAction.movingCost, "0.03");
  assert.equal(p.policyAction.asset, "NEAR");
  assert.equal(p.workspaceRevision, 2);
  assert.equal(p.transactions[0].actions[0].params.deposit, String(N));
  assert.equal(
    evaluatePolicy(p.policyAction, f.w.policy!, [], now).allowed,
    true,
  );
  assert.equal(
    evaluatePolicy(
      p.policyAction,
      { ...f.w.policy!, perActionCap: "2" },
      [],
      now,
    ).allowed,
    false,
  );
  assert.equal(
    evaluatePolicy(p.policyAction, { ...f.w.policy!, venues: [] }, [], now)
      .allowed,
    false,
  );
  assert.equal(
    evaluatePolicy(
      p.policyAction,
      {
        ...f.w.policy!,
        assetRows: [{ asset: "NEAR", priority: "P1", uses: ["hold"] }],
      },
      [],
      now,
    ).allowed,
    false,
  );
});
test("unknown/stale prices and native gas shortfalls refuse staking; a short reserve is disclosed for liquid LiNEAR", () => {
  const f = fixture();
  for (const v of [
    { ...f.v, usdcRaw: null },
    { ...f.v, freshUntil: "invalid" },
    { ...f.v, freshUntil: new Date(now - 1).toISOString() },
  ])
    assert.throws(() =>
      buildStakingPreparation(
        f.w,
        2,
        f.quote,
        v,
        f.fee,
        f.capital,
        f.native,
        now,
      ),
    );
  // LiNEAR stays liquid: a short or unknown surplus is disclosed on the review instead of refusing the stake.
  for (const surplus of [null, "3000000"]) {
    const p = buildStakingPreparation(f.w, 2, f.quote, f.v, f.fee, { ...f.capital, surplusUsdcRaw: surplus }, f.native, now);
    assert.match(String(p.reserveNote), surplus === null ? /couldn't be checked/ : /aren't fully covered/);
  }
  assert.equal(buildStakingPreparation(f.w, 2, f.quote, f.v, f.fee, f.capital, f.native, now).reserveNote, null);
  assert.throws(
    () =>
      buildStakingPreparation(
        f.w,
        2,
        f.quote,
        f.v,
        f.fee,
        f.capital,
        { amount: String(N + N / 2n), storage_usage: 1000 },
        now,
      ),
    /exit gas/,
  );
});
test("staking context fences source, account, workspace revision, mandate and policy", () => {
  const f = fixture(),
    p = buildStakingPreparation(
      f.w,
      2,
      f.quote,
      f.v,
      f.fee,
      f.capital,
      f.native,
      now,
    );
  assertStakingContext(p, f.w, 2);
  assert.throws(() => assertStakingContext(p, f.w, 3));
  for (const mutate of [
    (w: any) => (w.mode = "demo"),
    (w: any) => (w.accountId = "other.near"),
    (w: any) => w.mandate.version++,
    (w: any) => w.policy.version++,
  ]) {
    const w = structuredClone(f.w);
    mutate(w);
    assert.throws(() => assertStakingContext(p, w, 2));
  }
});
test("staking and every outgoing journal kind mutually fence in-flight handoffs, using the existing SQL lock", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE wallet_attempts(id TEXT PRIMARY KEY,session_id TEXT,payload TEXT)",
    );
    db.prepare("INSERT INTO wallet_attempts VALUES (?,?,?)").run(
      "new",
      "session",
      "{}",
    );
    db.prepare("INSERT INTO wallet_attempts VALUES (?,?,?)").run(
      "old",
      "session",
      "{}",
    );
    const update = db.prepare(
      "UPDATE wallet_attempts SET payload=? WHERE id=?" +
        stakingHandoffGuard(OUTGOING_HANDOFF_GUARD),
    );
    for (const kind of [
      "supply",
      "pay",
      "withdraw",
      "stake",
      "unstake",
      "withdraw_unstaked",
      "borrow",
      "repay",
      "native_stake",
      "future_journal_kind",
    ]) {
      db.prepare("UPDATE wallet_attempts SET payload=? WHERE id=?").run(
        JSON.stringify({
          kind,
          accountId: "fixture.near",
          state: "awaiting_wallet",
        }),
        "old",
      );
      assert.equal(
        update.run("{}", "new", "session", "new", "fixture.near").changes,
        0,
      );
      db.prepare("UPDATE wallet_attempts SET payload=? WHERE id=?").run(
        JSON.stringify({ kind, accountId: "fixture.near", state: "confirmed" }),
        "old",
      );
      assert.equal(
        update.run("{}", "new", "session", "new", "fixture.near").changes,
        1,
      );
    }
    assert.throws(() => stakingHandoffGuard("unexpected SQL"));
  } finally {
    db.close();
  }
});
