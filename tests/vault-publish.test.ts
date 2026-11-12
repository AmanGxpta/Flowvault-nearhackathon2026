import test from "node:test";
import assert from "node:assert/strict";
import { advance, amend, authorizationMessage, configMismatches, listingDigest, readiness, termsFromJson, termsToJson, type VaultListing } from "../lib/flowvault/vault-publish.ts";
import { validateStrategySpec, type StrategySpec } from "../lib/flowvault/strategy-spec.ts";
import type { VaultTerms } from "../lib/flowvault/vault.ts";

const at = "2026-11-13T00:00:00.000Z";
const terms: VaultTerms = {
  id: "v1", specId: "rhea-usdc-pool", specVersion: 1, asset: "USDC", assetDecimals: 6, shareDecimals: 12, virtualShares: 1_000_000n, virtualAssets: 1n, mode: "pooled",
  fees: { managementBps: 100, performanceBps: 1000, curatorShareBps: 8000, platformShareBps: 2000 }, capacityRaw: 500_000_000000n, perDepositorCapRaw: null, maxPositionBps: 9000,
  redemption: { noticeSeconds: 86_400, liquidityTargetBps: 1000 },
  admin: { owner: "owner.near", curator: "curator.near", pauseGuardian: null, upgradeAuthority: null, feeRecipients: { curator: "curator.near", platform: "flowvault.near" } },
};
const spec: StrategySpec = {
  id: "rhea-usdc-pool", version: 1, kind: "pooled_vault", title: "Rhea USDC pool", status: "reviewed", research: { reportRef: "r1", reviewedBy: "owner.near", reviewedAt: at },
  assets: [{ asset: "USDC", chain: "near", role: "input" }], venues: [{ id: "contract.main.burrow.near", methods: ["execute"] }], entry: ["supply"], exit: ["withdraw"],
  limits: { maxCapitalUsdcRaw: "500000000000", minCapitalUsdcRaw: "0", maxEntryCostUsdcRaw: "1000000", maxExitCostUsdcRaw: "1000000", maxSlippageBps: 10, surplusOnly: true },
  liquidity: { exitHoursWorstCase: 1, respectsObligationDates: true, minVenueLiquidityUsdcRaw: null },
  monitoring: [{ condition: "rate_below", threshold: "0.02", response: "alert" }], accounting: { emits: ["position_entry", "position_exit", "yield", "fee"], yieldBasis: "Rhea supply APR", forecastSeparateFromRealized: true },
  shutdown: { trigger: ["owner_request"], steps: ["withdraw"], destination: "owner_wallet" },
};
const listing = (): VaultListing => ({ id: "v1", stage: "opportunity", opportunity: { title: "Rhea USDC", thesis: "t", venues: ["rhea"], origin: "research", capturedAt: at }, report: null, spec: null, terms: null, review: null, authorization: null, deployment: null, history: [], createdAt: at, updatedAt: at });
const report = { version: 1, summary: "s", risks: ["Rhea oracle risk"], sources: [{ url: "https://docs.rhea.finance", title: "Rhea docs", capturedAt: at, claim: "supply APR" }, { url: "https://nearblocks.io", title: "explorer", capturedAt: at, claim: "TVL" }] };
const ready = readiness({ interfaceDoc: "docs/handoff/vault-interface.md", verifiedMethods: ["deposit", "request_redeem", "settle", "claim", "share_balance_of", "vault_config", "pause", "shutdown"] });

test("pooled vaults stay rejected until custody exists; the off-chain mechanics alone don't lift it", () => {
  assert.equal(readiness(null).custody, false);
  assert.ok(validateStrategySpec(spec, ["supply", "withdraw"]).some((p) => /Pooled vaults need/.test(p)), "default call unchanged");
  const missing = validateStrategySpec(spec, ["supply", "withdraw"], { vaultReady: false, vaultMissing: ["custody"] });
  assert.ok(missing.some((p) => /Missing: custody/.test(p)));
  assert.deepEqual(validateStrategySpec(spec, ["supply", "withdraw"], { vaultReady: true, vaultMissing: [] }), []);
});

test("publish flow: report needs sources and risks; spec review needs readiness; only the owner authorizes the exact digest", () => {
  let l = listing();
  assert.throws(() => advance(l, "report_sourced", { report: { ...report, sources: report.sources.slice(0, 1) } }), /two sources/);
  l = advance(l, "report_sourced", { report });
  const t = termsToJson(terms);
  assert.throws(() => advance(l, "spec_reviewed", { spec, terms: t, reviewer: "owner.near", kinds: ["supply", "withdraw"], readiness: readiness(null) }), /Pooled vaults need/);
  l = advance(l, "spec_reviewed", { spec, terms: t, reviewer: "owner.near", kinds: ["supply", "withdraw"], readiness: ready });
  const digest = listingDigest(l);
  assert.match(authorizationMessage(l), new RegExp(digest));
  const sig = { digest, signedBy: "owner.near", publicKey: "ed25519:x", signedAt: at, method: "nep413" as const };
  assert.throws(() => advance(l, "publish_authorized", { authorization: { ...sig, signedBy: "curator.near" } }), /disclosed owner/);
  assert.throws(() => advance(l, "publish_authorized", { authorization: { ...sig, digest: "00" } }), /different terms/);
  l = advance(l, "publish_authorized", { authorization: sig });
  const changed = amend(l, { terms: termsToJson({ ...terms, fees: { ...terms.fees, performanceBps: 2000 } }) });
  assert.equal(changed.stage, "spec_reviewed");
  assert.equal(changed.authorization, null, "a changed fee needs a new signature");
  assert.throws(() => advance(l, "deployed", {}), /owner deploys/);
  const view = { mode: "pooled", capacity_raw: "500000000000", management_bps: "100", performance_bps: "1000", curator_share_bps: "8000", notice_seconds: "86400", owner: "owner.near", curator: "curator.near", virtual_shares: "1000000", virtual_assets: "1" };
  assert.throws(() => advance(l, "deployed", { deployment: { contractId: "v1.vaults.near", configView: { ...view, performance_bps: "3000" } } }), /performance_bps/);
  l = advance(l, "deployed", { deployment: { contractId: "v1.vaults.near", configView: view } });
  l = advance(l, "open", {});
  assert.throws(() => advance(l, "operating", { book: { totalShares: 0n, pendingRedemptions: 0, settledDeposits: 0 } }), /first settled deposit/);
  l = advance(l, "operating", { book: { totalShares: 10n, pendingRedemptions: 0, settledDeposits: 1 } });
  l = advance(l, "winding_down", {});
  assert.throws(() => advance(l, "closed", { book: { totalShares: 5n, pendingRedemptions: 1, settledDeposits: 1 } }), /every holder/);
  l = advance(l, "closed", { book: { totalShares: 0n, pendingRedemptions: 0, settledDeposits: 1 } });
  assert.deepEqual(l.history.map((h) => h.to), ["report_sourced", "spec_reviewed", "publish_authorized", "deployed", "open", "operating", "winding_down", "closed"]);
  assert.throws(() => advance(l, "open", {}), /can't move/);
});

test("terms round-trip through JSON and config mismatches are named", () => {
  assert.deepEqual(termsFromJson(termsToJson(terms)), terms);
  assert.deepEqual(configMismatches(terms, {}).length, 10);
});
