import { payoutAsset } from "@/lib/flowvault/evm";
import { otherObligationHoldback } from "@/lib/flowvault/payments";
import { holdback } from "@/lib/flowvault/obligations";
import { QuoteUpstreamError } from "@/lib/flowvault/quote-errors";
import { exampleCashQuote } from "@/lib/flowvault/example-quote";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { dryCashQuote, liveMarket, readPortfolio } from "@/lib/flowvault/near";
import { positive, units } from "@/lib/flowvault/money";
import { compareCash } from "@/lib/flowvault/planner";
import { demoMarket, demoPortfolio } from "@/lib/flowvault/seed";
import type { CashQuote } from "@/lib/flowvault/types";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    await withCapitalEvidence(s.workspace);
    const body = z
      .object({
        amount: z.string().max(40),
        days: z.number().int().min(1).max(3650),
        destination: z.enum(["arb", "base", "bnb", "eth", "near"]),
        recipient: z.string().max(100).optional(),
        token: z.enum(["USDC", "USDT"]).default("USDC"),
        obligationId: z.string().optional(),
      })
      .parse(await request.json());
    const n = positive(body.amount);
    const days = Number(body.days);
    const route =
      s.workspace.mode === "demo"
        ? null
        : payoutAsset(body.destination, body.token);
    let quote: CashQuote;
    let market;
    let portfolio;
    if (s.workspace.mode === "demo") {
      quote = exampleCashQuote(body.amount, body.destination);
      market = demoMarket();
      portfolio = demoPortfolio();
    } else {
      if (!s.workspace.accountId)
        throw new Error("Watch your source account first.");
      [quote, market, portfolio] = await Promise.all([
        dryCashQuote(
          s.workspace.accountId,
          body.recipient ?? "",
          body.destination,
          units(body.amount, route!.decimals).toString(),
          body.token,
        ),
        liveMarket(),
        readPortfolio(s.workspace.accountId),
      ]);
    }
    const matches = s.workspace.obligations.filter(
      (o) =>
        !["paid", "cancelled"].includes(o.status) &&
        (body.obligationId
          ? o.id === body.obligationId
          : units(o.amount) === n && o.destination === body.destination),
    );
    if (body.obligationId && matches.length !== 1)
      throw new Error("Obligation not found.");
    const reservedCash =
      matches.length === 1
        ? otherObligationHoldback(s.workspace, matches[0])
        : holdback(s.workspace.mandate);
    const comparison = compareCash(
      body.amount,
      days,
      quote,
      market,
      portfolio,
      s.workspace.mandate,
      Date.now(),
      reservedCash,
    );
    if (quote.source === "demo")
      comparison.assumption +=
        " Fictional route costs differ by destination for illustration; they are example data, not observed chain fees.";
    return json({ quote, comparison }, s.cookie);
  } catch (e) {
    // The UI consumes error; exact upstream text stays available in the network response for debugging.
    if (e instanceof QuoteUpstreamError)
      return json({ error: e.message, debug: e.debug }, undefined, 400);
    return failure(e);
  }
}
