import { workspaceLedger } from "@/lib/flowvault/policy-context";
import { z } from "zod";
import { session, save, mutation, json, failure } from "@/lib/flowvault/store";
import { policySchema, defaultPolicy, VENUE_IDS } from "@/lib/flowvault/policy";
import { invalidatePlan } from "@/lib/flowvault/obligations";
import { readLedger } from "@/lib/flowvault/policy-store";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        policy: s.workspace.policy ?? defaultPolicy(),
        revision: s.revision,
        history: s.workspace.policyHistory ?? [],
        venueIds: VENUE_IDS,
        ledger: workspaceLedger(s.workspace, await readLedger(s.id)),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(r: Request) {
  try {
    mutation(r);
    const b = z
      .object({ revision: z.number().int(), policy: policySchema })
      .parse(await r.json());
    const s = await session(r);
    if (s.revision !== b.revision)
      throw new Error("Workspace changed. Refresh and try again.");
    s.workspace.policy = {
      ...b.policy,
      version: (s.workspace.policy?.version ?? 0) + 1,
    };
    s.workspace.policyHistory = [
      ...(s.workspace.policyHistory ?? []),
      {
        version: s.workspace.policy.version,
        savedAt: new Date().toISOString(),
        summary:
          "Saved policy revision: caps, asset permissions and allowlists",
      },
    ];
    invalidatePlan(s.workspace);
    const revision = await save(s.id, s.workspace, s.revision);
    return json({ workspace: s.workspace, revision }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
