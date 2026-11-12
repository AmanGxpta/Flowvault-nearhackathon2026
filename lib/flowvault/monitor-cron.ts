// Scheduled monitoring (owner: Interface). The Worker's cron trigger calls this: for each live workspace it
// advances recurring obligations and runs the same monitor a workspace read runs. It reads chain state and
// writes alerts and proposed plans only; it never signs, prepares or moves funds.
import { database, save } from "./store";
import { migrateWorkspace } from "./obligations";
import { advanceRecurrences } from "./recurrence";
import { ensureAccounts } from "./account-registry";
import { runMonitor } from "./monitor-service";

export async function runScheduledMonitor(limit = 100) {
  const d = await database();
  const rows = await d
    .prepare("SELECT id, payload, revision FROM workspaces ORDER BY rowid DESC LIMIT ?")
    .bind(limit)
    .all<{ id: string; payload: string; revision: number }>();
  const summary = { checked: 0, skipped: 0, failed: 0, generated: 0 };
  for (const row of rows.results) {
    try {
      const { workspace } = migrateWorkspace(JSON.parse(row.payload));
      // Only accounts proven yours are read: an unproven main account (typed in before the rule) is not monitored.
      const accountsChanged = ensureAccounts(workspace);
      // Example data and workspaces without a live account have nothing real to monitor.
      if (workspace.mode !== "live" || !workspace.accountId) {
        summary.skipped++;
        continue;
      }
      let revision = row.revision;
      const generated = advanceRecurrences(workspace);
      if (generated.length || accountsChanged) {
        revision = await save(row.id, workspace, revision); // a concurrent writer wins; the next run retries
        summary.generated += generated.length;
      }
      await runMonitor({ id: row.id, workspace, revision }, "cron");
      summary.checked++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
