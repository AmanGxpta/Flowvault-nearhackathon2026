// Monitoring conditions (owner: Interface). Pure and deterministic: given the SAME engine outputs every
// screen uses (Engines' capitalView/reserveFor, the Rhea credit capacity, plans and journals) it returns
// the alerts that hold right now. It never computes a balance, a reservation or a health figure itself,
// and it only PROPOSES responses (a plan objective to evaluate); it never authorizes or signs.
import type { ActionPlan, Alert, PlanObjective, Reservation, Valuation } from "./contracts.ts";
import type { Obligation, Position, Source } from "./types.ts";
import { seriesOf } from "./recurrence.ts";

const DAY = 86400000;
export type AlertGroup = "dates" | "capital" | "credit" | "plans";
export const GROUP: Record<Alert["kind"], AlertGroup> = {
  obligation_window: "dates",
  recurrence_due: "dates",
  reserve_shortfall: "capital",
  exit_threatens_payment: "capital",
  debt_risk: "credit",
  operation_attention: "plans",
};

/** What the monitor may propose. The plan service evaluates it with the engines; nothing is pre-approved. */
export interface Proposal {
  objective: PlanObjective;
  obligationId?: string;
  amountRaw?: string;
  deadline?: string;
  title?: string;
}
export interface Candidate {
  dedupeKey: string;
  kind: Alert["kind"];
  severity: Alert["severity"];
  message: string;
  obligationId?: string;
  planId?: string;
  proposal?: Proposal;
  /** Engine figures behind the message, each named by the engine that produced it. */
  figures?: { label: string; value: string | null; engine: string }[];
}

/** The subset of Engines' CapitalReport the monitor reads. */
export interface CapitalInput {
  spendableNowUsdcRaw: string;
  holdbackUsdcRaw: string | null;
  reserveUsdcRaw: string;
  reservations: Reservation[];
  valuations: Valuation[];
  blocksAutomation: boolean;
  reasons: string[];
}
export interface CreditInput {
  debtUsdcRaw: string;
  health: string | null;
  stressedHealth: string | null;
  minHealth: string;
}
export interface MonitorInput {
  now: number;
  source: Source;
  obligations: Obligation[];
  leadDays: number;
  horizonDays: number;
  /** null = not evaluated this run (read failed or timed out): capital alerts are left as they were. */
  capital: CapitalInput | null;
  positions: Position[] | null;
  /** Exit window in days per position id, from the market snapshot; null = unknown. */
  exitDays: Record<string, number | null>;
  /** undefined = no supported debt in this workspace; null = not evaluated this run. */
  credit?: CreditInput | null;
  plans: ActionPlan[] | null;
}

const ACTIVE_PLAN = new Set(["draft", "evaluated", "reviewed", "executing", "partial"]);
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(d + "T00:00:00Z");
const daysUntil = (d: string, now: number) => Math.round((dayStart(d) - dayStart(utcDay(now))) / DAY);
const pending = (o: Obligation) => o.status === "pending";
const CHAIN: Record<string, string> = { near: "NEAR", base: "Base", arb: "Arbitrum", bnb: "BNB Chain", eth: "Ethereum" };

/** 6-decimal USDC raw → "1,234.56" (display only; the raw value stays in figures). */
export function usd(rawValue: string | bigint) {
  const v = BigInt(rawValue);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const cents = (a + 5000n) / 10000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + whole + "." + (cents % 100n).toString().padStart(2, "0");
}
function grouped(amount: string) {
  const [w, f] = amount.split(".");
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}
export function shortDate(d: string) {
  return new Date(dayStart(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
const what = (o: Obligation) => `${o.label} (${grouped(o.amount)} ${o.token} on ${CHAIN[o.destination] ?? o.destination})`;

function activePlanFor(plans: ActionPlan[] | null, obligationId: string) {
  return plans?.find((p) => p.request.obligationId === obligationId && ACTIVE_PLAN.has(p.state));
}

/** Cumulative protection need by due date: floor reserve + each pending obligation's reserveFor amount. */
export function coverage(input: Pick<MonitorInput, "obligations" | "now" | "horizonDays">, c: CapitalInput) {
  const spendable = BigInt(c.spendableNowUsdcRaw);
  let need = BigInt(c.reserveUsdcRaw);
  const rows: { obligation: Obligation; reservation: Reservation; needRaw: bigint; covered: boolean }[] = [];
  // Same set Engines' holdback protects: pending, inside the horizon (or legacy-protected).
  const due = input.obligations.filter((o) => pending(o) && (o.legacyProtected || daysUntil(o.dueDate, input.now) <= input.horizonDays)).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const o of due) {
    const r = c.reservations.find((x) => x.obligationId === o.id);
    if (!r || r.unavailableReason) continue;
    need += BigInt(r.reserveUsdcRaw);
    rows.push({ obligation: o, reservation: r, needRaw: need, covered: need <= spendable });
  }
  return rows;
}

const valueOf = (c: CapitalInput, id: string) => {
  const v = c.valuations.find((x) => x.positionId === id && x.kind === "observed");
  return v?.usdcRaw == null ? null : BigInt(v.usdcRaw);
};

export function detect(input: MonitorInput): { candidates: Candidate[]; evaluated: AlertGroup[]; skipped: string[] } {
  const out: Candidate[] = [];
  const evaluated: AlertGroup[] = ["dates"];
  const skipped: string[] = [];
  const { now } = input;
  const today = utcDay(now);

  /* 1. Preparation window: a pending payment within mandate.leadDays (or overdue). */
  for (const o of input.obligations.filter(pending)) {
    const d = daysUntil(o.dueDate, now);
    if (d > input.leadDays) continue;
    const plan = activePlanFor(input.plans, o.id);
    out.push({
      dedupeKey: `obligation_window:${o.id}:${o.dueDate}`,
      kind: "obligation_window",
      severity: d <= 0 ? "urgent" : d <= 1 ? "urgent" : "warn",
      message:
        d < 0
          ? `${what(o)} was due ${shortDate(o.dueDate)} and is still unpaid. It stays protected until you pay or cancel it.`
          : d === 0
            ? `${what(o)} is due today.`
            : `${what(o)} is due ${shortDate(o.dueDate)}, inside your ${input.leadDays}-day preparation window.`,
      obligationId: o.id,
      planId: plan?.id,
      proposal: plan ? undefined : { objective: "pay_obligation", obligationId: o.id },
    });
  }

  /* 6. Recurrence: a generated next instance is now scheduled and protected. */
  for (const o of input.obligations.filter(pending)) {
    const { occurrence } = seriesOf(o.id);
    if (occurrence < 2 || !o.recurrence || o.recurrence === "none") continue;
    if (daysUntil(o.dueDate, now) > input.horizonDays) continue;
    out.push({
      dedupeKey: `recurrence_due:${o.id}`,
      kind: "recurrence_due",
      severity: "info",
      message: `${o.label} repeats ${o.recurrence}: the next ${grouped(o.amount)} ${o.token} on ${shortDate(o.dueDate)} is scheduled and counted in your holdback.`,
      obligationId: o.id,
    });
  }

  /* 2 + 3. Capital: spendable below the required reserve; an exit window threatening a payment date. */
  const c = input.capital;
  if (!c) skipped.push("capital");
  else {
    evaluated.push("capital");
    if (c.holdbackUsdcRaw === null) {
      out.push({
        dedupeKey: "reserve_shortfall:unvalued",
        kind: "reserve_shortfall",
        severity: "warn",
        message: `Your holdback can't be valued right now, so FlowVault won't move money automatically. ${c.reasons[0] ?? ""}`.trim(),
      });
    } else {
      const spendable = BigInt(c.spendableNowUsdcRaw);
      const holdback = BigInt(c.holdbackUsdcRaw);
      const rows = coverage(input, c);
      const first = rows.find((r) => !r.covered);
      const owner = (input.positions ?? []).filter((p) => p.ownership !== "watched");
      const instant = owner.filter((p) => p.kind === "supplied" && p.asset === "USDC");
      const instantRaw = instant.reduce((n, p) => n + (valueOf(c, p.id) ?? 0n), 0n);
      if (spendable < holdback) {
        const short = holdback - spendable;
        const date = first?.obligation.dueDate ?? today;
        const by = utcDay(Math.max(dayStart(today), dayStart(date) - DAY));
        const figures = [
          { label: "Spendable now", value: usd(spendable), engine: "capitalView" },
          { label: "Required holdback", value: usd(holdback), engine: "capitalView / reserveFor" },
          { label: "Shortfall", value: usd(short), engine: "capitalView" },
          { label: "Rhea USDC supply", value: instant.length ? usd(instantRaw) : null, engine: "capitalView" },
        ];
        const title =
          instantRaw >= short
            ? `Begin withdrawing ${usd(short)} USDC from Rhea by ${shortDate(by)}; spendable after: ${usd(spendable + short)} (holdback ${usd(holdback)})`
            : `Cover ${usd(short)} USDC before ${shortDate(date)}; reserve after: ${usd(holdback)}`;
        out.push({
          dedupeKey: `reserve_shortfall:${first?.obligation.id ?? "floor"}`,
          kind: "reserve_shortfall",
          severity: daysUntil(date, now) <= input.leadDays ? "urgent" : "warn",
          message:
            `Spendable cash (${usd(spendable)}) is ${usd(short)} below the ${usd(holdback)} you hold back` +
            (first ? ` for payments, starting with ${first.obligation.label} on ${shortDate(date)}.` : " as your reserve floor.") +
            (instantRaw >= short ? ` ${title}.` : " Rhea supply alone doesn't cover it; review the alternatives."),
          obligationId: first?.obligation.id,
          figures,
          proposal: { objective: "access_cash", amountRaw: short.toString(), deadline: by, title },
        });
      }
      // Exit windows: only money not already covered by spendable cash or instant Rhea supply is at risk.
      if (first) {
        const gap = first.needRaw - spendable - instantRaw;
        for (const p of owner) {
          if (p.kind !== "staking") continue;
          const value = valueOf(c, p.id);
          const due = first.obligation.dueDate;
          const pendingExit = p.availableAt ? utcDay(Date.parse(p.availableAt)) : null;
          const exitDays = input.exitDays[p.id] ?? null;
          const ready = pendingExit ?? (exitDays === null ? null : utcDay(dayStart(today) + (exitDays + input.leadDays) * DAY));
          if (gap <= 0n && !pendingExit) continue;
          if (ready !== null && ready <= due) {
            // Not late yet; warn only when the latest start for this exit is inside the preparation window.
            if (pendingExit || exitDays === null || gap <= 0n) continue;
            const latest = utcDay(dayStart(due) - (exitDays + input.leadDays) * DAY);
            if (daysUntil(latest, now) > input.leadDays) continue;
            out.push({
              dedupeKey: `exit_threatens_payment:${p.id}:${first.obligation.id}`,
              kind: "exit_threatens_payment",
              severity: daysUntil(latest, now) <= 0 ? "urgent" : "warn",
              message: `To cover ${first.obligation.label} on ${shortDate(due)} from ${p.label}, its ${exitDays}-day exit must begin by ${shortDate(latest)}.`,
              obligationId: first.obligation.id,
              figures: [
                { label: "Not covered by cash or Rhea", value: usd(gap), engine: "capitalView / reserveFor" },
                { label: p.label, value: value === null ? null : usd(value), engine: "capitalView" },
              ],
              proposal: { objective: "access_cash", amountRaw: gap.toString(), deadline: latest },
            });
            continue;
          }
          if (gap <= 0n) continue;
          out.push({
            dedupeKey: `exit_threatens_payment:${p.id}:${first.obligation.id}`,
            kind: "exit_threatens_payment",
            severity: "urgent",
            message:
              ready === null
                ? `${p.label} has no known exit window, and ${first.obligation.label} on ${shortDate(due)} isn't covered by cash or Rhea supply.`
                : `${p.label} would only be available ${pendingExit ? "around" : "by"} ${shortDate(ready)}, after ${first.obligation.label} on ${shortDate(due)}, and cash plus Rhea supply don't cover that payment.`,
            obligationId: first.obligation.id,
            figures: [
              { label: "Not covered by cash or Rhea", value: usd(gap), engine: "capitalView / reserveFor" },
              { label: p.label, value: value === null ? null : usd(value), engine: "capitalView" },
              { label: "Available", value: ready, engine: pendingExit ? "position availability (estimate)" : "market exit window" },
            ],
            proposal: { objective: "access_cash", amountRaw: gap.toString(), deadline: utcDay(Math.max(dayStart(today), dayStart(due) - DAY)) },
          });
        }
      }
    }
  }

  /* 5. Supported debt near the owner's health threshold (Rhea capacity health vs policy minimum). */
  if (input.credit === null) skipped.push("credit");
  else if (input.credit) {
    evaluated.push("credit");
    const k = input.credit;
    const debt = BigInt(k.debtUsdcRaw);
    const min = Number(k.minHealth);
    const num = (v: string | null) => (v === null || !Number.isFinite(Number(v)) ? null : Number(v));
    const h = num(k.health);
    const sh = num(k.stressedHealth);
    if (debt > 0n) {
      const figures = [
        { label: "Debt", value: usd(debt), engine: "lendingPreview" },
        { label: "Health now", value: k.health, engine: "lendingPreview" },
        { label: "Health under your stress drawdown", value: k.stressedHealth, engine: "lendingPreview" },
        { label: "Your minimum", value: k.minHealth, engine: "policy" },
      ];
      if (h === null || sh === null)
        out.push({ dedupeKey: "debt_risk:rhea", kind: "debt_risk", severity: "warn", message: "Your Rhea loan's health can't be valued right now. Don't add debt until it can.", figures });
      else if (sh < min || h < min * 1.1)
        out.push({
          dedupeKey: "debt_risk:rhea",
          kind: "debt_risk",
          severity: sh < min && h < min * 1.1 ? "urgent" : "warn",
          message:
            sh < min
              ? `Under your stress drawdown your Rhea health would be ${sh.toFixed(2)}, below your minimum of ${min.toFixed(2)}.`
              : `Your Rhea health is ${h.toFixed(2)}, within 10% of your minimum of ${min.toFixed(2)}.`,
          figures,
          proposal: { objective: "repay" },
        });
    }
  }

  /* 4. Operations needing attention: unconfirmed results, wallet requests left open, failed or partial plans. */
  if (!input.plans) skipped.push("plans");
  else {
    evaluated.push("plans");
    for (const p of input.plans) {
      const title = (p as ActionPlan & { title?: string }).title ?? p.objective.replace(/_/g, " ");
      const recent = now - Date.parse(p.updatedAt) < 7 * DAY;
      for (const s of p.steps) {
        if (s.state === "unknown" || s.state === "partial")
          out.push({
            dedupeKey: `operation_attention:${p.id}:${s.id}:unconfirmed`,
            kind: "operation_attention",
            severity: "urgent",
            message: `“${title}”: a step's result isn't confirmed yet. Check it before you act on this money again.`,
            planId: p.id,
            obligationId: p.request.obligationId,
          });
        else if ((s.state === "awaiting_wallet" || s.state === "submitted") && now - Date.parse(p.updatedAt) > 10 * 60_000)
          out.push({
            dedupeKey: `operation_attention:${p.id}:${s.id}:wallet`,
            kind: "operation_attention",
            severity: "warn",
            message: `“${title}” is waiting on your wallet. Approve or reject the request, then check the plan.`,
            planId: p.id,
            obligationId: p.request.obligationId,
          });
      }
      if ((p.state === "failed" || p.state === "partial") && recent && !p.steps.some((s) => s.state === "unknown" || s.state === "partial"))
        out.push({
          dedupeKey: `operation_attention:${p.id}:${p.state}`,
          kind: "operation_attention",
          severity: "warn",
          message: `“${title}” ${p.state === "failed" ? "failed" : "finished only partly"}. Open it to see what was confirmed.`,
          planId: p.id,
          obligationId: p.request.obligationId,
        });
    }
  }

  return { candidates: out, evaluated, skipped };
}
