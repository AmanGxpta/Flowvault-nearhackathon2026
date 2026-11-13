import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { prepareSwap, allowSwapInPolicy } from "@/lib/flowvault/swap-journal";
import { swapTokenCatalog } from "@/lib/flowvault/swap-catalog";

/** Owner-signed in-app swaps (NEAR tokens through Rhea / Ref). prepare: fresh quote, balance, storage, price and
 * policy checks, then a journal entry the owner reviews; allow: the explicit "Allow in Policy" revision for it.
 * Signing happens only after /api/transactions authorize, in the owner's own wallet. */
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    const b = z.discriminatedUnion("action", [
      z.object({ action: z.literal("prepare"), from: z.string().max(200), to: z.string().max(200), amount: z.string().max(80), slippage: z.number().int() }),
      z.object({ action: z.literal("allow"), id: z.string().uuid(), revision: z.number().int() }),
    ]).parse(await request.json());
    if (b.action === "allow") return json(await allowSwapInPolicy(request, b.id, b.revision), s.cookie);
    return json(await prepareSwap(request, await swapTokenCatalog(), b), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
