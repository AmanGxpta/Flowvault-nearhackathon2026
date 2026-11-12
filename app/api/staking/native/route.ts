import { env } from "cloudflare:workers";
import { session, json, failure } from "@/lib/flowvault/store";
import { evaluatePool } from "@/lib/flowvault/staking-native-live";
import { NOT_DEPLOYED, fundAuthority } from "@/lib/flowvault/staking-native";
import { policyContractId } from "@/lib/flowvault/policy-contract";
function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" ? binding : process.env[name];
}
/** GET /api/staking/native?pool=<pool account> — read-only validator evaluation (P2). */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const pool = new URL(r.url).searchParams.get("pool") ?? "";
    if (s.workspace.mode !== "live")
      return json({ source: "demo", fictional: true, executable: false, reason: "Native staking runs on a live account only." }, s.cookie);
    const accountId = s.workspace.accountId ?? null;
    const contractId = policyContractId(setting);
    const evaluation = await evaluatePool(pool, accountId);
    return json(
      {
        source: "live",
        evaluation,
        policyContract: contractId
          ? { status: "configured", contractId, note: "Native stake preparation needs the id of an owner-approved proposal on this contract." }
          : { status: NOT_DEPLOYED.status, contractId: null, note: NOT_DEPLOYED.reason },
        authority: accountId ? fundAuthority(accountId, contractId) : null,
        executable: false,
        executableReason: "Preparation goes through POST /api/staking/native (journal), then /api/transactions authorize, then the owner's wallet.",
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
