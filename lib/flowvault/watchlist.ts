// The watchlist saved with a connected account: starred tokens (market ids, "<chain>:<address>") and public wallets
// you follow with your own label and private note. Research only: watched wallets are never yours, never counted and
// never signed for. Changes are small operations applied to the stored list, so two devices editing at once don't
// overwrite each other. Pure: the store and the API use it, and so do the tests.
import { parseResearch, researchAddress, type WatchedAddress } from "./research.ts";

export interface Watchlist { wallets: WatchedAddress[]; saved: string[] }
export type WatchOp =
  | { op: "star"; id: string }
  | { op: "unstar"; id: string }
  | { op: "watch_wallet"; network: string; address: string; label?: string; notes?: string }
  | { op: "update_wallet"; id: string; label?: string; notes?: string }
  | { op: "unwatch_wallet"; id: string }
  /** One-time move of a list this browser kept before watchlists were saved with the account: merged, never replacing. */
  | { op: "import"; data: unknown };

export const MAX_SAVED = 100, MAX_WALLETS = 100;
const MARKET_ID = /^[a-z0-9_-]{2,30}:[A-Za-z0-9._-]{1,120}$/;
export const emptyWatchlist = (): Watchlist => ({ wallets: [], saved: [] });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A stored or imported list, cleaned: valid addresses only, no duplicates, within the limits. */
export function cleanWatchlist(value: unknown): Watchlist {
  const parsed = parseResearch(JSON.stringify(value ?? {}));
  const saved = [...new Map(parsed.saved.filter((x) => MARKET_ID.test(x)).map((x) => [x.toLowerCase(), x])).values()].slice(0, MAX_SAVED);
  return { wallets: parsed.wallets.slice(0, MAX_WALLETS), saved };
}

/** Applies one change. Throws a readable error for anything invalid; the list is never partly changed. */
export function applyWatchOp(list: Watchlist, o: WatchOp): Watchlist {
  const w = cleanWatchlist(list);
  switch (o.op) {
    case "star": {
      if (!MARKET_ID.test(o.id)) throw new Error("That token id isn't valid.");
      if (w.saved.some((x) => same(x, o.id))) return w;
      if (w.saved.length >= MAX_SAVED) throw new Error(`Your watchlist holds up to ${MAX_SAVED} tokens.`);
      return { ...w, saved: [...w.saved, o.id] };
    }
    case "unstar": return { ...w, saved: w.saved.filter((x) => !same(x, o.id)) };
    case "watch_wallet": {
      const address = researchAddress(o.network, o.address), id = o.network + ":" + address;
      if (w.wallets.some((x) => x.id === id)) throw new Error("This wallet is already saved.");
      if (w.wallets.length >= MAX_WALLETS) throw new Error(`You can watch up to ${MAX_WALLETS} wallets.`);
      return { ...w, wallets: [...w.wallets, { id, network: o.network as WatchedAddress["network"], address, label: (o.label ?? "").trim().slice(0, 80) || address, notes: (o.notes ?? "").slice(0, 1000) }] };
    }
    case "update_wallet": {
      if (!w.wallets.some((x) => x.id === o.id)) throw new Error("That wallet isn't on your watchlist.");
      return { ...w, wallets: w.wallets.map((x) => (x.id === o.id ? { ...x, ...(o.label !== undefined ? { label: o.label.slice(0, 80) } : {}), ...(o.notes !== undefined ? { notes: o.notes.slice(0, 1000) } : {}) } : x)) };
    }
    case "unwatch_wallet": return { ...w, wallets: w.wallets.filter((x) => x.id !== o.id) };
    case "import": {
      const add = cleanWatchlist(o.data);
      const wallets = [...w.wallets, ...add.wallets.filter((a) => !w.wallets.some((x) => x.id === a.id))].slice(0, MAX_WALLETS);
      const saved = [...w.saved, ...add.saved.filter((a) => !w.saved.some((x) => same(x, a)))].slice(0, MAX_SAVED);
      return { wallets, saved };
    }
  }
}
