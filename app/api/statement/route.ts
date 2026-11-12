import { session, json, failure } from "@/lib/flowvault/store";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { sessionStatement, period } from "@/lib/flowvault/ledger-live";
/** GET /api/statement[?from=YYYY-MM-DD&to=YYYY-MM-DD] — period statement over the ledger (Engines E3). Read-only. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const range = period(new URL(r.url));
    await withCapitalEvidence(s.workspace);
    const statement = await sessionStatement(s.id, s.workspace, range);
    return json({ ...statement, revision: s.revision }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
