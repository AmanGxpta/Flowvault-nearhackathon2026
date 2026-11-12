import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUSTODY_METHODS, advance, amend, authorizationMessage, configMismatches, deploymentProblems, listingDigest, readiness, termsFromJson, termsToJson, type VaultListing } from "../lib/flowvault/vault-publish.ts";
import { validateStrategySpec, type StrategySpec } from "../lib/flowvault/strategy-spec.ts";
import type { VaultTerms } from "../lib/flowvault/vault.ts";

const at = "2026-11-13T00:00:00.000Z";
const terms: VaultTerms = {
  id: "v1", specId: "rhea-usdc-pool", specVersion: 1, asset: "USDC", assetDecimals: 6, shareDecimals: 18, virtualShares: 1_000_000_000_000n, virtualAssets: 1n, mode: "pooled",
  fees: { managementBps: 0, performanceBps: 1500, curatorShareBps: 7000, platformShareBps: 3000 }, capacityRaw: 1_000_000_000000n, perDepositorCapRaw: 100_000_000000n, maxPositionBps: 8000,
  redemption: { noticeSeconds: 0, liquidityTargetBps: 2000 },
  admin: { owner: "owner.near", curator: "curator.near", pauseGuardian: null, upgradeAuthority: null, feeRecipients: { curator: "curator.near", platform: "platform.near" } },
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
const ready = readiness({ interfaceDoc: "docs/handoff/vault-interface.md", verifiedMethods: CUSTODY_METHODS });
/** The contract's actual get_config output (tests/fixtures/vault/contract-views.json, generated from contracts/vault). */
const realConfig = JSON.parse(readFileSync(new URL("./fixtures/vault/contract-views.json", import.meta.url), "utf8")).config as Record<string, unknown>;
const deployed = (configView: Record<string, unknown>, over: Partial<{ exports: string[]; fullAccessKeys: string[] }> = {}) => ({ contractId: "v1.vaults.near", configView, exports: CUSTODY_METHODS, fullAccessKeys: [], ...over });

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
  assert.throws(() => advance(l, "deployed", { deployment: deployed({ ...realConfig, performance_fee_bps: 3000 }) }), /performance_fee_bps: deployed 3000, reviewed 1500/);
  assert.throws(() => advance(l, "deployed", { deployment: deployed(realConfig, { exports: CUSTODY_METHODS.filter((m) => m !== "claim") }) }), /doesn't export: claim/);
  assert.throws(() => advance(l, "deployed", { deployment: deployed(realConfig, { fullAccessKeys: ["ed25519:hidden"] }) }), /undisclosed full-access keys/);
  l = advance(l, "deployed", { deployment: deployed({ ...realConfig, disclosed_upgrade_keys: ["ed25519:k"] }, { fullAccessKeys: ["ed25519:k"] }) });
  assert.deepEqual(l.deployment!.mismatches, []);
  l = advance(l, "open", {});
  assert.throws(() => advance(l, "operating", { book: { totalShares: 0n, pendingRedemptions: 0, settledDeposits: 0 } }), /first settled deposit/);
  l = advance(l, "operating", { book: { totalShares: 10n, pendingRedemptions: 0, settledDeposits: 1 } });
  l = advance(l, "winding_down", {});
  assert.throws(() => advance(l, "closed", { book: { totalShares: 5n, pendingRedemptions: 1, settledDeposits: 1 } }), /every holder/);
  l = advance(l, "closed", { book: { totalShares: 0n, pendingRedemptions: 0, settledDeposits: 1 } });
  assert.deepEqual(l.history.map((h) => h.to), ["report_sourced", "spec_reviewed", "publish_authorized", "deployed", "open", "operating", "winding_down", "closed"]);
  assert.throws(() => advance(l, "open", {}), /can't move/);
});

test("config check uses get_config's real keys and units (fixture from the contract)", () => {
  assert.deepEqual(termsFromJson(termsToJson(terms)), terms);
  assert.deepEqual(configMismatches(terms, realConfig), [], "the reviewed terms match the contract's own output");
  assert.equal(configMismatches(terms, {}).length, 17, "every key missing is named (single_depositor must be an explicit null)");
  assert.deepEqual(configMismatches({ ...terms, redemption: { ...terms.redemption, noticeSeconds: 86_400 } }, realConfig), ["redemption_notice_ms: deployed 0, reviewed 86400000"], "notice is compared in milliseconds");
  assert.deepEqual(configMismatches({ ...terms, mode: "single_depositor" }, realConfig), ["single_depositor: deployed null, reviewed owner.near"]);
  assert.deepEqual(configMismatches(terms, { ...realConfig, single_depositor: "owner.near" }), ["single_depositor: deployed owner.near, reviewed null"]);
  assert.deepEqual(configMismatches({ ...terms, perDepositorCapRaw: null }, { ...realConfig, per_depositor_cap_raw: realConfig.capacity_raw }), [], "no cap = a cap equal to capacity");
  assert.deepEqual(deploymentProblems({ configView: realConfig, exports: CUSTODY_METHODS, fullAccessKeys: [] }), []);
});
