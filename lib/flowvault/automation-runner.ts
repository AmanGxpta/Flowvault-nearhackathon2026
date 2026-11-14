// Runs automations: reads the workspace (the same reads Ask FlowVault uses), writes a brief, an alert or a proposal,
// and schedules the next run. The cron calls runDueAutomations every 30 minutes; "Run now" calls runAutomation.
// Nothing here prepares a wallet request, signs or moves funds: a sweep writes a proposal (with its hazard scan)
// that waits in Approvals until the owner reviews it on the normal supply card.
import { database, type SessionInfo } from "./store";
import { migrateWorkspace } from "./obligations";
import { ensureAccounts } from "./account-registry";
import { liveReads } from "./chat-reads";
import { todayCards, USDC_NEAR } from "./today";
import { defaultPolicy, evaluatePolicy, hazardChecks } from "./policy";
import { readLedger } from "./policy-store";
import { policyAction } from "./plans-service";
import { bestPairs, CHAINS } from "./market-scan";
import { describe, localDay, nextRun, type Automation, type AutomationEvent } from "./automations";
import { automationGet, automationPut, automationsDue, eventAdd } from "./automation-store";
import type { Workspace } from "./types";

const STABLE = /^(USDC|USDT|USDT\.E|USDC\.E|DAI|USDE|FRAX|PYUSD)$/i;
const USDC_CONTRACT = USDC_NEAR.slice("near:".length);
const usd = (n: number) => "$" + (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));
const WRAPPED: Record<string, string> = { "eth:native": "ethereum/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "base:native": "base/0x4200000000000000000000000000000000000006", "arb:native": "arbitrum/0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "near:native": "near/wrap.near", "sol:native": "solana/So11111111111111111111111111111111111111112", "bsc:native": "bsc/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", "pol:native": "polygon/0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" };
const DEX = Object.fromEntries(Object.entries(CHAINS).map(([dex, c]) => [c.network, dex]));

type Ctx = { id: string; workspace: Workspace; revision: number };
function session(c: Ctx): SessionInfo { return { id: c.id, slot: "personal", workspace: c.workspace, revision: c.revision, cookie: "", sessionId: c.id } as SessionInfo; }

/** One run: the event it writes (or null when an always-on alert has nothing to say). */
export async function evaluate(c: Ctx, a: Automation, now = Date.now()): Promise<Omit<AutomationEvent, "id" | "automationId" | "createdAt" | "status"> | null> {
  const reads = liveReads(session(c), new Request("https://flowvault.local/automation"));
  const h = await reads.holdings();
  const wallet = h.rows.filter((r) => r.kind === "wallet");
  const total = Number(h.totalUsd ?? 0) || h.rows.reduce((n, r) => n + (r.kind === "debt" ? -1 : 1) * Number(r.usd ?? 0), 0);
  const idle = wallet.filter((r) => STABLE.test(r.asset)).reduce((n, r) => n + Number(r.usd ?? 0), 0);

  if (a.kind === "brief") {
    const [m, limits] = await Promise.all([reads.markets().catch(() => null), reads.limits().catch(() => null)]);
    const cards = todayCards({ holdings: wallet.filter((r) => r.catalogId).map((r) => ({ tokenId: r.catalogId!, symbol: r.asset, network: r.network, amount: Number(r.amount), usd: r.usd !== null ? Number(r.usd) : null })), rates: (m?.rows ?? []).map((r) => ({ tokenId: r.tokenId, symbol: r.symbol, supplyApy: r.supplyApy })), stakeApy: null, held24h: {}, trending: [] }, 3);
    const top = [...h.rows].filter((r) => r.kind !== "debt" && r.usd !== null).sort((x, y) => Number(y.usd) - Number(x.usd)).slice(0, 3);
    const soon = (c.workspace.obligations ?? []).filter((o) => o.status === "pending" && Date.parse(o.dueDate + "T23:59:59Z") - now < 7 * 86_400_000);
    return { kind: "brief", title: "Your brief", lines: [
      `Portfolio ≈ ${usd(total)}${h.unvalued ? ` (${h.unvalued} holdings unpriced)` : ""}. Largest: ${top.map((r) => `${r.asset} ${usd(Number(r.usd))}`).join(", ") || "none"}.`,
      limits ? `Spendable now ${limits.spendableNow ? "$" + limits.spendableNow : "unknown"}; available after your plan ${limits.surplus ? "$" + limits.surplus : "unknown"}.` : "Limits couldn't be read.",
      ...(idle >= 1 ? [`${usd(idle)} in stablecoins is sitting in wallets.`] : []),
      ...cards.map((x) => x.title + "."),
      soon.length ? `${soon.length} payment${soon.length === 1 ? "" : "s"} due in the next 7 days: ${soon.slice(0, 3).map((o) => `${o.amount} ${o.token} to ${o.label} on ${o.dueDate}`).join("; ")}.` : "No payments due in the next 7 days.",
    ], action: { kind: "view", screen: "hub" } };
  }

  if (a.kind === "sweep") {
    const limits = await reads.limits().catch(() => null);
    const surplus = Number(limits?.surplus ?? 0);
    if (!limits?.surplus || surplus < 1) return { kind: "info", title: "Nothing to sweep this week", lines: [limits?.surplus ? `Available after your reserve and dated payments: $${limits.surplus}. Sweeps start at $1.` : "Your surplus couldn't be read, so nothing was proposed."] };
    const amount = (Math.floor(surplus * 100) / 100).toFixed(2);
    const policy = c.workspace.policy ?? defaultPolicy();
    const action = policyAction(c.workspace, "supply", amount);
    const checks = hazardChecks(action, policy, evaluatePolicy(action, policy, await readLedger(c.id), now));
    return { kind: "approval", title: `Supply $${amount} surplus USDC to Rhea`, lines: [`USDC above your reserve ($${limits.reserve ?? "?"}) and payments in your planning window.`, "Review it on the supply card; your wallet signs."], action: { kind: "supply", tokenId: USDC_CONTRACT, amount }, checks };
  }

  const today = localDay(now, a.schedule.tzOffsetMin);
  if (a.lastFiredDay === today) return null; // always-on alerts speak at most once a day

  if (a.kind === "idle_alert") {
    const limit = Number(a.params.thresholdUsd ?? 5000);
    if (idle <= limit) return null;
    const m = await reads.markets().catch(() => null);
    const best = (m?.rows ?? []).filter((r) => /^USD[CT]/i.test(r.symbol) && r.canSupply && r.supplyApy !== null).sort((x, y) => (y.supplyApy ?? 0) - (x.supplyApy ?? 0))[0];
    return { kind: "alert", title: `Idle stablecoins are at ${usd(idle)}`, lines: [`Above your ${usd(limit)} alert.`, ...(best ? [`Rhea pays ${best.supplyApy!.toFixed(2)}% on ${best.symbol} right now (variable).`] : [])], ...(best ? { action: { kind: "supply" as const, tokenId: best.tokenId } } : {}) };
  }
  if (a.kind === "allocation_alert") {
    const sym = (a.params.asset ?? "").toUpperCase(), rows = h.rows.filter((r) => r.kind !== "debt" && r.asset.toUpperCase() === sym && r.usd !== null);
    const share = total > 0 ? rows.reduce((n, r) => n + Number(r.usd), 0) / total * 100 : 0;
    if (share <= Number(a.params.pct)) return null;
    const biggest = rows.filter((r) => r.catalogId).sort((x, y) => Number(y.usd) - Number(x.usd))[0];
    return { kind: "alert", title: `${sym} is ${share.toFixed(1)}% of your portfolio`, lines: [`Above your ${a.params.pct}% rule.`, "Review a swap of some into USDC if you want to rebalance."], ...(biggest ? { action: { kind: "swap" as const, from: biggest.catalogId!, to: USDC_NEAR } } : {}) };
  }
  if (a.kind === "price_alert") {
    const sym = (a.params.asset ?? "").toUpperCase();
    const row = h.rows.find((r) => r.asset.toUpperCase() === sym && r.catalogId);
    const id = row?.catalogId ?? (sym === "ETH" ? "eth:native" : sym === "NEAR" ? "near:native" : sym === "SOL" ? "sol:native" : null);
    const path = id ? WRAPPED[id] ?? (DEX[id.split(":")[0]] ? DEX[id.split(":")[0]] + "/" + id.slice(id.indexOf(":") + 1) : null) : null;
    if (!path) return null;
    const pairs = bestPairs(await fetch("https://api.dexscreener.com/tokens/v1/" + path, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => []));
    const ch = pairs[0]?.change?.h24;
    if (typeof ch !== "number" || Math.abs(ch) < Number(a.params.pct)) return null;
    return { kind: "alert", title: `${sym} is ${ch > 0 ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% today`, lines: [`Moved more than your ${a.params.pct}% alert (DexScreener, 24 hours).`], ...(id ? { action: ch > 0 ? { kind: "swap" as const, from: id, to: USDC_NEAR } : { kind: "swap" as const, from: USDC_NEAR, to: id } } : {}) };
  }
  return null;
}

/** Runs one automation now, records what it said, and schedules the next run. */
export async function runAutomation(c: Ctx, a: Automation, now = Date.now()) {
  let event: AutomationEvent | null = null;
  try {
    const out = await evaluate(c, a, now);
    if (out) event = await eventAdd(c.id, { ...out, id: crypto.randomUUID(), automationId: a.id, createdAt: new Date(now).toISOString(), status: "new" });
  } catch (e) {
    event = await eventAdd(c.id, { kind: "info", title: `${describe(a).title}: couldn't run`, lines: [(e as Error).message], id: crypto.randomUUID(), automationId: a.id, createdAt: new Date(now).toISOString(), status: "new" });
  }
  const next: Automation = { ...a, lastRunAt: new Date(now).toISOString(), nextRunAt: new Date(nextRun(a, now)).toISOString(), ...(event && a.schedule.every === "always" && event.kind === "alert" ? { lastFiredDay: localDay(now, a.schedule.tzOffsetMin) } : {}) };
  await automationPut(c.id, next);
  return { automation: next, event };
}

/** Cron: every due automation across workspaces, each re-read before it runs. */
export async function runDueAutomations(limit = 50, now = Date.now()) {
  const due = await automationsDue(now, limit);
  const d = await database();
  const summary = { due: due.length, ran: 0, failed: 0 };
  for (const { sessionId, automation } of due) {
    try {
      const ws = await d.prepare("SELECT payload, revision FROM workspaces WHERE id = ?").bind(sessionId).first<{ payload: string; revision: number }>();
      const fresh = await automationGet(sessionId, automation.id);
      if (!ws || !fresh?.enabled) continue;
      const { workspace } = migrateWorkspace(JSON.parse(ws.payload));
      ensureAccounts(workspace);
      if (workspace.mode !== "live") continue;
      await runAutomation({ id: sessionId, workspace, revision: ws.revision }, fresh, now);
      summary.ran++;
    } catch { summary.failed++; }
  }
  return summary;
}
