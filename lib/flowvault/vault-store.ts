// Vault records (owner: Stream A): the vaults a workspace follows and its vault listings (publish flow).
// Listing saves are compare-and-swap on the revision, so two tabs can't both advance the same listing.
import { database } from "./store";
import type { VaultListing } from "./vault-publish";

const WATCH = "CREATE TABLE IF NOT EXISTS vault_watch (session_id TEXT NOT NULL, contract_id TEXT NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (session_id, contract_id))";
const LISTINGS = "CREATE TABLE IF NOT EXISTS vault_listings (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL)";

async function db() {
  const d = await database();
  await d.prepare(WATCH).run();
  await d.prepare(LISTINGS).run();
  return d;
}

export async function watched(sessionId: string): Promise<string[]> {
  const r = await (await db()).prepare("SELECT contract_id FROM vault_watch WHERE session_id=? ORDER BY added_at").bind(sessionId).all<{ contract_id: string }>();
  return (r.results ?? []).map((x) => x.contract_id);
}
export async function watch(sessionId: string, contractId: string) {
  await (await db()).prepare("INSERT OR IGNORE INTO vault_watch (session_id, contract_id, added_at) VALUES (?,?,?)").bind(sessionId, contractId, Date.now()).run();
}
export async function unwatch(sessionId: string, contractId: string) {
  await (await db()).prepare("DELETE FROM vault_watch WHERE session_id=? AND contract_id=?").bind(sessionId, contractId).run();
}

export async function listings(sessionId: string): Promise<{ listing: VaultListing; revision: number }[]> {
  const r = await (await db()).prepare("SELECT revision, payload FROM vault_listings WHERE session_id=?").bind(sessionId).all<{ revision: number; payload: string }>();
  return (r.results ?? []).map((x) => ({ listing: JSON.parse(x.payload) as VaultListing, revision: x.revision })).sort((a, b) => b.listing.updatedAt.localeCompare(a.listing.updatedAt));
}
export async function listingGet(sessionId: string, id: string): Promise<{ listing: VaultListing; revision: number }> {
  const x = await (await db()).prepare("SELECT revision, payload FROM vault_listings WHERE session_id=? AND id=?").bind(sessionId, id).first<{ revision: number; payload: string }>();
  if (!x) throw new Error("Listing not found.");
  return { listing: JSON.parse(x.payload) as VaultListing, revision: x.revision };
}
export async function listingInsert(sessionId: string, l: VaultListing) {
  await (await db()).prepare("INSERT INTO vault_listings (id, session_id, revision, payload) VALUES (?,?,1,?)").bind(l.id, sessionId, JSON.stringify(l)).run();
}
export async function listingSave(sessionId: string, l: VaultListing, revision: number) {
  const r = await (await db()).prepare("UPDATE vault_listings SET payload=?, revision=revision+1 WHERE session_id=? AND id=? AND revision=?").bind(JSON.stringify(l), sessionId, l.id, revision).run();
  if (!r.meta?.changes) throw new Error("This listing changed in another tab. Reload and try again.");
}
