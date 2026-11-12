import { env } from "cloudflare:workers";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { defaultPolicy } from "@/lib/flowvault/policy";
import { validAccount } from "@/lib/flowvault/near";
import { policyContractId, readPolicyContract, planFromPolicy, ownerCall, OWNER_METHODS } from "@/lib/flowvault/policy-contract";
function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" ? binding : process.env[name];
}
/** GET /api/policy-contract — status of the optional on-chain policy contract (read-only). */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const state = await readPolicyContract(policyContractId(setting), s.workspace.mode === "live" ? (s.workspace.accountId ?? null) : null);
    return json({ ...state, revision: s.revision }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
/** POST /api/policy-contract `{method, agentId?, opId?}` — prepare one unsigned owner call. `set_plan`
 * publishes the saved FlowVault policy as the next on-chain plan version. Fails with the not-deployed reason
 * when no contract is configured. */
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const b = z
      .object({ method: z.enum(OWNER_METHODS), agentId: z.string().max(64).optional(), opId: z.string().regex(/^\d{1,20}$/).optional() })
      .strict()
      .parse(await r.json());
    if (s.workspace.mode !== "live" || !s.workspace.accountId) throw new Error("Open your live NEAR account first.");
    const accountId = s.workspace.accountId;
    const state = await readPolicyContract(policyContractId(setting), accountId);
    let args: Record<string, unknown>;
    if (b.method === "set_plan") {
      await withCapitalEvidence(s.workspace);
      const next = BigInt(state.plan?.version ?? "0") + 1n;
      args = { plan: planFromPolicy(s.workspace, s.workspace.policy ?? defaultPolicy(s.workspace.mandate.maxMoveCost), next) };
    } else if (b.method === "add_agent" || b.method === "remove_agent") {
      if (!b.agentId || !validAccount(b.agentId)) throw new Error("Give a valid agent account.");
      args = { agent_id: b.agentId };
    } else {
      if (!b.opId) throw new Error("Give the proposal id.");
      args = { op_id: b.opId };
    }
    return json(ownerCall(state, accountId, b.method, args), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
