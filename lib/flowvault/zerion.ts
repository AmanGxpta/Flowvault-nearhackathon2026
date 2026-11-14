// Whole-wallet reads for connected EVM addresses through the Zerion API (server setting ZERION_API_KEY): every
// token on every chain Zerion indexes, DeFi positions by protocol (deposits, loans, staking, rewards, LP legs) and
// NFTs at collection floor. Zerion's spam filter is applied. Its USD values become each position's valuation, so
// the net worth matches what wallet trackers show. NFTs are listed beside the total and not added to it, the same
// way Zerion's own total leaves them out (floor prices are estimates, not sale prices).
//
// FlowVault's own finalized reads stay authoritative for what it can spend or prove: native ETH and USDC on
// Ethereum, Base and Arbitrum, and the Hyperliquid margin account. Zerion rows that would count those twice are
// dropped here.
import { decimal } from "./money.ts";
import { EVM_CHAINS } from "./evm.ts";
import { serverSetting } from "./server-setting.ts";
import { wholeWalletAsset } from "./asset-scope.ts";
export { wholeWalletAsset };
import type { Chain, NftHolding, Position } from "./types.ts";

export const ZERION_API = "https://api.zerion.io/v1";
/** Zerion chain id → FlowVault chain (only where FlowVault has its own chain id) and display name. */
const LEGACY: Record<string, Chain> = { ethereum: "eth", base: "base", arbitrum: "arb", "binance-smart-chain": "bnb" };
const NAMES: Record<string, string> = {
  ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", "binance-smart-chain": "BNB Chain", polygon: "Polygon",
  avalanche: "Avalanche", optimism: "Optimism", "zksync-era": "zkSync Era", linea: "Linea", scroll: "Scroll",
  blast: "Blast", gnosis: "Gnosis", fantom: "Fantom", celo: "Celo", mantle: "Mantle", "polygon-zkevm": "Polygon zkEVM",
  xdai: "Gnosis", zora: "Zora", mode: "Mode", aurora: "Aurora", solana: "Solana", berachain: "Berachain", sonic: "Sonic", unichain: "Unichain", abstract: "Abstract", ink: "Ink",
};
export const networkName = (id: string) => NAMES[id] ?? id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Covered by FlowVault's finalized RPC reads (readEvmNetwork): native ETH and USDC on these three chains. */
const OWN_READS: Record<string, string> = { ethereum: EVM_CHAINS.eth.usdc, base: EVM_CHAINS.base.usdc, arbitrum: EVM_CHAINS.arb.usdc };

/* eslint-disable @typescript-eslint/no-explicit-any -- Zerion JSON:API bodies */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface ZerionRead {
  positions: Position[];
  nfts: NftHolding[];
  /** Plain-language notes for the section (unpriced tokens skipped, NFT read failed, …). */
  notes: string[];
  /** Zerion's own wallet total (tokens + DeFi, NFTs excluded), for cross-checking. */
  totalUsd: number | null;
}

const KIND: Record<string, Position["kind"]> = { wallet: "wallet", deposit: "supplied", loan: "debt", staked: "staking", locked: "staking", reward: "staking", investment: "supplied" };
const TYPE_LABEL: Record<string, string> = { deposit: "Deposit", loan: "Loan", staked: "Staked", locked: "Locked", reward: "Rewards", investment: "Investment" };

/** One Zerion position → a FlowVault position, or a reason it is skipped. Pure. */
export function mapZerionPosition(row: any, address: string, at: string, freshUntil: string, opts: { hyperliquid: boolean }): Position | { skip: string } {
  const a = row?.attributes ?? {};
  const chainId: string = row?.relationships?.chain?.data?.id ?? "";
  const dapp: string | null = row?.relationships?.dapp?.data?.id ?? null;
  const type: string = a.position_type ?? "wallet";
  const f = a.fungible_info ?? {};
  const symbol = String(f.symbol ?? a.name ?? "?").slice(0, 24);
  if (a.flags?.is_trash || a.flags?.displayable === false) return { skip: "spam" };
  if (!chainId) return { skip: "no chain" };
  if (opts.hyperliquid && dapp === "hyperliquid") return { skip: "own read" };
  const impl = (f.implementations ?? []).find((x: any) => x?.chain_id === chainId);
  if (type === "wallet" && chainId in OWN_READS && impl && (impl.address == null || String(impl.address).toLowerCase() === OWN_READS[chainId].toLowerCase()))
    return { skip: "own read" };
  const decimals = Number(a.quantity?.decimals ?? impl?.decimals);
  const raw = String(a.quantity?.int ?? "");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^\d+$/.test(raw)) return { skip: "quantity unverified" };
  if (raw === "0") return { skip: "zero" };
  const value = typeof a.value === "number" && Number.isFinite(a.value) ? Math.abs(a.value) : null;
  if (value === null) return { skip: "unpriced" };
  const usdcRaw = BigInt(Math.round(value * 1e6)).toString();
  const network = networkName(chainId);
  const protocol: string | null = a.protocol ?? null;
  const kind = KIND[type] ?? "supplied";
  const label = protocol ? `${protocol} · ${TYPE_LABEL[type] ?? type} ${symbol}` : `${f.name ?? symbol} on ${network}`;
  const addr = address.toLowerCase();
  return {
    id: `zerion:${addr}:${String(row.id ?? `${chainId}-${symbol}-${type}`)}`,
    kind,
    label,
    asset: wholeWalletAsset(symbol, network),
    displayAsset: symbol,
    amount: decimal(BigInt(raw), decimals),
    rawAmount: raw,
    decimals,
    chain: LEGACY[chainId],
    network,
    networkId: chainId,
    venue: protocol ?? "wallet",
    accountId: addr,
    source: "live",
    capturedAt: at,
    availableAt: kind === "wallet" ? at : null,
    availabilityIsEstimate: kind !== "wallet",
    icon: typeof f.icon?.url === "string" ? f.icon.url : undefined,
    groupId: typeof a.group_id === "string" ? a.group_id : undefined,
    venueValuation: { usdcRaw, basis: "Zerion USD price", freshUntil },
    valuation: { amount: (Math.round(value * 100) / 100).toFixed(2), unit: "USD", source: "live", capturedAt: at, basis: "Zerion USD price" },
  } as Position;
}

/** Unsolicited "visit this site / claim" NFTs that Zerion doesn't flag: a domain or a claim lure in the name
 * (fancy Unicode letters folded first, so "𝙚𝙫𝙢𝙚𝙣𝙩𝙧𝙮 𝙘𝙤𝙢" is caught too). */
export function looksLikeAirdropScam(...names: unknown[]) {
  return names.some((n) => {
    const t = String(n ?? "").normalize("NFKC").toLowerCase();
    return /\b[a-z0-9-]{3,}\.(com|io|xyz|net|org|app|site|online|top|live|gift|claims?)\b/.test(t) || /\b[a-z0-9-]{4,} com\b/.test(t) || /\b(claim|voucher|airdrop|reward pass|visit)\b/.test(t) || /\$\s?\d[\d,]*/.test(t);
  });
}

/** One Zerion NFT position → a holding (spam and unpriced kept out of the floor total by the caller). Pure. */
export function mapZerionNft(row: any, address: string): NftHolding | null {
  const a = row?.attributes ?? {};
  const info = a.nft_info ?? {};
  if (info.flags?.is_spam || looksLikeAirdropScam(info.name, a.collection_info?.name)) return null;
  const chainId: string = row?.relationships?.chain?.data?.id ?? "";
  const floor = typeof a.value === "number" && Number.isFinite(a.value) && a.value > 0 ? a.value : null;
  return {
    id: `zerion-nft:${address.toLowerCase()}:${String(row.id ?? info.contract_address + ":" + info.token_id)}`,
    name: String(info.name ?? a.collection_info?.name ?? "Untitled").slice(0, 80),
    collection: String(a.collection_info?.name ?? "").slice(0, 80) || null,
    network: networkName(chainId),
    amount: String(a.amount ?? "1"),
    floorUsd: floor === null ? null : Math.round(floor * 100) / 100,
    image: typeof info.content?.preview?.url === "string" ? info.content.preview.url : null,
    accountId: address.toLowerCase(),
  };
}

// Zerion keys allow only a few requests per second. Requests from this server go out one at a time, spaced.
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
const GAP_MS = 400;
function paced<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    try { return await work(); } finally { lastAt = Date.now(); }
  });
  queue = run.catch(() => undefined);
  return run;
}

async function zget(path: string, key: string, fetcher: Fetcher, deadline: number): Promise<any> {
  // 202/503: Zerion is still indexing this wallet. 429: rate limited. Retry while the read budget allows, then say so.
  for (;;) {
    const r = await paced(() => fetcher(ZERION_API + path, {
      headers: { accept: "application/json", authorization: "Basic " + btoa(key + ":") },
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    }));
    if (r.status === 200) return r.json();
    if ((r.status === 202 || r.status === 503 || r.status === 429) && Date.now() + 1500 < deadline) {
      const wait = Math.min(1500, Math.max(300, Number(r.headers.get("retry-after") ?? 1) * 1000));
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (r.status === 202 || r.status === 503) throw new Error("Zerion is still indexing this wallet. Try again in a minute.");
    if (r.status === 401 || r.status === 403) throw new Error("Zerion refused the API key (ZERION_API_KEY).");
    if (r.status === 429) throw new Error("Zerion rate limit reached. Try again shortly.");
    throw new Error("Zerion read failed: HTTP " + r.status);
  }
}

/**
 * Where Zerion replies are kept between reads (D1 in the app, memory in tests), and the daily request budget.
 * Every portfolio load, tab, browser and dev-server restart shares it, so refreshing over and over costs nothing.
 */
export interface ZerionStore {
  get(address: string, kind: "positions" | "nfts"): Promise<{ at: number; body: any } | null>;
  put(address: string, kind: "positions" | "nfts", at: number, body: any): Promise<void>;
  /** Count one request against today's budget; false when the budget is spent (nothing is counted then). */
  take(day: string, limit: number): Promise<boolean>;
}
/** Re-read a wallet's tokens at most this often, and its NFTs (floors move slowly) at most this often. */
export const POSITIONS_TTL_MS = 5 * 60_000;
export const NFTS_TTL_MS = 30 * 60_000;
/** When Zerion can't be asked (budget spent, rate limited, down), a read this recent is shown instead, with its time. */
export const STALE_MAX_MS = 6 * 60 * 60_000;
/** A key allows 2,000 requests a day; FlowVault stops at 1,800 to leave room (server setting ZERION_DAILY_LIMIT). */
export const DEFAULT_DAILY_LIMIT = 1800;

export function memoryZerionStore(): ZerionStore {
  const rows = new Map<string, { at: number; body: any }>(), used = new Map<string, number>();
  return {
    async get(a, k) { return rows.get(a + ":" + k) ?? null; },
    async put(a, k, at, body) { rows.set(a + ":" + k, { at, body }); },
    async take(day, limit) { const n = used.get(day) ?? 0; if (n >= limit) return false; used.set(day, n + 1); return true; },
  };
}

// Reads already on their way are shared: two tabs (or the portfolio and a swap picker) loading at once make one request.
const inflight = new Map<string, Promise<{ at: number; body: any; note?: string }>>();
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + " UTC";

async function cachedBody(
  addr: string, kind: "positions" | "nfts", path: string, ttl: number,
  o: { key: string; fetcher: Fetcher; deadline: number; store: ZerionStore; now: () => number; limit: number },
): Promise<{ at: number; body: any; note?: string }> {
  const hit = await o.store.get(addr, kind).catch(() => null);
  if (hit && o.now() - hit.at < ttl) return hit;
  const flightKey = addr + ":" + kind;
  const running = inflight.get(flightKey);
  if (running) return running;
  const work = (async () => {
    const stale = (why: string) => {
      if (hit && o.now() - hit.at < STALE_MAX_MS) return { ...hit, note: `${kind === "nfts" ? "NFTs" : "Values"} from ${hhmm(hit.at)}: ${why}` };
      throw new Error(why);
    };
    if (!(await o.store.take(new Date(o.now()).toISOString().slice(0, 10), o.limit).catch(() => false)))
      return stale("today's Zerion request budget is used up, so refreshing is paused until tomorrow (UTC)");
    try {
      const body = await zget(path, o.key, o.fetcher, o.deadline);
      const at = o.now();
      await o.store.put(addr, kind, at, body).catch(() => undefined);
      return { at, body };
    } catch (e) {
      return stale((e as Error).message);
    }
  })();
  inflight.set(flightKey, work);
  try { return await work; } finally { inflight.delete(flightKey); }
}

/** Every priced, non-spam position and NFT of one EVM address. Throws when the wallet itself can't be read. */
export async function readZerionWallet(
  address: string,
  opts: { key: string; hyperliquid: boolean; store: ZerionStore; fetcher?: Fetcher; budgetMs?: number; now?: () => number; dailyLimit?: number },
): Promise<ZerionRead> {
  const addr = address.toLowerCase();
  const now = opts.now ?? Date.now;
  const o = { key: opts.key, fetcher: opts.fetcher ?? ((u: string, i: RequestInit) => fetch(u, i)), deadline: now() + (opts.budgetMs ?? 8000), store: opts.store, now, limit: opts.dailyLimit ?? DEFAULT_DAILY_LIMIT };
  const q = "currency=usd&filter[positions]=no_filter&filter[trash]=only_non_trash&sort=value";
  const positions = await cachedBody(addr, "positions", `/wallets/${addr}/positions/?${q}`, POSITIONS_TTL_MS, o);
  const nfts = await cachedBody(addr, "nfts", `/wallets/${addr}/nft-positions/?currency=usd&sort=-floor_price&page[size]=100`, NFTS_TTL_MS, o).then(
    (b) => ({ ok: true as const, ...b }),
    (e: Error) => ({ ok: false as const, e }),
  );
  // Values carry the time Zerion priced them. A fresh read stays valid past its 5-minute reuse window; a fallback
  // read (budget spent, Zerion unavailable) is shown up to 6 hours old, and the note says from when.
  const at = new Date(positions.at).toISOString();
  const freshUntil = new Date(positions.at + (positions.note ? STALE_MAX_MS : 15 * 60_000)).toISOString();
  const out: ZerionRead = { positions: [], nfts: [], notes: positions.note ? [positions.note] : [], totalUsd: null };
  const skipped: Record<string, number> = {};
  let total = 0;
  for (const row of positions.body?.data ?? []) {
    const p = mapZerionPosition(row, addr, at, freshUntil, { hyperliquid: opts.hyperliquid });
    if ("skip" in p) { skipped[p.skip] = (skipped[p.skip] ?? 0) + 1; continue; }
    out.positions.push(p);
  }
  for (const row of positions.body?.data ?? []) {
    const a = row?.attributes ?? {};
    if (a.flags?.is_trash || typeof a.value !== "number") continue;
    total += a.position_type === "loan" ? -Math.abs(a.value) : a.value;
  }
  out.totalUsd = Math.round(total * 100) / 100;
  if (skipped.unpriced) out.notes.push(`${skipped.unpriced} token${skipped.unpriced === 1 ? " has" : "s have"} no market price and ${skipped.unpriced === 1 ? "isn't" : "aren't"} counted`);
  if (nfts.ok) {
    out.nfts = (nfts.body?.data ?? []).map((r: any) => mapZerionNft(r, addr)).filter(Boolean) as NftHolding[];
    if (nfts.note) out.notes.push(nfts.note);
  } else out.notes.push("NFTs couldn't be read: " + nfts.e.message);
  return out;
}

/**
 * The Zerion key, only while whole-wallet reads are switched on (server setting ZERION_ENABLED=true). Off by
 * default, so development reloads never spend the key's daily quota.
 */
export async function zerionKey() {
  if ((await serverSetting("ZERION_ENABLED"))?.toLowerCase() !== "true") return null;
  return serverSetting("ZERION_API_KEY");
}
export async function zerionDailyLimit() {
  const n = Number(await serverSetting("ZERION_DAILY_LIMIT"));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}
