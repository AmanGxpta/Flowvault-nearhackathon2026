import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
  // Interface (E4): cron trigger for monitoring and recurrence. Reads and proposes only; never signs.
  scheduled(_controller: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(import("../lib/flowvault/monitor-cron").then((m) => m.runScheduledMonitor()));
    // Stream C: due autonomous mandates (claimed by compare-and-set; prepares owner-signed plans only).
    ctx.waitUntil(import("../lib/flowvault/mandate-cron").then((m) => m.runDueMandates()));
    // Automations: briefs, alerts and sweep proposals that wait for the owner's approval. Never signs.
    ctx.waitUntil(import("../lib/flowvault/automation-runner").then((m) => m.runDueAutomations()));
  },
};

export default worker;
