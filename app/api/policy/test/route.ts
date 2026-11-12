import { workspaceLedger } from "@/lib/flowvault/policy-context";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import {
  evaluatePolicy,
  defaultPolicy,
  policySchema,
} from "@/lib/flowvault/policy";
import { readLedger } from "@/lib/flowvault/policy-store";
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const raw = z.record(z.unknown()).parse(await r.json());
    const draft =
      raw.draftPolicy === undefined
        ? undefined
        : policySchema.parse(raw.draftPolicy);
    const action = z
      .object({
        chain: z.enum(["near", "arb", "base", "bnb", "eth"]).optional(),
        id: z.string().optional(),
        kind: z.string(),
        asset: z.string(),
        amount: z.string(),
        recipient: z.string(),
        venue: z.string(),
        movingCost: z.string().nullable(),
        gasNear: z.string().nullable(),
        source: z.enum(["demo", "live"]),
        accountId: z.string(),
        methods: z.array(
          z.object({
            receiver: z.string(),
            method: z.string(),
            nestedReceiver: z.string().optional(),
          }),
        ),
      })
      .parse(raw);
    action.id = undefined;
    if (action.source !== s.workspace.mode)
      throw new Error("Policy test source must match the selected workspace.");
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        simulation: true,
        readOnly: true,
        evaluatedAgainst: draft ? "unsaved-draft" : "saved-policy",
        policyVersion: (draft ?? s.workspace.policy)?.version ?? 1,
        ...evaluatePolicy(
          action,
          draft ?? s.workspace.policy ?? defaultPolicy(),
          workspaceLedger(
            s.workspace,
            await readLedger(s.id),
            action.accountId,
          ),
        ),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
