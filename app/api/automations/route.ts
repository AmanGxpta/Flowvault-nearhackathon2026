// Automations API. GET lists this workspace's automations (with plain descriptions) and recent events (briefs, alerts,
// proposals). POST op=create | update | delete | run | event. Creating or changing one never moves funds; a sweep's
// proposal still waits for the owner's own review and wallet.
import { z } from "zod";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { checkAutomation, describe, nextRun, template, type Automation } from "@/lib/flowvault/automations";
import { automationDelete, automationGet, automationList, automationPut, eventList, eventStatus } from "@/lib/flowvault/automation-store";
import { runAutomation } from "@/lib/flowvault/automation-runner";

const MAX = 20;
function owner(s: SessionInfo) {
  if (s.workspace.mode !== "live" || s.slot !== "personal" || !s.workspace.accountId) throw new Error("Sign in with your NEAR wallet to set up automations.");
  return s.workspace.accountId;
}
const kind = z.enum(["brief", "sweep", "idle_alert", "allocation_alert", "price_alert"]);
const schedule = z.object({ every: z.enum(["day", "week", "always"]), at: z.string().max(5).optional(), day: z.number().int().min(0).max(6).optional(), tzOffsetMin: z.number().int() }).strict();
const params = z.object({ thresholdUsd: z.number().optional(), asset: z.string().max(12).optional(), pct: z.number().optional() }).strict();
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), kind, tzOffsetMin: z.number().int(), schedule: schedule.optional(), params: params.optional(), by: z.enum(["you", "assistant"]).default("you") }).strict(),
  z.object({ op: z.literal("update"), id: z.string().uuid(), enabled: z.boolean().optional(), schedule: schedule.optional(), params: params.optional() }).strict(),
  z.object({ op: z.enum(["delete", "run"]), id: z.string().uuid() }).strict(),
  z.object({ op: z.literal("event"), id: z.string().uuid(), status: z.enum(["seen", "done", "dismissed"]) }).strict(),
]);
const present = (a: Automation) => ({ ...a, ...describe(a) });

export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live" || s.slot !== "personal") return json({ automations: [], events: [] }, s.cookie);
    const [list, events] = await Promise.all([automationList(s.id), eventList(s.id)]);
    return json({ automations: list.map(present), events }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    owner(s);
    const b = body.parse(await r.json());
    const now = Date.now();
    if (b.op === "create") {
      if ((await automationList(s.id)).length >= MAX) throw new Error(`You can have ${MAX} automations.`);
      const base = template(b.kind, b.tzOffsetMin);
      const draft = { kind: b.kind, schedule: b.schedule ?? base.schedule, params: { ...base.params, ...(b.params ?? {}) } };
      const why = checkAutomation(draft);
      if (why) throw new Error(why);
      const a: Automation = { id: crypto.randomUUID(), ...draft, enabled: true, createdAt: new Date(now).toISOString(), createdBy: b.by, lastRunAt: null, nextRunAt: new Date(nextRun(draft, now)).toISOString() };
      return json({ automation: present(await automationPut(s.id, a)) }, s.cookie);
    }
    if (b.op === "event") return json({ event: await eventStatus(s.id, b.id, b.status) }, s.cookie);
    const a = await automationGet(s.id, b.id);
    if (!a) throw new Error("That automation isn't here any more.");
    if (b.op === "delete") { await automationDelete(s.id, b.id); return json({ ok: true }, s.cookie); }
    if (b.op === "run") return json(await runAutomation({ id: s.id, workspace: s.workspace, revision: s.revision }, a, now), s.cookie);
    if (b.op !== "update") throw new Error("Unknown operation.");
    const next = { ...a, ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.schedule ? { schedule: b.schedule } : {}), ...(b.params ? { params: { ...a.params, ...b.params } } : {}) };
    const why = checkAutomation(next);
    if (why) throw new Error(why);
    next.nextRunAt = next.enabled ? new Date(nextRun(next, now)).toISOString() : null;
    return json({ automation: present(await automationPut(s.id, next)) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
