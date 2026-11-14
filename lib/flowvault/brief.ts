// The brief, pure: what someone should know about their money right now, in a few lines, each with the one action
// that follows from it. Used by the scheduled brief, "Brief me now" and Ask FlowVault, so all three say the same thing.
import { todayCards, type TodayAction } from "./today.ts";

export interface BriefRow { asset: string; kind: string; usd: number | null; catalogId: string | null; network: string; amount: number }
export interface BriefInput {
  rows: BriefRow[];
  totalUsd: number;
  unvalued: number;
  limits: { spendableNow: string | null; surplus: string | null; reserve: string | null } | null;
  rates: { tokenId: string; symbol: string; supplyApy: number | null }[];
  /** Scheduled payments, or null when they weren't read (the brief then says nothing about them). */
  obligations: { label: string; amount: string; token: string; dueDate: string; status: string }[] | null;
  now: number;
}
export type BriefAction = { kind: "supply"; tokenId: string; amount?: string } | { kind: "swap"; from: string; to: string; amount?: string } | { kind: "view"; screen: string; tab?: string };
export interface BriefItem { label: string; text: string; tone?: "good" | "warn" | "info"; action?: { label: string; to: BriefAction } }

const STABLE = /^(USDC|USDT|USDT\.E|USDC\.E|DAI|USDE|FRAX|PYUSD)$/i;
const usd = (n: number) => "$" + (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));
const toAction = (a: TodayAction): BriefAction => (a.kind === "supply" ? { kind: "supply", tokenId: a.tokenId } : a.kind === "swap" ? { kind: "swap", from: a.from, to: a.to, ...(a.amount ? { amount: a.amount } : {}) } : a.kind === "stake" ? { kind: "view", screen: "earn", tab: "stake" } : { kind: "view", screen: "markets" });

export function buildBrief(i: BriefInput): BriefItem[] {
  const items: BriefItem[] = [];
  const byAsset = new Map<string, number>();
  for (const r of i.rows) if (r.kind !== "debt" && r.usd !== null) byAsset.set(r.asset, (byAsset.get(r.asset) ?? 0) + r.usd);
  const top = [...byAsset].sort((a, b) => b[1] - a[1]).slice(0, 3);
  items.push({ label: "Portfolio", tone: "info", text: `≈ ${usd(i.totalUsd)}${i.unvalued ? ` (${i.unvalued} holdings unpriced)` : ""}. Largest: ${top.map(([a, v]) => `${a} ${usd(v)}`).join(", ") || "none"}.`, action: { label: "Open portfolio", to: { kind: "view", screen: "portfolio" } } });
  if (i.limits) items.push({ label: "Cash", tone: "info", text: `Spendable now ${i.limits.spendableNow ? "$" + i.limits.spendableNow : "unknown"}; available after your reserve and payments ${i.limits.surplus ? "$" + i.limits.surplus : "unknown"}.` });
  const wallet = i.rows.filter((r) => r.kind === "wallet");
  const cards = todayCards({ holdings: wallet.filter((r) => r.catalogId).map((r) => ({ tokenId: r.catalogId!, symbol: r.asset, network: r.network, amount: r.amount, usd: r.usd })), rates: i.rates, stakeApy: null, held24h: {}, trending: [] }, 3);
  for (const c of cards) items.push({ label: c.tone === "earn" ? "Idle money" : c.tone === "stake" ? "Staking" : "Today", tone: "good", text: c.title + ". " + c.body.split(". ")[0] + ".", action: { label: c.cta, to: toAction(c.action) } });
  if (i.obligations === null) return items;
  const pending = i.obligations.filter((o) => o.status === "pending");
  const end = (d: string) => Date.parse(d + "T23:59:59Z");
  const overdue = pending.filter((o) => end(o.dueDate) < i.now), soon = pending.filter((o) => end(o.dueDate) >= i.now && end(o.dueDate) - i.now < 7 * 86_400_000);
  const pay = (o: (typeof pending)[number]) => `${o.amount} ${o.token} to ${o.label} (${o.dueDate})`;
  if (overdue.length) items.push({ label: "Overdue", tone: "warn", text: overdue.slice(0, 3).map(pay).join("; ") + ".", action: { label: "Review payments", to: { kind: "view", screen: "scheduled" } } });
  items.push({ label: "Next 7 days", tone: soon.length ? "warn" : "info", text: soon.length ? soon.slice(0, 3).map(pay).join("; ") + "." : "No payments due.", ...(soon.length ? { action: { label: "Review payments", to: { kind: "view", screen: "scheduled" } } } : {}) });
  return items;
}
export const isStableAsset = (s: string) => STABLE.test(s);
