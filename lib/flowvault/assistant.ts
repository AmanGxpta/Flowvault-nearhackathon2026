import { capitalView } from "./valuation.ts";
import type { CapitalReport } from "./valuation.ts";
import { payoutSupported } from "./evm.ts";
import { z } from "zod";
import { units, decimal, positive } from "./money.ts";
import { dateSchema, holdback } from "./obligations.ts";
import { usableBalances } from "./usable.ts";
import { calendarRanking } from "./calendar.ts";
import { evaluatePolicy, defaultPolicy } from "./policy.ts";
import type { LedgerEntry, PolicyAction } from "./policy.ts";
import { assetStress, stressCapacity } from "./credit.ts";
import { exampleCashQuote } from "./example-quote.ts";
import { otherObligationHoldback, paymentSources } from "./payments.ts";
import { ownerPositions } from "./accounts.ts";
import { SUPPLY_USDC as USDC, SUPPLY_RHEA as RHEA } from "./supply.ts";
import type { Workspace, Portfolio, MarketSnapshot, Chain } from "./types.ts";
const amount = z
  .string()
  .max(40)
  .refine((x) => {
    try {
      return positive(x) > 0n;
    } catch {
      return false;
    }
  }, "Invalid proposal amount.")
  .transform((v) => decimal(positive(v)));
export const proposalSchema = z
  .object({
    kind: z.enum([
      "pay",
      "allocate_surplus",
      "stress",
      "explain_block",
      "clarify",
      "borrow",
      "repay",
      "respond_to_change",
      "convert",
    ]),
    amount: amount.nullable(),
    recipientLabel: z.string().trim().min(1).max(100).nullable().default(null),
    asset: z
      .enum(["USDC", "USDT", "ETH", "NEAR", "LiNEAR", "rNEAR"])
      .nullable(),
    chain: z.enum(["near", "base", "arb", "bnb", "eth"]).nullable(),
    dueDate: dateSchema.nullable(),
    drawdownBps: z.number().int().min(0).max(10000).nullable(),
    action: z.enum(["supply", "withdraw", "pay", "stake"]).nullable(),
    sources: z
      .array(z.enum(["wallet-usdc", "rhea-usdc", "ETH", "LiNEAR", "rNEAR"]))
      .max(5),
    reasons: z
      .array(
        z.enum([
          "USER_CASH_REQUEST",
          "SURPLUS_ALLOCATION",
          "STRESS_SCENARIO",
          "POLICY_EXPLANATION",
          "MISSING_DETAILS",
          "BORROW_REQUEST",
          "REPAY_REQUEST",
          "SCHEDULE_CHANGE",
          "CONVERT_REQUEST",
        ]),
      )
      .max(5),
  })
  .strict();
export type AssistantProposal = z.infer<typeof proposalSchema>;
const base = (): AssistantProposal => ({
  kind: "clarify",
  recipientLabel: null,
  amount: null,
  asset: null,
  chain: null,
  dueDate: null,
  drawdownBps: null,
  action: null,
  sources: [],
  reasons: ["MISSING_DETAILS"],
});
export function questionDate(q: string, now = Date.now()) {
  const date = q.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (date) return dateSchema.parse(date);
  const offset = /tomorrow/i.test(q)
    ? 1
    : /next week/i.test(q)
      ? 7
      : /today/i.test(q)
        ? 0
        : Number(q.match(/in (\d+) days?/i)?.[1] ?? NaN);
  if (Number.isFinite(offset)) {
    if (offset > 3650)
      throw new Error("Assistant date exceeds supported horizon.");
    return new Date(now + offset * 86400000).toISOString().slice(0, 10);
  }
  const named = q.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?/i,
  );
  if (named) {
    const month = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ].indexOf(named[1].slice(0, 3).toLowerCase());
    let year = Number(named[3] ?? new Date(now).getUTCFullYear());
    let s = `${year}-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
    if (!named[3] && s < new Date(now).toISOString().slice(0, 10))
      s = `${++year}-${s.slice(5)}`;
    return dateSchema.parse(s);
  }
  return null;
}
export function parseIntent(
  question: string,
  now = Date.now(),
): AssistantProposal {
  const p = base();
  const q = question.toLowerCase();
  // Convert: USDC held on Ethereum, Base or Arbitrum → NEAR in the NEAR account (and maybe stake it).
  const convert =
    !/\bwhy\b|blocked|refused/.test(q) &&
    (/\b(?:convert|bridge|move|swap|exchange|turn|change|send)\b[^.?!]*\busdc\b[^.?!]*\b(?:to|into|for)\s+(?:\w+\s+)?near\b/.test(q) ||
      /\bget\b[^.?!]*\bnear\b[^.?!]*\bfrom\b[^.?!]*\busdc\b/.test(q) ||
      /\bstake\b[^.?!]*\b(?:my\s+)?usdc\b/.test(q));
  if (convert) {
    p.kind = "convert";
    p.amount = question.match(/([\d,]+(?:\.\d+)?)\s*usdc/i)?.[1]?.replaceAll(",", "") ?? null;
    p.asset = "USDC";
    p.chain = /arbitrum|\barb\b/.test(q) ? "arb" : /\bbase\b/.test(q) ? "base" : /ethereum|\beth\b|\bevm\b/.test(q) ? "eth" : null;
    p.action = /\bstake\b|\bstaking\b/.test(q) ? "stake" : null;
    p.reasons = ["CONVERT_REQUEST"];
    return proposalSchema.parse(p);
  }
  if (/moved (?:forward|up|earlier)|brought forward|now due (?:earlier|sooner)|due date (?:moved|changed)|rescheduled/.test(q)) {
    p.kind = "respond_to_change";
    p.recipientLabel =
      question.match(/\bmy\s+([A-Za-z][A-Za-z .'-]{0,40}?)\s+payment\b/i)?.[1]?.trim() ?? null;
    p.dueDate = questionDate(question, now);
    p.sources = ["wallet-usdc", "rhea-usdc"];
    p.reasons = ["SCHEDULE_CHANGE"];
  } else if (/\brepay\b|pay (?:off|back|down) (?:the|my|this) (?:loan|debt)/.test(q)) {
    p.kind = "repay";
    p.amount = question.match(/([\d,]+(?:\.\d+)?)\s*usdc/i)?.[1]?.replaceAll(",", "") ?? null;
    p.asset = "USDC";
    p.chain = "near";
    p.sources = ["wallet-usdc"];
    p.reasons = ["REPAY_REQUEST"];
  } else if (/\bborrow\b/.test(q) && !/why|blocked|refused/.test(q)) {
    p.kind = "borrow";
    p.amount = question.match(/([\d,]+(?:\.\d+)?)\s*usdc/i)?.[1]?.replaceAll(",", "") ?? null;
    p.asset = "USDC";
    p.chain = "near";
    p.sources = ["LiNEAR", "rNEAR"];
    p.reasons = ["BORROW_REQUEST"];
  } else if (/why|blocked|refused/.test(q)) {
    p.kind = "explain_block";
    p.action = /withdraw/.test(q)
      ? "withdraw"
      : /stake/.test(q)
        ? "stake"
        : /pay/.test(q)
          ? "pay"
          : "supply";
    p.amount =
      question
        .match(/([\d,]+(?:\.\d+)?)\s*(?:usdc|usdt|near)/i)?.[1]
        ?.replaceAll(",", "") ?? null;
    p.asset = /\bnear\b/i.test(question) ? "NEAR" : "USDC";
    p.reasons = ["POLICY_EXPLANATION"];
  } else if (/eth/.test(q) && /fall|drop|stress|crash/.test(q)) {
    p.kind = "stress";
    p.asset = "ETH";
    const percent = q.match(/(\d+(?:\.\d{1,2})?)\s*%/);
    p.drawdownBps = percent ? Number(units(percent[1], 2)) : null;
    p.reasons = ["STRESS_SCENARIO"];
  } else if (/surplus|put.*work|where.*earn/.test(q)) {
    p.kind = "allocate_surplus";
    p.asset = "USDC";
    p.chain = "near";
    p.sources = ["wallet-usdc"];
    p.reasons = ["SURPLUS_ALLOCATION"];
  } else if (/\bpay\b/.test(q)) {
    p.kind = "pay";
    const m = question.match(
      /\bpay\s+(?:([A-Za-z][A-Za-z .'-]{0,60}?)\s+)?\$?([\d,]+(?:\.\d+)?)\s*(USDC|USDT)?/i,
    );
    p.amount = m?.[2].replaceAll(",", "") ?? null;
    p.recipientLabel =
      question.match(/\b0x[0-9a-fA-F]{40}\b/)?.[0] ??
      m?.[1]?.trim() ??
      question
        .match(
          /\bto\s+([A-Za-z][A-Za-z .'-]{0,60}?)(?=\s+(?:on|by|in|without)\b|[?!]|$)/i,
        )?.[1]
        ?.trim() ??
      null;
    p.asset = m?.[3]?.toUpperCase() === "USDT" ? "USDT" : "USDC";
    p.chain = /\bbnb\b|\bbsc\b/.test(q)
      ? "bnb"
      : /arbitrum|\barb\b/.test(q)
        ? "arb"
        : /\bbase\b/.test(q)
          ? "base"
          : /ethereum/.test(q)
            ? "eth"
            : /\bnear\b/.test(q)
              ? "near"
              : null;
    p.dueDate = questionDate(question, now);
    p.sources = ["wallet-usdc", "rhea-usdc"];
    p.reasons = ["USER_CASH_REQUEST"];
  }
  return proposalSchema.parse(p);
}
/** Clear numeric/chain intent cannot be overwritten by model output. */
export function validateModelIntent(
  model: unknown,
  question: string,
  now = Date.now(),
) {
  const p = proposalSchema.parse(model);
  const anchor = parseIntent(question, now);
  for (const field of [
    "kind",
    "amount",
    "recipientLabel",
    "asset",
    "chain",
    "dueDate",
    "drawdownBps",
    "action",
  ] as const) {
    const known = anchor[field];
    if (anchor.kind !== "clarify" && p[field] !== known)
      throw new Error(
        "Model proposal changed explicit question field: " + field,
      );
  }
  return p;
}
export interface AssistantContext {
  obligationId?: string;
  workspace: Workspace;
  portfolio: Portfolio;
  market: MarketSnapshot;
  ledger: LedgerEntry[];
  creditCapacity: string | null;
  /** Engines valuation evidence (prices, quotes); capitalView() figures come from it. */
  evidence?: import("./valuation-evidence.ts").ValuationEvidence | null;
}
export function evaluateAssistant(
  raw: unknown,
  c: AssistantContext,
  now = Date.now(),
) {
  const proposal = proposalSchema.parse(raw);
  const { workspace: w, market } = c;
  const p = {
    ...c.portfolio,
    positions: ownerPositions(c.portfolio.positions),
  };
  if (p.source !== w.mode || market.source !== w.mode)
    throw new Error("Assistant evidence sources cannot be mixed.");
  const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
  const dates = w.obligations
    .filter((o) => !["paid", "cancelled"].includes(o.status))
    .map((o) => o.dueDate);
  let capital: CapitalReport | undefined;
  try {
    capital = capitalView(w, c.portfolio, c.evidence ?? undefined, { now });
  } catch {
    capital = undefined;
  }
  const usable = usableBalances(p, dates, "0", c.creditCapacity, now, {
    prices: c.evidence?.prices ?? null,
    capital,
  });
  const ranking = calendarRanking(w.mandate, market, p, {}, now);
  const account = w.accountId ?? "fictional-example";
  const action = (
    kind: string,
    value: string,
    recipient = account,
    venue = RHEA,
    movingCost: string | null = "0",
  ): PolicyAction => ({
    kind,
    asset: "USDC",
    chain: "near",
    amount: value,
    recipient,
    venue,
    movingCost,
    gasNear: "0.250000000000000000000001",
    source: w.mode,
    accountId: account,
    methods: [
      {
        receiver: kind === "pay" ? USDC : RHEA,
        method: kind === "pay" ? "ft_transfer" : "execute",
      },
    ],
  });
  let evaluation: any;
  let answer: string;
  if (proposal.kind === "pay") {
    const matches = w.obligations.filter(
      (o) =>
        !["paid", "cancelled"].includes(o.status) &&
        (!c.obligationId || o.id === c.obligationId) &&
        proposal.amount !== null &&
        units(o.amount) === units(proposal.amount) &&
        o.token === proposal.asset &&
        o.destination === proposal.chain &&
        (!proposal.recipientLabel ||
          o.label
            .toLowerCase()
            .includes(proposal.recipientLabel.toLowerCase()) ||
          o.recipient.toLowerCase() === proposal.recipientLabel.toLowerCase()),
    );
    const o = matches.length === 1 ? matches[0] : undefined;
    const reasons: string[] = [];
    if (matches.length > 1) reasons.push("AMBIGUOUS_CALENDAR_RECIPIENT");
    if (proposal.sources.some((s) => !["wallet-usdc", "rhea-usdc"].includes(s)))
      reasons.push("UNSUPPORTED_FUNDING_SOURCE");
    if (!proposal.amount) reasons.push("MISSING_AMOUNT");
    if (!proposal.chain) reasons.push("MISSING_CHAIN");
    if (!o?.recipient) reasons.push("MATCHING_CALENDAR_RECIPIENT_REQUIRED");
    const due = proposal.dueDate ?? o?.dueDate ?? null;
    if (due && Date.parse(due + "T23:59:59.999Z") <= now)
      reasons.push("DEADLINE_PASSED");
    let quote: any = null,
      sources: any = null,
      checked: any = null;
    if (w.mode === "demo" && proposal.amount && proposal.chain && o) {
      quote = exampleCashQuote(proposal.amount, proposal.chain, now);
      sources = paymentSources(
        decimal(
          p.positions
            .filter(
              (x) =>
                x.asset === "USDC" &&
                x.kind === "wallet" &&
                (!x.chain || x.chain === "near"),
            )
            .reduce((n, x) => n + units(x.amount), 0n),
        ),
        decimal(
          p.positions
            .filter(
              (x) =>
                x.asset === "USDC" &&
                x.kind === "supplied" &&
                x.id.startsWith("rhea"),
            )
            .reduce((n, x) => n + units(x.amount), 0n),
        ),
        otherObligationHoldback(w, o, now),
        quote.maxInput,
      );
      checked = evaluatePolicy(
        action(
          "pay",
          quote.maxInput,
          o.recipient.toLowerCase(),
          "1click",
          decimal(units(quote.maxInput) - units(proposal.amount)),
        ),
        policy,
        c.ledger,
        now,
      );
      if (!sources.covered) reasons.push("INSUFFICIENT_ELIGIBLE_CASH");
      if (!checked.allowed)
        reasons.push(...checked.violations.map((x: any) => x.code));
    } else reasons.push("LIVE_EXACT_OUTPUT_COSTS_UNVERIFIED");
    if (
      proposal.sources.includes("ETH") &&
      policy.protectedAssets.some((a) => a.toUpperCase() === "ETH")
    )
      reasons.push("PROTECTED_ASSET");
    if (usable.cashNow.amount === null)
      reasons.push("CASH_COVERAGE_UNVERIFIED");
    evaluation = {
      kind: "pay",
      amount: proposal.amount,
      asset: proposal.asset,
      chain: proposal.chain,
      dueDate: due,
      obligationId: o?.id ?? null,
      allowed: reasons.length === 0,
      reasons,
      quote,
      sources,
      policy: checked,
      reserve: w.mandate.reserve,
      executionSupported: payoutSupported(
        proposal.chain ?? "",
        proposal.asset ?? "",
      ),
      readOnly: true,
    };
    answer = evaluation.allowed
      ? `The fictional funding plan covers ${evaluation.amount} ${evaluation.asset}. Maximum source funding is ${quote.maxInput} USDC, including a ${quote.buffer} USDC modeled buffer; the reserve remains ${evaluation.reserve} USDC. This is a planning result; nothing is prepared or authorized.`
      : `A payable plan is not established: ${reasons.join(", ")}. No funds are prepared or authorized.`;
    if (!evaluation.executionSupported)
      answer +=
        " This destination/token has no supported live payment execution path.";
  } else if (proposal.kind === "allocate_surplus") {
    const chosen = ranking.strategies.find((x) => x.id === ranking.chosen);
    const checked =
      units(ranking.surplus) > 0n
        ? evaluatePolicy(
            action("supply", ranking.surplus),
            policy,
            c.ledger,
            now,
          )
        : null;
    evaluation = {
      kind: "allocate_surplus",
      amount: ranking.surplus,
      allowed: !!chosen && checked?.allowed === true,
      chosen: chosen?.id ?? null,
      policy: checked,
      reasons: chosen
        ? (checked?.violations.map((x) => x.code) ?? [])
        : [...new Set(ranking.strategies.flatMap((x) => x.reasons))],
    };
    answer = evaluation.allowed
      ? `The engine finds ${evaluation.amount} USDC of NEAR-wallet surplus and ranks ${chosen!.name} first after modeled costs. This remains a read-only proposal.`
      : `The engine finds ${evaluation.amount} USDC of NEAR-wallet surplus, but does not approve a strategy: ${evaluation.reasons.join(", ")}.`;
  } else if (proposal.kind === "stress") {
    const rows = p.positions.filter((x) => x.asset === proposal.asset);
    const values = rows.map((x) =>
      p.source === "demo" && x.valuation?.source === "demo"
        ? x.valuation.amount
        : null,
    );
    const known = rows.length > 0 && values.every((x) => x !== null);
    const value = known
      ? decimal(values.reduce((n, x) => n + units(x!), 0n))
      : null;
    const stress =
      proposal.drawdownBps === null
        ? null
        : assetStress(proposal.asset ?? "ETH", value, proposal.drawdownBps);
    const protectedAsset = policy.protectedAssets.includes(
      proposal.asset ?? "ETH",
    );
    const credit = stressCapacity(
      [
        {
          id: "assistant-stress",
          source: w.mode,
          capturedAt: p.capturedAt,
          existingDebt: p.positions.some((x) => x.kind === "debt") ? null : "0",
          protocolLimit: null,
          liquidity: null,
          assets: rows.map((x) => ({
            assetId: x.asset,
            collateralId: x.id,
            value: x.valuation?.source === "demo" ? x.valuation.amount : null,
            drawdownBps: proposal.drawdownBps ?? 0,
            ltvCapBps: 7000,
            liquidationThresholdBps: null,
            protocolLtvBps: null,
            minHealth: "1.5",
            priority: "P1" as const,
            permissions: protectedAsset
              ? ["hold" as const]
              : ["pledge" as const, "borrow" as const],
            eligible: !protectedAsset,
          })),
        },
      ],
      now,
    );
    evaluation = {
      kind: "stress",
      allowed: stress?.stressedValue !== null && stress !== null,
      stress,
      credit,
      protectedAsset,
      cashNow: usable.cashNow.amount,
      holdback: ranking.holdback,
    };
    answer =
      stress?.stressedValue != null
        ? `The engine stresses ${stress.asset} from ${stress.valueBefore} to ${stress.stressedValue} in the scenario, a loss of ${stress.loss}. Observed cash remains ${evaluation.cashNow ?? "unknown"} USDC. ${protectedAsset ? "The asset remains protected." : "This creates no borrowing approval."}`
        : "The engine has no verified valuation or complete drawdown for that scenario. Cash and borrowing capacity are not inferred from missing data.";
  } else if (proposal.kind === "explain_block") {
    const amount = proposal.amount;
    const checked =
      amount !== null && proposal.asset === "USDC" && units(amount) > 0n
        ? evaluatePolicy(
            {
              ...action(proposal.action ?? "supply", amount),
              asset: proposal.asset ?? "USDC",
            },
            policy,
            c.ledger,
            now,
          )
        : null;
    evaluation = {
      kind: "explain_block",
      amount,
      allowed: checked?.allowed ?? false,
      policy: checked,
      reasons: checked?.violations.map((x) => x.code) ?? [
        amount === null
          ? "MISSING_ACTION_CONTEXT"
          : "AMOUNT_VALUATION_UNVERIFIED",
      ],
      limits: {
        perAction: policy.perActionCap,
        daily: policy.dailyCap,
        maxMoveCost: policy.maxMoveCost,
      },
      operationSpecific: true,
    };
    answer =
      amount === null
        ? "Specify the amount and action that was blocked. A historical operation is not inferred from missing context."
        : proposal.asset !== "USDC"
          ? "That native-asset amount has no verified USDC valuation for the policy caps. No approval can be inferred."
          : `The tested amount is ${evaluation.amount} ${proposal.asset ?? "USDC"} against a per-action limit of ${evaluation.limits.perAction} USDC and daily limit of ${evaluation.limits.daily} USDC. ${checked?.allowed ? "These policy checks pass; full preparation guards still apply." : "Blocked checks: " + evaluation.reasons.join(", ") + "."}`;
  } else if (proposal.kind === "borrow") {
    const capacity = c.creditCapacity;
    evaluation = {
      kind: "borrow",
      capacity,
      allowed: false,
      reasons: capacity === null ? ["CAPACITY_UNKNOWN"] : units(capacity) === 0n ? ["NO_STRESS_CAPACITY"] : [],
      readOnly: true,
    };
    answer =
      capacity === null
        ? "The credit engine can't establish stress capacity from verified valuations, so no borrowing amount is offered."
        : `The credit engine's stress capacity under your rules is ${capacity} USDC. New debt always needs your explicit approval and a wallet signature; nothing is prepared here.`;
  } else if (proposal.kind === "repay") {
    const debt = p.positions
      .filter((x) => x.kind === "debt" && x.asset === "USDC")
      .reduce((n, x) => n + units(x.amount), 0n);
    evaluation = {
      kind: "repay",
      debt: decimal(debt),
      cashNow: usable.cashNow.amount,
      holdback: ranking.holdback,
      allowed: false,
      reasons: debt === 0n ? ["NO_DEBT_FOUND"] : [],
      readOnly: true,
    };
    answer =
      debt === 0n
        ? "The portfolio read shows no USDC debt to repay. Nothing to plan."
        : `The portfolio shows ${decimal(debt)} USDC of debt. Repayment can only use cash above your reserve and dated payments (${ranking.holdback ?? "unknown"} USDC held back).`;
  } else if (proposal.kind === "convert") {
    // USDC FlowVault has read on Ethereum, Base and Arbitrum in wallets proven yours.
    const evmUsdc = c.portfolio.positions.filter(
      (x) => x.asset === "USDC" && ["eth", "base", "arb"].includes(String(x.chain)) && x.ownership !== "watched" && units(x.amount) > 0n,
    );
    const total = evmUsdc.reduce((n, x) => n + units(x.amount), 0n);
    const chainName: Record<string, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum" };
    const list = evmUsdc.map((x) => `${Number(decimal(units(x.amount))).toFixed(2)} USDC on ${chainName[String(x.chain)]}`).join(", ");
    const nearAccount = w.accountId;
    const reasons = [...(!nearAccount ? ["NO_NEAR_ACCOUNT"] : []), ...(total === 0n ? ["NO_EVM_USDC"] : [])];
    evaluation = {
      kind: "convert",
      amount: proposal.amount ?? (total > 0n ? decimal(total) : null),
      to: nearAccount,
      available: decimal(total),
      allowed: reasons.length === 0,
      reasons,
      readOnly: true,
    };
    answer = !nearAccount
      ? "Connect your NEAR wallet first: converted NEAR is delivered to your NEAR account."
      : total === 0n
        ? "I don’t see USDC on Ethereum, Base or Arbitrum in your connected wallets. Connect the wallet that holds it, then ask again."
        : `You hold ${list}. FlowVault can convert it to NEAR in ${nearAccount} through NEAR Intents: you approve one USDC transfer in your Ethereum wallet, 1Click delivers wNEAR in about a minute, you unwrap it to NEAR in your NEAR wallet` +
          (proposal.action === "stake" ? ", and then stake it from Strategies (LiNEAR or a verified validator)." : ".") +
          " Each step is yours to approve; nothing is prepared until you open it.";
  } else if (proposal.kind === "respond_to_change") {
    const pending = w.obligations
      .filter((o) => !["paid", "cancelled"].includes(o.status))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const label = proposal.recipientLabel?.toLowerCase();
    const o = (label && pending.find((x) => x.label.toLowerCase().includes(label))) || pending[0];
    evaluation = {
      kind: "respond_to_change",
      obligationId: o?.id ?? null,
      dueDate: o?.dueDate ?? null,
      holdback: ranking.holdback,
      surplus: ranking.surplus,
      allowed: !!o,
      reasons: o ? [] : ["NO_PENDING_PAYMENT"],
      readOnly: true,
    };
    answer = o
      ? `The engine re-ran your cash plan with the current dates: ${ranking.holdback ?? "an unknown amount of"} USDC is now held back and ${ranking.surplus} USDC is surplus. The plan below names the payment and compares how to fund it in time.`
      : "There is no pending payment to re-plan.";
  } else {
    evaluation = {
      kind: "clarify",
      allowed: false,
      reasons: ["MISSING_DETAILS"],
    };
    answer =
      "Ask about paying a calendar obligation, deploying surplus, an ETH drawdown, or a blocked action. No execution is available from this assistant.";
  }
  return {
    source: w.mode,
    fictional: w.mode === "demo",
    label:
      w.mode === "demo"
        ? "FICTIONAL EXAMPLE — read-only engine figures"
        : "LIVE READS — scoped, read-only engine figures",
    proposal,
    evaluation,
    answer,
    figures: { usable, ranking },
    readOnly: true,
    prepares: false,
    authorizes: false,
    signable: false,
  };
}
