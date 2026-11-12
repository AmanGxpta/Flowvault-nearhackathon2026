import { rheaLendingVenue } from "@/lib/flowvault/lending-venue-rhea";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { checkPolicy } from "@/lib/flowvault/policy-store";
import { defaultPolicy, preparationAction } from "@/lib/flowvault/policy";
import { createAttempt, preparationRetry } from "@/lib/flowvault/attempts";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { holdback } from "@/lib/flowvault/obligations";
import { decimal, units } from "@/lib/flowvault/money";
import { LENDING_KINDS, COLLATERAL_FAMILY } from "@/lib/flowvault/lending";
import { freshLending, lendingPreview, serializeLending } from "@/lib/flowvault/lending-live";
/** GET /api/lending — live Rhea credit state and USDC borrow capacity (read-only). */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      return json(
        {
          source: s.workspace.mode,
          fictional: s.workspace.mode === "demo",
          capacity: null,
          reasons: [s.workspace.mode === "demo" ? "EXAMPLE_WORKSPACE_NO_LIVE_CREDIT" : "NO_ACCOUNT"],
          executable: false,
        },
        s.cookie,
      );
    const { state, capacity } = await lendingPreview(s.workspace.accountId, s.workspace.policy);
    return json(
      {
        source: "live",
        fictional: false,
        venue: "Rhea Lending",
        collateralFamily: Object.keys(COLLATERAL_FAMILY),
        executable: capacity.capacityUsdcRaw !== null,
        capacity: serializeLending(capacity),
        venueSnapshot: rheaLendingVenue.inspect(state, s.workspace.policy),
        state: serializeLending({ ...state, prices: state.prices ? { basis: state.prices.basis, freshUntil: state.prices.freshUntil } : null }),
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
/** POST /api/lending — prepare one owner-signed Rhea step into the wallet-attempt journal. */
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    await withCapitalEvidence(s.workspace);
    const body = z
      .object({
        kind: z.enum(LENDING_KINDS as [string, ...string[]]),
        asset: z.enum(["USDC", "LiNEAR", "rNEAR"]),
        amount: z.string().max(40),
        key: z.string().uuid(),
        approveNewDebt: z.boolean().default(false),
      })
      .parse(await request.json());
    const kind = body.kind as (typeof LENDING_KINDS)[number];
    if (s.workspace.mode !== "live" || !s.workspace.accountId)
      throw new Error("Open your live NEAR account to prepare a Rhea credit step.");
    const decimals = body.asset === "USDC" ? 6 : 24;
    const amountRaw = units(body.amount, decimals);
    const retry = await preparationRetry(s.id, body.key, {
      kind,
      accountId: s.workspace.accountId,
      mandateVersion: s.workspace.mandate.version,
      amount: decimal(amountRaw, decimals),
    });
    if (retry) return json({ ...retry.preparation, kind: retry.kind, attemptId: retry.id }, s.cookie);
    const preparation = await freshLending(s.workspace.accountId, s.workspace.policy, {
      kind,
      asset: body.asset,
      amountRaw,
      approveNewDebt: body.approveNewDebt,
      holdbackRaw: kind === "repay" ? holdback(s.workspace.mandate) : undefined,
    });
    await checkPolicy(
      s.id,
      preparationAction(preparation, kind),
      s.workspace.policy ?? defaultPolicy(s.workspace.mandate.maxMoveCost),
    );
    const current = await session(request);
    if (
      current.workspace.mode !== "live" ||
      current.workspace.accountId !== s.workspace.accountId ||
      current.workspace.mandate.version !== s.workspace.mandate.version
    )
      throw new Error("Workspace changed during preparation. Refresh and prepare again.");
    const attempt = await createAttempt(s.id, s.workspace.mandate.version, preparation, kind, body.key);
    return json({ ...attempt.preparation, kind: attempt.kind, attemptId: attempt.id }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
