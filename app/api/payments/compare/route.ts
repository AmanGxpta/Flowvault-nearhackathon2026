import { z } from "zod";
import { session, json, failure, mutation } from "@/lib/flowvault/store";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { workspaceLedger } from "@/lib/flowvault/policy-context";
import { readLedger } from "@/lib/flowvault/policy-store";
import { demoMarket } from "@/lib/flowvault/seed";
import { liveMarket } from "@/lib/flowvault/near";
import { compareObligation } from "@/lib/flowvault/payment-comparison";
export async function POST(r: Request) {
  try {
    mutation(r);
    const b = z
      .object({ obligationId: z.string().min(1) })
      .strict()
      .parse(await r.json());
    const s = await session(r);
    const [{ portfolio }, market, ledger] = await Promise.all([
      workspacePortfolio(s.workspace),
      s.workspace.mode === "demo" ? demoMarket() : liveMarket(),
      readLedger(s.id),
    ]);
    const current = await session(r);
    if (current.revision !== s.revision)
      throw new Error(
        "Payment comparison workspace changed. Refresh and try again.",
      );
    return json(
      {
        comparison: compareObligation(b.obligationId, {
          workspace: s.workspace,
          portfolio,
          market,
          ledger: workspaceLedger(s.workspace, ledger),
          creditCapacity: null,
        }),
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
