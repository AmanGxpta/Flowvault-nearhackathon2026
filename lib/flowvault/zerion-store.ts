// Zerion replies and the daily request count, kept in D1 so every load, tab, browser and restart shares them. A
// wallet's public balances are the same for everyone who reads it, so replies are keyed by address alone.
import { database } from "./store";
import type { ZerionStore } from "./zerion";

const TABLES = [
  "CREATE TABLE IF NOT EXISTS zerion_cache (address TEXT NOT NULL, kind TEXT NOT NULL, fetched_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (address, kind))",
  "CREATE TABLE IF NOT EXISTS zerion_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL)",
];
let ready: Promise<void> | null = null;
async function db() {
  const d = await database();
  ready ??= Promise.all(TABLES.map((t) => d.prepare(t).run())).then(() => undefined);
  await ready;
  return d;
}

export const d1ZerionStore: ZerionStore = {
  async get(address, kind) {
    const r = await (await db()).prepare("SELECT fetched_at, body FROM zerion_cache WHERE address=? AND kind=?").bind(address, kind).first<{ fetched_at: number; body: string }>();
    return r ? { at: r.fetched_at, body: JSON.parse(r.body) } : null;
  },
  async put(address, kind, at, body) {
    await (await db()).prepare("INSERT INTO zerion_cache (address, kind, fetched_at, body) VALUES (?,?,?,?) ON CONFLICT(address, kind) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body")
      .bind(address, kind, at, JSON.stringify(body)).run();
  },
  async take(day, limit) {
    // One statement: counts the request only while today's count is under the limit.
    const r = await (await db()).prepare("INSERT INTO zerion_usage (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE zerion_usage.count < ?")
      .bind(day, limit).run();
    return (r.meta?.changes ?? 0) > 0;
  },
};
