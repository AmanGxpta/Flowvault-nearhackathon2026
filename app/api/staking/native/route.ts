import { env } from "cloudflare:workers";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { evaluatePool, freshNative, assertNativeContext } from "@/lib/flowvault/staking-native-live";
import { NOT_DEPLOYED, NATIVE_KINDS, fundAuthority } from "@/lib/flowvault/staking-native";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { createAttempt, preparationRetry } from "@/lib/flowvault/attempts";
import { checkPolicy } from "@/lib/flowvault/policy-store";
import { defaultPolicy, preparationAction } from "@/lib/flowvault/policy";
import { units, decimal } from "@/lib/flowvault/money";
import { policyContractId } from "@/lib/flowvault/policy-contract";
function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" ? binding : process.env[name];
}
/** GET /api/staking/native?pool=<pool account> — read-only validator evaluation (P2). */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const pool = new URL(r.url).searchParams.get("pool") ?? "";
    if (s.workspace.mode !== "live")
      return json({ source: "demo", fictional: true, executable: false, reason: "Native staking runs on a live account only." }, s.cookie);
    const accountId = s.workspace.accountId ?? null;
    const contractId = policyContractId(setting);
    const evaluation = await evaluatePool(pool, accountId);
    return json(
      {
        source: "live",
        evaluation,
        policyContract: contractId
          ? { status: "configured", contractId, note: "Native stake preparation needs the id of an owner-approved proposal on this contract." }
          : { status: NOT_DEPLOYED.status, contractId: null, note: NOT_DEPLOYED.reason },
        authority: accountId ? fundAuthority(accountId, contractId) : null,
        executable: false,
        executableReason: "Preparation goes through POST /api/staking/native (journal), then /api/transactions authorize, then the owner's wallet.",
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}

/** POST /api/staking/native — prepare one owner-signed native staking step into the wallet-attempt journal.
 * Body `{kind:"native_stake"|"native_unstake"|"native_withdraw", pool, amount (NEAR decimal), key (uuid),
 * approveStake? (required true for native_stake), proposalId? (required when a policy contract is configured)}`. */
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    await withCapitalEvidence(s.workspace);
    const body = z
      .object({
        kind: z.enum(NATIVE_KINDS),
        pool: z.string().min(2).max(64),
        amount: z.string().max(40),
        key: z.string().uuid(),
        approveStake: z.boolean().default(false),
        proposalId: z.string().regex(/^\d{1,20}$/).nullish(),
      })
      .strict()
      .parse(await request.json());
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error("Open your live NEAR account to prepare a staking step.");
    const amountRaw = units(body.amount, 24);
    const retry = await preparationRetry(s.id, "native:" + body.key, {
      kind: body.kind,
      accountId: s.workspace.accountId,
      mandateVersion: s.workspace.mandate.version,
      amount: decimal(amountRaw, 24),
    });
    if (retry) return json({ ...retry.preparation, kind: retry.kind, attemptId: retry.id }, s.cookie);
    const preparation = await freshNative(
      s.workspace,
      s.revision,
      { kind: body.kind, pool: body.pool, amountRaw, approveStake: body.approveStake, proposalId: body.proposalId ?? null },
      policyContractId(setting),
    );
    await checkPolicy(
      s.id,
      preparationAction(preparation, body.kind),
      s.workspace.policy ?? defaultPolicy(s.workspace.mandate.maxMoveCost),
    );
    const current = await session(request);
    assertNativeContext(preparation, current.workspace, current.revision);
    const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation, body.kind, "native:" + body.key);
    return json({ ...attempt.preparation, kind: attempt.kind, attemptId: attempt.id }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
