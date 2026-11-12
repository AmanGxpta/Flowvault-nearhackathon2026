import { session, json, failure } from "@/lib/flowvault/store";
import { workspacePortfolio } from "@/lib/flowvault/portfolio-service";
import { usableBalances } from "@/lib/flowvault/usable";
import { portfolioCredit } from "@/lib/flowvault/credit-live";
import { listActiveAttempts } from "@/lib/flowvault/attempts";
import { units, decimal } from "@/lib/flowvault/money";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const q = new URL(r.url).searchParams;
    const mode = q.get("mode") ?? s.workspace.mode;
    if (!["live", "demo"].includes(mode))
      throw new Error("Invalid portfolio source.");
    if (mode !== s.workspace.mode)
      throw new Error("Example and live portfolio sources cannot be mixed.");
    const {
      portfolio: p,
      staking,
      watchedErrors,
    } = await workspacePortfolio(
      { ...s.workspace, mode: mode as "live" | "demo" },
      {
        account: q.get("account") ?? undefined,
        base: q.get("base") ?? undefined,
        arb: q.get("arb") ?? undefined,
        staking: q.get("staking") !== "false",
        pools: (q.get("pools") ?? "").split(",").filter(Boolean),
      },
    );
    const active =
      s.workspace.mode === "demo" ? [] : await listActiveAttempts(s.id);
    const reserved = active
      .filter((a) => a.accountId === p.accountId && a.kind !== "withdraw")
      .reduce((n, a) => n + units(a.amount), 0n);
    let credit: any;
    try {
      credit = await portfolioCredit(p, s.workspace.policy);
    } catch (e) {
      credit = { capacity: null, reason: String(e), borrowExecution: false };
    }
    const dates = q.getAll("date").length
      ? q.getAll("date")
      : s.workspace.obligations
          .filter((o) => !["paid", "cancelled"].includes(o.status))
          .map((o) => o.dueDate);
    return json(
      {
        ...p,
        staking,
        watchedErrors,
        credit,
        usable: usableBalances(
          p,
          [...new Set(dates)],
          decimal(reserved),
          credit.capacity,
        ),
        coverage: {
          near: p.accountId ? "requested" : "not-configured",
          base:
            q.has("base") || s.workspace.evmAddresses?.base
              ? "requested"
              : "not-configured",
          arb:
            q.has("arb") || s.workspace.evmAddresses?.arb
              ? "requested"
              : "not-configured",
          staking: staking ? "requested" : "not-requested",
          watched: (s.workspace.watchedAccounts ?? []).length,
        },
        fictional: p.source === "demo",
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
