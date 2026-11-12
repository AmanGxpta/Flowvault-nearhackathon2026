import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { createAttempt, readAttempt } from "@/lib/flowvault/attempts";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { checkPolicy } from "@/lib/flowvault/policy-store";
import { defaultPolicy } from "@/lib/flowvault/policy";
import {
  freshStaking,
  assertStakingContext,
  STAKING_KINDS,
} from "@/lib/flowvault/staking-execution";
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const b = z
      .object({
        kind: z.enum(STAKING_KINDS),
        amountRaw: z
          .string()
          .regex(/^[1-9]\d*$/)
          .max(39),
        key: z.string().uuid(),
      })
      .strict()
      .parse(await r.json());
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error("Open a live account for LiNEAR execution.");
    const key = "staking:" + b.key,
      id = await keyedAttemptId(s.id, key);
    let existing;
    try {
      existing = (await readAttempt(s.id, id)).attempt;
    } catch (e) {
      if (
        !(e instanceof Error) ||
        e.message !== "Transaction request not found in this browser session."
      )
        throw e;
    }
    if (existing) {
      const p = existing.preparation as StakingPreparation;
      assertStakingContext(p, s.workspace, s.revision);
      if (existing.kind !== b.kind || p.amountRaw !== b.amountRaw)
        throw new Error(
          "Staking idempotency key conflicts with the reviewed request.",
        );
      return json({ ...p, attemptId: existing.id }, s.cookie);
    }
    const p = await freshStaking(s.workspace, s.revision, b.kind, b.amountRaw);
    await checkPolicy(
      s.id,
      p.policyAction,
      s.workspace.policy ?? defaultPolicy(s.workspace.mandate.maxMoveCost),
    );
    const current = await session(r);
    assertStakingContext(p, current.workspace, current.revision);
    const attempt = await createAttempt(
      s.id,
      s.workspace.mandate.version,
      p,
      b.kind,
      key,
    );
    if ((attempt.preparation as StakingPreparation).amountRaw !== b.amountRaw)
      throw new Error(
        "Staking idempotency key conflicts with the reviewed request.",
      );
    return json({ ...attempt.preparation, attemptId: attempt.id }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
