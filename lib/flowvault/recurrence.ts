// Recurring obligations (owner: Interface). A recurring payment is a series of CONCRETE obligations:
// "rent-aman" is occurrence 1, "rent-aman-r2" occurrence 2, and so on. The next instance is generated
// when the current one is paid, cancelled, or its due date has passed (an unpaid past instance stays
// pending and protected). Ids are deterministic, so generation is idempotent across tabs, retries and
// the cron trigger. Each instance is an ordinary obligation, so holdback reaches it through Engines'
// reserveFor() exactly like any other payment; nothing here computes a reservation.
import type { Obligation, Workspace } from "./types.ts";
import { dueInHorizon } from "./valuation.ts";
import { invalidatePlan, projectObligations } from "./obligations.ts";

const DAY = 86400000;
/** Never generate more than this many instances of one series in a single pass (long absence). */
export const MAX_CATCH_UP = 24;
const SERIES = /^(.+)-r(\d{1,4})$/;
type Recurring = NonNullable<Obligation["recurrence"]>;

export function seriesOf(id: string) {
  const m = id.match(SERIES);
  return m && Number(m[2]) >= 2 ? { seriesId: m[1], occurrence: Number(m[2]) } : { seriesId: id, occurrence: 1 };
}
export function instanceId(seriesId: string, occurrence: number) {
  return occurrence === 1 ? seriesId : `${seriesId}-r${occurrence}`;
}
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Next due date. Months keep the series' anchor day, clamped to short months (31 Jan → 28 Feb → 31 Mar). */
export function nextDueDate(date: string, recurrence: Recurring, anchorDay = Number(date.slice(8, 10))) {
  if (recurrence === "none") return null;
  const t = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  if (recurrence === "weekly") return utcDay(t + 7 * DAY);
  const d = new Date(t);
  const months = recurrence === "monthly" ? 1 : 12;
  const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + months) / 12);
  const m = (d.getUTCMonth() + months) % 12;
  return utcDay(Date.UTC(y, m, Math.min(anchorDay, daysIn(y, m))));
}

/** Done for recurrence purposes: settled, cancelled, or its due day is over. */
export function instanceDone(o: Pick<Obligation, "status" | "dueDate">, now = Date.now()) {
  return o.status === "paid" || o.status === "cancelled" || o.dueDate < utcDay(now);
}

export interface Generated {
  obligation: Obligation;
  seriesId: string;
  occurrence: number;
  fromId: string;
  /** Why the previous instance let the series advance. */
  because: "paid" | "cancelled" | "date_passed" | "skipped";
}

/**
 * Generates every due next instance in place. Returns what was created (empty when nothing changed).
 * A generated instance the owner later deleted is remembered in `recurrenceLog` and never re-created;
 * the series continues after it once its date passes. Setting recurrence to "none" on the latest
 * instance ends the series.
 */
export function advanceRecurrences(w: Workspace, now = Date.now()): Generated[] {
  const log = (w.recurrenceLog ??= {});
  const byId = new Map(w.obligations.map((o) => [o.id, o]));
  const series = new Map<string, Obligation[]>();
  for (const o of w.obligations) {
    const { seriesId } = seriesOf(o.id);
    series.set(seriesId, [...(series.get(seriesId) ?? []), o]);
  }
  const out: Generated[] = [];
  for (const [seriesId, members] of series) {
    const sorted = [...members].sort((a, b) => seriesOf(a.id).occurrence - seriesOf(b.id).occurrence);
    let template = sorted[sorted.length - 1];
    if (!template.recurrence || template.recurrence === "none") continue;
    const anchorDay = Number(sorted[0].dueDate.slice(8, 10));
    let occurrence = seriesOf(template.id).occurrence;
    let current: Pick<Obligation, "status" | "dueDate"> = template;
    // Skip forward over instances the owner deleted (remembered) so they are not resurrected.
    while (log[instanceId(seriesId, occurrence + 1)] && !byId.has(instanceId(seriesId, occurrence + 1))) {
      occurrence++;
      current = { status: "pending", dueDate: log[instanceId(seriesId, occurrence)] };
    }
    for (let i = 0; i < MAX_CATCH_UP && instanceDone(current, now); i++) {
      const id = instanceId(seriesId, occurrence + 1);
      if (id.length > 64) break;
      const existing = byId.get(id);
      if (existing) {
        template = existing;
        current = existing;
        occurrence++;
        continue;
      }
      if (log[id]) {
        current = { status: "pending", dueDate: log[id] };
        occurrence++;
        continue;
      }
      const dueDate = nextDueDate(current.dueDate, template.recurrence as Recurring, anchorDay);
      if (!dueDate) break;
      const because: Generated["because"] =
        current === template ? (template.status === "paid" ? "paid" : template.status === "cancelled" ? "cancelled" : "date_passed") : "skipped";
      const obligation: Obligation = {
        id,
        label: template.label,
        recipient: template.recipient,
        destination: template.destination,
        token: template.token,
        amount: template.amount,
        dueDate,
        recurrence: template.recurrence,
        status: "pending",
        ...(template.note ? { note: template.note } : {}),
      };
      w.obligations.push(obligation);
      byId.set(id, obligation);
      log[id] = dueDate;
      out.push({ obligation, seriesId, occurrence: occurrence + 1, fromId: template.id, because });
      template = obligation;
      current = obligation;
      occurrence++;
    }
  }
  if (!out.length) return out;
  // A new instance inside the protection horizon changes holdback: supersede drafts like any obligation edit.
  if (dueInHorizon(w.mandate, out.map((g) => g.obligation), now).length) invalidatePlan(w);
  projectObligations(w, now);
  return out;
}

/** Display facts for one obligation's series (Calendar/Overview). */
export function seriesFacts(w: Workspace, id: string) {
  const { seriesId, occurrence } = seriesOf(id);
  const members = w.obligations.filter((o) => seriesOf(o.id).seriesId === seriesId);
  const latest = members.reduce((a, b) => (seriesOf(b.id).occurrence > seriesOf(a.id).occurrence ? b : a), members[0]);
  return { seriesId, occurrence, instances: members.length, latestId: latest?.id ?? id };
}
