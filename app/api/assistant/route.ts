import { workspaceLedger } from "@/lib/flowvault/policy-context";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { assistantIntent } from "@/lib/flowvault/assistant-provider";
import { evaluateAssistant } from "@/lib/flowvault/assistant";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { demoMarket } from "@/lib/flowvault/seed";
import { liveMarket } from "@/lib/flowvault/near";
import { portfolioCredit } from "@/lib/flowvault/credit-live";
import { readLedger } from "@/lib/flowvault/policy-store";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" ? binding : process.env[name];
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const b = z
      .object({
        question: z.string().trim().min(1).max(2000),
        useModel: z.boolean().default(true),
      })
      .strict()
      .parse(await r.json());
    const s = await session(r);
    const evidence = await withCapitalEvidence(s.workspace);
    const now = Date.now();
    const intent = await assistantIntent(
      b.question,
      b.useModel
        ? {
            key: setting("NEARAI_API_KEY"),
            baseUrl: setting("NEARAI_BASE_URL"),
            model: setting("NEARAI_MODEL"),
          }
        : {},
      now,
    );
    const [{ portfolio }, market, ledger] = await Promise.all([
      workspacePortfolio(s.workspace),
      s.workspace.mode === "demo" ? demoMarket(now) : liveMarket(),
      readLedger(s.id),
    ]);
    let creditCapacity: string | null = null;
    try {
      creditCapacity = (await portfolioCredit(portfolio, s.workspace.policy))
        .capacity;
    } catch {
      /* Explicit unknown, never zero. */
    }
    const current = await session(r);
    if (
      current.workspace.mode !== s.workspace.mode ||
      current.workspace.accountId !== s.workspace.accountId ||
      current.workspace.mandate.version !== s.workspace.mandate.version
    )
      throw new Error(
        "Assistant workspace changed. Ask again using the current plan.",
      );
    const result = evaluateAssistant(
      intent.proposal,
      {
        workspace: s.workspace,
        portfolio,
        market,
        ledger: workspaceLedger(s.workspace, ledger),
        creditCapacity,
        evidence,
      },
      now,
    );
    return json(
      {
        ...result,
        provider: intent.provider,
        dataSent: intent.dataSent,
        warning: intent.warning,
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
