import { session, json, failure } from "@/lib/flowvault/store";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { sessionLedger, period } from "@/lib/flowvault/ledger-live";
import { ledgerCsv } from "@/lib/flowvault/ledger";
/** GET /api/ledger[?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv] — journal-derived ledger (Engines E3). Read-only. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const url = new URL(r.url);
    const range = period(url);
    await withCapitalEvidence(s.workspace);
    const ledger = await sessionLedger(s.id, s.workspace);
    const entries = ledger.entries.filter((e) => e.at >= range.from && e.at < range.to);
    if (url.searchParams.get("format") === "csv") {
      const name = `flowvault-ledger-${ledger.source}-${range.from.slice(0, 10)}-${range.to.slice(0, 10)}.csv`;
      const headers: Record<string, string> = {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      };
      if (s.cookie) headers["Set-Cookie"] = s.cookie;
      return new Response(ledgerCsv(entries), { headers });
    }
    return json(
      {
        source: ledger.source,
        fictional: ledger.source === "demo",
        accountId: ledger.accountId,
        period: range,
        entries,
        errors: ledger.errors,
        revision: s.revision,
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
