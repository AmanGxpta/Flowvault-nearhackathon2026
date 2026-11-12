import {
  evmAddressesSchema,
  watchedAccountsSchema,
} from "@/lib/flowvault/accounts";
import { projectObligations } from "@/lib/flowvault/obligations";
import { z } from "zod";
import { session, save, mutation, json, failure } from "@/lib/flowvault/store";
import { mandateSchema } from "@/lib/flowvault/validation";
import { validAccount } from "@/lib/flowvault/near";
import { adoptLegacy, ensureAccounts } from "@/lib/flowvault/account-registry";
export async function GET(request: Request) {
  try {
    const s = await session(request);
    return json(
      { workspace: s.workspace, revision: s.revision, workspaceSlot: s.slot },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(request: Request) {
  try {
    mutation(request);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        mandate: z.unknown().optional(),
        evmAddresses: evmAddressesSchema.optional(),
        watchedAccounts: watchedAccountsSchema.optional(),
        mode: z.enum(["live", "demo"]).optional(),
        accountId: z.string().optional(),
      })
      .parse(await request.json());
    let s = await session(request);
    if (body.mode === "demo" && s.slot !== "example") {
      if (body.mandate || body.evmAddresses || body.watchedAccounts)
        throw new Error("Select the example workspace before editing it.");
      const url = new URL(request.url);
      url.searchParams.set("workspace", "example");
      s = await session(new Request(url, { headers: request.headers }));
      return json(
        { workspace: s.workspace, revision: s.revision, workspaceSlot: s.slot },
        s.cookie,
      );
    }
    if (s.slot === "example" && body.mode === "live")
      throw new Error(
        "Select the personal workspace before opening a live account.",
      );
    if (body.revision !== s.revision)
      throw new Error("Workspace changed. Refresh and try again.");
    if (body.evmAddresses || body.watchedAccounts) {
      s.workspace.evmAddresses = body.evmAddresses ?? s.workspace.evmAddresses;
      s.workspace.watchedAccounts =
        body.watchedAccounts ?? s.workspace.watchedAccounts;
      // Interface: older writers update the account registry these fields are derived from.
      adoptLegacy(s.workspace);
      s.workspace.mandate.version++;
      s.workspace.operations = s.workspace.operations.map((o) =>
        o.state === "draft" ? { ...o, state: "superseded" } : o,
      );
    }
    if (body.mandate) {
      const m = mandateSchema.parse(body.mandate);
      s.workspace.mandate = {
        ...m,
        obligations: s.workspace.obligations,
        version: s.workspace.mandate.version + 1,
      };
      s.workspace.operations = s.workspace.operations.map((o) =>
        o.state === "draft" ? { ...o, state: "superseded" } : o,
      );
    }
    if (body.mode) {
      if (!["live", "demo"].includes(body.mode))
        throw new Error("Invalid workspace mode.");
      if (body.mode === "live" && !validAccount(body.accountId ?? ""))
        throw new Error("Enter a valid public NEAR account.");
      if (
        s.workspace.mode !== body.mode ||
        s.workspace.accountId !== (body.accountId ?? null)
      ) {
        s.workspace.mandate.version++;
        s.workspace.operations = s.workspace.operations.map((o) =>
          o.state === "draft" ? { ...o, state: "superseded" } : o,
        );
      }
      // Interface (account registry): switching the main NEAR account keeps your other accounts. A previous
      // main account you only typed in becomes watched (syncPrimary); one a wallet signed in as stays yours.
      s.workspace.mode = body.mode;
      s.workspace.accountId =
        body.mode === "live" ? (body.accountId ?? null) : null;
    }
    projectObligations(s.workspace);
    ensureAccounts(s.workspace);
    const revision = await save(s.id, s.workspace, s.revision);
    return json(
      { workspace: s.workspace, revision, workspaceSlot: s.slot },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    mutation(request);
    const body = z
      .object({
        reset: z.literal(true),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await request.json());
    const s = await session(request);
    if (s.slot !== "example")
      throw new Error("Only the example workspace can be reset.");
    if (body.revision !== s.revision)
      throw new Error("Workspace changed. Refresh and try again.");
    const { seed } = await import("@/lib/flowvault/seed");
    const workspace = seed();
    workspace.mandate.version = s.workspace.mandate.version + 1;
    const revision = await save(s.id, workspace, s.revision);
    return json({ workspace, revision, workspaceSlot: s.slot }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
