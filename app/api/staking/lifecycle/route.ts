import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import {
  linearLifecycleQuote,
  observeLinearLifecycle,
} from "@/lib/flowvault/staking-lifecycle";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error("Open a live NEAR account to observe LiNEAR.");
    return json(await observeLinearLifecycle(s.workspace.accountId, z.enum(["linear","rnear"]).parse(new URL(r.url).searchParams.get("venue") ?? "linear")), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error("Open a live NEAR account to compare LiNEAR.");
    const b = z
      .object({
        kind: z.enum(["stake", "unstake", "withdraw_unstaked"]),
        venue: z.enum(["linear","rnear"]).default("linear"),
        amountRaw: z
          .string()
          .regex(/^[1-9]\d*$/)
          .max(39),
      })
      .strict()
      .parse(await r.json());
    const quote = await linearLifecycleQuote(
      s.workspace.accountId,
      b.kind,
      b.amountRaw,
      b.venue,
    );
    const current = await session(r);
    if (
      current.revision !== s.revision ||
      current.workspace.accountId !== s.workspace.accountId
    )
      throw new Error("Staking workspace changed. Compare again.");
    return json(
      {
        ...quote,
        revision: s.revision,
        warning:
          "Read-only SDK quote. No journal, approval, wallet handoff or execution authority. Use the step adapter once integrated.",
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
