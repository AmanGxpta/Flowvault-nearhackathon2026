import { exampleCreditRows } from "./example-credit";
import { keyedAttemptId } from "./preparation-key";
import { migrateWorkspace } from "./obligations";
import { env } from "cloudflare:workers";
import { seed, personalSeed, exampleDate } from "./seed";
import type { Workspace } from "./types";
export interface Stored {
  workspace: Workspace;
  revision: number;
}
export async function database() {
  if (!env.DB)
    throw new Error(
      "Local DB binding unavailable. Start the app with npm run dev.",
    );
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)",
  ).run();
  return env.DB;
}
export async function session(request: Request) {
  const existing = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)fv_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const baseId = existing ?? crypto.randomUUID();
  const requested =
    new URL(request.url).searchParams.get("workspace") ??
    request.headers.get("x-flowvault-workspace") ??
    "personal";
  if (!["example", "personal", "live"].includes(requested))
    throw new Error("Invalid workspace slot.");
  const slot = requested === "example" ? "example" : "personal";
  const id =
    slot === "example"
      ? await keyedAttemptId(baseId, "example-workspace")
      : baseId;
  const db = await database();
  await db
    .prepare(
      "INSERT OR IGNORE INTO workspaces (id,payload,revision) VALUES (?,?,0)",
    )
    .bind(id, JSON.stringify(slot === "example" ? seed() : personalSeed()))
    .run();
  const row = await db
    .prepare("SELECT payload,revision FROM workspaces WHERE id=?")
    .bind(id)
    .first<{ payload: string; revision: number }>();
  if (!row) throw new Error("Workspace could not be opened.");
  let input = JSON.parse(row.payload);
  let refreshed = false;
  if (slot === "example") {
    if (input.exampleSeed !== "design-v1") {
      input = seed();
      refreshed = true;
    } else if (input.exampleAnchorDate !== exampleDate(0)) {
      const delta =
        Date.parse(exampleDate(0)) - Date.parse(input.exampleAnchorDate);
      if (Number.isFinite(delta)) {
        input.obligations = input.obligations.map((o: any) => ({
          ...o,
          dueDate: new Date(Date.parse(o.dueDate) + delta)
            .toISOString()
            .slice(0, 10),
        }));
        input.exampleAnchorDate = exampleDate(0);
        input.mandate.version++;
        input.operations = input.operations.map((o: any) =>
          o.state === "draft" ? { ...o, state: "superseded" } : o,
        );
        refreshed = true;
      }
    }
  }
  if (slot === "example" && input.exampleCreditVersion !== 1) {
    input.exampleCreditVersion = 1;
    input.policy ??= seed().policy;
    input.policy.creditRows = exampleCreditRows();
    for (const row of input.policy.assetRows ?? [])
      if (
        ["LiNEAR", "rNEAR"].includes(row.asset) &&
        row.uses.includes("pledge") &&
        !row.uses.includes("borrow")
      )
        row.uses.push("borrow");
    input.mandate.version++;
    input.operations = input.operations.map((o: any) =>
      o.state === "draft" ? { ...o, state: "superseded" } : o,
    );
    refreshed = true;
  }
  const migrated = migrateWorkspace(input);
  let revision = row.revision;
  if (migrated.changed || refreshed)
    revision = await save(id, migrated.workspace, revision);
  return {
    id,
    slot,
    ...{
      workspace: migrated.workspace,
      revision,
    },
    cookie: `fv_session=${baseId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
  };
}
export async function save(id: string, workspace: Workspace, revision: number) {
  const db = await database();
  const result = await db
    .prepare(
      "UPDATE workspaces SET payload=?, revision=revision+1 WHERE id=? AND revision=?",
    )
    .bind(JSON.stringify(workspace), id, revision)
    .run();
  if (result.meta.changes !== 1)
    throw new Error("Workspace changed in another tab. Refresh and try again.");
  return revision + 1;
}
export function mutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new Error("Workspace writes require the same origin.");
}
export function json(value: unknown, cookie?: string, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
export function failure(e: unknown) {
  return json(
    { error: e instanceof Error ? e.message : "Request failed" },
    undefined,
    400,
  );
}
