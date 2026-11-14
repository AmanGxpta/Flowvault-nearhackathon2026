"use client";
// Demo Mode automations: the example workspace's automations and what they produced, kept in this browser tab (they
// never reach the server). Running one builds its result from the example wallets with the same brief logic as the
// real thing, so the demo behaves like the product: briefs, alerts and a sweep proposal with its hazard scan.
import { describe, nextRun, template, type Automation, type AutomationEvent, type AutomationKind } from "@/lib/flowvault/automations";
import { buildBrief, isStableAsset } from "@/lib/flowvault/brief";
import { exampleChecks } from "@/lib/flowvault/demo-sim";
import { exampleWalletHoldings } from "@/lib/flowvault/example-wallets";

// Own storage key, not the shared demo-flow store: that one keeps only its 30 newest rows, which would evict the
// automations once enough events pile up. Automations are never evicted; events keep the newest 40.
const KEY = "fv-demo-hub-v1";
type Store = { autos: Automation[]; events: AutomationEvent[] };
const tz = () => -new Date().getTimezoneOffset();
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const DEMO_EVENT = "fv:automations-refresh";
const notify = () => window.dispatchEvent(new Event(DEMO_EVENT));
let memory: Store | null = null;

function make(kind: AutomationKind, over: Partial<Automation> = {}): Automation {
  const t = template(kind, tz()), now = Date.now();
  const a: Automation = { id: "demo-auto-" + crypto.randomUUID(), ...t, enabled: true, createdAt: new Date(now).toISOString(), createdBy: "you", lastRunAt: null, nextRunAt: null, ...over };
  a.params = { ...t.params, ...over.params };
  a.nextRunAt = new Date(nextRun(a, now)).toISOString();
  return a;
}
function seeded(): Store {
  // Distinct creation times keep the list in a stable order: rows never jump when one runs.
  const t0 = Date.now() - 4 * 86_400_000;
  const autos = (["brief", "sweep", "idle_alert", "allocation_alert"] as AutomationKind[]).map((k, i) => make(k, { createdAt: new Date(t0 + i * 60_000).toISOString() }));
  // The sweep has already run once, so the example opens with a proposal waiting in Approvals.
  const sweep = autos[1], ran = new Date(Date.now() - 2 * 3_600_000).toISOString();
  sweep.lastRunAt = ran;
  return { autos, events: [{ ...demoEvaluate(sweep, []), id: "demo-ev-" + crypto.randomUUID(), automationId: sweep.id, createdAt: ran, status: "new" }] };
}
function load(): Store {
  try { const raw = sessionStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Store; } catch { /* storage blocked: fall back to memory */ }
  if (!memory) { memory = seeded(); save(memory, false); }
  return memory;
}
function save(st: Store, tell = true) {
  st.events = st.events.slice(0, 40); memory = st;
  try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch { /* storage blocked: lives for this page only */ }
  if (tell) notify();
}
function edit(fn: (st: Store) => void) { const st = load(); fn(st); save(st); }

/** Back to the four seeded automations with no results, for "Reset example". */
export function demoAutomationsReset() { memory = null; try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ } notify(); }
export function demoAutomations() { return [...load().autos].sort((x, y) => x.createdAt.localeCompare(y.createdAt)).map((a) => ({ ...a, ...describe(a) })); }
export function demoEvents() { return [...load().events].sort((x, y) => y.createdAt.localeCompare(x.createdAt)); }
export function demoCreate(kind: AutomationKind, schedule?: Automation["schedule"], params?: Automation["params"], by: Automation["createdBy"] = "you") {
  const a = make(kind, { ...(schedule ? { schedule } : {}), params: params ?? {}, createdBy: by });
  edit((st) => { st.autos.push(a); }); return a;
}
export function demoUpdate(id: string, patch: Partial<Automation>) {
  edit((st) => { const i = st.autos.findIndex((a) => a.id === id); if (i < 0) return;
    const a = { ...st.autos[i], ...patch, params: { ...st.autos[i].params, ...patch.params } };
    a.nextRunAt = a.enabled ? new Date(nextRun(a, Date.now())).toISOString() : null; st.autos[i] = a; });
}
export function demoDelete(id: string) { edit((st) => { st.autos = st.autos.filter((a) => a.id !== id); }); }
export function demoEventStatus(id: string, status: AutomationEvent["status"]) { edit((st) => { st.events = st.events.map((e) => (e.id === id ? { ...e, status } : e)); }); }
function addEvent(e: AutomationEvent, lastRunFor?: string) {
  edit((st) => { st.events.unshift(e); if (lastRunFor) st.autos = st.autos.map((a) => (a.id === lastRunFor ? { ...a, lastRunAt: e.createdAt, nextRunAt: a.enabled ? new Date(nextRun(a, Date.parse(e.createdAt) + 1)).toISOString() : null } : a)); });
}

const holdingsRows = () => exampleWalletHoldings().map((h) => ({ asset: h.symbol, kind: "wallet", usd: Number(h.usd), catalogId: (h.network === "near" ? (h.symbol === "NEAR" ? "near:native" : "near:" + USDC) : `${h.network}:${h.symbol.toLowerCase()}`), network: h.network, amount: Number(h.amount) }));
/** What an example automation produces now. */
export function demoEvaluate(a: Pick<Automation, "id" | "kind" | "params">, rates: { tokenId: string; symbol: string; supplyApy: number | null }[]): Omit<AutomationEvent, "id" | "automationId" | "createdAt" | "status"> {
  const rows = holdingsRows(), total = 35_198.18;
  const idle = rows.filter((r) => isStableAsset(r.asset)).reduce((n, r) => n + r.usd, 0);
  if (a.kind === "brief") {
    const items = buildBrief({ rows, totalUsd: total, unvalued: 0, limits: { spendableNow: "14,240.00", surplus: "2,690.00", reserve: "10,000.00" }, rates, obligations: [{ label: "Payroll to aman.near", amount: "6,000", token: "USDC", dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), status: "pending" }], now: Date.now() });
    return { kind: "brief", title: "Your brief", lines: items.map((x) => `${x.label}: ${x.text}`), items };
  }
  if (a.kind === "sweep") return { kind: "approval", title: "Supply $2,690 surplus USDC to Rhea", lines: ["USDC above your $10,000 reserve and the payments in your planning window, from the example workspace."], action: { kind: "supply", tokenId: USDC, amount: "2690" }, checks: exampleChecks(2690, [{ id: "health", label: "No debt: nothing can be liquidated", ok: true }]) };
  if (a.kind === "idle_alert") {
    const limit = Number(a.params.thresholdUsd ?? 5000), best = [...rates].filter((r) => /^USD[CT]/i.test(r.symbol) && r.supplyApy !== null).sort((x, y) => y.supplyApy! - x.supplyApy!)[0];
    return idle > limit ? { kind: "alert", title: `Idle stablecoins are at $${Math.round(idle).toLocaleString("en-US")}`, lines: [`Above your $${limit.toLocaleString("en-US")} alert.`], ...(best ? { action: { kind: "supply" as const, tokenId: best.tokenId } } : {}) }
      : { kind: "info", title: `Idle stablecoins are $${Math.round(idle).toLocaleString("en-US")}`, lines: [`Under your $${limit.toLocaleString("en-US")} alert; nothing to do.`] };
  }
  if (a.kind === "allocation_alert") {
    const sym = (a.params.asset ?? "ETH").toUpperCase(), share = rows.filter((r) => r.asset.toUpperCase() === sym).reduce((n, r) => n + r.usd, 0) / total * 100;
    return share > Number(a.params.pct) ? { kind: "alert", title: `${sym} is ${share.toFixed(1)}% of your portfolio`, lines: [`Above your ${a.params.pct}% rule.`] } : { kind: "info", title: `${sym} is ${share.toFixed(1)}% of your portfolio`, lines: [`Under your ${a.params.pct}% rule; nothing to rebalance.`] };
  }
  const sym = (a.params.asset ?? "ETH").toUpperCase();
  return { kind: "alert", title: `${sym} is down ${Math.max(Number(a.params.pct ?? 5), 5.4).toFixed(1)}% today`, lines: ["Example move: moved more than your alert in 24 hours."], action: { kind: "swap", from: "near:" + USDC, to: sym === "NEAR" ? "near:native" : "eth:native" } };
}
export function demoRun(a: Automation, rates: Parameters<typeof demoEvaluate>[1]) {
  const now = Date.now(), out = demoEvaluate(a, rates);
  const e: AutomationEvent = { ...out, id: "demo-ev-" + crypto.randomUUID(), automationId: a.id, createdAt: new Date(now).toISOString(), status: "new" };
  addEvent(e, a.id); return e;
}
export function demoBriefNow(rates: Parameters<typeof demoEvaluate>[1]) {
  const out = demoEvaluate({ id: "now", kind: "brief", params: {} }, rates);
  const e: AutomationEvent = { ...out, id: "demo-ev-" + crypto.randomUUID(), automationId: "now", createdAt: new Date().toISOString(), status: "new" };
  addEvent(e); return e;
}
