// Watchlist API: the tokens and public wallets a connected account follows, saved with its workspace so they appear
// on every device the account signs in on. GET reads it; POST applies one change (star, unstar, watch_wallet,
// update_wallet, unwatch_wallet, import). Research only: nothing here touches ownership, balances or signing.
import { z } from "zod";
import { session, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { watchlistApply, watchlistGet } from "@/lib/flowvault/watchlist-store";

/** The same rule as the app's lock: the personal workspace with a NEAR account or another wallet it proved. */
function connected(s: SessionInfo) {
  const proven = ((s.workspace as { accounts?: { proof?: { method?: string } }[] }).accounts ?? []).some((a) => ["nep413", "siwe", "siws"].includes(a.proof?.method ?? ""));
  if (s.slot !== "personal" || s.workspace.mode !== "live" || (!s.workspace.accountId && !proven)) throw new Error("Connect a wallet to keep a watchlist.");
}
const text = (n: number) => z.string().max(n);
const body = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["star", "unstar"]), id: text(160) }).strict(),
  z.object({ op: z.literal("watch_wallet"), network: z.enum(["near", "base", "arb", "eth"]), address: text(100), label: text(80).optional(), notes: text(1000).optional() }).strict(),
  z.object({ op: z.literal("update_wallet"), id: text(120), label: text(80).optional(), notes: text(1000).optional() }).strict(),
  z.object({ op: z.literal("unwatch_wallet"), id: text(120) }).strict(),
  z.object({ op: z.literal("import"), data: z.object({ wallets: z.array(z.unknown()).max(200).optional(), saved: z.array(z.unknown()).max(200).optional() }) }).strict(),
]);

export async function GET(r: Request) {
  try {
    const s = await session(r);
    connected(s);
    return json(await watchlistGet(s.id), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    const s = await session(r);
    connected(s);
    const op = body.parse(await r.json());
    return json(await watchlistApply(s.id, op), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
