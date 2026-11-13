// Staking flows API. GET lists this workspace's flows (or one with ?id) with each step's live state from the
// journal. POST op=create starts a flow (idempotent per key), op=link ties a journal attempt to a step (verified to be
// this session's, of the right kind, and never replacing something already sent), op=cancel closes a flow that has
// nothing in motion. Nothing here prepares, signs or moves funds.
import { z } from "zod";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { readAttempt } from "@/lib/flowvault/attempts";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { swapTokenCatalog } from "@/lib/flowvault/swap-catalog";
import { deriveFlow, type AttemptView, type StakeFlow } from "@/lib/flowvault/stake-flow";
import { flowGet, flowList, flowPut } from "@/lib/flowvault/stake-flow-store";
import type { WalletAttempt } from "@/lib/flowvault/execution";

function view(a: WalletAttempt): AttemptView {
  const p = a.preparation as unknown as { amountRaw?: string; result?: { deliveredRaw?: string | null; refundedRaw?: string | null } };
  return { id: a.id, state: a.state, message: a.message, hashes: a.hashes.length, deliveredRaw: p.result?.deliveredRaw ?? null, refundedRaw: p.result?.refundedRaw ?? null, stakedRaw: a.state === "confirmed" ? p.amountRaw ?? null : null };
}
async function attempts(s: SessionInfo, f: StakeFlow) {
  const one = async (id?: string) => (id ? await readAttempt(s.id, id).then((x) => x.attempt).catch(() => null) : null);
  const [pay, stake] = await Promise.all([one(f.links.pay), one(f.links.stake)]);
  return { pay, stake };
}
async function present(s: SessionInfo, f: StakeFlow) {
  const a = await attempts(s, f);
  const views = { pay: a.pay ? view(a.pay) : null, stake: a.stake ? view(a.stake) : null };
  return { flow: f, attempts: views, ...deriveFlow(f, views) };
}
function live(s: SessionInfo) {
  if (s.workspace.mode !== "live" || !s.workspace.accountId) throw new Error("Connect your NEAR account to stake.");
  return s.workspace.accountId;
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live") return json({ flows: [] }, s.cookie);
    const id = new URL(r.url).searchParams.get("id");
    if (id) {
      const f = await flowGet(s.id, id);
      if (!f) throw new Error("Staking flow not found.");
      return json(await present(s, f), s.cookie);
    }
    return json({ flows: await Promise.all((await flowList(s.id)).map((f) => present(s, f))) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const raw = z.string().regex(/^[1-9]\d{0,38}$/);
const createSchema = z.object({
  op: z.literal("create"), key: z.string().uuid(), venue: z.literal("linear"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("near"), amountRaw: raw }).strict(),
    z.object({ kind: z.literal("swap"), from: z.string().min(3).max(200), amount: z.string().regex(/^\d+(\.\d+)?$/).max(40), expectedNearRaw: raw.nullable() }).strict(),
  ]),
}).strict();
const linkSchema = z.object({ op: z.literal("link"), id: z.string().min(8).max(100), step: z.enum(["pay", "stake"]), attemptId: z.string().uuid() }).strict();
const cancelSchema = z.object({ op: z.literal("cancel"), id: z.string().min(8).max(100) }).strict();
const SENT = new Set(["awaiting_wallet", "submitted", "unknown", "partial", "confirmed"]);
const NETWORK: Record<string, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum" };

export async function POST(r: Request) {
  try {
    mutation(r);
    const body = await r.json() as { op?: string };
    const s = await session(r);
    const accountId = live(s);
    if (body.op === "create") {
      const b = createSchema.parse(body);
      const id = await keyedAttemptId(s.id, "stake-flow:" + b.key);
      const existing = await flowGet(s.id, id);
      if (existing) return json(await present(s, existing), s.cookie);
      let source: StakeFlow["source"];
      if (b.source.kind === "swap") {
        const t = (await swapTokenCatalog()).find((x) => x.id === (b.source as { from: string }).from);
        if (!t || !NETWORK[t.network] || !t.assetId) throw new Error("Pay with NEAR, or with a token on Ethereum, Base or Arbitrum that NEAR Intents supports.");
        source = { kind: "swap", from: t.id, fromSymbol: t.symbol, fromNetwork: NETWORK[t.network], amount: b.source.amount, expectedNearRaw: b.source.expectedNearRaw };
      } else source = b.source;
      const at = new Date().toISOString();
      const f: StakeFlow = { id, accountId, venue: "linear", source, createdAt: at, updatedAt: at, cancelledAt: null, links: {} };
      await flowPut(s.id, f);
      return json(await present(s, f), s.cookie);
    }
    if (body.op === "link") {
      const b = linkSchema.parse(body);
      const f = await flowGet(s.id, b.id);
      if (!f || f.accountId !== accountId) throw new Error("Staking flow not found for this account.");
      const { attempt } = await readAttempt(s.id, b.attemptId);
      if (b.step === "pay" && attempt.kind !== "swap") throw new Error("The payment step takes a swap.");
      if (b.step === "stake" && attempt.kind !== "stake") throw new Error("The staking step takes a LiNEAR stake.");
      const current = f.links[b.step];
      if (current && current !== b.attemptId) {
        const prev = await readAttempt(s.id, current).then((x) => x.attempt).catch(() => null);
        // Something already sent is never replaced; a declined or expired request can be.
        if (prev && SENT.has(prev.state)) throw new Error("This step was already sent to your wallet. Check its status instead.");
      }
      f.links[b.step] = b.attemptId;
      f.cancelledAt = null;
      await flowPut(s.id, f);
      return json(await present(s, f), s.cookie);
    }
    if (body.op === "cancel") {
      const b = cancelSchema.parse(body);
      const f = await flowGet(s.id, b.id);
      if (!f) throw new Error("Staking flow not found.");
      const a = await attempts(s, f);
      if ([a.pay, a.stake].some((x) => x && ["awaiting_wallet", "submitted", "unknown", "partial"].includes(x.state)))
        throw new Error("Something in this flow is already on its way. It can't be cancelled; check its status instead.");
      f.cancelledAt = new Date().toISOString();
      await flowPut(s.id, f);
      return json(await present(s, f), s.cookie);
    }
    throw new Error("Unknown operation.");
  } catch (e) {
    return failure(e);
  }
}
