// Alerts (owner: Interface). GET runs the monitor on each workspace read (throttled); POST "check" runs it
// now; POST "dismiss" hides one alert until its condition clears and returns. Alerts only propose plans.
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { runMonitor, openAlerts } from "@/lib/flowvault/monitor-service";
import { dismissAlert, listAlerts } from "@/lib/flowvault/monitor-store";
import type { MonitorAlert } from "@/lib/flowvault/monitor-store";
import type { RunSummary } from "@/lib/flowvault/monitor-store";

function view(source: string, alerts: MonitorAlert[], run: RunSummary | null, ran: boolean) {
  return {
    source,
    fictional: source === "demo",
    alerts: openAlerts(alerts),
    resolved: alerts.filter((a) => a.resolvedAt).sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!)).slice(0, 10),
    run,
    ran,
  };
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    const { alerts, run, ran } = await runMonitor(s, "read");
    return json(view(s.workspace.mode, alerts, run, ran), s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }).strict(),
  z.object({ action: z.literal("dismiss"), id: z.string().min(1).max(100) }).strict(),
]);

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await session(r);
    if (b.action === "dismiss") {
      await dismissAlert(s.id, b.id);
      return json(view(s.workspace.mode, await listAlerts(s.id), null, false), s.cookie);
    }
    const { alerts, run, ran } = await runMonitor(s, "manual");
    return json(view(s.workspace.mode, alerts, run, ran), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
