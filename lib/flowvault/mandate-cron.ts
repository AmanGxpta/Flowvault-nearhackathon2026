// Scheduled mandate runs (owner: Stream C). The Worker's cron trigger calls this after the monitor. Each due
// mandate is claimed by compare-and-set inside runMandate, so overlapping triggers never run one twice.
// It reads chain state and prepares owner-signed plans only; it never signs or moves funds.
import { database } from "./store";
import { migrateWorkspace } from "./obligations";
import { ensureAccounts } from "./account-registry";
import { mandatesDue } from "./mandate-store";
import { runMandate } from "./mandate-service";

export async function runDueMandates(limit = 50, now = Date.now()) {
  const due = await mandatesDue(new Date(now).toISOString(), limit);
  const d = await database();
  const summary = { due: due.length, ran: 0, failed: 0, outcomes: [] as string[] };
  for (const row of due) {
    try {
      const ws = await d.prepare("SELECT payload, revision FROM workspaces WHERE id = ?").bind(row.session_id).first<{ payload: string; revision: number }>();
      if (!ws) continue;
      const { workspace } = migrateWorkspace(JSON.parse(ws.payload));
      ensureAccounts(workspace);
      const r = await runMandate({ id: row.session_id, workspace, revision: ws.revision }, row.id, "cron", now);
      summary.ran++;
      summary.outcomes.push(`${row.id}: ${r.outcome}`);
    } catch (e) {
      summary.failed++;
      summary.outcomes.push(`${row.id}: ${(e as Error).message}`);
    }
  }
  return summary;
}
