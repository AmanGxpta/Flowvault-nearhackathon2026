// Autonomous mandates (owner: Stream C). Create a draft, change its terms, approve it with the owner's NEP-413
// signature over the terms digest, activate/pause/revoke, run it now, clear a freeze, and the account-wide kill
// switch. FlowVault never signs: a run prepares an owner-signed plan at most.
import { z } from "zod";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import type { AgentMandate } from "@/lib/flowvault/contracts";
import { STRATEGY_SPECS } from "@/lib/flowvault/strategy-spec";
import { strategyEligibility } from "@/lib/flowvault/strategy-eligibility";
import { registeredKinds } from "@/lib/flowvault/step-adapters";
import { approvalMessage, applyClock, draftMandate, mandateDigest, transition, validateMandate } from "@/lib/flowvault/mandate";
import { DELEGATION_OPTIONS } from "@/lib/flowvault/mandate-authority";
import { auditAppend, auditList, killSwitch, mandateGet, mandateInsert, mandateList, mandateSave } from "@/lib/flowvault/mandate-store";
import { changeState, resolveFreeze, runMandate, setKill } from "@/lib/flowvault/mandate-service";
import { b64, verifyNear, CHALLENGE_TTL_MS, type Challenge } from "@/lib/flowvault/account-proof";
import { nearKeyPermission, saveChallenge, takeChallenge } from "@/lib/flowvault/account-proof-store";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { units } from "@/lib/flowvault/money";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function supportedStrategies() {
  return strategyEligibility(registeredKinds()).filter((e) => e.eligible && e.spec.entry.includes("supply"));
}

/** GET /api/mandates[?id=] — mandates, kill switch, delegation options and (with id) the audit trail. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const id = new URL(r.url).searchParams.get("id");
    const now = Date.now();
    const rows = await mandateList(s.id);
    const mandates = rows.map(({ mandate }) => {
      const m = applyClock(mandate, now);
      return { ...m, digest: mandateDigest(m), signatureMatches: !!m.approval && m.approval.digest === mandateDigest(m), problems: validateMandate(m, STRATEGY_SPECS) };
    });
    return json(
      {
        source: s.workspace.mode,
        accountId: s.workspace.mode === "live" ? s.workspace.accountId : null,
        signedIn: s.account,
        killSwitchAt: await killSwitch(s.id),
        mandates,
        audit: id ? (await auditList(s.id, id)).reverse() : undefined,
        options: DELEGATION_OPTIONS,
        strategies: supportedStrategies().map((e) => ({ id: e.spec.id, title: e.spec.title, status: e.spec.status, exitHoursWorstCase: e.spec.liquidity.exitHoursWorstCase })),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}

const usdcText = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
const terms = z
  .object({
    title: z.string().min(1).max(80),
    validDays: z.number().int().min(1).max(90),
    capital: usdcText,
    perAction: usdcText,
    daily: usdcText,
    lifetime: usdcText,
    maxActionsPerDay: z.number().int().min(1).max(24),
    maxCost: usdcText,
    maxSlippageBps: z.number().int().min(0).max(500),
    maxLoss: usdcText,
    reserveFloor: usdcText,
    obligationBufferDays: z.number().int().min(0).max(30),
    quoteMaxAgeSec: z.number().int().min(5).max(600),
    evidenceMaxAgeSec: z.number().int().min(30).max(900),
    maxPositionPct: z.number().min(0.01).max(100),
    maxProtocolPct: z.number().min(0.01).max(100),
    maxChainPct: z.number().min(0.01).max(100),
    everyMinutes: z.number().int().min(15).max(10080),
    actions: z.array(z.enum(["deploy_surplus", "keep_allocation", "recall_for_obligation", "protective_exit"])).min(1).max(4),
  })
  .partial()
  .strict();

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), strategyId: z.string().max(80) }).strict(),
  z.object({ action: z.literal("update"), id: z.string().max(80), terms }).strict(),
  z.object({ action: z.literal("challenge"), id: z.string().max(80) }).strict(),
  z.object({ action: z.literal("approve"), id: z.string().max(80), challengeId: z.string().max(64), signature: z.string().max(200), publicKey: z.string().max(80), accountId: z.string().max(64) }).strict(),
  z.object({ action: z.enum(["activate", "pause", "resume", "revoke", "run", "unfreeze"]), id: z.string().max(80) }).strict(),
  z.object({ action: z.literal("kill"), on: z.boolean() }).strict(),
]);

function requireOwner(s: SessionInfo) {
  if (s.workspace.mode !== "live" || !s.workspace.accountId)
    throw new Error("Mandates run on your own live NEAR account. Open your workspace (not the example) first.");
  if (s.slot === "personal" && s.account !== s.workspace.accountId)
    throw new Error("Connect your NEAR wallet first. Mandates are saved with your NEAR account.");
  return s.workspace.accountId;
}

function applyTerms(m: AgentMandate, t: z.infer<typeof terms>, now: number): AgentMandate {
  const raw = (v: string | undefined, prev: string) => (v === undefined ? prev : units(v).toString());
  const bps = (v: number | undefined, prev: number) => (v === undefined ? prev : Math.round(v * 100));
  return {
    ...m,
    title: t.title ?? m.title,
    validUntil: t.validDays ? new Date(Date.parse(m.validFrom) + t.validDays * 864e5).toISOString() : m.validUntil,
    limits: {
      capitalUsdcRaw: raw(t.capital, m.limits.capitalUsdcRaw),
      perActionUsdcRaw: raw(t.perAction, m.limits.perActionUsdcRaw),
      dailyUsdcRaw: raw(t.daily, m.limits.dailyUsdcRaw),
      cumulativeUsdcRaw: raw(t.lifetime, m.limits.cumulativeUsdcRaw),
      maxActionsPerDay: t.maxActionsPerDay ?? m.limits.maxActionsPerDay,
      maxCostUsdcRaw: raw(t.maxCost, m.limits.maxCostUsdcRaw),
      maxSlippageBps: t.maxSlippageBps ?? m.limits.maxSlippageBps,
      maxStrategyLossUsdcRaw: raw(t.maxLoss, m.limits.maxStrategyLossUsdcRaw),
    },
    protection: { ...m.protection, reserveFloorUsdcRaw: raw(t.reserveFloor, m.protection.reserveFloorUsdcRaw), obligationBufferDays: t.obligationBufferDays ?? m.protection.obligationBufferDays },
    freshness: { quoteMaxAgeSec: t.quoteMaxAgeSec ?? m.freshness.quoteMaxAgeSec, evidenceMaxAgeSec: t.evidenceMaxAgeSec ?? m.freshness.evidenceMaxAgeSec },
    concentration: { maxPositionBps: bps(t.maxPositionPct, m.concentration.maxPositionBps), maxProtocolBps: bps(t.maxProtocolPct, m.concentration.maxProtocolBps), maxChainBps: bps(t.maxChainPct, m.concentration.maxChainBps) },
    schedule: { ...m.schedule, everyMinutes: t.everyMinutes ?? m.schedule.everyMinutes },
    scope: { ...m.scope, actions: t.actions ?? m.scope.actions },
    updatedAt: new Date(now).toISOString(),
  };
}

async function lifecycleNote(s: SessionInfo, m: AgentMandate, summary: string) {
  const at = new Date().toISOString();
  await auditAppend(s.id, [{ id: await keyedAttemptId(s.id, `mandate-audit:${m.id}:${at}:lifecycle:${summary.slice(0, 40)}`), mandateId: m.id, mandateVersion: m.version, runId: null, at, phase: "lifecycle", summary }]);
}

/** POST /api/mandates — see the action union above. */
export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await session(r);
    const now = Date.now();
    if (b.action === "kill") {
      const notes = await setKill(s, b.on, now);
      return json({ killSwitchAt: b.on ? new Date(now).toISOString() : null, notes }, s.cookie);
    }
    const accountId = requireOwner(s);
    if (b.action === "create") {
      const e = supportedStrategies().find((x) => x.spec.id === b.strategyId);
      if (!e) throw new Error("That strategy can't run under a mandate yet (only eligible USDC supply strategies can).");
      const id = "mdt_" + hex(crypto.getRandomValues(new Uint8Array(8)));
      const m = draftMandate({ id, accountId, source: "live", now, reserveUsdcRaw: units(s.workspace.mandate.reserve).toString(), strategy: e.spec });
      await mandateInsert(s.id, m);
      await lifecycleNote(s, m, "Draft created from strategy " + e.spec.id + ".");
      return json({ mandate: m }, s.cookie);
    }
    const stored = await mandateGet(s.id, b.id);
    if (!stored) throw new Error("Mandate not found.");
    const m = applyClock(stored.mandate, now);
    if (m.accountId !== accountId) throw new Error("This mandate belongs to another account.");

    if (b.action === "update") {
      if (!["draft", "approved", "paused"].includes(m.state)) throw new Error(`Pause the mandate before changing its terms (it is ${m.state}).`);
      const changed = applyTerms(m.state === "draft" ? m : transition(m, "draft", new Date(now).toISOString()), b.terms, now);
      const next = { ...changed, version: m.version + 1, approval: null };
      const problems = validateMandate(next, STRATEGY_SPECS);
      if (problems.length) throw new Error(problems.join(" "));
      await mandateSave(s.id, next, stored.revision);
      await lifecycleNote(s, next, `Terms changed (v${next.version}); needs your signature again.`);
      return json({ mandate: next }, s.cookie);
    }
    if (b.action === "challenge") {
      if (m.state !== "draft") throw new Error("Only a draft is signed. Change its terms to return it to draft.");
      const problems = validateMandate(m, STRATEGY_SPECS);
      if (problems.length) throw new Error(problems.join(" "));
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const c: Challenge = {
        id: hex(crypto.getRandomValues(new Uint8Array(16))),
        chain: "near",
        address: accountId,
        message: approvalMessage(m),
        nonce: b64.encode(nonce),
        recipient: new URL(r.url).host,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
      };
      await saveChallenge(s.id, c);
      return json({ challengeId: c.id, message: c.message, nonce: c.nonce, recipient: c.recipient, digest: mandateDigest(m) }, s.cookie);
    }
    if (b.action === "approve") {
      const c = await takeChallenge(s.id, b.challengeId);
      if (now > Date.parse(c.expiresAt)) throw new Error("This approval request expired. Sign again.");
      if (c.message !== approvalMessage(m)) throw new Error("The mandate changed after you were asked to sign. Sign the current terms.");
      await verifyNear(c, { accountId: b.accountId, publicKey: b.publicKey, signature: b.signature }, nearKeyPermission);
      const approved = transition({ ...m, approval: { digest: mandateDigest(m), signedBy: accountId, publicKey: b.publicKey, signedAt: new Date(now).toISOString(), method: "nep413" } }, "approved", new Date(now).toISOString());
      await mandateSave(s.id, approved, stored.revision);
      await lifecycleNote(s, approved, `Approved: owner's NEP-413 signature verified (full-access key ${b.publicKey.slice(0, 16)}…) over digest ${approved.approval!.digest.slice(0, 16)}….`);
      return json({ mandate: approved }, s.cookie);
    }
    if (b.action === "activate" || b.action === "resume") {
      if (await killSwitch(s.id)) throw new Error("The kill switch is on. Turn it off first.");
      return json(await changeState(s, m.id, "active", now), s.cookie);
    }
    if (b.action === "pause") return json(await changeState(s, m.id, "paused", now), s.cookie);
    if (b.action === "revoke") return json(await changeState(s, m.id, "revoked", now), s.cookie);
    if (b.action === "unfreeze") return json({ mandate: await resolveFreeze(s, m.id, now) }, s.cookie);
    // run now
    return json(await runMandate(s, m.id, "manual", now), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
