// Strategy vaults (owner: Stream A).
//   GET  → the vaults this workspace follows, read live from each contract (final views) for every proven NEAR
//          account: holder views (shares, value, attributable exposure, costs, exit terms, queue position, claims),
//          owner/curator views when one of your accounts holds the role, disclosures (admin and upgrade keys checked
//          against the account's actual keys, the trusted NAV attestation) and any model/contract difference; plus
//          the workspace's vault listings and what custody readiness rests on. The example workspace shows one
//          fictional vault and nothing live.
//   POST → watch / unwatch a vault; listing_create / listing_advance / listing_amend for the publish flow. FlowVault
//          never deploys, publishes or signs: the owner signs the authorization (NEP-413) and deploys; publish
//          verification reads the deployed config, code exports and access keys from the chain itself.
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { proven } from "@/lib/flowvault/account-registry";
import { validAccount } from "@/lib/flowvault/near";
import { CHALLENGE_TTL_MS, b64, verifyNear, type Challenge } from "@/lib/flowvault/account-proof";
import { nearKeyPermission, saveChallenge, takeChallenge } from "@/lib/flowvault/account-proof-store";
import { exampleVault } from "@/lib/flowvault/vault-example";
import { deploymentEvidence, readVault, vaultConfig } from "@/lib/flowvault/vault-live";
import { listingGet, listingInsert, listingSave, listings, unwatch, watch, watched } from "@/lib/flowvault/vault-store";
import { CUSTODY_METHODS, advance, amend, authorizationMessage, listingDigest, readiness, type VaultListing, type VaultStage } from "@/lib/flowvault/vault-publish";
import { bookFromViews } from "@/lib/flowvault/vault-contract";
import type { StrategySpec } from "@/lib/flowvault/strategy-spec";
import { registeredKinds } from "@/lib/flowvault/step-adapters";
import { listAttempts } from "@/lib/flowvault/attempts";
import { planIdFor, planInsert, planGet } from "@/lib/flowvault/plans-store";
import { vaultPlan } from "@/lib/flowvault/vault-plans";
import { effectsOf } from "@/lib/flowvault/vault-ops-live";
import { isVaultKind, isVaultPreparation, vaultInPolicy, vaultPolicyEntries, type VaultPreparation } from "@/lib/flowvault/vault-ops";

/** Custody rests on the v1 contract interface (local implementation; not deployed or audited). Deployment re-checks the code. */
const READINESS = () => readiness({ interfaceDoc: "docs/handoff/vault-interface.md v1.5 (contracts/vault, not deployed, no security review)", verifiedMethods: CUSTODY_METHODS });

function nearAccounts(s: Awaited<ReturnType<typeof session>>): string[] {
  const ids = (s.workspace.accounts ?? []).filter((a) => a.chain === "near" && proven(a)).map((a) => a.address);
  return [...new Set([...(s.account ? [s.account] : []), ...ids])];
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    const rd = READINESS();
    if (s.workspace.mode !== "live") return json({ source: "example", vaults: [exampleVault()], listings: [], readiness: rd, accounts: [] }, s.cookie);
    const mine = nearAccounts(s);
    const ids = await watched(s.id);
    const vaults = await Promise.all(ids.map((id) => readVault(id, mine).catch((e) => ({ contractId: id, error: (e as Error).message }))));
    // Your vault requests from the wallet journal: confirmed effects (receipt- or vault-record-verified) and those in flight.
    const operations = (await listAttempts(s.id))
      .filter((a) => isVaultKind(a.kind) && isVaultPreparation(a.preparation))
      .map((a) => {
        const p = a.preparation as unknown as VaultPreparation;
        return { id: a.id, kind: a.kind, state: a.state, message: a.message, contractId: p.vault.contractId, detail: p.vault.detail, amountRaw: p.vault.amountRaw, sharesRaw: p.vault.sharesRaw, requestId: p.vault.requestId, hashes: a.hashes, effects: effectsOf(a), updatedAt: a.updatedAt };
      });
    const policy = s.workspace.policy;
    const policyAllowed = Object.fromEntries(ids.map((id) => [id, vaultInPolicy(policy, id)]));
    return json({ source: "live", vaults, operations, policyAllowed, signer: s.workspace.accountId ?? null, listings: (await listings(s.id)).map((x) => ({ ...x.listing, digest: x.listing.spec && x.listing.terms ? listingDigest(x.listing) : null })), readiness: rd, accounts: mine }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const account = z.string().refine(validAccount, "Not a NEAR account id.");
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("watch"), contractId: account }),
  z.object({ action: z.literal("unwatch"), contractId: account }),
  z.object({ action: z.literal("listing_create"), title: z.string().min(3).max(120), thesis: z.string().min(10).max(2000), venues: z.array(z.string().max(100)).max(10), origin: z.enum(["research", "monitor", "owner"]) }),
  z.object({ action: z.literal("listing_amend"), id: z.string(), spec: z.any().optional(), terms: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal("listing_challenge"), id: z.string() }),
  z.object({
    action: z.literal("plan"),
    key: z.string().uuid(),
    op: z.enum(["vault_deposit", "vault_redeem", "vault_cancel", "vault_claim", "vault_settle"]),
    contractId: account,
    amountRaw: z.string().regex(/^[1-9]\d{0,30}$/).optional(),
    sharesRaw: z.string().regex(/^[1-9]\d{0,40}$/).optional(),
    requestId: z.string().regex(/^\d{1,20}$/).optional(),
  }),
  z.object({
    action: z.literal("listing_advance"),
    id: z.string(),
    to: z.enum(["opportunity", "report_sourced", "spec_reviewed", "publish_authorized", "deployed", "open", "operating", "winding_down", "closed"]),
    report: z.object({ version: z.number().int(), summary: z.string().max(4000), risks: z.array(z.string().max(500)).max(30), sources: z.array(z.object({ url: z.string().max(500), title: z.string().max(200), capturedAt: z.string(), claim: z.string().max(1000) })).max(30) }).optional(),
    spec: z.any().optional(),
    terms: z.record(z.string(), z.unknown()).optional(),
    reviewer: z.string().max(100).optional(),
    signed: z.object({ challengeId: z.string(), accountId: account, publicKey: z.string(), signature: z.string() }).optional(),
    contractId: account.optional(),
    note: z.string().max(500).optional(),
  }),
]);

export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    if (s.workspace.mode !== "live") throw new Error("The example workspace's vault is fictional; switch to your own workspace.");
    const parsed = body.safeParse(await r.json().catch(() => null));
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "That request isn't valid.");
    const b = parsed.data;
    const now = Date.now();
    if (b.action === "watch") {
      await vaultConfig(b.contractId);
      await watch(s.id, b.contractId);
      return json({ ok: true }, s.cookie);
    }
    if (b.action === "unwatch") {
      await unwatch(s.id, b.contractId);
      return json({ ok: true }, s.cookie);
    }
    if (b.action === "plan") {
      // One owner action on one vault, as a plan with one wallet-signed step. Dry-run against live views first.
      if (!(await watched(s.id)).includes(b.contractId)) throw new Error("Follow this vault first.");
      if (!s.workspace.accountId) throw new Error("Sign in with your NEAR account to operate a vault.");
      const id = await planIdFor(s.id, b.key);
      const existing = await planGet(s.id, id);
      if (existing) return json({ plan: existing.plan, replay: true }, s.cookie);
      const plan = await vaultPlan(s, id, b.key, { op: b.op, contractId: b.contractId, accountId: s.workspace.accountId, amountRaw: b.amountRaw, sharesRaw: b.sharesRaw, requestId: b.requestId });
      const current = await session(r);
      if (current.revision !== s.revision) throw new Error("Workspace changed while the vault was read. Try again.");
      try {
        return json({ plan: await planInsert(s.id, plan), policyAllowed: vaultInPolicy(s.workspace.policy, b.contractId), policyNeeds: vaultPolicyEntries(b.contractId) }, s.cookie);
      } catch (e) {
        const activePlanId = (e as { activePlanId?: string }).activePlanId;
        if (activePlanId) return json({ error: (e as Error).message, activePlanId }, s.cookie, 409);
        throw e;
      }
    }
    if (b.action === "listing_create") {
      const at = new Date(now).toISOString();
      const l: VaultListing = {
        id: "vault-" + crypto.randomUUID(), stage: "opportunity", opportunity: { title: b.title, thesis: b.thesis, venues: b.venues, origin: b.origin, capturedAt: at },
        report: null, spec: null, terms: null, review: null, authorization: null, deployment: null, history: [], createdAt: at, updatedAt: at,
      };
      await listingInsert(s.id, l);
      return json({ listing: l }, s.cookie);
    }
    const { listing, revision } = await listingGet(s.id, b.id);
    if (b.action === "listing_amend") {
      const next = amend(listing, { spec: b.spec as StrategySpec | undefined, terms: b.terms });
      await listingSave(s.id, next, revision);
      return json({ listing: next }, s.cookie);
    }
    if (b.action === "listing_challenge") {
      if (listing.stage !== "spec_reviewed" || !listing.terms) throw new Error("Only a reviewed listing is signed for publishing.");
      const owner = String((listing.terms.admin as Record<string, unknown>)?.owner ?? "");
      const c: Challenge = {
        id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join(""), chain: "near", address: owner,
        message: authorizationMessage(listing), nonce: b64.encode(crypto.getRandomValues(new Uint8Array(32))), recipient: new URL(r.url).host,
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
      };
      await saveChallenge(s.id, c);
      return json({ challengeId: c.id, message: c.message, nonce: c.nonce, recipient: c.recipient, owner, digest: listingDigest(listing) }, s.cookie);
    }
    // listing_advance: evidence is gathered here (signature verified, chain read), never trusted from the client.
    const to = b.to as VaultStage;
    let authorization: VaultListing["authorization"] | undefined;
    if (to === "publish_authorized") {
      if (!b.signed) throw new Error("Publishing needs the owner's signature.");
      const c = await takeChallenge(s.id, b.signed.challengeId);
      if (now > Date.parse(c.expiresAt)) throw new Error("This signing request expired. Sign again.");
      if (c.message !== authorizationMessage(listing)) throw new Error("The listing changed after you were asked to sign. Sign the current terms.");
      await verifyNear(c, { accountId: b.signed.accountId, publicKey: b.signed.publicKey, signature: b.signed.signature }, nearKeyPermission);
      authorization = { digest: listingDigest(listing), signedBy: b.signed.accountId, publicKey: b.signed.publicKey, signedAt: new Date(now).toISOString(), method: "nep413" };
    }
    let deployment;
    if (to === "deployed") {
      if (!b.contractId) throw new Error("Name the contract account the owner deployed.");
      deployment = await deploymentEvidence(b.contractId);
    }
    let book;
    if ((to === "operating" || to === "closed") && listing.deployment) {
      const id = listing.deployment.contractId;
      const snap = await readVault(id, []);
      const vb = bookFromViews(snap.nav, snap.requests, []);
      book = { totalShares: vb.totalShares, pendingRedemptions: vb.pendingRedemptions.length + snap.requests.filter((q) => q.status === "claimable" || q.status === "claiming").length, settledDeposits: snap.requests.filter((q) => q.kind === "deposit" && q.status === "settled").length };
    }
    const next = advance(listing, to, {
      report: b.report, spec: b.spec as StrategySpec | undefined, terms: b.terms, reviewer: b.reviewer, kinds: registeredKinds(), readiness: READINESS(),
      authorization, deployment, book, note: b.note,
    }, new Date(now).toISOString());
    await listingSave(s.id, next, revision);
    return json({ listing: next }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
