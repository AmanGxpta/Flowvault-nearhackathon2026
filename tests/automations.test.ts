import test from "node:test";
import assert from "node:assert/strict";
import { checkAutomation, describe, localDay, nextRun, template } from "../lib/flowvault/automations.ts";

const IST = 330; // UTC+5:30

test("a daily 8:00 brief runs at 8:00 local, today if it's still before 8, else tomorrow", () => {
  const brief = template("brief", IST);
  const beforeEight = Date.parse("2026-11-14T01:00:00Z"); // 06:30 IST
  assert.equal(new Date(nextRun(brief, beforeEight)).toISOString(), "2026-11-14T02:30:00.000Z");
  const afterEight = Date.parse("2026-11-14T03:00:00Z"); // 08:30 IST
  assert.equal(new Date(nextRun(brief, afterEight)).toISOString(), "2026-11-15T02:30:00.000Z");
});

test("a Friday sweep runs on the next Friday at 9:00 local, a week later once it has run", () => {
  const sweep = template("sweep", IST);
  const saturday = Date.parse("2026-11-14T06:00:00Z"); // Sat 14 Nov
  assert.equal(new Date(nextRun(sweep, saturday)).toISOString(), "2026-11-20T03:30:00.000Z");
  const fridayAtNine = Date.parse("2026-11-20T03:30:00Z");
  assert.equal(new Date(nextRun(sweep, fridayAtNine)).toISOString(), "2026-11-27T03:30:00.000Z");
  assert.equal(localDay(Date.parse("2026-11-14T20:00:00Z"), IST), "2026-11-15");
});

test("automations are checked and described in plain words", () => {
  assert.equal(checkAutomation(template("idle_alert", 0)), null);
  assert.match(checkAutomation({ ...template("brief", 0), schedule: { every: "day", at: "25:00", tzOffsetMin: 0 } })!, /time like 08:00/);
  assert.match(checkAutomation({ ...template("allocation_alert", 0), params: { asset: "ETH", pct: 140 } })!, /between 1% and 99%/);
  assert.equal(describe(template("brief", 0)).title, "Brief me every day at 8:00 AM");
  assert.equal(describe(template("sweep", 0)).title, "Sweep surplus on Fridays");
  assert.equal(describe(template("idle_alert", 0)).title, "Alert me when idle stablecoins exceed $5,000");
});
