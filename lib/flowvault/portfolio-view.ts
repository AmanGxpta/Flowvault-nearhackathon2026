// Portfolio page shaping, pure: one row per asset across every chain and wallet (expandable to where it sits),
// DeFi grouped by protocol, and the split by network and by wallet. Values are the ones already on each row
// (the server's valuation); nothing here prices anything. Unvalued rows stay visible and are never counted.

export interface HoldingRow {
  id: string;
  symbol: string;
  name: string;
  kind: "wallet" | "supplied" | "collateral" | "debt" | "staking";
  usd: number | null;
  quantity: number | null;
  network: string;
  account: string;
  walletLabel: string;
  venue: string | null;
  groupId?: string;
  icon?: string;
}

export interface AssetGroup {
  key: string;
  symbol: string;
  name: string;
  icon?: string;
  usd: number | null;
  quantity: number | null;
  price: number | null;
  networks: string[];
  wallets: string[];
  rows: HoldingRow[];
}

const byValue = (a: { usd: number | null }, b: { usd: number | null }) => (b.usd ?? -1) - (a.usd ?? -1);

/** Wallet tokens, one group per symbol, biggest first. A group with any unvalued row keeps the valued part. */
export function groupTokens(rows: HoldingRow[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();
  for (const r of rows.filter((x) => x.kind === "wallet")) {
    const key = r.symbol.toUpperCase();
    const g = groups.get(key) ?? { key, symbol: r.symbol, name: r.name, icon: r.icon, usd: null, quantity: 0, price: null, networks: [], wallets: [], rows: [] };
    g.rows.push(r);
    if (r.usd !== null) g.usd = (g.usd ?? 0) + r.usd;
    g.quantity = g.quantity === null || r.quantity === null ? null : g.quantity + r.quantity;
    if (!g.networks.includes(r.network)) g.networks.push(r.network);
    if (!g.wallets.includes(r.account)) g.wallets.push(r.account);
    g.icon ??= r.icon;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    g.rows.sort(byValue);
    // Price only when every row is valued, so a partly priced group never shows a misleading unit price.
    g.price = g.usd !== null && g.quantity && g.rows.every((r) => r.usd !== null) ? g.usd / g.quantity : null;
    if (g.rows.length > 1 && new Set(g.rows.map((r) => r.name)).size > 1) g.name = g.symbol;
  }
  return [...groups.values()].sort(byValue);
}

export interface ProtocolGroup {
  venue: string;
  icon?: string;
  /** Assets minus debt. */
  usd: number;
  debt: number;
  unvalued: number;
  networks: string[];
  rows: HoldingRow[];
}
/** Everything that isn't a plain wallet balance, grouped by protocol (LP legs stay together), biggest first. */
export function groupProtocols(rows: HoldingRow[]): ProtocolGroup[] {
  const groups = new Map<string, ProtocolGroup>();
  for (const r of rows.filter((x) => x.kind !== "wallet")) {
    const venue = r.venue && r.venue !== "wallet" ? r.venue : "Other positions";
    const g = groups.get(venue) ?? { venue, usd: 0, debt: 0, unvalued: 0, networks: [], rows: [] };
    g.rows.push(r);
    if (r.usd === null) g.unvalued++;
    else if (r.kind === "debt") { g.debt += r.usd; g.usd -= r.usd; }
    else g.usd += r.usd;
    if (!g.networks.includes(r.network)) g.networks.push(r.network);
    groups.set(venue, g);
  }
  for (const g of groups.values())
    // Assets before loans; legs of one pool next to each other; otherwise biggest first.
    g.rows.sort((a, b) => (a.kind === "debt" ? 1 : 0) - (b.kind === "debt" ? 1 : 0) || (a.groupId ?? "").localeCompare(b.groupId ?? "") || byValue(a, b));
  return [...groups.values()].sort((a, b) => b.usd - a.usd);
}

export interface Slice { label: string; usd: number; share: number; members: string[] }
/** Split of counted value (debt subtracted) by a key; the smallest beyond `top` fold into "Other". */
export function distribution(rows: HoldingRow[], key: (r: HoldingRow) => string, top = 6): Slice[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.usd === null) continue;
    by.set(key(r), (by.get(key(r)) ?? 0) + (r.kind === "debt" ? -r.usd : r.usd));
  }
  const all = [...by].filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  const total = all.reduce((s, [, v]) => s + v, 0);
  if (!total) return [];
  const head = all.slice(0, top).map(([label, usd]) => ({ label, usd, share: usd / total, members: [label] }));
  const rest = all.slice(top);
  if (rest.length) {
    const usd = rest.reduce((s, [, v]) => s + v, 0);
    head.push({ label: `Other (${rest.length})`, usd, share: usd / total, members: rest.map(([l]) => l) });
  }
  return head;
}

export interface Totals { tokens: number; defi: number; debt: number; unvalued: number }
export function totals(rows: HoldingRow[]): Totals {
  const t: Totals = { tokens: 0, defi: 0, debt: 0, unvalued: 0 };
  for (const r of rows) {
    if (r.usd === null) t.unvalued++;
    else if (r.kind === "wallet") t.tokens += r.usd;
    else if (r.kind === "debt") t.debt += r.usd;
    else t.defi += r.usd;
  }
  return t;
}

/** Hide dust: valued groups under `min` dollars. Unvalued groups stay (they might be worth something). */
export function splitSmall<T extends { usd: number | null }>(groups: T[], min = 1): { shown: T[]; hidden: T[] } {
  const shown: T[] = [], hidden: T[] = [];
  for (const g of groups) (g.usd !== null && g.usd < min ? hidden : shown).push(g);
  return { shown, hidden };
}

export interface WalletSummary {
  account: string;
  label: string;
  /** Assets minus debt. */
  usd: number;
  share: number;
  tokens: number;
  defi: number;
  nfts: number;
  nftFloor: number;
  networks: string[];
  top: { symbol: string; icon?: string; usd: number }[];
}
/** One card per wallet: its value and share, what it holds and where, and its three largest assets. */
export function summarizeWallets(rows: HoldingRow[], nfts: { accountId: string; floorUsd: number | null; amount: string }[], names: Map<string, string>): WalletSummary[] {
  const out = new Map<string, WalletSummary>();
  const get = (account: string) => {
    let w = out.get(account);
    if (!w) out.set(account, (w = { account, label: names.get(account) ?? account, usd: 0, share: 0, tokens: 0, defi: 0, nfts: 0, nftFloor: 0, networks: [], top: [] }));
    return w;
  };
  for (const r of rows) {
    const w = get(r.account);
    if (r.usd !== null) w.usd += r.kind === "debt" ? -r.usd : r.usd;
    if (!w.networks.includes(r.network)) w.networks.push(r.network);
  }
  for (const [account, w] of out) {
    const mine = rows.filter((r) => r.account === account);
    w.tokens = groupTokens(mine).length;
    w.defi = groupProtocols(mine).length;
    w.top = groupTokens(mine).filter((g) => g.usd !== null && g.usd > 0).slice(0, 3).map((g) => ({ symbol: g.symbol, icon: g.icon, usd: g.usd! }));
    const order = distribution(mine, (r) => r.network, 99).map((s) => s.label);
    w.networks.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }
  for (const n of nfts) {
    const w = out.get(n.accountId);
    if (!w) continue;
    w.nfts += 1;
    w.nftFloor += (n.floorUsd ?? 0) * (Number(n.amount) || 1);
  }
  const total = [...out.values()].reduce((s, w) => s + Math.max(w.usd, 0), 0);
  for (const w of out.values()) w.share = total > 0 ? Math.max(w.usd, 0) / total : 0;
  return [...out.values()].sort((a, b) => b.usd - a.usd);
}

/** A wallet's best name: the owner's label beats a shortened address. */
export function walletNameMap(rows: { account: string; walletLabel: string }[]) {
  const names = new Map<string, string>();
  const looksLikeAddress = (s: string) => !s || s.includes("…") || /^0x[0-9a-f]{6,}$/i.test(s);
  for (const r of rows) {
    const had = names.get(r.account);
    if (had === undefined || (looksLikeAddress(had) && !looksLikeAddress(r.walletLabel))) names.set(r.account, r.walletLabel || r.account);
  }
  return names;
}
