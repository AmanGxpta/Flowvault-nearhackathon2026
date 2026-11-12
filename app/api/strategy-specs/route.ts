import { session, json, failure } from "@/lib/flowvault/store";
import { registeredKinds } from "@/lib/flowvault/step-adapters";
import { strategyEligibility } from "@/lib/flowvault/strategy-eligibility";
/** GET /api/strategy-specs — read-only account-strategy specs with eligibility against registered adapters. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const registered = registeredKinds();
    return json(
      {
        kind: "account_strategy_specs",
        note: "Individual account strategies run on the owner's own funds through FlowVault's adapters, policy and ledger. None is a pooled vault.",
        registeredStepKinds: registered,
        specs: strategyEligibility(registered),
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
