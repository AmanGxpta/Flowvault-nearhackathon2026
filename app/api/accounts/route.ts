// Accounts (owner: Interface). The accounts you have proven are yours, on any chain. An account enters only
// through its wallet ("connect", sent by the browser after the wallet connected as it); there is no way to add
// an address by typing it. Rename and forget. Nothing here signs or moves funds.
import { z } from "zod";
import { session, save, mutation, json, failure } from "@/lib/flowvault/store";
import { applyAccountAction, unreadAccounts, type AccountAction } from "@/lib/flowvault/account-registry";
import type { Workspace } from "@/lib/flowvault/types";

const chain = z.enum(["near", "evm", "solana"]);
const id = z.string().min(3).max(120);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), chain, address: z.string().min(2).max(80) }).strict(),
  z.object({ action: z.literal("rename"), id, label: z.string().min(1).max(60) }).strict(),
  z.object({ action: z.literal("forget"), id }).strict(),
]);

function view(w: Workspace, revision: number, message = "") {
  const fictional = w.mode === "demo" || !!w.fictional;
  return {
    fictional,
    accounts: fictional ? [] : (w.accounts ?? []),
    unread: fictional ? [] : unreadAccounts(w).map((a) => a.id),
    revision,
    message,
  };
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(view(s.workspace, s.revision), s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json()) as AccountAction;
    const s = await session(r);
    const { counted, message } = applyAccountAction(s.workspace, b);
    if (b.action === "connect" && !message) return json(view(s.workspace, s.revision), s.cookie);
    if (counted) {
      // Same rule as every other account change: what counts moved, so unexecuted drafts no longer hold.
      s.workspace.mandate.version++;
      s.workspace.operations = s.workspace.operations.map((o) => (o.state === "draft" ? { ...o, state: "superseded" } : o));
    }
    const revision = await save(s.id, s.workspace, s.revision);
    return json(view(s.workspace, revision, message), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
