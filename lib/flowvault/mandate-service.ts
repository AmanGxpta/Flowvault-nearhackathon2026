// Mandate runner (owner: Stream C). Observe → Decide → Check → Execute → Account, through the existing layers:
// capitalView() for every figure, StrategySpec for what may run, ActionPlan + StepAdapter journals for execution,
// plan ledger entries for results, and an append-only audit linking all of it. With owner_signs_each authority
// (the only one provisioned today) "execute" means: a reviewed plan sized within the mandate, waiting for the
// owner's wallet. FlowVault never signs.
import type { ActionPlan, AgentMandate, MandateAuditEntry } from "./contracts";
import type { Workspace } from "./types";
import { STRATEGY_SPECS } from "./strategy-spec";
import {
  applyClock, checkAction, decide, planOutcome, transition, usageFrom, usdc,
  type Advice, type MandateObservation, type ProposedAction, type UsageEvent,
} from "./mandate";
import { auditAppend, auditList, killSwitch, mandateGet, mandateList, mandateSave } from "./mandate-store";
import { keyedAttemptId } from "./preparation-key";
import { workspacePortfolio } from "./portfolio-service";
import { readValuationEvidence } from "./valuation-evidence";
import { capitalView, dueInHorizon, usdcInFlightRaw } from "./valuation";
import { listActiveAttempts } from "./attempts";
import { units } from "./money";
import { planGet, planIdFor, planInsert, planSave } from "./plans-store";
import { applyExpiry, applyFence, cancel, inFlight, isTerminal, planContext, settle } from "./plans";
import { evaluatePlan, reviewChoice, type StoredPlan } from "./plans-service";

export interface MandateSession {
  id: string;
  workspace: Workspace;
  revision: number;
}

const RHEA = "contract.main.burrow.near";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────── audit helpers ───────────── */

async function entry(sessionId: string, m: AgentMandate, runId: string | null, phase: MandateAuditEntry["phase"], summary: string, extra: Partial<MandateAuditEntry> = {}, at = new Date().toISOString()) {
  const id = await keyedAttemptId(sessionId, `mandate-audit:${m.id}:${runId ?? at}:${phase}:${extra.planId ?? ""}:${summary.slice(0, 60)}`);
  return { id, mandateId: m.id, mandateVersion: m.version, runId, at, phase, summary, ...extra } satisfies MandateAuditEntry;
}
function usageEvents(audit: MandateAuditEntry[]): UsageEvent[] {
  return audit.flatMap((e) => {
    const u = (e.data as { usage?: UsageEvent } | undefined)?.usage;
    return u ? [u] : [];
  });
}

/* ───────────── observe ───────────── */

async function observe(s: MandateSession, m: AgentMandate, audit: MandateAuditEntry[], now: number) {
  const w = s.workspace;
  const [{ portfolio }, evidence, active, kill] = await Promise.all([
    workspacePortfolio(w),
    readValuationEvidence(w, { quotes: false }),
    w.mode === "demo" ? Promise.resolve([]) : listActiveAttempts(s.id),
    killSwitch(s.id),
  ]);
  const stressBps = Object.fromEntries((w.policy?.creditRows ?? []).map((x) => [x.assetId, x.drawdownBps]));
  const view = capitalView(w, portfolio, evidence, { now, committedRaw: usdcInFlightRaw(active, portfolio.accountId), stressBps });

  // Reconcile every plan this mandate created from its journal-verified state.
  const results: MandateAuditEntry[] = [];
  const openPlanIds: string[] = [];
  const uncertain: MandateObservation["uncertain"] = active
    .filter((a) => a.state === "unknown" || a.state === "partial")
    .map((a) => ({ ref: "attempt " + a.id, state: a.state }));
  const done = new Set(audit.filter((e) => e.phase === "result" && e.planId).map((e) => e.planId));
  const ctx = planContext(w, s.revision);
  for (const e of audit.filter((x) => x.phase === "execute" && x.planId && !done.has(x.planId))) {
    const stored = await planGet(s.id, e.planId!);
    if (!stored) continue;
    const plan = stored.plan;
    applyExpiry(plan, now);
    applyFence(plan, ctx, now);
    settle(plan, now);
    await planSave(s.id, plan, stored.previous).catch(() => undefined);
    const out = planOutcome(plan);
    const committed = (e.data as { usage?: UsageEvent } | undefined)?.usage;
    if (out.status === "open") openPlanIds.push(plan.id);
    else if (out.status === "uncertain") {
      openPlanIds.push(plan.id);
      uncertain.push({ ref: "plan " + plan.id, state: out.detail });
    } else
      results.push(
        await entry(s.id, m, null, "result", out.status === "confirmed" ? `Confirmed: deployed ${out.deployedDeltaUsdcRaw.startsWith("-") ? "−" + usdc(out.deployedDeltaUsdcRaw.slice(1)) : "+" + usdc(out.deployedDeltaUsdcRaw)} USDC. ${out.detail}` : `Released: ${out.detail}`, {
          planId: plan.id,
          ledgerEntryIds: out.ledgerEntryIds,
          txHashes: out.txHashes,
          data: {
            usage: {
              at: new Date(now).toISOString(),
              kind: committed?.kind ?? "deploy_surplus",
              amountUsdcRaw: committed?.amountUsdcRaw ?? "0",
              status: out.status === "confirmed" ? "confirmed" : "released",
              deployedDeltaUsdcRaw: out.deployedDeltaUsdcRaw,
              planId: plan.id,
            } satisfies UsageEvent,
          },
        }, new Date(now).toISOString()),
      );
  }
  const events = usageEvents([...audit, ...results]);
  const deployedBook = usageFrom(events, now, "0", []).deployedUsdcRaw;

  // Mandate positions: Rhea USDC supply, bounded by what the mandate itself deployed (never the owner's other supply).
  const owner = portfolio.positions.filter((p) => p.ownership !== "watched");
  const rheaSupplied = owner.filter((p) => p.id.startsWith("rhea-") && p.kind === "supplied" && p.asset === "USDC").reduce((n, p) => n + units(p.amount), 0n);
  const rheaKnown = !(portfolio.sections ?? []).some((x) => x.id.includes("rhea") && x.status !== "observed");
  const deployed = BigInt(deployedBook);
  let unrealized: string | null = "0";
  if (deployed > 0n) {
    if (!rheaKnown) unrealized = null;
    else if (rheaSupplied < deployed)
      uncertain.push({ ref: "Rhea supply", state: `holds ${usdc(rheaSupplied)} USDC but the mandate deployed ${usdc(deployed)}; withdrawn outside the mandate or a loss — review before it runs again` });
  }
  const exposure = owner.map((p) => {
    const v = view.valuations.find((x) => x.positionId === p.id && x.kind === "observed");
    const venue = p.id.startsWith("rhea-") ? RHEA : p.kind === "wallet" ? "wallet" : (p.venue ?? p.asset);
    return { positionId: p.id, venue, protocol: venue, chain: String(p.chain ?? "near"), usdcRaw: v?.usdcRaw ?? null };
  });
  const observation: MandateObservation = {
    now,
    capital: {
      spendableNowUsdcRaw: view.spendableNowUsdcRaw,
      holdbackUsdcRaw: view.holdbackUsdcRaw,
      surplusUsdcRaw: view.surplusUsdcRaw,
      reserveUsdcRaw: view.reserveUsdcRaw,
      netWorthUsdcRaw: view.netWorthUsdcRaw,
      debtUsdcRaw: view.debtUsdcRaw,
      blocksAutomation: view.blocksAutomation,
      capturedAt: portfolio.capturedAt,
      reasons: view.reasons,
    },
    horizonDays: w.mandate.horizon,
    obligations: dueInHorizon(w.mandate, w.obligations, now).map((o) => {
      const r = view.reservations.find((x) => x.obligationId === o.id);
      return { id: o.id, dueDate: o.dueDate, reserveUsdcRaw: r && !r.unavailableReason ? r.reserveUsdcRaw : null };
    }),
    exposure,
    recallable: deployed > 0n ? [{ venue: RHEA, strategyId: "rhea-usdc-surplus", usdcRaw: (rheaSupplied < deployed ? rheaSupplied : deployed).toString() }] : [],
    uncertain,
    killSwitch: !!kill,
    usage: usageFrom(events, now, unrealized, openPlanIds),
  };
  return { observation, results };
}

/* ───────────── execute (owner-signed plan) ───────────── */

async function execute(s: MandateSession, m: AgentMandate, a: ProposedAction, runId: string, o: MandateObservation) {
  const key = `mandate:${m.id}:v${m.version}:${runId}:${a.kind}`;
  const id = await planIdFor(s.id, key);
  const existing = await planGet(s.id, id);
  if (existing) return { plan: existing.plan as StoredPlan, amount: BigInt(a.amountUsdcRaw), replay: true };
  const text = `Mandate “${m.title}” (v${m.version}): ${a.reason}`;
  const plan =
    a.kind === "deploy_surplus"
      ? await evaluatePlan(s, id, { objective: "deploy_surplus", key, text, createdBy: "monitor" })
      : await evaluatePlan(s, id, { objective: "access_cash", key, text, createdBy: "monitor", amountRaw: a.amountUsdcRaw, deadline: a.deadline, title: `Mandate: recall ${usdc(a.amountUsdcRaw)} USDC from Rhea` });
  const choiceId = a.kind === "deploy_surplus" ? "rhea-usdc" : "withdraw-rhea";
  const choice = plan.alternatives.find((x) => x.id === choiceId);
  if (!choice || !choice.eligible)
    throw new Error(`The plan engine did not offer an eligible ${choiceId} choice: ${(choice?.reasons ?? plan.blockedReasons).join(", ") || "not offered"}.`);
  // The mandate caps; it never enlarges an engine figure.
  const amount = BigInt(choice.amountUsdcRaw) < BigInt(a.amountUsdcRaw) ? BigInt(choice.amountUsdcRaw) : BigInt(a.amountUsdcRaw);
  choice.amountUsdcRaw = amount.toString();
  plan.request = { ...plan.request, amountRaw: amount.toString() };
  if (a.kind === "deploy_surplus")
    plan.effects.exposure = [
      { asset: "USDC · NEAR wallet", deltaRaw: (-amount).toString(), decimals: 6 },
      { asset: "USDC · Rhea supply", deltaRaw: amount.toString(), decimals: 6 },
    ];
  plan.title = a.kind === "deploy_surplus" ? `Mandate: supply ${usdc(amount)} USDC to Rhea` : plan.title;
  // Re-check with the plan engine's figures (exact amount and cost) before the plan exists.
  const recheck = checkAction(m, o, { ...a, amountUsdcRaw: amount.toString(), costUsdcRaw: choice.costsUsdcRaw ?? a.costUsdcRaw });
  if (!recheck.allowed) throw Object.assign(new Error("The plan's figures fail the mandate's checks."), { checks: recheck.checks });
  reviewChoice(plan, choiceId);
  return { plan: (await planInsert(s.id, plan)) as StoredPlan, amount, replay: false, checks: recheck.checks };
}

/* ───────────── run ───────────── */

export interface RunResult {
  mandate: AgentMandate;
  runId: string | null;
  outcome: string;
  planId?: string;
}

/** One run. Claims the mandate by compare-and-set (a concurrent run loses and does nothing). */
export async function runMandate(s: MandateSession, id: string, trigger: "cron" | "manual", now = Date.now(), advice: Advice[] = []): Promise<RunResult> {
  const stored = await mandateGet(s.id, id);
  if (!stored) throw new Error("Mandate not found.");
  let { mandate: m, revision } = stored;
  const at = new Date(now).toISOString();
  const log: MandateAuditEntry[] = [];
  const clocked = applyClock(m, now);
  if (clocked.state !== m.state) {
    revision = await mandateSave(s.id, clocked, revision);
    await auditAppend(s.id, [await entry(s.id, clocked, null, "lifecycle", "Expired at the end of its validity window.", {}, at)]);
    return { mandate: clocked, runId: null, outcome: "expired" };
  }
  m = clocked;
  if (m.state !== "active") return { mandate: m, runId: null, outcome: `Mandate is ${m.state}; nothing runs.` };
  if (s.workspace.mode !== m.source || (m.source === "live" && s.workspace.accountId !== m.accountId))
    return { mandate: m, runId: null, outcome: "This workspace is not the mandate's account; nothing runs." };

  // Claim: schedule the next run first, so a crash never makes the scheduler spin on the same mandate.
  const runId = `${trigger}:${at.slice(0, 16)}`;
  m = { ...m, updatedAt: at, schedule: { ...m.schedule, lastRunAt: at, nextRunAt: new Date(now + m.schedule.everyMinutes * 60_000).toISOString() } };
  revision = await mandateSave(s.id, m, revision);

  const audit = await auditList(s.id, m.id);
  let observation: MandateObservation;
  try {
    const r = await observe(s, m, audit, now);
    observation = r.observation;
    log.push(...r.results);
  } catch (e) {
    await auditAppend(s.id, [await entry(s.id, m, runId, "observe", "Stopped: observation failed — " + msg(e), {}, at)]);
    return { mandate: m, runId, outcome: "Observation failed; nothing was decided." };
  }
  const c = observation.capital;
  log.push(await entry(s.id, m, runId, "observe", `Spendable ${usdc(c.spendableNowUsdcRaw)}, holdback ${c.holdbackUsdcRaw === null ? "unknown" : usdc(c.holdbackUsdcRaw)}, surplus ${c.surplusUsdcRaw === null ? "unknown" : usdc(c.surplusUsdcRaw)} USDC; mandate deployed ${usdc(observation.usage.deployedUsdcRaw)}.`, { data: { observation } }, at));

  const d = decide(m, observation, STRATEGY_SPECS, advice);
  for (const a of advice) log.push(await entry(s.id, m, runId, "advice", `${a.sourceUrl ? "Sourced" : "Unsourced (ignored)"} advice: ${a.claim}`, { data: a }, at));
  log.push(await entry(s.id, m, runId, "decide", d.freeze ? "Freeze: " + d.freeze : d.stop ? "Stop: " + d.stop : d.actions.length ? d.actions.map((x) => `${x.kind} ${usdc(x.amountUsdcRaw)} USDC — ${x.reason}`).join("; ") : d.notes.join(" "), { data: d }, at));

  if (d.freeze) {
    const latest = await mandateGet(s.id, m.id);
    if (latest) {
      const frozen = { ...latest.mandate, frozen: { at, reason: d.freeze, ref: observation.uncertain[0]?.ref ?? null }, updatedAt: at };
      await mandateSave(s.id, frozen, latest.revision).catch(() => undefined);
      m = frozen;
    }
    log.push(await entry(s.id, m, runId, "freeze", d.freeze, {}, at));
    await auditAppend(s.id, log);
    return { mandate: m, runId, outcome: "Frozen: " + d.freeze };
  }
  let outcome = d.stop ?? (d.actions.length ? "" : d.notes.join(" ") || "Nothing to do.");
  let planId: string | undefined;
  for (const a of d.actions) {
    const check = checkAction(m, observation, a);
    log.push(await entry(s.id, m, runId, "check", check.allowed ? `Passed ${check.checks.length} checks.` : "Blocked: " + check.checks.filter((x) => x.ok !== true).map((x) => `${x.id} (${x.detail})`).join("; "), { data: { action: a, checks: check.checks } }, at));
    if (!check.allowed) {
      outcome = "Blocked by the mandate's checks.";
      continue;
    }
    try {
      const r = await execute(s, m, a, runId, observation);
      planId = r.plan.id;
      const usage: UsageEvent = { at, kind: a.kind, amountUsdcRaw: r.amount.toString(), status: "committed", planId: r.plan.id };
      log.push(await entry(s.id, m, runId, "execute", `Plan ${r.plan.id} ready for your wallet: ${a.kind} ${usdc(r.amount)} USDC. Nothing moves until you sign.`, { planId: r.plan.id, data: { usage, recheck: r.checks ?? null, replay: r.replay } }, at));
      outcome = `Prepared plan ${r.plan.id} (${a.kind} ${usdc(r.amount)} USDC) for your signature.`;
    } catch (e) {
      const checks = (e as { checks?: unknown }).checks;
      const activePlanId = (e as { activePlanId?: string }).activePlanId;
      log.push(await entry(s.id, m, runId, "execute", "Not prepared: " + msg(e) + (activePlanId ? ` (active plan ${activePlanId})` : ""), { data: { checks: checks ?? null, activePlanId: activePlanId ?? null } }, at));
      outcome = "Not prepared: " + msg(e);
    }
  }
  await auditAppend(s.id, log);
  return { mandate: m, runId, outcome, planId };
}

/** Cancels the mandate's plans that have not reached a wallet; plans already in a wallet are left to their journal. */
export async function cancelMandatePlans(s: MandateSession, m: AgentMandate, why: string) {
  const audit = await auditList(s.id, m.id);
  const done = new Set(audit.filter((e) => e.phase === "result").map((e) => e.planId));
  const notes: string[] = [];
  for (const e of audit.filter((x) => x.phase === "execute" && x.planId && !done.has(x.planId))) {
    const stored = await planGet(s.id, e.planId!);
    if (!stored || isTerminal(stored.plan)) continue;
    if (inFlight(stored.plan as ActionPlan).length) {
      notes.push(`Plan ${stored.plan.id} is already in your wallet; track it to the end.`);
      continue;
    }
    cancel(stored.plan);
    await planSave(s.id, stored.plan, stored.previous).catch(() => notes.push(`Plan ${stored.plan.id} changed meanwhile; check it.`));
    notes.push(`Cancelled plan ${stored.plan.id} (${why}).`);
  }
  return notes;
}

/** Lifecycle change with audit. Revoke and pause also cancel the mandate's plans not yet in a wallet. */
export async function changeState(s: MandateSession, id: string, to: AgentMandate["state"], now = Date.now()) {
  const stored = await mandateGet(s.id, id);
  if (!stored) throw new Error("Mandate not found.");
  const at = new Date(now).toISOString();
  const next = transition(applyClock(stored.mandate, now), to, at);
  await mandateSave(s.id, next, stored.revision);
  const notes = to === "revoked" || to === "paused" ? await cancelMandatePlans(s, next, to) : [];
  await auditAppend(s.id, [await entry(s.id, next, null, "lifecycle", `${stored.mandate.state} → ${to}.${notes.length ? " " + notes.join(" ") : ""}`, {}, at)]);
  return { mandate: next, notes };
}

export async function listWithAudit(sessionId: string) {
  return mandateList(sessionId);
}

/**
 * Owner clears a freeze after checking the operation in their wallet history. If the mandate's Rhea position is
 * smaller than its book (withdrawn outside the mandate, or a loss), the book is rebased to what is observed and
 * the difference is recorded, never silently dropped. A still-uncertain wallet attempt keeps it frozen.
 */
export async function resolveFreeze(s: MandateSession, id: string, now = Date.now()) {
  const stored = await mandateGet(s.id, id);
  if (!stored) throw new Error("Mandate not found.");
  const m = stored.mandate;
  if (!m.frozen) throw new Error("This mandate is not frozen.");
  const at = new Date(now).toISOString();
  const audit = await auditList(s.id, m.id);
  const { observation } = await observe(s, { ...m, frozen: null }, audit, now);
  const attempts = observation.uncertain.filter((u) => u.ref.startsWith("attempt ") || u.ref.startsWith("plan "));
  if (attempts.length) throw new Error("Still uncertain: " + attempts.map((u) => `${u.ref} (${u.state})`).join(", ") + ". Check it in Activity first.");
  const log: MandateAuditEntry[] = [];
  const recorded = BigInt(usageFrom(usageEvents(audit), now, "0", []).deployedUsdcRaw);
  const observed = BigInt(observation.recallable[0]?.usdcRaw ?? "0");
  if (observed < recorded) {
    const usage: UsageEvent = { at, kind: "keep_allocation", amountUsdcRaw: "0", status: "confirmed", deployedDeltaUsdcRaw: (observed - recorded).toString(), realizedPnlUsdcRaw: "0" };
    log.push(await entry(s.id, m, null, "result", `Owner acknowledged: book rebased from ${usdc(recorded)} to observed ${usdc(observed)} USDC (moved outside the mandate or lost; see the ledger).`, { data: { usage } }, at));
  }
  const next = { ...m, frozen: null, updatedAt: at };
  await mandateSave(s.id, next, stored.revision);
  log.push(await entry(s.id, next, null, "lifecycle", "Freeze cleared by the owner: " + m.frozen.reason, {}, at));
  await auditAppend(s.id, log);
  return next;
}

/** Account-wide kill switch: blocks every mandate run and cancels mandate plans not yet in a wallet. */
export async function setKill(s: MandateSession, on: boolean, now = Date.now()) {
  const { setKillSwitch } = await import("./mandate-store");
  const at = new Date(now).toISOString();
  await setKillSwitch(s.id, on, at);
  const notes: string[] = [];
  for (const { mandate } of await mandateList(s.id)) {
    if (on && ["active", "approved", "paused"].includes(mandate.state)) notes.push(...(await cancelMandatePlans(s, mandate, "kill switch")));
    await auditAppend(s.id, [await entry(s.id, mandate, null, "lifecycle", on ? "Kill switch ON: no mandate runs or prepares anything." : "Kill switch off.", {}, at)]);
  }
  return notes;
}
