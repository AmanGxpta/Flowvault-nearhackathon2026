import type { Workspace } from "./types.ts";
import type { LedgerEntry } from "./policy.ts";
import { EXAMPLE_LIMITS } from "./example-policy.ts";
/** Fictional usage is never inserted into the live authorization journal. */
export function workspaceLedger(
  w: Workspace,
  ledger: LedgerEntry[],
  accountId = "fictional-example",
  now = Date.now(),
): LedgerEntry[] {
  return w.mode === "demo"
    ? [
        {
          operationId: "fictional:prior-usage",
          amount: String(EXAMPLE_LIMITS.usedToday),
          source: "demo",
          accountId,
          createdAt:
            new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z",
          state: "SIMULATED",
        },
      ]
    : ledger;
}
