import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { createAttempt, readAttempt } from "@/lib/flowvault/attempts";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { checkPolicy } from "@/lib/flowvault/policy-store";
import { defaultPolicy, hazardChecks } from "@/lib/flowvault/policy";
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
        venue: z.enum(["linear","rnear"]).default("linear"),
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
      if (existing.kind !== b.kind || p.amountRaw !== b.amountRaw || p.quote.protocol !== b.venue)
        throw new Error(
          "Staking idempotency key conflicts with the reviewed request.",
        );
      return json({ ...p, attemptId: existing.id }, s.cookie);
    }
    const p = await freshStaking(s.workspace, s.revision, b.kind, b.amountRaw, b.venue);
    const stakingPolicy = s.workspace.policy ?? defaultPolicy(s.workspace.mandate.maxMoveCost);
    const checked = await checkPolicy(s.id, p.policyAction, stakingPolicy);
    const checks = hazardChecks(p.policyAction, stakingPolicy, checked, [{ id: "code", label: "Staking contract code verified", ok: true }, { id: "gas-reserve", label: "0.5 NEAR stays on your account for fees", ok: true }]);
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
    return json({ ...attempt.preparation, attemptId: attempt.id, checks }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
