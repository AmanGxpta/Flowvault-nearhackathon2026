import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { unsignedStake } from "@/lib/flowvault/staking-options";
import { nearAddress } from "@/lib/flowvault/accounts";
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const b = z
      .object({
        kind: z.enum(["native", "linear", "rnear"]),
        amount: z.string().max(60),
        pool: nearAddress.optional(),
      })
      .strict()
      .parse(await r.json());
    const p = await unsignedStake(s.workspace, b.kind, b.amount, b.pool);
    const current = await session(r);
    if (
      current.workspace.accountId !== s.workspace.accountId ||
      current.workspace.mode !== s.workspace.mode ||
      current.workspace.mandate.version !== s.workspace.mandate.version
    )
      throw new Error("Workspace changed during staking quote.");
    return json(p, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
