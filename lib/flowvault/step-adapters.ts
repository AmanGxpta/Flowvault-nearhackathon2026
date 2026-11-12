import { creditSettlementAdapter } from "./adapters/credit-settlement-step";
import {stakingStepAdapter} from "./adapters/staking-step";
import { fundingLegAdapter } from "./adapters/funding-leg-step"; // Stream A: fund_transfer legs
// Step-adapter registry and plan executor (owner: Interface). The executor ONLY orchestrates: every signed
// step is prepared, authorized, signed and verified by an existing journal. The built-in adapters call the
// existing journal route handlers in-process, so their guards (policy, fences, idempotency, handoff locks,
// receipt and destination verification) apply unchanged. Other owners add only a registration line at the
// bottom of this file (borrow/repay/collateral: Engines; stake/unstake: Positions).
import type { ActionPlan, LedgerEntry, PlanStep, StepAdapter, StepKind, StepState } from "./contracts";
import type { Workspace } from "./types";
import type { WalletAttempt } from "./execution";
import type { PaymentPlan } from "./payments";
import { readAttempt } from "./attempts";
import { keyedAttemptId } from "./preparation-key";
import { decimal, units } from "./money";
import { rheaCreditAdapter } from "./lending-step";
import { nativeStakingAdapter } from "./adapters/native-staking-step";
import { assertPreparable, depsMet, IN_FLIGHT, noteStep, settle, stepGeneration } from "./plans";

/* ───────────── execution context ───────────── */

export interface StepRunContext {
  request: Request;
  sessionId: string;
  workspace: Workspace;
  revision: number;
}
const contexts = new WeakMap<ActionPlan, StepRunContext>();
/** Adapters read the request/session the executor is running under. Bound per plan object, never global. */
export function stepContext(plan: ActionPlan): StepRunContext {
  const c = contexts.get(plan);
  if (!c) throw new Error("Step adapters run only inside the plan executor.");
  return c;
}

/* ───────────── registry ───────────── */

const registry = new Map<StepKind, StepAdapter>();
export function registerStepAdapter(adapter: StepAdapter) {
  for (const kind of adapter.kinds) {
    if (registry.has(kind)) throw new Error(`A step adapter for ${kind} is already registered.`);
    registry.set(kind, adapter);
  }
}
export function adapterFor(kind: StepKind) {
  return registry.get(kind) ?? null;
}
export function registeredKinds(): StepKind[] {
  return [...registry.keys()];
}

/* ───────────── in-process calls to the existing journal routes ───────────── */

type Handler = (r: Request) => Promise<Response>;
const ROUTES: Record<string, () => Promise<{ POST?: Handler; GET?: Handler }>> = {
  prepare: () => import("@/app/api/prepare/route"),
  transactions: () => import("@/app/api/transactions/route"),
  payments: () => import("@/app/api/payments/route"),
  payment: () => import("@/app/api/payments/[id]/route"),
  staking: () => import("@/app/api/staking/actions/route"), // Positions P1c
  aave: () => import("@/app/api/lending/venues/route"),
  lending: () => import("@/app/api/lending/route"), // Engines E2
  native: () => import("@/app/api/staking/native/route"), // Engines P2
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- journal responses are route JSON
export async function journalCall<T = any>(
  ctx: StepRunContext,
  route: keyof typeof ROUTES,
  path: string,
  body: unknown,
): Promise<T> {
  const url = new URL(path, ctx.request.url);
  const headers = new Headers({ "content-type": "application/json", origin: url.origin });
  for (const h of ["cookie", "x-flowvault-workspace"]) {
    const v = ctx.request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const mod = await ROUTES[route]();
  const res = await mod.POST!(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }));
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data?.error ?? "Journal request failed.");
  return data as T;
}

/** Deterministic journal key: a retry reuses the same wallet attempt; a re-prepare after expiry does not. */
export function stepKey(plan: ActionPlan, step: PlanStep, purpose = "attempt") {
  return keyedAttemptId(plan.id, `${purpose}:${step.id}:${stepGeneration(step)}`);
}
export function paymentKey(plan: ActionPlan) {
  return keyedAttemptId(plan.id, "payment");
}

const ATTEMPT_STATE: Record<WalletAttempt["state"], StepState> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting_wallet",
  submitted: "submitted",
  confirmed: "confirmed",
  failed: "failed",
  partial: "partial",
  unknown: "unknown",
};

/** Mirrors a wallet attempt into the step. Verification already happened in the journal. */
async function attemptCheck(plan: ActionPlan, step: PlanStep, ledger: (a: WalletAttempt) => LedgerEntry[]) {
  const ctx = stepContext(plan);
  if (!step.attemptId) return { patch: {}, ledger: [] };
  let { attempt } = await readAttempt(ctx.sessionId, step.attemptId);
  if (attempt.state === "submitted" && attempt.hashes.length)
    attempt = (await journalCall<{ attempt: WalletAttempt }>(ctx, "transactions", "/api/transactions", { id: attempt.id, action: "check" })).attempt;
  const state = ATTEMPT_STATE[attempt.state];
  const patch: Partial<PlanStep> = { state };
  if (state === "confirmed")
    patch.actual = { amountRaw: units(attempt.amount).toString(), asset: "USDC", usdcRaw: units(attempt.amount).toString(), evidence: attempt.verificationEvidence ?? attempt.hashes };
  return { patch, ledger: state === "confirmed" && step.state !== "confirmed" ? ledger(attempt) : [], message: attempt.message };
}

function entry(plan: ActionPlan, step: PlanStep, e: Omit<LedgerEntry, "id" | "planId" | "stepId" | "source" | "at">): LedgerEntry {
  return { id: `${step.id}:${e.kind}`, at: new Date().toISOString(), planId: plan.id, stepId: step.id, source: plan.source, ...e };
}

/* ───────────── built-in adapters (existing journals) ───────────── */

/** Rhea USDC supply: the wallet_attempts journal via /api/prepare and /api/transactions. */
export const supplyAdapter: StepAdapter = {
  kinds: ["supply"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    const prep = await journalCall(ctx, "prepare", "/api/prepare", {
      kind: "supply",
      amount: decimal(BigInt(step.expected.amountRaw ?? "0")),
      key: await stepKey(plan, step),
    });
    return { attemptId: prep.attemptId, expiresAt: prep.expiresAt, state: "prepared" };
  },
  async check(step, plan) {
    return attemptCheck(plan, step, (a) => [
      entry(plan, step, {
        kind: "internal_transfer", asset: "USDC", chain: "near", amountRaw: units(a.amount).toString(), decimals: 6,
        usdcRaw: units(a.amount).toString(), netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: "0", realized: true,
        basis: "Rhea supply verified from finalized receipts (resolved ft_transfer_call amount)", status: "confirmed",
        attemptId: a.id, positionId: "rhea-usdc", txHashes: a.hashes,
      }),
    ]);
  },
};

async function ensurePayment(plan: ActionPlan): Promise<PaymentPlan> {
  const ctx = stepContext(plan);
  const r = await journalCall<{ payment: PaymentPlan }>(ctx, "payments", "/api/payments", {
    key: await paymentKey(plan),
    obligationId: plan.request.obligationId,
  });
  const choice = plan.alternatives.find((a) => a.id === plan.selectedChoiceId);
  if (choice?.kind === "idle_cash" && r.payment.state === "needs-withdrawal")
    throw new Error("A fresh quote needs a Rhea withdrawal that this reviewed plan does not include. Cancel and ask again.");
  return r.payment;
}
function paymentPath(id: string) {
  return "/api/payments/" + encodeURIComponent(id);
}

/** Rhea withdrawal: inside a payment plan via the payment journal, otherwise a plain withdraw attempt. */
export const withdrawAdapter: StepAdapter = {
  kinds: ["withdraw"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    if (plan.request.obligationId) {
      const payment = await ensurePayment(plan);
      const r = await journalCall(ctx, "payment", paymentPath(payment.id), { action: "prepare-withdraw" });
      return { paymentPlanId: payment.id, attemptId: r.attempt?.id ?? r.payment.withdrawAttemptId, expiresAt: r.attempt?.expiresAt, state: "prepared" };
    }
    const prep = await journalCall(ctx, "prepare", "/api/prepare", {
      kind: "withdraw",
      amount: decimal(BigInt(step.expected.amountRaw ?? "0")),
      key: await stepKey(plan, step),
    });
    return { attemptId: prep.attemptId, expiresAt: prep.expiresAt, state: "prepared" };
  },
  async check(step, plan) {
    return attemptCheck(plan, step, (a) => [
      entry(plan, step, {
        kind: "internal_transfer", asset: "USDC", chain: "near", amountRaw: units(a.amount).toString(), decimals: 6,
        usdcRaw: units(a.amount).toString(), netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: "0", realized: true,
        basis: "Rhea withdrawal verified from the native USDC payout event", status: "confirmed",
        attemptId: a.id, positionId: "rhea-usdc", txHashes: a.hashes,
      }),
    ]);
  },
};

/** Executable exact-output 1Click quote. No signature; the owner reviews it before the deposit step. */
export const payQuoteAdapter: StepAdapter = {
  kinds: ["pay_quote"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    const payment = await ensurePayment(plan);
    const r = await journalCall<{ payment: PaymentPlan }>(ctx, "payment", paymentPath(payment.id), { action: "quote" });
    const q = (r.payment.retainedSignedQuote as { quote?: { amountIn?: string; deadline?: string } } | undefined)?.quote ?? null;
    return {
      paymentPlanId: payment.id,
      state: "confirmed",
      expiresAt: q?.deadline,
      actual: { amountRaw: q?.amountIn, asset: "USDC", usdcRaw: q?.amountIn, evidence: { quote: q, message: r.payment.message } },
    };
  },
  async check() {
    return { patch: {}, ledger: [] };
  },
};

/** USDC deposit to the quoted 1Click address: a pay wallet attempt prepared by the payment journal. */
export const payDepositAdapter: StepAdapter = {
  kinds: ["pay_deposit"],
  async prepare(step, plan) {
    const ctx = stepContext(plan);
    const payment = await ensurePayment(plan);
    const r = await journalCall(ctx, "payment", paymentPath(payment.id), { action: "prepare-deposit" });
    return { paymentPlanId: payment.id, attemptId: r.attempt?.id ?? r.payment.depositAttemptId, expiresAt: r.attempt?.expiresAt, state: "prepared" };
  },
  async check(step, plan) {
    // The economic result is booked by verify_payout from the destination receipt, not by the deposit.
    const r = await attemptCheck(plan, step, () => []);
    return r;
  },
};

const PAYMENT_FAILED = ["refunded", "failed", "deadline-passed"];
/** Polls the provider and the independent destination-chain proof through the payment journal. */
export const verifyPayoutAdapter: StepAdapter = {
  kinds: ["verify_payout"],
  async prepare() {
    return { state: "submitted" };
  },
  async check(step, plan) {
    const ctx = stepContext(plan);
    const id = plan.steps.find((s) => s.paymentPlanId)?.paymentPlanId;
    if (!id) return { patch: {}, ledger: [] };
    const { payment } = await journalCall<{ payment: PaymentPlan }>(ctx, "payment", paymentPath(id), { action: "poll" });
    if (payment.state === "paid") {
      const proof = payment.destinationProof as { amount?: string; decimals?: number; transactionHash?: string } | undefined;
      const deposit = plan.steps.find((s) => s.kind === "pay_deposit");
      const sent = deposit?.actual?.usdcRaw ?? null;
      return {
        patch: { state: "confirmed" as const, paymentPlanId: id, actual: { amountRaw: proof?.amount, asset: payment.obligationSnapshot.token, usdcRaw: sent ?? undefined, evidence: proof } },
        ledger:
          step.state === "confirmed"
            ? []
            : [
                entry(plan, step, {
                  kind: "payment_out", asset: payment.obligationSnapshot.token, chain: payment.obligationSnapshot.destination,
                  amountRaw: String(proof?.amount ?? ""), decimals: Number(proof?.decimals ?? 6), usdcRaw: sent,
                  netWorthEffectUsdcRaw: sent ? "-" + sent : null, liabilityEffectUsdcRaw: "0", realized: true,
                  basis: "Exact payout verified from a finalized destination-chain receipt", status: "confirmed",
                  attemptId: deposit?.attemptId, txHashes: proof?.transactionHash ? [proof.transactionHash] : [],
                }),
              ],
        message: payment.message,
      };
    }
    if (PAYMENT_FAILED.includes(payment.state))
      return { patch: { state: payment.state === "refunded" ? ("partial" as const) : ("failed" as const) }, ledger: [], message: payment.message };
    return { patch: { state: "submitted" as const }, ledger: [], message: payment.message };
  },
};

/** A dated pause (e.g. hold until a payment date). Confirms by the clock only. */
export const waitAdapter: StepAdapter = {
  kinds: ["wait_until"],
  async prepare() {
    return { state: "submitted" };
  },
  async check(step) {
    const until = Date.parse(step.expected.note ?? "");
    return { patch: Number.isFinite(until) && until <= Date.now() ? { state: "confirmed" as const } : {}, ledger: [] };
  },
};

/* ───────────── executor ───────────── */

const AUTO: StepKind[] = ["verify_payout", "wait_until", "credit_settlement"];

function apply(step: PlanStep, patch: Partial<PlanStep>, message?: string) {
  const before = step.state;
  Object.assign(step, patch);
  if (patch.state && (patch.state !== before || message))
    noteStep(step, "journal", step.state, message ?? `Step ${step.state}.`, patch.actual?.evidence ?? null);
}

/** Prepares one step through its adapter. Fences, dependencies, approvals and idempotency are checked first. */
export async function executePrepare(plan: ActionPlan, stepId: string, ctx: StepRunContext, now: ActionPlan["context"]) {
  const decision = assertPreparable(plan, stepId, now);
  if (decision.kind === "existing") return { plan, ledger: [] as LedgerEntry[] };
  const step = decision.step;
  const adapter = adapterFor(step.kind);
  if (!adapter) throw new Error(`No execution adapter is registered for “${step.kind}” yet. Nothing was prepared.`);
  contexts.set(plan, ctx);
  try {
    const patch = await adapter.prepare(step, plan);
    apply(step, patch, patch.state === "confirmed" ? "Done; no signature needed." : "Prepared by its journal. Review it, then approve in your wallet.");
    settle(plan);
    return await executeCheck(plan, ctx);
  } finally {
    contexts.delete(plan);
  }
}

/** Reconciles every step from its journal (finalized evidence only) and returns new ledger entries. */
export async function executeCheck(plan: ActionPlan, ctx: StepRunContext) {
  contexts.set(plan, ctx);
  const ledger: LedgerEntry[] = [];
  try {
    for (const step of plan.steps) {
      settle(plan);
      const auto = AUTO.includes(step.kind) && step.state === "ready" && depsMet(plan, step);
      if (auto) apply(step, await adapterFor(step.kind)!.prepare(step, plan), "Waiting for independent evidence.");
      const watch = step.attemptId || auto || (AUTO.includes(step.kind) && IN_FLIGHT.includes(step.state));
      if (!watch || step.state === "confirmed" || step.state === "skipped") continue;
      const adapter = adapterFor(step.kind);
      if (!adapter) continue;
      const r = (await adapter.check(step, plan)) as { patch: Partial<PlanStep>; ledger: LedgerEntry[]; message?: string };
      apply(step, r.patch, r.message);
      // Credit settlement has an additional independent source/destination proof gate. A provider
      // report may advance the transfer journal but cannot book this leg before that gate confirms.
      if (!(step.kind === "fund_transfer" && plan.alternatives.find(a => a.id === plan.selectedChoiceId)?.creditSettlement)) ledger.push(...r.ledger);
    }
    for (const e of ledger) if (!plan.ledgerEntryIds.includes(e.id)) plan.ledgerEntryIds.push(e.id);
    settle(plan);
    return { plan, ledger };
  } finally {
    contexts.delete(plan);
  }
}

/** Marks an approval granted when the owner opens the wallet for that step (the wallet itself authorizes). */
export function grantApproval(plan: ActionPlan, stepId: string) {
  const a = plan.approvals.find((x) => x.stepId === stepId);
  if (a && !a.grantedAt) a.grantedAt = new Date().toISOString();
}

/* ───────────── registrations (owners add one line each) ───────────── */

registerStepAdapter(supplyAdapter);
registerStepAdapter(withdrawAdapter);
registerStepAdapter(payQuoteAdapter);
registerStepAdapter(payDepositAdapter);
registerStepAdapter(verifyPayoutAdapter);
registerStepAdapter(waitAdapter);
registerStepAdapter(rheaCreditAdapter); // Engines: collateral_add, borrow, repay, collateral_release
registerStepAdapter(nativeStakingAdapter); // Engines P2: native_stake, native_unstake, native_withdraw
registerStepAdapter(stakingStepAdapter); // Positions: LiNEAR stake, unstake, withdraw_unstaked
registerStepAdapter(fundingLegAdapter); // Stream A: fund_transfer (cross-wallet funding legs)

registerStepAdapter(creditSettlementAdapter);
