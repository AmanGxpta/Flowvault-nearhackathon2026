// Growth API: community tips, points and invites. GET returns today's tips (ranked) and, for a signed-in account,
// its points, invite code and invite count. POST op=tip shares a tip (no links; points at an action in FlowVault),
// op=vote / op=used marks a tip (crediting its author once per person), op=invite uses an invite code. Only a
// proven NEAR account can post or earn. Nothing here moves funds or pays anything.
import { z } from "zod";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { serverSetting } from "@/lib/flowvault/server-setting";
import { checkTip, feeShareBps, feeShareText, rankTips, POINTS } from "@/lib/flowvault/growth";
import { applyInvite, listTips, markTip, postTip, summary } from "@/lib/flowvault/growth-store";

function account(s: SessionInfo) {
  if (s.workspace.mode !== "live" || s.slot !== "personal" || !s.workspace.accountId) throw new Error("Sign in with your NEAR wallet to share tips and earn points.");
  return s.workspace.accountId;
}
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), to: z.string().max(200), symbol: z.string().max(24) }).strict(),
  z.object({ kind: z.literal("supply"), tokenId: z.string().max(80), symbol: z.string().max(24) }).strict(),
  z.object({ kind: z.literal("stake") }).strict(),
]);
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("tip"), title: z.string().max(200), detail: z.string().max(600), action }).strict(),
  z.object({ op: z.enum(["vote", "used"]), id: z.string().uuid() }).strict(),
  z.object({ op: z.literal("invite"), code: z.string().regex(/^[a-z0-9]{8}$/i) }).strict(),
]);

export async function GET(r: Request) {
  try {
    const s = await session(r);
    const me = s.workspace.mode === "live" && s.slot === "personal" ? s.workspace.accountId ?? null : null;
    const bps = feeShareBps(await serverSetting("GROWTH_FEE_SHARE_BPS"));
    return json({ tips: rankTips(await listTips(me)).slice(0, 12), me: me ? await summary(me) : null, rules: POINTS, feeShare: { bps, text: feeShareText(bps) } }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r), me = account(s);
    const b = body.parse(await r.json());
    if (b.op === "tip") {
      const why = checkTip(b);
      if (why) throw new Error(why);
      return json({ id: await postTip(me, b) }, s.cookie);
    }
    if (b.op === "invite") return json(await applyInvite(me, b.code), s.cookie);
    return json(await markTip(me, b.id, b.op), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
