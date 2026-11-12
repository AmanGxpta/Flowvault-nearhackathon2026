import { exampleCreditRows } from "./example-credit";
import { keyedAttemptId } from "./preparation-key";
import { migrateWorkspace } from "./obligations";
import { ensureAccounts } from "./account-registry";
import { advanceRecurrences } from "./recurrence";
import { env } from "cloudflare:workers";
import { seed, personalSeed, exampleDate } from "./seed";
import type { Workspace } from "./types";
export interface SessionInfo {
  /** The workspace row: the signed-in NEAR account's workspace, else this browser's own (empty) one. */
  id: string;
  slot: "example" | "personal";
  workspace: Workspace;
  revision: number;
  cookie: string;
  /** This browser's session id (the cookie). */
  sessionId: string;
  /** The NEAR account this browser is signed in as (proven by NEP-413 on this server), or null. */
  account: string | null;
}
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
/*
 * Account ownership. Your calendar, policy, plans and history belong to your NEAR account, not to a browser.
 * A browser is signed in to an account only after this server verifies the account's NEP-413 signature
 * (POST /api/accounts prove); the binding lasts 30 days or until sign-out. A browser that isn't signed in
 * gets its own empty workspace, so a disconnected browser shows none of your payments.
 */
const BINDING_TTL_MS = 30 * 864e5;
export const accountWorkspaceId = (accountId: string) => "near:" + accountId;
async function bindingsTable() {
  const db = await database();
  await db
    .prepare("CREATE TABLE IF NOT EXISTS account_bindings (session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, bound_at INTEGER NOT NULL)")
    .run();
  return db;
}
async function boundAccount(sessionId: string): Promise<string | null> {
  const db = await bindingsTable();
  const b = await db
    .prepare("SELECT account_id, bound_at FROM account_bindings WHERE session_id=?")
    .bind(sessionId)
    .first<{ account_id: string; bound_at: number }>();
  return b && Date.now() - Number(b.bound_at) < BINDING_TTL_MS ? b.account_id : null;
}
/** Tables whose rows belong to a workspace (session_id = workspace row id). */
const OWNED_TABLES = ["wallet_attempts", "payment_plans", "payment_locks", "policy_ledger", "action_plans", "plan_locks", "plan_ledger_outbox", "funding_transfers", "funding_legs", "funding_solana"];

/**
 * Sign this browser in to a proven NEAR account. Call only after the account's signature was verified.
 * The first time, the browser's own workspace (its calendar, policy, plans and history) becomes the account's.
 * Later, anything new in the browser's workspace (payments, proven wallets) is merged into the account's.
 * Either way the browser's own workspace is emptied, so signing out leaves nothing behind.
 * `apply` records the proof on the account's workspace.
 */
export async function bindAccount(s: SessionInfo, accountId: string, apply: (w: Workspace) => void) {
  if (s.slot !== "personal") throw new Error("The example workspace can’t sign in to an account.");
  const db = await bindingsTable();
  const target = accountWorkspaceId(accountId);
  const fromBrowser = s.id === s.sessionId;
  if (s.id !== target) {
    const row = await db.prepare("SELECT payload,revision FROM workspaces WHERE id=?").bind(target).first<{ payload: string; revision: number }>();
    if (!row) {
      const w = fromBrowser ? structuredClone(s.workspace) : personalSeed();
      apply(w);
      await db.prepare("INSERT INTO workspaces (id,payload,revision) VALUES (?,?,0)").bind(target, JSON.stringify(w)).run();
    } else {
      const w = migrateWorkspace(JSON.parse(row.payload)).workspace;
      if (fromBrowser) {
        const ids = new Set(w.obligations.map((o) => o.id));
        for (const o of s.workspace.obligations) if (!ids.has(o.id)) w.obligations.push(o);
        const accts = new Set((w.accounts ?? []).map((a) => a.id));
        for (const a of s.workspace.accounts ?? []) if (a.proof && !accts.has(a.id)) (w.accounts ??= []).push(a);
      }
      apply(w);
      await save(target, w, row.revision);
    }
    if (fromBrowser) {
      for (const t of OWNED_TABLES) {
        try {
          await db.prepare(`UPDATE OR IGNORE ${t} SET session_id=? WHERE session_id=?`).bind(target, s.sessionId).run();
        } catch {
          /* table not created yet: nothing to move */
        }
      }
      await db.prepare("UPDATE workspaces SET payload=?, revision=revision+1 WHERE id=?").bind(JSON.stringify(personalSeed()), s.sessionId).run();
    }
  }
  await db
    .prepare("INSERT OR REPLACE INTO account_bindings (session_id, account_id, bound_at) VALUES (?,?,?)")
    .bind(s.sessionId, accountId, Date.now())
    .run();
}
/** Sign this browser out. The account's workspace stays saved; this browser goes back to its empty one. */
export async function unbindAccount(sessionId: string) {
  const db = await bindingsTable();
  await db.prepare("DELETE FROM account_bindings WHERE session_id=?").bind(sessionId).run();
}

export async function session(request: Request, retry = true): Promise<SessionInfo> {
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
  const account = slot === "personal" && existing ? await boundAccount(baseId) : null;
  const id =
    slot === "example"
      ? await keyedAttemptId(baseId, "example-workspace")
      : account
        ? accountWorkspaceId(account)
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
  // Interface: recurring obligations get their next concrete instance on every read (idempotent ids).
  const recurred = advanceRecurrences(migrated.workspace).length > 0;
  // Interface: the account registry is built once from the older fields and keeps them derived from it.
  const accountsChanged = ensureAccounts(migrated.workspace);
  if (migrated.changed || refreshed || recurred || accountsChanged) {
    try {
      revision = await save(id, migrated.workspace, revision);
    } catch (e) {
      // A concurrent read generated the same instances first; re-read its version once.
      if (retry && (recurred || accountsChanged) && !migrated.changed && !refreshed) return session(request, false);
      throw e;
    }
  }
  // Upgrade: a browser workspace whose main NEAR account was proven here (NEP-413, verified by this server)
  // within the sign-in window is signed in to that account once, moving its calendar and history across.
  const main = migrated.workspace.accountId;
  const mainProof = main ? (migrated.workspace.accounts ?? []).find((a) => a.id === "near:" + main)?.proof : undefined;
  if (
    retry &&
    slot === "personal" &&
    !account &&
    main &&
    mainProof?.method === "nep413" &&
    Date.now() - Date.parse(mainProof.at) < BINDING_TTL_MS
  ) {
    try {
      await bindAccount(
        { id, slot, workspace: migrated.workspace, revision, cookie: "", sessionId: baseId, account: null },
        main,
        () => {},
      );
    } catch {
      /* a parallel request signed in first; the re-read below finds its binding */
    }
    return session(request, false);
  }
  return {
    id,
    slot,
    ...{
      workspace: migrated.workspace,
      revision,
    },
    cookie: `fv_session=${baseId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
    sessionId: baseId,
    account,
  };
}
export async function save(id: string, workspace: Workspace, revision: number) {
  const db = await database();
  const result = await db
    .prepare(
      "UPDATE workspaces SET payload=?, revision=revision+1 WHERE id=? AND revision=?",
    )
    .bind(
      // Evidence reservations are per-request valuation inputs, never stored state.
      JSON.stringify(workspace, (k, v) => (k === "evidenceReservations" ? undefined : v)),
      id,
      revision,
    )
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
