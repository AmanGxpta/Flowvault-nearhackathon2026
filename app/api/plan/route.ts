import { session, json, failure } from "@/lib/flowvault/store";
import { demoMarket } from "@/lib/flowvault/seed";
import { liveMarket } from "@/lib/flowvault/near";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { nextAction } from "@/lib/flowvault/action";
import { calendarRanking } from "@/lib/flowvault/calendar";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    await withCapitalEvidence(s.workspace);
    const [market, { portfolio: p }] = await Promise.all([
      s.workspace.mode === "demo" ? demoMarket() : liveMarket(),
      workspacePortfolio(s.workspace, { staking: false, watch: false }),
    ]);
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        action: nextAction(s.workspace.mandate, market, p),
        calendar: calendarRanking(s.workspace.mandate, market, p),
        obligations: s.workspace.obligations,
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
