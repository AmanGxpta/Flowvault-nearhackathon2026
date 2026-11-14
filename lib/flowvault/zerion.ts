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

const cache = new Map<string, { at: number; read: ZerionRead }>();
// A Zerion key allows 2,000 requests a day: one wallet refreshed at most every 5 minutes, NFTs every 30.
const CACHE_MS = 5 * 60_000;
const nftCache = new Map<string, { at: number; body: any }>();
const NFT_CACHE_MS = 30 * 60_000;

/** Every priced, non-spam position and NFT of one EVM address. Throws when the wallet itself can't be read. */
export async function readZerionWallet(
  address: string,
  opts: { key: string; hyperliquid: boolean; fetcher?: Fetcher; budgetMs?: number; now?: () => number },
): Promise<ZerionRead> {
  const addr = address.toLowerCase();
  const now = opts.now ?? Date.now;
  const hit = cache.get(addr + ":" + opts.hyperliquid);
  if (hit && now() - hit.at < CACHE_MS) return hit.read;
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const deadline = now() + (opts.budgetMs ?? 8000);
  const at = new Date(now()).toISOString(), freshUntil = new Date(now() + 10 * 60_000).toISOString();
  const q = "currency=usd&filter[positions]=no_filter&filter[trash]=only_non_trash&sort=value";
  const positions = await zget(`/wallets/${addr}/positions/?${q}`, opts.key, fetcher, deadline);
  // NFT floors move slowly: a read from the last 30 minutes is reused, which also halves the requests per refresh.
  const nftHit = nftCache.get(addr);
  const nfts = nftHit && now() - nftHit.at < NFT_CACHE_MS
    ? { ok: true as const, b: nftHit.body }
    : await zget(`/wallets/${addr}/nft-positions/?currency=usd&sort=-floor_price&page[size]=100`, opts.key, fetcher, deadline).then(
        (b) => { nftCache.set(addr, { at: now(), body: b }); return { ok: true as const, b }; },
        (e: Error) => ({ ok: false as const, e }),
      );
  const out: ZerionRead = { positions: [], nfts: [], notes: [], totalUsd: null };
  const skipped: Record<string, number> = {};
  let total = 0;
  for (const row of positions?.data ?? []) {
    const p = mapZerionPosition(row, addr, at, freshUntil, { hyperliquid: opts.hyperliquid });
    if ("skip" in p) { skipped[p.skip] = (skipped[p.skip] ?? 0) + 1; continue; }
    out.positions.push(p);
  }
  for (const row of positions?.data ?? []) {
    const a = row?.attributes ?? {};
    if (a.flags?.is_trash || typeof a.value !== "number") continue;
    total += a.position_type === "loan" ? -Math.abs(a.value) : a.value;
  }
  out.totalUsd = Math.round(total * 100) / 100;
  if (skipped.unpriced) out.notes.push(`${skipped.unpriced} token${skipped.unpriced === 1 ? " has" : "s have"} no market price and ${skipped.unpriced === 1 ? "isn't" : "aren't"} counted`);
  if (nfts.ok) out.nfts = (nfts.b?.data ?? []).map((r: any) => mapZerionNft(r, addr)).filter(Boolean) as NftHolding[];
  else out.notes.push("NFTs couldn't be read: " + nfts.e.message);
  cache.set(addr + ":" + opts.hyperliquid, { at: now(), read: out });
  return out;
}

export const zerionKey = () => serverSetting("ZERION_API_KEY");
/** Test seam: forget cached reads. */
export const clearZerionCache = () => { cache.clear(); nftCache.clear(); };
