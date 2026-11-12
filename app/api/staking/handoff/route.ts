import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { readAttempt, saveAttempt } from "@/lib/flowvault/attempts";
import {
  assertStakingContext,
  isStakingKind,
} from "@/lib/flowvault/staking-execution";
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
import {
  assertStakingWalletHandoff,
  consumeStakingWalletHandoff,
} from "@/lib/flowvault/staking-wallet-guard";
/** Atomic, one-use app wallet handoff claim. It never calls a wallet or signs. */
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const { preparation } = z
      .object({
        preparation: z.object({ attemptId: z.string().uuid() }).passthrough(),
      })
      .strict()
      .parse(await r.json());
    const { attempt, previous } = await readAttempt(
      s.id,
      preparation.attemptId,
    );
    if (!isStakingKind(attempt.kind))
      throw new Error("Use a LiNEAR journal attempt.");
    assertStakingContext(
      attempt.preparation as StakingPreparation,
      s.workspace,
      s.revision,
    );
    assertStakingWalletHandoff(
      preparation as unknown as StakingPreparation & { attemptId: string },
      attempt,
    );
    const claimed = consumeStakingWalletHandoff(attempt);
    await saveAttempt(s.id, claimed, previous, s.revision);
    return json({ attempt: claimed }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
