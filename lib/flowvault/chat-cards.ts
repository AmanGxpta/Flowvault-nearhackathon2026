// Ask FlowVault cards: the typed, non-executable drafts the chat renders. A card holds parameters (what the owner
// wants) and, once the owner starts the operation from the card, a link to the journal attempt or plan that
// carries it. The model can create and edit drafts through tools; it can never prepare, authorize or sign. Once a
// card is linked to something handed to a wallet, it is locked: a follow-up makes a new version as a new card and
// the locked card keeps its history.
import { z } from "zod/v4";
import { units, decimal } from "./money.ts";
import type { SwapToken } from "./swap-explorer.ts";

export const CARD_KINDS = ["swap", "lend", "trade", "stake", "pay", "portfolio", "research", "perps", "notice", "choice", "automation"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

const amountText = z.string().trim().max(40).regex(/^\d+(\.\d+)?$/, "Amounts are plain decimals.");
const catalogId = z.string().min(3).max(200);
export const LEND_ACTIONS = ["supply", "withdraw", "collateral_add", "collateral_release", "borrow", "repay"] as const;

export const swapParams = z.object({
  from: catalogId,
  to: catalogId,
  amount: amountText.nullable(),
  /** The amount was asked for in dollars; `amount` is its token equivalent at `priceUsed`. */
  amountUsd: amountText.nullable().default(null),
  priceUsed: z.string().max(40).nullable().default(null),
  slippageBps: z.number().int().min(10).max(500).default(100),
}).strict();
export const lendParams = z.object({
  action: z.enum(LEND_ACTIONS),
  tokenId: z.string().min(2).max(100),
  symbol: z.string().min(1).max(20),
  icon: z.string().max(4000).nullable().default(null),
  amount: amountText.nullable(),
  supplyApy: z.number().nullable().default(null),
  borrowApy: z.number().nullable().default(null),
}).strict();
export const tradeParams = z.object({ chain: z.string().min(2).max(30), address: z.string().min(2).max(100), symbol: z.string().max(30) }).strict();
export const stakeParams = z.object({
  action: z.enum(["stake", "unstake"]),
  venue: z.string().max(64).nullable(),
  venueName: z.string().max(80).nullable().default(null),
  amount: amountText.nullable(),
  positionId: z.string().max(120).nullable().default(null),
  options: z.array(z.object({ venue: z.string(), name: z.string(), apy: z.string().nullable(), exit: z.string() })).max(6).default([]),
}).strict();
export const payParams = z.object({ obligationId: z.string().max(100), label: z.string().max(100), amount: z.string().max(40), token: z.string().max(20), chain: z.string().max(20), dueDate: z.string().max(10) }).strict();
export const portfolioParams = z.object({
  capturedAt: z.string(),
  rows: z.array(z.object({ asset: z.string(), network: z.string(), kind: z.string(), amount: z.string(), usd: z.string().nullable(), account: z.string().nullable(), catalogId: z.string().nullable() })).max(40),
  totalUsd: z.string().nullable(),
  unvalued: z.number().int(),
  coverage: z.array(z.string()).max(10),
}).strict();
export const researchParams = z.object({ network: z.enum(["near", "base", "arb"]), address: z.string().max(100) }).strict();
export const perpsParams = z.object({ coin: z.string().max(20).nullable() }).strict();
export const noticeParams = z.object({
  tone: z.enum(["blocked", "info"]),
  title: z.string().max(140),
  reasons: z.array(z.string().max(240)).max(6),
  remedies: z.array(z.object({ label: z.string().max(60), prompt: z.string().max(240) })).max(4),
}).strict();
export const choiceParams = z.object({
  question: z.string().max(200),
  options: z.array(z.object({ label: z.string().max(60), prompt: z.string().max(240), detail: z.string().max(120).nullable().default(null) })).min(2).max(5),
}).strict();

export const automationParams = z.object({
  kind: z.enum(["brief", "sweep", "idle_alert", "allocation_alert", "price_alert"]),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  day: z.number().int().min(0).max(6).nullable().default(null),
  thresholdUsd: z.number().min(1).max(1e9).nullable().default(null),
  asset: z.string().max(12).nullable().default(null),
  pct: z.number().min(1).max(99).nullable().default(null),
  /** Set once the owner turns it on: the automation's id. */
  createdId: z.string().max(64).nullable().default(null),
}).strict();
export const PARAMS = { swap: swapParams, lend: lendParams, trade: tradeParams, stake: stakeParams, pay: payParams, portfolio: portfolioParams, research: researchParams, perps: perpsParams, notice: noticeParams, choice: choiceParams, automation: automationParams } as const;
export type CardParams<K extends CardKind> = z.infer<(typeof PARAMS)[K]>;

/** Link from a card to the journal that carries the operation. Validated against the session server-side. */
export interface CardLink { attemptId?: string; planId?: string; state: string; at: string }
export interface Card<K extends CardKind = CardKind> {
  id: string;
  kind: K;
  version: number;
  params: CardParams<K>;
  /** Short facts the owner should see with the draft (assumptions, evidence time). */
  notes: string[];
  createdAt: string;
  updatedAt: string;
  by: "assistant" | "you";
  link: CardLink | null;
  /** A follow-up made a new card because this one was already handed to a wallet. */
  supersededBy: string | null;
  supersedes: string | null;
  history: { version: number; params: unknown; at: string; by: "assistant" | "you"; link?: CardLink }[];
}

/** States in which a wallet may have been asked or something may be on chain; such cards never change. */
export const HANDED_OFF = new Set(["awaiting_wallet", "submitted", "unknown", "confirmed", "failed", "partial", "executing", "completed"]);
export const isLocked = (c: Card) => !!c.link && HANDED_OFF.has(c.link.state);

export function newCard<K extends CardKind>(kind: K, params: unknown, by: "assistant" | "you", notes: string[] = [], now = Date.now(), id: string = crypto.randomUUID()): Card<K> {
  const at = new Date(now).toISOString();
  return { id, kind, version: 1, params: PARAMS[kind].parse(params) as CardParams<K>, notes: notes.slice(0, 6), createdAt: at, updatedAt: at, by, link: null, supersededBy: null, supersedes: null, history: [] };
}

/**
 * Apply an edit. An editable draft gets a new version (the old parameters stay in its history, and any review
 * prepared from them is invalid because the card's version changed). A locked card is never changed: the edit
 * becomes a new card that supersedes it.
 */
export function editCard(card: Card, patch: Record<string, unknown>, by: "assistant" | "you", notes: string[] | null = null, now = Date.now()): { card: Card; created: Card | null } {
  const merged = PARAMS[card.kind].parse({ ...(card.params as object), ...patch });
  // Nothing changed (e.g. a debounced save of what a review already applied): no new version, the link stays.
  if (JSON.stringify(merged) === JSON.stringify(card.params)) return { card, created: null };
  if (isLocked(card)) {
    const fresh = newCard(card.kind, merged, by, notes ?? card.notes, now);
    fresh.supersedes = card.id;
    return { card: { ...card, supersededBy: fresh.id }, created: fresh };
  }
  const at = new Date(now).toISOString();
  return {
    card: {
      ...card,
      version: card.version + 1,
      params: merged as never,
      // The owner's own change makes the assistant's assumptions (e.g. "$5 ≈ …") stale.
      notes: (notes ?? (by === "you" ? [] : card.notes)).slice(0, 6),
      updatedAt: at,
      by,
      // A link to a review that was only prepared (never handed to a wallet) no longer matches the parameters.
      link: null,
      history: [...card.history, { version: card.version, params: card.params, at: card.updatedAt, by: card.by }].slice(-10),
    },
    created: null,
  };
}

/* ───────────── Asset resolution: network + canonical contract, never a ticker alone ───────────── */

const NETWORK_ALIASES: Record<string, string> = {
  near: "near", ethereum: "eth", eth: "eth", mainnet: "eth", base: "base", arbitrum: "arb", arb: "arb", solana: "sol", sol: "sol",
  bsc: "bsc", bnb: "bsc", "bnb chain": "bsc", optimism: "op", op: "op", polygon: "pol", pol: "pol", avalanche: "avax", avax: "avax",
  gnosis: "gnosis", hyperliquid: "hypercore", hypercore: "hypercore",
};
export const networkKey = (n: string | null | undefined) => (n ? NETWORK_ALIASES[n.trim().toLowerCase()] ?? n.trim().toLowerCase() : null);

/** Assets whose identity is pinned by FlowVault (native coins, native USDC, the main NEAR tokens). */
const CANONICAL: Record<string, Record<string, string>> = {
  near: { NEAR: "native", WNEAR: "wrap.near", USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", USDT: "usdt.tether-token.near", ETH: "eth.bridge.near" },
  eth: { ETH: "native", USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7" },
  base: { ETH: "native", USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  arb: { ETH: "native", USDC: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", USDT: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9" },
  sol: { SOL: "native", USDC: "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v" },
};
/** Where a ticker usually means one network's asset, when the owner didn't name a network and holds it nowhere. */
const HOME: Record<string, string> = { NEAR: "near", WNEAR: "near", SOL: "sol", USDC: "near", USDT: "near" };

export type Resolution =
  | { ok: true; token: SwapToken; assumed: string | null }
  | { ok: false; reason: "unknown" | "ambiguous"; message: string; options: { id: string; network: string; label: string }[] };

/**
 * Resolve a ticker (and optional network) to one catalog asset. With a network: the canonical contract if FlowVault
 * pins one, else the only listing with that ticker there (several → ambiguous). Without a network: the owner's
 * holdings decide when exactly one network holds it, else the asset's home network for well-known tickers, else
 * ambiguous with the options listed. A contract id or catalog id is taken as given.
 */
export function resolveAsset(tokens: SwapToken[], symbolOrId: string, network: string | null, held: Record<string, string> = {}): Resolution {
  const raw = symbolOrId.trim();
  const byId = tokens.find((t) => t.id === raw);
  if (byId) return { ok: true, token: byId, assumed: null };
  const net = networkKey(network);
  const byContract = tokens.filter((t) => t.contract.toLowerCase() === raw.toLowerCase() && (!net || t.network === net));
  if (byContract.length === 1) return { ok: true, token: byContract[0], assumed: null };
  const sym = raw.replace(/^\$/, "").toUpperCase();
  const label = (t: SwapToken) => `${t.symbol} on ${NETWORK_NAMES[t.network] ?? t.network}`;
  const matches = tokens.filter((t) => t.symbol.toUpperCase() === sym && (!net || t.network === net));
  if (!matches.length) return { ok: false, reason: "unknown", message: `No ${sym}${net ? " on " + (NETWORK_NAMES[net] ?? net) : ""} in the swap catalog.`, options: [] };
  const pick = (list: SwapToken[], n: string) => {
    const pinned = CANONICAL[n]?.[sym];
    const exact = pinned ? list.find((t) => t.network === n && t.contract.toLowerCase() === pinned) : undefined;
    if (exact) return exact;
    const there = list.filter((t) => t.network === n);
    return there.length === 1 ? there[0] : null;
  };
  if (net) {
    const t = pick(matches, net);
    if (t) return { ok: true, token: t, assumed: null };
    return { ok: false, reason: "ambiguous", message: `Several assets are called ${sym} on ${NETWORK_NAMES[net] ?? net}. Choose by contract.`, options: matches.slice(0, 5).map((t) => ({ id: t.id, network: t.network, label: label(t) + " · " + t.contract.slice(0, 10) })) };
  }
  const heldIds = matches.filter((t) => held[t.id] && held[t.id] !== "0");
  if (heldIds.length === 1) return { ok: true, token: heldIds[0], assumed: `${label(heldIds[0])} (the only network where you hold ${sym})` };
  const networks = [...new Set((heldIds.length ? heldIds : matches).map((t) => t.network))];
  if (networks.length === 1) { const t = pick(matches, networks[0]); if (t) return { ok: true, token: t, assumed: null }; }
  if (!heldIds.length && HOME[sym]) { const t = pick(matches, HOME[sym]); if (t) return { ok: true, token: t, assumed: `${label(t)}` }; }
  const opts = (heldIds.length ? heldIds : matches.filter((t) => CANONICAL[t.network]?.[sym] === t.contract.toLowerCase())).slice(0, 5);
  return { ok: false, reason: "ambiguous", message: `${sym} exists on several networks${heldIds.length ? " where you hold it" : ""}. Which one?`, options: (opts.length ? opts : matches.slice(0, 5)).map((t) => ({ id: t.id, network: t.network, label: label(t) })) };
}

export const NETWORK_NAMES: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", op: "Optimism", pol: "Polygon", avax: "Avalanche", gnosis: "Gnosis", hypercore: "Hyperliquid" };

/**
 * Token amount for a dollar amount at a quoted price, in the token's base units (bigint), rounded down. Returns
 * null when the price is missing or not a positive decimal: a dollar amount is never guessed.
 */
export function usdToTokenAmount(usd: string, price: string | null | undefined, decimals: number): string | null {
  if (!price || !/^\d+(\.\d+)?$/.test(price)) return null;
  const [w, f = ""] = price.split(".");
  const p = units(w + (f ? "." + f.slice(0, 18) : ""), 18);
  if (p <= 0n) return null;
  const raw = (units(usd, 18) * 10n ** BigInt(decimals)) / p;
  if (raw <= 0n) return null;
  // Keep at most 8 significant fractional digits so the draft stays readable; the quote uses the exact amount.
  const keep = decimals > 8 ? 10n ** BigInt(decimals - 8) : 1n;
  return decimal((raw / keep) * keep, decimals);
}

/** Remaining balance after spending `amount` from `balance` (both decimals in the same token). Null if unknown. */
export function remainingAfter(balance: string | null, amount: string | null, decimals: number): { remaining: string; short: boolean } | null {
  if (balance === null || amount === null) return null;
  const b = units(balance, decimals), a = units(amount, decimals);
  return { remaining: decimal(b >= a ? b - a : 0n, decimals), short: a > b };
}

/** A compact, model-safe view of a card (no icons, no history). */
export function cardBrief(c: Card) {
  return { cardId: c.id, kind: c.kind, version: c.version, params: { ...(c.params as Record<string, unknown>), icon: undefined }, status: c.link?.state ?? "draft", locked: isLocked(c), supersededBy: c.supersededBy };
}
