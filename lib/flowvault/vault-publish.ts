// Vault publish flow (owner: Stream A). Pure state machine for one vault listing:
//   opportunity → report_sourced → spec_reviewed → publish_authorized → deployed → open → operating → winding_down → closed
// Every step has a guard; FlowVault never deploys or publishes: the owner signs the authorization (NEP-413 over the
// listing digest) and deploys the contract; FlowVault then verifies the deployed configuration against the
// reviewed terms. Any change to the spec or terms after authorization returns the listing to spec_reviewed.
import { sha256 } from "@noble/hashes/sha2";
import type { StepKind } from "./contracts.ts";
import type { StrategySpec } from "./strategy-spec.ts";
import { validateStrategySpec } from "./strategy-spec.ts";
import { validateTerms, type VaultTerms } from "./vault.ts";

export type VaultStage = "opportunity" | "report_sourced" | "spec_reviewed" | "publish_authorized" | "deployed" | "open" | "operating" | "winding_down" | "closed";
export const NEXT: Record<VaultStage, VaultStage[]> = {
  opportunity: ["report_sourced"],
  report_sourced: ["spec_reviewed", "opportunity"],
  spec_reviewed: ["publish_authorized", "report_sourced"],
  publish_authorized: ["deployed", "spec_reviewed"],
  deployed: ["open"],
  open: ["operating", "winding_down"],
  operating: ["winding_down"],
  winding_down: ["closed"],
  closed: [],
};

/** What must exist before a pooled vault may be specified at all. Custody needs the deployed contract. */
export interface VaultReadiness {
  custody: boolean;
  shares: boolean;
  nav: boolean;
  fees: boolean;
  redemption: boolean;
  evidence: Partial<Record<"custody" | "shares" | "nav" | "fees" | "redemption", string>>;
}
/** Contract methods custody depends on (docs/handoff/vault-interface.md v1); a deployed vault's wasm must export all. */
export const CUSTODY_METHODS = ["ft_on_transfer", "settle_deposit", "cancel_deposit", "request_redeem", "cancel_redemption", "process_redemptions", "claim", "ft_balance_of", "ft_transfer", "get_config", "get_nav", "get_account", "get_requests", "report_nav", "set_status"];
/** The off-chain side (lib/flowvault/vault.ts) provides share accounting, NAV, fee crystallization and the queue. */
export function readiness(contract: { interfaceDoc: string; verifiedMethods: string[] } | null): VaultReadiness {
  const need = CUSTODY_METHODS;
  const custody = !!contract && need.every((m) => contract.verifiedMethods.includes(m));
  return {
    custody, shares: true, nav: true, fees: true, redemption: true,
    evidence: {
      custody: custody ? `contracts/vault per ${contract!.interfaceDoc}` : contract ? `contract interface missing: ${need.filter((m) => !contract.verifiedMethods.includes(m)).join(", ")}` : "contracts/vault does not exist yet",
      shares: "vault.ts sharesFor/assetsFor (virtual offset, rounds against the actor)",
      nav: "vault.ts nav() from shared valuations; unknown → null",
      fees: "vault.ts crystallize() (management per second, HWM performance, curator/platform split)",
      redemption: "vault.ts requestRedemption/settle (notice, FIFO, partial by liquidity)",
    },
  };
}
export const ready = (r: VaultReadiness) => r.custody && r.shares && r.nav && r.fees && r.redemption;

export interface SourcedReport {
  version: number;
  sources: { url: string; title: string; capturedAt: string; claim: string }[];
  risks: string[];
  summary: string;
}
export interface VaultListing {
  id: string;
  stage: VaultStage;
  opportunity: { title: string; thesis: string; venues: string[]; origin: "research" | "monitor" | "owner"; capturedAt: string };
  report: SourcedReport | null;
  spec: StrategySpec | null;
  /** VaultTerms with bigints as decimal strings (JSON-safe). */
  terms: Record<string, unknown> | null;
  review: { by: string; at: string } | null;
  authorization: { digest: string; signedBy: string; publicKey: string; signedAt: string; method: "nep413" } | null;
  deployment: { contractId: string; verifiedAt: string; mismatches: string[] } | null;
  history: { at: string; from: VaultStage; to: VaultStage; note: string }[];
  createdAt: string;
  updatedAt: string;
}

/* ───────────── serialization and digest ───────────── */

export function termsToJson(t: VaultTerms): Record<string, unknown> {
  return JSON.parse(JSON.stringify(t, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
export function termsFromJson(j: Record<string, unknown>): VaultTerms {
  const t = structuredClone(j) as unknown as VaultTerms & Record<string, unknown>;
  for (const k of ["virtualShares", "virtualAssets", "capacityRaw"] as const) (t as unknown as Record<string, bigint>)[k] = BigInt(String(j[k]));
  t.perDepositorCapRaw = j.perDepositorCapRaw == null ? null : BigInt(String(j.perDepositorCapRaw));
  return t;
}
const canonical = (v: unknown): string =>
  v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",") + "}";
/** What the owner signs: the reviewed spec and terms, nothing else. */
export function listingDigest(l: Pick<VaultListing, "id" | "spec" | "terms">): string {
  return Array.from(sha256(new TextEncoder().encode(canonical({ id: l.id, spec: l.spec, terms: l.terms }))), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const authorizationMessage = (l: VaultListing) => `FlowVault: I authorize publishing vault ${l.id} with the reviewed strategy and terms (digest ${listingDigest(l)}). I deploy and own it; FlowVault never deploys or holds keys.`;

/* ───────────── guards ───────────── */

export function reportProblems(r: SourcedReport | null): string[] {
  if (!r) return ["A sourced report is required."];
  const p: string[] = [];
  const good = r.sources.filter((s) => /^https:\/\//.test(s.url) && Number.isFinite(Date.parse(s.capturedAt)) && s.claim.trim().length > 0);
  if (good.length < 2) p.push("At least two sources, each with an https link, a capture date and the claim it supports.");
  if (!r.risks.length) p.push("The report must list the risks.");
  return p;
}

export function specProblems(spec: StrategySpec | null, terms: Record<string, unknown> | null, kinds: StepKind[], rd: VaultReadiness): string[] {
  if (!spec || !terms) return ["A strategy spec and vault terms are required."];
  const p: string[] = [];
  if (spec.kind !== "pooled_vault") p.push("A vault listing needs a pooled_vault spec.");
  p.push(...validateStrategySpec(spec, kinds, { vaultReady: ready(rd), vaultMissing: (Object.keys(rd.evidence) as (keyof VaultReadiness["evidence"])[]).filter((k) => !rd[k]) }));
  try {
    p.push(...validateTerms(termsFromJson(terms)));
  } catch (e) {
    p.push("Terms don't parse: " + (e as Error).message);
  }
  return p;
}

export const NEAR_USDC_ID = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** The contract's get_config keys and units for each reviewed term (null = JSON null; notice is in milliseconds). */
export function expectedConfig(terms: VaultTerms): Record<string, string | null> {
  return {
    single_depositor: terms.mode === "single_depositor" ? terms.admin.owner : null,
    owner_id: terms.admin.owner,
    curator_id: terms.admin.curator,
    platform_id: terms.admin.feeRecipients.platform,
    asset_id: NEAR_USDC_ID,
    asset_decimals: String(terms.assetDecimals),
    share_decimals: String(terms.shareDecimals),
    management_fee_bps: String(terms.fees.managementBps),
    performance_fee_bps: String(terms.fees.performanceBps),
    curator_fee_share_bps: String(terms.fees.curatorShareBps),
    capacity_raw: terms.capacityRaw.toString(),
    // The contract always has a per-depositor cap; "no cap" in the terms means a cap equal to capacity.
    per_depositor_cap_raw: (terms.perDepositorCapRaw ?? terms.capacityRaw).toString(),
    max_position_bps: String(terms.maxPositionBps),
    liquidity_target_bps: String(terms.redemption.liquidityTargetBps),
    redemption_notice_ms: String(terms.redemption.noticeSeconds * 1000),
    virtual_shares_raw: terms.virtualShares.toString(),
    virtual_assets_raw: terms.virtualAssets.toString(),
  };
}
const shown = (v: unknown) => (v === undefined ? "missing" : v === null ? "null" : String(v));
/** Compares the deployed contract's get_config view with the reviewed terms; any difference blocks opening. */
export function configMismatches(terms: VaultTerms, view: Record<string, unknown>): string[] {
  return Object.entries(expectedConfig(terms))
    .filter(([k, v]) => (v === null ? view[k] !== null : view[k] === undefined || view[k] === null || String(view[k]) !== v))
    .map(([k, v]) => `${k}: deployed ${shown(view[k])}, reviewed ${v ?? "null"}`);
}

/** The wasm must export every custody method, and every actual full-access key must be disclosed in the config. */
export function deploymentProblems(d: { configView: Record<string, unknown>; exports: string[]; fullAccessKeys: string[] }): string[] {
  const p: string[] = [];
  const missing = CUSTODY_METHODS.filter((m) => !d.exports.includes(m));
  if (missing.length) p.push(`contract code doesn't export: ${missing.join(", ")}`);
  const disclosed = Array.isArray(d.configView.disclosed_upgrade_keys) ? (d.configView.disclosed_upgrade_keys as unknown[]).map(String) : [];
  const hidden = d.fullAccessKeys.filter((k) => !disclosed.includes(k));
  if (hidden.length) p.push(`undisclosed full-access keys (they can replace the code): ${hidden.join(", ")}`);
  return p;
}

export interface AdvanceInput {
  report?: SourcedReport;
  spec?: StrategySpec;
  terms?: Record<string, unknown>;
  reviewer?: string;
  kinds?: StepKind[];
  readiness?: VaultReadiness;
  /** Already verified NEP-413 signature (account-proof.ts) over authorizationMessage(). */
  authorization?: VaultListing["authorization"];
  /** Read from NEAR RPC: get_config, the deployed wasm's exported methods, and the account's actual full-access keys. */
  deployment?: { contractId: string; configView: Record<string, unknown>; exports: string[]; fullAccessKeys: string[] };
  book?: { totalShares: bigint; pendingRedemptions: number; settledDeposits: number };
  note?: string;
}

export function advance(l0: VaultListing, to: VaultStage, i: AdvanceInput, now = new Date().toISOString()): VaultListing {
  if (!NEXT[l0.stage].includes(to)) throw new Error(`A ${l0.stage} listing can't move to ${to}.`);
  const l: VaultListing = structuredClone(l0);
  const fail = (p: string[]) => {
    if (p.length) throw new Error(p.join(" "));
  };
  if (to === "report_sourced") {
    fail(reportProblems(i.report ?? null));
    l.report = i.report!;
  }
  if (to === "spec_reviewed" && l0.stage === "report_sourced") {
    if (!i.reviewer) throw new Error("Name who reviewed the spec.");
    fail(specProblems(i.spec ?? null, i.terms ?? null, i.kinds ?? [], i.readiness ?? readiness(null)));
    l.spec = i.spec!;
    l.terms = i.terms!;
    l.review = { by: i.reviewer, at: now };
  }
  if (to === "spec_reviewed" && l0.stage === "publish_authorized") l.authorization = null;
  if (to === "publish_authorized") {
    const a = i.authorization;
    if (!a || a.method !== "nep413") throw new Error("Publishing needs the owner's signature.");
    if (a.digest !== listingDigest(l)) throw new Error("The signature is for different terms. Sign the current reviewed terms.");
    const owner = l.terms ? String((l.terms.admin as Record<string, unknown>)?.owner ?? "") : "";
    if (a.signedBy !== owner) throw new Error("Only the vault's disclosed owner can authorize publishing.");
    l.authorization = a;
  }
  if (to === "deployed") {
    if (!i.deployment) throw new Error("Deployment evidence is required (the owner deploys).");
    const d = i.deployment;
    const mismatches = [
      ...configMismatches(termsFromJson(l.terms!), d.configView),
      ...deploymentProblems(d),
    ];
    l.deployment = { contractId: i.deployment.contractId, verifiedAt: now, mismatches };
    if (mismatches.length) throw new Error("The deployed vault doesn't match the reviewed terms: " + mismatches.join("; "));
  }
  if (to === "operating" && !(i.book && i.book.settledDeposits > 0)) throw new Error("A vault starts operating after its first settled deposit.");
  if (to === "closed" && !(i.book && i.book.totalShares === 0n && i.book.pendingRedemptions === 0)) throw new Error("A vault closes only after every holder has been paid.");
  l.history.push({ at: now, from: l0.stage, to, note: i.note ?? "" });
  l.stage = to;
  l.updatedAt = now;
  return l;
}

/** Editing the spec or terms after authorization invalidates it. */
export function amend(l0: VaultListing, change: { spec?: StrategySpec; terms?: Record<string, unknown> }, now = new Date().toISOString()): VaultListing {
  if (!["spec_reviewed", "publish_authorized"].includes(l0.stage)) throw new Error("Only a reviewed, not yet deployed listing can be amended.");
  const l = structuredClone(l0);
  if (change.spec) l.spec = change.spec;
  if (change.terms) l.terms = change.terms;
  if (l.stage === "publish_authorized") {
    l.history.push({ at: now, from: l.stage, to: "spec_reviewed", note: "Terms changed after authorization; the owner must sign again." });
    l.stage = "spec_reviewed";
  }
  l.authorization = null;
  l.updatedAt = now;
  return l;
}
