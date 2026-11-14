// Supply flows API ("swap into it, then supply"). GET lists this workspace's flows (or one with ?id) with each step's
// live state from the journal. POST op=create starts a flow (idempotent per key), op=link ties a journal attempt to a
// step (verified to be this session's, of the right kind and amounts, and never replacing something already sent),
// op=cancel closes a flow with nothing in motion, op=resume reopens it. Nothing here prepares, signs or moves funds.
import { z } from "zod";
import { units } from "@/lib/flowvault/money";
import type { IntentsPreparation } from "@/lib/flowvault/swap-intents";
import type { RheaPreparation } from "@/lib/flowvault/rhea-markets-live";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { readAttempt } from "@/lib/flowvault/attempts";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { swapTokenCatalog } from "@/lib/flowvault/swap-catalog";
import { deriveSupplyFlow, type SupplyAttemptView, type SupplyFlow } from "@/lib/flowvault/supply-flow";
import { supplyFlowGet, supplyFlowList, supplyFlowPut } from "@/lib/flowvault/supply-flow-store";
import type { WalletAttempt } from "@/lib/flowvault/execution";

const NETWORK: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum" };
const WRAP = "wrap.near";

function view(a: WalletAttempt): SupplyAttemptView {
  const p = a.preparation as unknown as { amountRaw?: string; result?: { deliveredRaw?: string | null; refundedRaw?: string | null } };
  return { id: a.id, state: a.state, message: a.message, hashes: a.hashes.length, deliveredRaw: p.result?.deliveredRaw ?? null, refundedRaw: p.result?.refundedRaw ?? null, suppliedRaw: a.kind === "lend" && a.state === "confirmed" ? p.amountRaw ?? null : null };
}
async function attempts(s: SessionInfo, f: SupplyFlow) {
  const one = async (id?: string) => (id ? await readAttempt(s.id, id).then((x) => x.attempt).catch(() => null) : null);
  const [pay, supply] = await Promise.all([one(f.links.pay), one(f.links.supply)]);
  return { pay, supply };
}
async function present(s: SessionInfo, f: SupplyFlow) {
  const a = await attempts(s, f);
  const views = { pay: a.pay ? view(a.pay) : null, supply: a.supply ? view(a.supply) : null };
  return { flow: f, attempts: views, ...deriveSupplyFlow(f, views) };
}
function live(s: SessionInfo) {
  if (s.workspace.mode !== "live" || !s.workspace.accountId) throw new Error("Connect your NEAR account to supply.");
  return s.workspace.accountId;
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live") return json({ flows: [] }, s.cookie);
    const id = new URL(r.url).searchParams.get("id");
    if (id) {
      const f = await supplyFlowGet(s.id, id);
      if (!f) throw new Error("Supply flow not found.");
      return json(await present(s, f), s.cookie);
    }
    return json({ flows: await Promise.all((await supplyFlowList(s.id)).map((f) => present(s, f))) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const raw = z.string().regex(/^[1-9]\d{0,38}$/);
const createSchema = z.object({
  op: z.literal("create"), key: z.string().uuid(),
  tokenId: z.string().regex(/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/),
  /** Rhea's own name for the market (e.g. USDt), shown instead of the swap catalog's. Display only. */
  symbol: z.string().regex(/^[\w.$-]{1,24}$/).optional(),
  apy: z.number().min(0).max(1000).nullable(),
  from: z.string().min(3).max(200), amount: z.string().regex(/^\d+(\.\d+)?$/).max(40), expectedRaw: raw.nullable(),
}).strict();
const linkSchema = z.object({ op: z.literal("link"), id: z.string().min(8).max(100), step: z.enum(["pay", "supply"]), attemptId: z.string().uuid() }).strict();
const idSchema = z.object({ op: z.enum(["cancel", "resume"]), id: z.string().min(8).max(100) }).strict();
const SENT = new Set(["awaiting_wallet", "submitted", "unknown", "partial", "confirmed"]);

export async function POST(r: Request) {
  try {
    mutation(r);
    const body = await r.json() as { op?: string };
    const s = await session(r);
    const accountId = live(s);
    if (body.op === "create") {
      const b = createSchema.parse(body);
      const id = await keyedAttemptId(s.id, "supply-flow:" + b.key);
      const existing = await supplyFlowGet(s.id, id);
      if (existing) return json(await present(s, existing), s.cookie);
      if (b.tokenId === WRAP) throw new Error("Supply NEAR straight from your wallet; it doesn't need a swap.");
      const catalog = await swapTokenCatalog();
      const from = catalog.find((x) => x.id === b.from);
      if (!from || !NETWORK[from.network] || !from.assetId) throw new Error("Pay with a token on NEAR, Ethereum, Base or Arbitrum that NEAR Intents supports.");
      const target = catalog.find((x) => x.network === "near" && x.contract === b.tokenId && !!x.assetId);
      if (!target) throw new Error("NEAR Intents can't deliver this token, so it can't be swapped into here. Swap into it on the Swap page, then supply.");
      if (from.id === target.id) throw new Error("You already hold this token. Supply it directly.");
      units(b.amount, from.decimals); // rejects more decimals than the token has
      const at = new Date().toISOString();
      const f: SupplyFlow = {
        id, accountId, tokenId: b.tokenId, symbol: b.symbol ?? target.symbol, decimals: target.decimals, apy: b.apy,
        source: { from: from.id, fromSymbol: from.symbol, fromNetwork: NETWORK[from.network], amount: b.amount, expectedRaw: b.expectedRaw },
        createdAt: at, updatedAt: at, cancelledAt: null, links: {},
      };
      await supplyFlowPut(s.id, f);
      return json(await present(s, f), s.cookie);
    }
    if (body.op === "link") {
      const b = linkSchema.parse(body);
      const f = await supplyFlowGet(s.id, b.id);
      if (!f || f.accountId !== accountId) throw new Error("Supply flow not found for this account.");
      const { attempt } = await readAttempt(s.id, b.attemptId);
      if (b.step === "pay") {
        if (attempt.kind !== "swap") throw new Error("The payment step takes a swap.");
        const p = attempt.preparation as unknown as IntentsPreparation;
        if (p.route !== "intents" || p.to.network !== "near" || p.to.contract !== f.tokenId || p.recipient !== f.accountId || `${p.from.network}:${p.from.contract}`.toLowerCase() !== f.source.from.toLowerCase() || p.amountRaw !== units(f.source.amount, p.from.decimals).toString())
          throw new Error("This payment does not match the flow's route, amount or receiving account.");
      } else {
        if (attempt.kind !== "lend") throw new Error("The supply step takes a Rhea supply.");
        const p = attempt.preparation as unknown as RheaPreparation;
        const linked = await attempts(s, f);
        const delivered = deriveSupplyFlow(f, { pay: linked.pay ? view(linked.pay) : null }).supplyRaw;
        if (p.action !== "supply" || p.tokenId !== f.tokenId || p.accountId !== f.accountId || p.native || !delivered || BigInt(p.amountRaw) <= 0n || BigInt(p.amountRaw) > BigInt(delivered))
          throw new Error("This supply does not match what arrived for this flow.");
      }
      const current = f.links[b.step];
      if (current && current !== b.attemptId) {
        const prev = await readAttempt(s.id, current).then((x) => x.attempt).catch(() => null);
        // Something already sent is never replaced; a declined or expired request can be.
        if (prev && SENT.has(prev.state)) throw new Error("This step was already sent to your wallet. Check its status instead.");
      }
      f.links[b.step] = b.attemptId;
      f.cancelledAt = null;
      await supplyFlowPut(s.id, f);
      return json(await present(s, f), s.cookie);
    }
    const b = idSchema.parse(body);
    const f = await supplyFlowGet(s.id, b.id);
    if (!f || f.accountId !== accountId) throw new Error("Supply flow not found for this account.");
    if (b.op === "resume") { f.cancelledAt = null; await supplyFlowPut(s.id, f); return json(await present(s, f), s.cookie); }
    const a = await attempts(s, f);
    if (a.supply?.state === "confirmed") throw new Error("This supply is already complete.");
    if ([a.pay, a.supply].some((x) => x && ["awaiting_wallet", "submitted", "unknown", "partial"].includes(x.state)))
      throw new Error("Something in this flow is already on its way. It can't be closed; check its status instead.");
    f.cancelledAt = new Date().toISOString();
    await supplyFlowPut(s.id, f);
    return json(await present(s, f), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
