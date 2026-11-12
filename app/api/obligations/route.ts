import { z } from "zod";
import { session, save, mutation, json, failure } from "@/lib/flowvault/store";
import {
  editObligation,
  holdback,
  obligationCash,
} from "@/lib/flowvault/obligations";
import { decimal } from "@/lib/flowvault/money";
export async function GET(request: Request) {
  try {
    const s = await session(request);
    let totals;
    try {
      totals = {
        holdback: decimal(holdback(s.workspace.mandate)),
        obligationsInHorizon: decimal(obligationCash(s.workspace.mandate)),
        error: null,
      };
    } catch (e) {
      totals = {
        holdback: null,
        obligationsInHorizon: null,
        error: (e as Error).message,
      };
    }
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        obligations: s.workspace.obligations,
        revision: s.revision,
        horizonDays: s.workspace.mandate.horizon,
        ...totals,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
async function edit(
  request: Request,
  operation: "create" | "update" | "delete",
) {
  try {
    mutation(request);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        obligation: z.unknown(),
      })
      .parse(await request.json());
    const s = await session(request);
    if (body.revision !== s.revision)
      throw new Error("Workspace changed. Refresh and try again.");
    const workspace = editObligation(s.workspace, operation, body.obligation);
    const revision = await save(s.id, workspace, s.revision);
    return json({ workspace, revision }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
export const POST = (r: Request) => edit(r, "create");
export const PUT = (r: Request) => edit(r, "update");
export const DELETE = (r: Request) => edit(r, "delete");
