import {checkPolicy} from "@/lib/flowvault/policy-store";
import {preparationAction,defaultPolicy} from "@/lib/flowvault/policy";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { freshSupply, freshWithdraw } from "@/lib/flowvault/prepare";
import { supplyHoldback } from "@/lib/flowvault/execution";
import { createAttempt, preparationRetry } from "@/lib/flowvault/attempts";
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    const body = z
      .object({
        amount: z.string().max(40),
        kind: z.enum(["supply", "withdraw"]).default("supply"),
        key: z.string().uuid().optional(),
      })
      .parse(await request.json());
    if (body.kind === "withdraw" && !body.key)
      throw new Error(
        "Withdrawal preparation requires a UUID idempotency key.",
      );
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error(
        `Watch or connect your account to prepare a live ${body.kind}.`,
      );
    if (body.key) {
      const retry = await preparationRetry(s.id, body.key, {
        kind: body.kind,
        accountId: s.workspace.accountId,
        mandateVersion: s.workspace.mandate.version,
        amount: body.amount,
      });
      if (retry)
        return json(
          { ...retry.preparation, kind: retry.kind, attemptId: retry.id },
          s.cookie,
        );
    }
    const preparation =
      body.kind === "withdraw"
        ? await freshWithdraw(s.workspace.accountId, body.amount)
        : await freshSupply(
            s.workspace.accountId,
            supplyHoldback(s.workspace.mandate),
            body.amount,
          );
    await checkPolicy(s.id,preparationAction(preparation,body.kind),s.workspace.policy??defaultPolicy(s.workspace.mandate.maxMoveCost));
    const current = await session(request);
    if (
      current.workspace.mode !== "live" ||
      current.workspace.accountId !== s.workspace.accountId ||
      current.workspace.mandate.version !== s.workspace.mandate.version
    )
      throw new Error(
        "Workspace changed during preparation. Refresh and prepare again.",
      );
    const attempt = await createAttempt(
      s.id,
      s.workspace.mandate.version,
      preparation,
      body.kind,
      body.key,
    );
    return json(
      { ...attempt.preparation, kind: attempt.kind, attemptId: attempt.id },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
