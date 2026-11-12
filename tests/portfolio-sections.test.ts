import { test } from "node:test";
import assert from "node:assert/strict";
import { workspacePortfolio } from "../lib/flowvault/portfolio-service.ts";
import { usableBalances } from "../lib/flowvault/usable.ts";
import { nextAction } from "../lib/flowvault/action.ts";
import { personalSeed, demoMarket } from "../lib/flowvault/seed.ts";
import type { Portfolio, PortfolioSection } from "../lib/flowvault/types.ts";
const all: PortfolioSection["affects"] = [
  "netWorth",
  "cashNow",
  "withdrawableByDate",
  "committedCapital",
  "borrowingHeadroom",
];
function fixture(): Portfolio {
  return {
    source: "live",
    accountId: "section-fixture.near",
    capturedAt: new Date().toISOString(),
    errors: [],
    positions: [
      {
        id: "usdc-wallet",
        asset: "USDC",
        amount: "10",
        kind: "wallet",
        label: "Wallet USDC",
        chain: "near",
      },
      {
        id: "rhea-supplied-0",
        asset: "USDC",
        amount: "20",
        kind: "supplied",
        label: "Rhea USDC",
        chain: "near",
        availableAt: new Date().toISOString(),
      },
    ],
    sections: [
      {
        id: "near-usdc",
        status: "observed",
        capturedAt: new Date().toISOString(),
        reasons: [],
        positionIds: ["usdc-wallet"],
        affects: ["netWorth", "cashNow", "withdrawableByDate"],
      },
      {
        id: "rhea",
        status: "observed",
        capturedAt: new Date().toISOString(),
        reasons: [],
        positionIds: ["rhea-supplied-0"],
        affects: [
          "netWorth",
          "withdrawableByDate",
          "committedCapital",
          "borrowingHeadroom",
        ],
      },
    ],
  };
}
const fail = async () => {
  throw Error("Staking RPC unavailable (fixture)");
};
function workspace() {
  const w = personalSeed();
  w.accountId = "section-fixture.near";
  w.evmAddresses = { base: "0x" + "1".repeat(40), arb: "0x" + "2".repeat(40) };
  w.mandate.reserve = "1";
  w.mandate.cashAmount = "0";
  return w;
}
const adapters = {
  readPortfolio: async () => fixture(),
  readEvmUsdc: async (chain: "base" | "arb") => ({
    id: chain + "-usdc",
    asset: "USDC",
    amount: chain === "base" ? "3" : "4",
    kind: "wallet" as const,
    label: chain + " USDC",
    chain,
  }),
  readStaking: fail,
};
test("staking failure isolates its section and preserves NEAR, Rhea and both EVM balances", async () => {
  const w = workspace();
  const { portfolio: p, staking } = await workspacePortfolio(w, {}, adapters);
  assert.equal(p.errors.length, 0);
  assert.equal(staking.native.status, "unknown");
  assert.equal(p.positions.find((x) => x.id === "usdc-wallet")?.amount, "10");
  assert.equal(
    p.positions.find((x) => x.id === "rhea-supplied-0")?.amount,
    "20",
  );
  const b = usableBalances(p, ["2026-12-01"]);
  assert.equal(b.cashNow.amount, "17");
  assert.equal(b.cashNow.coverage, "complete");
  assert.equal(b.withdrawableByDate[0].amount, "37");
  assert.equal(b.committedCapital.amount, null);
  assert.equal(b.committedCapital.knownSubtotal, "20");
  assert.equal(b.netWorth.amount, null);
  assert.equal(b.netWorth.knownSubtotal, "37");
  assert.ok(
    b.excludedSections.some((s) => s.id === "staking" && s.amount === null),
  );
  const m = { ...demoMarket(), source: "live" as const };
  assert.notEqual(
    nextAction(w.mandate, m, p).title,
    "Balances are unavailable",
  );
});
test("one failed EVM wallet never hides other chain positions; unknown aggregate is not zero", async () => {
  const { portfolio: p } = await workspacePortfolio(
    workspace(),
    {},
    {
      ...adapters,
      readEvmUsdc: async (chain) => {
        if (chain === "base") throw Error("Base RPC unavailable");
        return adapters.readEvmUsdc(chain);
      },
    },
  );
  assert.equal(p.positions.find((x) => x.id === "arb-usdc")?.amount, "4");
  assert.ok(
    p.sections?.some((s) => s.id === "base-usdc" && s.status === "unavailable"),
  );
  assert.ok(p.positions.some((x) => x.id === "usdc-wallet"));
  const b = usableBalances(p, []);
  assert.equal(b.cashNow.amount, null);
  assert.equal(b.cashNow.knownSubtotal, "14");
  assert.equal(b.cashNow.coverage, "partial");
  assert.ok(b.cashNow.excludedSections?.some((s) => s.id === "base-usdc"));
});
test("a failed NEAR adapter still returns EVM evidence and refuses unknown Rhea cash actions", async () => {
  const w = workspace();
  const { portfolio: p } = await workspacePortfolio(
    w,
    {},
    {
      ...adapters,
      readPortfolio: async () => {
        throw Error("NEAR unavailable");
      },
    },
  );
  const b = usableBalances(p, []);
  assert.equal(b.cashNow.knownSubtotal, "7");
  assert.equal(b.cashNow.amount, null);
  assert.equal(p.positions.length, 2);
  assert.equal(
    nextAction(w.mandate, { ...demoMarket(), source: "live" }, p).kind,
    "none",
  );
});
test("Rhea-only failure does not poison observed cash and never claims debt or headroom is zero", () => {
  const p = fixture();
  p.positions = p.positions.filter((x) => !x.id.startsWith("rhea"));
  p.sections![1] = {
    ...p.sections![1],
    status: "unavailable",
    reasons: ["Rhea RPC failed"],
    positionIds: [],
  };
  const b = usableBalances(p, [], "0", "100");
  assert.equal(b.cashNow.amount, "10");
  assert.equal(b.borrowingHeadroom.amount, null);
  assert.equal(b.committedCapital.amount, null);
  assert.ok(b.committedCapital.excludedSections?.some((s) => s.id === "rhea"));
});

test("malformed NEAR or USDC amounts and malformed Rhea data only invalidate the affected adapter", async (t) => {
  const { fetchPortfolio, USDC } = await import("../lib/flowvault/near.ts");
  let failed = "near-native";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body));
      const q = request.params;
      let result: any;
      if (q.request_type === "view_account")
        result = {
          amount:
            failed === "near-native" ? "invalid" : "1000000000000000000000000",
        };
      else {
        let data: any;
        if (q.method_name === "ft_balance_of")
          data =
            q.account_id === USDC
              ? failed === "near-usdc"
                ? "invalid"
                : "10000000"
              : "0";
        else if (q.method_name === "get_account_all_positions")
          data =
            failed === "rhea"
              ? { supplied: [] }
              : {
                  supplied: [{ token_id: USDC, balance: "20000000" }],
                  positions: {},
                };
        else if (q.method_name === "get_assets_paged_detailed")
          data = [{ token_id: USDC, config: { extra_decimals: 0 } }];
        else throw Error("Unexpected request " + q.method_name);
        result = {
          result: [...new TextEncoder().encode(JSON.stringify(data))],
          block_height: 123,
        };
      }
      return Response.json({ jsonrpc: "2.0", result });
    },
  );
  for (failed of ["near-native", "near-usdc", "rhea"]) {
    const p = await fetchPortfolio("section-fixture.near");
    assert.equal(
      p.sections?.find((s) => s.id === failed)?.status,
      "unavailable",
    );
    for (const id of ["near-native", "near-usdc", "rhea"].filter(
      (x) => x !== failed,
    ))
      assert.equal(p.sections?.find((s) => s.id === id)?.status, "observed");
    assert.equal(p.errors.length, 0);
  }
});

test("fresh supply, withdrawal and payment inventory never depend on staking endpoints", async (t) => {
  const { freshSupply, freshWithdraw } = await import(
    "../lib/flowvault/prepare.ts"
  );
  const { paymentInventory } = await import(
    "../lib/flowvault/payment-inventory.ts"
  );
  const { USDC, RHEA } = await import("../lib/flowvault/near.ts");
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options?: RequestInit) => {
      const q = JSON.parse(String(options?.body)).params;
      calls.push(q.account_id + ":" + (q.method_name ?? q.request_type));
      assert.ok(
        [USDC, RHEA, "section-fixture.near"].includes(q.account_id),
        "unexpected dependency on staking or discovery",
      );
      let result: any;
      if (q.request_type === "view_account")
        result = {
          amount: "1000000000000000000000000",
          storage_usage: 100,
          block_height: 123,
        };
      else {
        const data: any =
          q.method_name === "ft_balance_of"
            ? "100000000"
            : q.method_name === "ft_metadata"
              ? { decimals: 6 }
              : q.method_name === "storage_balance_of"
                ? { total: "10000000000000000000000", available: "0" }
                : q.method_name === "storage_balance_bounds"
                  ? { min: "10000000000000000000000" }
                  : q.method_name === "get_config"
                    ? { contract_mode: "Running" }
                    : q.method_name === "get_account_all_positions"
                      ? {
                          account_id: "section-fixture.near",
                          supplied: [{ token_id: USDC, balance: "20000000" }],
                          positions: {
                            REGULAR_POSITION: { collateral: [], borrowed: [] },
                          },
                          is_locked: false,
                        }
                      : q.method_name === "get_assets_paged_detailed"
                        ? [
                            {
                              token_id: USDC,
                              supplied: { balance: "100000000" },
                              borrowed: { balance: "0" },
                              reserved: "0",
                              prot_fee: "0",
                              margin_debt: { balance: "0" },
                              margin_pending_debt: "0",
                              config: {
                                extra_decimals: 0,
                                can_deposit: true,
                                can_withdraw: true,
                              },
                            },
                          ]
                        : undefined;
        assert.notEqual(
          data,
          undefined,
          "unexpected preflight method " + q.method_name,
        );
        result = {
          result: [...new TextEncoder().encode(JSON.stringify(data))],
          block_height: 123,
        };
      }
      return Response.json({ jsonrpc: "2.0", result });
    },
  );
  const supply = await freshSupply("section-fixture.near", "1", "1");
  assert.equal(supply.amount, "1");
  const withdrawal = await freshWithdraw("section-fixture.near", "1");
  assert.equal(withdrawal.amount, "1");
  const sources = await paymentInventory("section-fixture.near");
  assert.equal(sources.wallet, "100");
  assert.equal(sources.rhea, "20");
  assert.equal(sources.reason, null);
  assert.ok(calls.length > 0);
});

test("unconfigured NEAR does not erase explicitly configured EVM wallet observations", async () => {
  const w = workspace();
  w.accountId = null;
  const { portfolio: p } = await workspacePortfolio(w, {}, adapters);
  assert.equal(p.errors.length, 0);
  assert.equal(
    p.sections?.find((s) => s.id === "near")?.status,
    "not-configured",
  );
  assert.equal(usableBalances(p, []).cashNow.amount, "7");
});
