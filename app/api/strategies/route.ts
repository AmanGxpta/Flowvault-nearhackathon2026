import { session, json, failure } from "@/lib/flowvault/store";
import { demoMarket } from "@/lib/flowvault/seed";
import { liveMarket } from "@/lib/flowvault/near";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { calendarRanking } from "@/lib/flowvault/calendar";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const q = new URL(r.url).searchParams;
    const [market, { portfolio: p }] = await Promise.all([
      s.workspace.mode === "demo" ? demoMarket() : liveMarket(),
      workspacePortfolio(s.workspace, { staking: false, watch: false }),
    ]);
    return json(
      calendarRanking(s.workspace.mandate, market, p, {}, Date.now(), {
        amount: q.get("amount") ?? undefined,
      }),
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
