// Automations, pure: what an automation is, when it next runs, and how it reads to a person. Five kinds:
//   brief            "Brief me every day at 8:00": portfolio, idle money, best rates, what needs you
//   sweep            "Sweep surplus on Fridays": proposes supplying USDC above your reserve and dated payments to Rhea
//   idle_alert       "Alert me when idle stablecoins exceed $5,000"
//   allocation_alert "Alert me if ETH is more than 40% of my portfolio"
//   price_alert      "Alert me when ETH moves 5% in a day"
// An automation never signs or moves anything. It writes a brief or an alert, and the sweep writes a proposal that
// waits in Approvals for the owner's own review and wallet. Times are the owner's local wall-clock times, stored with
// their UTC offset.

export type AutomationKind = "brief" | "sweep" | "idle_alert" | "allocation_alert" | "price_alert";
export interface AutomationSchedule { every: "day" | "week" | "always"; at?: string; day?: number; tzOffsetMin: number }
export interface Automation {
  id: string;
  kind: AutomationKind;
  enabled: boolean;
  schedule: AutomationSchedule;
  params: { thresholdUsd?: number; asset?: string; pct?: number };
  createdAt: string;
  createdBy: "you" | "assistant";
  lastRunAt: string | null;
  nextRunAt: string | null;
  /** For daily dedupe of "always" alerts: the local date it last fired. */
  lastFiredDay?: string | null;
}
export type AutomationEventKind = "brief" | "alert" | "approval" | "info";
export interface AutomationEvent {
  id: string;
  automationId: string;
  kind: AutomationEventKind;
  title: string;
  lines: string[];
  /** What the event's button opens. Nothing executes from an event. */
  action?: { kind: "supply"; tokenId: string; amount?: string } | { kind: "swap"; from: string; to: string; amount?: string } | { kind: "view"; screen: string; tab?: string };
  checks?: { id: string; label: string; ok: boolean | null; detail?: string }[];
  /** A brief's lines, each with its own action. */
  items?: import("./brief.ts").BriefItem[];
  createdAt: string;
  status: "new" | "seen" | "done" | "dismissed";
}

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** How often "always on" alerts are evaluated (the cron runs every 30 minutes). */
export const ALWAYS_EVERY_MS = 30 * 60_000;

/** Defaults for each kind: a sensible schedule and parameters, overridable. */
export function template(kind: AutomationKind, tzOffsetMin: number): Pick<Automation, "kind" | "schedule" | "params"> {
  switch (kind) {
    case "brief": return { kind, schedule: { every: "day", at: "08:00", tzOffsetMin }, params: {} };
    case "sweep": return { kind, schedule: { every: "week", day: 5, at: "09:00", tzOffsetMin }, params: {} };
    case "idle_alert": return { kind, schedule: { every: "always", tzOffsetMin }, params: { thresholdUsd: 5000 } };
    case "allocation_alert": return { kind, schedule: { every: "always", tzOffsetMin }, params: { asset: "ETH", pct: 40 } };
    case "price_alert": return { kind, schedule: { every: "always", tzOffsetMin }, params: { asset: "ETH", pct: 5 } };
  }
}

/** Checks an automation's shape; returns the first problem or null. */
export function checkAutomation(a: Pick<Automation, "kind" | "schedule" | "params">): string | null {
  const s = a.schedule;
  if (!Number.isInteger(s.tzOffsetMin) || Math.abs(s.tzOffsetMin) > 14 * 60) return "Unknown time zone.";
  if (s.every !== "always" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.at ?? "")) return "Choose a time like 08:00.";
  if (s.every === "week" && !(Number.isInteger(s.day) && s.day! >= 0 && s.day! <= 6)) return "Choose a day of the week.";
  if (a.kind === "brief" || a.kind === "sweep") { if (s.every === "always") return "Briefs and sweeps run on a schedule."; }
  else if (s.every !== "always") return "Alerts are always on.";
  if (a.kind === "idle_alert" && !(Number(a.params.thresholdUsd) >= 1 && Number(a.params.thresholdUsd) <= 1e9)) return "Choose an amount above $1.";
  if ((a.kind === "allocation_alert" || a.kind === "price_alert") && !/^[A-Za-z0-9.$]{1,12}$/.test(a.params.asset ?? "")) return "Choose an asset.";
  if (a.kind === "allocation_alert" && !(Number(a.params.pct) > 0 && Number(a.params.pct) < 100)) return "Choose a share between 1% and 99%.";
  if (a.kind === "price_alert" && !(Number(a.params.pct) >= 1 && Number(a.params.pct) <= 90)) return "Choose a move between 1% and 90%.";
  return null;
}

/** The next run strictly after `after` (UTC ms), or the next evaluation for always-on alerts. */
export function nextRun(a: Pick<Automation, "schedule">, after: number): number {
  const s = a.schedule;
  if (s.every === "always") return after + ALWAYS_EVERY_MS;
  const [h, m] = (s.at ?? "08:00").split(":").map(Number);
  // Work in the owner's local clock: shift into local, find the next local slot, shift back to UTC.
  const local = new Date(after + s.tzOffsetMin * 60_000);
  const slot = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m));
  if (s.every === "day") { if (slot.getTime() <= local.getTime()) slot.setUTCDate(slot.getUTCDate() + 1); }
  else { let add = ((s.day ?? 0) - slot.getUTCDay() + 7) % 7; if (add === 0 && slot.getTime() <= local.getTime()) add = 7; slot.setUTCDate(slot.getUTCDate() + add); }
  return slot.getTime() - s.tzOffsetMin * 60_000;
}
/** The owner's local calendar date for a UTC instant (YYYY-MM-DD). */
export const localDay = (at: number, tzOffsetMin: number) => new Date(at + tzOffsetMin * 60_000).toISOString().slice(0, 10);

const time12 = (at?: string) => { const [h, m] = (at ?? "08:00").split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const usd = (n?: number) => "$" + Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
/** How an automation reads in a list: a title, a one-line description and a schedule chip. */
export function describe(a: Pick<Automation, "kind" | "schedule" | "params">) {
  const s = a.schedule, p = a.params;
  switch (a.kind) {
    case "brief": return { title: `Brief me every day at ${time12(s.at)}`, sub: "Your portfolio, idle money, best rates and what needs you.", chip: `Daily · ${time12(s.at)}` };
    case "sweep": return { title: `Sweep surplus on ${DAYS[s.day ?? 5]}s`, sub: "Proposes supplying USDC above your reserve and dated payments to Rhea, for your approval.", chip: `Weekly · ${DAYS[s.day ?? 5].slice(0, 3)} ${time12(s.at)}` };
    case "idle_alert": return { title: `Alert me when idle stablecoins exceed ${usd(p.thresholdUsd)}`, sub: "So you can put them to work or route them to a payment.", chip: "Always on" };
    case "allocation_alert": return { title: `Alert me if ${p.asset} is more than ${p.pct}% of my portfolio`, sub: "With a suggested swap to bring it back, for your review.", chip: "Rule-based" };
    case "price_alert": return { title: `Alert me when ${p.asset} moves ${p.pct}% in a day`, sub: "Up or down, from DexScreener's 24-hour change.", chip: "Always on" };
  }
}
