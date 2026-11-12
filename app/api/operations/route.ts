import { z } from "zod";
import { session, save, mutation, json, failure } from "@/lib/flowvault/store";
import { transition } from "@/lib/flowvault/planner";
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    const b = z
      .object({
        revision: z.number().int().nonnegative(),
        action: z.literal("transition").optional(),
        state: z.enum(["reviewed", "cancelled"]).optional(),
        id: z.string().optional(),
        key: z.string().optional(),
        kind: z.enum(["allocation", "cash-request", "supply"]).optional(),
        details: z.unknown().optional(),
      })
      .parse(await request.json());
    if (b.action === "transition") {
      if (b.revision !== s.revision)
        throw new Error("Workspace changed. Refresh first.");
      if (!b.state || !["reviewed", "cancelled"].includes(b.state))
        throw new Error("Only local review or cancellation is supported.");
      const i = s.workspace.operations.findIndex((o) => o.id === b.id);
      if (i < 0) throw new Error("Operation not found.");
      s.workspace.operations[i] = transition(
        s.workspace.operations[i],
        b.state,
        s.workspace.mandate.version,
      );
    } else {
      if (typeof b.key !== "string" || !/^[a-f0-9-]{36}$/.test(b.key))
        throw new Error("A request id is required.");
      if (!b.kind || !["allocation", "cash-request", "supply"].includes(b.kind))
        throw new Error("Unsupported operation type.");
      const payload = {
        kind: b.kind,
        accountId: s.workspace.accountId,
        mandate: s.workspace.mandate,
        source: s.workspace.mode,
        details: b.details ?? {},
      };
      if (JSON.stringify(payload).length > 30000)
        throw new Error("Proposal is too large.");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(payload)),
      );
      const payloadHash = Array.from(new Uint8Array(hash), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join("");
      const existing = s.workspace.operations.find((o) => o.id === b.key);
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new Error("This request id belongs to a different proposal.");
        return json({ workspace: s.workspace, revision: s.revision }, s.cookie);
      }
      if (b.revision !== s.revision)
        throw new Error("Workspace changed. Refresh first.");
      let expiresAt = new Date(Date.now() + 180000).toISOString();
      if (b.kind === "cash-request") {
        const details = z
          .object({
            comparison: z
              .object({
                validUntil: z.string().datetime(),
                source: z.enum(["live", "demo"]),
              })
              .passthrough(),
          })
          .passthrough()
          .parse(b.details);
        if (details.comparison.source !== s.workspace.mode)
          throw new Error("Comparison source does not match the workspace.");
        if (Date.parse(details.comparison.validUntil) <= Date.now())
          throw new Error("Comparison expired. Request a fresh quote.");
        expiresAt = new Date(
          Math.min(
            Date.parse(details.comparison.validUntil),
            Date.now() + 180000,
          ),
        ).toISOString();
      }
      s.workspace.operations.unshift({
        id: b.key,
        title:
          b.kind === "allocation"
            ? "Earning allocation review"
            : b.kind === "supply"
              ? "USDC supply preparation"
              : "Cash request comparison",
        kind: b.kind,
        source: s.workspace.mode,
        state: "draft",
        createdAt: new Date().toISOString(),
        expiresAt,
        mandateVersion: s.workspace.mandate.version,
        payloadHash,
        payload,
      });
      s.workspace.operations = s.workspace.operations.slice(0, 50);
    }
    const revision = await save(s.id, s.workspace, s.revision);
    return json({ workspace: s.workspace, revision }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
