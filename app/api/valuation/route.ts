import { session, json, failure } from "@/lib/flowvault/store";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { listActiveAttempts } from "@/lib/flowvault/attempts";
import { readValuationEvidence } from "@/lib/flowvault/valuation-evidence";
import { capitalView, usdcText } from "@/lib/flowvault/valuation";
import { units } from "@/lib/flowvault/money";
/** GET /api/valuation[?quotes=true] — the shared CapitalView (Engines). Read-only. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const quotes = new URL(r.url).searchParams.get("quotes") === "true";
    const [{ portfolio }, evidence, active] = await Promise.all([
      workspacePortfolio(s.workspace),
      readValuationEvidence(s.workspace, { quotes }),
      s.workspace.mode === "demo" ? Promise.resolve([]) : listActiveAttempts(s.id),
    ]);
    const committedRaw = active
      .filter((a) => a.accountId === portfolio.accountId && a.kind !== "withdraw")
      .reduce((n, a) => n + units(a.amount), 0n);
    const stressBps = Object.fromEntries(
      (s.workspace.policy?.creditRows ?? []).map((x) => [x.assetId, x.drawdownBps]),
    );
    const view = capitalView(s.workspace, portfolio, evidence, { committedRaw, stressBps });
    return json(
      {
        ...view,
        fictional: view.source === "demo",
        display: {
          netWorth: usdcText(view.netWorthUsdcRaw),
          stressedNetWorth: usdcText(view.stressedNetWorthUsdcRaw),
          spendableNow: usdcText(view.spendableNowUsdcRaw),
          holdback: usdcText(view.holdbackUsdcRaw),
          surplus: usdcText(view.surplusUsdcRaw),
        },
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
