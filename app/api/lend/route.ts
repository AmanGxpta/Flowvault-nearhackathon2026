import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { prepareRhea, allowRheaInPolicy, rheaPositions } from "@/lib/flowvault/rhea-markets-live";

const token = z.string().regex(/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/);

/** GET ?token= — your Rhea position, wallet balance and market terms for one token (finalized, read-only). */
export async function GET(request: Request) {
  try {
    const s = await session(request);
    return json(await rheaPositions(request, token.parse(new URL(request.url).searchParams.get("token"))), s.cookie);
  } catch (e) {
    return failure(e);
  }
}

/** Owner-signed Rhea Lending for every market. prepare: finalized reads, Rhea-oracle prices, health, liquidity,
 * storage and policy checks, then a journal entry the owner reviews; allow: the explicit "Allow in Policy"
 * revision for it. Signing happens only after /api/transactions authorize, in the owner's own wallet. */
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    const b = z.discriminatedUnion("op", [
      z.object({ op: z.literal("prepare"), action: z.enum(["supply", "withdraw", "collateral_add", "collateral_release", "borrow", "repay"]), tokenId: token, amount: z.string().regex(/^\d{1,30}(\.\d{1,30})?$/), native: z.boolean().optional(), approveNewDebt: z.boolean().optional() }).strict(),
      z.object({ op: z.literal("allow"), id: z.string().uuid(), revision: z.number().int() }).strict(),
    ]).parse(await request.json());
    if (b.op === "allow") return json(await allowRheaInPolicy(request, b.id, b.revision), s.cookie);
    return json(await prepareRhea(request, b), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
