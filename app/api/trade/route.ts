import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { previewTrade, prepareTrade, allowTradeInPolicy, tradeOptions } from "@/lib/flowvault/trade-live";

const addr = z.string().min(32).max(64).regex(/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/);
const trade = { fromChain: z.number().int().positive(), fromToken: addr, toChain: z.number().int().positive(), toToken: addr, amount: z.string().regex(/^\d{1,30}(\.\d{1,36})?$/), sender: addr.optional(), recipient: addr.optional(), slippageBps: z.number().int() };

/** In-app trading of any DexScreener token through LI.FI (EVM chains and Solana, same-chain or cross-chain).
 * options: what you can pay with and your balances; preview: a quote, nothing journaled; prepare: fresh quote,
 * balance, allowance, fee and policy checks, then a journal entry you review; allow: the explicit "Allow in Policy"
 * revision. Signing happens only after /api/transactions authorize, in your own wallet. */
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    const b = z.discriminatedUnion("op", [
      z.object({ op: z.literal("options"), chainId: z.number().int().positive(), evm: z.array(addr).max(8), solana: z.array(addr).max(8) }).strict(),
      z.object({ op: z.literal("preview"), ...trade }).strict(),
      z.object({ op: z.literal("prepare"), ...trade }).strict(),
      z.object({ op: z.literal("allow"), id: z.string().uuid(), revision: z.number().int() }).strict(),
    ]).parse(await request.json());
    if (b.op === "options") return json(await tradeOptions(request, b.chainId, { evm: b.evm, solana: b.solana }), s.cookie);
    if (b.op === "allow") return json(await allowTradeInPolicy(request, b.id, b.revision), s.cookie);
    return json(b.op === "preview" ? await previewTrade(request, b) : await prepareTrade(request, b), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
