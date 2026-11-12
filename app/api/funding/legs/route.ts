// Funding legs (owner: Stream A; engine in lib/flowvault/funding-mesh*.ts).
//   POST {action:"handoff", id}            → single-use: the exact source-chain transfer for the source's wallet
//   POST {action:"attach", id, txHash}     → records the signed transfer and tells 1Click
//   POST {action:"uncertain", id}          → the wallet didn't say; FlowVault checks the deposit address instead
//   POST {action:"declined", id}           → the wallet refused (nothing broadcast); the leg can be approved again
//   GET  ?planId=…                         → where every leg's funds are right now (recovery view)
// Only your own workspace, only legs prepared by a reviewed plan step. FlowVault signs nothing.
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { planGet } from "@/lib/flowvault/plans-store";
import { attachLeg, declineLeg, handoffLeg, outcomeOf } from "@/lib/flowvault/funding-mesh-live";
import { legsForPlan } from "@/lib/flowvault/funding-mesh-store";
import { fundsLocation } from "@/lib/flowvault/funding-mesh";
import type { StoredPlan } from "@/lib/flowvault/plans-service";

const legId = z.string().regex(/^leg:[0-9a-f-]{36}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("handoff"), id: legId }).strict(),
  z.object({ action: z.literal("attach"), id: legId, txHash: z.string().min(16).max(100) }).strict(),
  z.object({ action: z.literal("uncertain"), id: legId }).strict(),
  z.object({ action: z.literal("declined"), id: legId }).strict(),
]);

async function own(r: Request) {
  const s = await session(r);
  if (s.slot !== "personal" || s.workspace.mode !== "live") throw new Error("Funding legs need your own workspace, not Demo Mode.");
  if (!s.account) throw new Error("Connect your NEAR wallet first.");
  return s;
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await own(r);
    if (b.action === "handoff") {
      const leg = await handoffLeg(s.id, b.id);
      return json({ id: leg.id, network: leg.network, from: leg.from, tx: leg.tx, depositAddress: leg.quote.depositAddress, amountRaw: leg.amountRaw, deadline: leg.quote.deadline }, s.cookie);
    }
    if (b.action === "declined") {
      const leg = await declineLeg(s.id, b.id);
      return json({ id: leg.id, state: leg.state }, s.cookie);
    }
    const leg = await attachLeg(s.id, b.id, b.action === "attach" ? b.txHash : null);
    return json({ id: leg.id, state: leg.state }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function GET(r: Request) {
  try {
    const s = await own(r);
    const planId = new URL(r.url).searchParams.get("planId") ?? "";
    const found = await planGet(s.id, planId);
    if (!found) throw new Error("Plan not found in this workspace.");
    const plan = found.plan as StoredPlan;
    if (!plan.funding) return json({ funding: null, locations: [] }, s.cookie);
    const records = await legsForPlan(s.id, plan.id);
    const locations = plan.funding.legs.map((leg) => {
      const step = plan.steps.find((x) => x.expected.legId === leg.id) ?? null;
      const rec = records.filter((x) => x.legId === leg.id).at(-1) ?? null;
      return fundsLocation(leg, step, rec ? outcomeOf(rec) : null);
    });
    return json({ funding: plan.funding, locations, atomic: false }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
