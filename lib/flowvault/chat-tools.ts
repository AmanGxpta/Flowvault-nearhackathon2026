// Ask FlowVault capability registry. Every tool has a strict input schema and returns compact evidence (canonical
// identities, amounts, source, freshness, coverage). Read tools only read. Draft tools create or edit
// non-executable cards; preparing, authorizing and signing happen only when the owner acts on a card through the
// existing journals. Nothing here can change policy, approve allowances, sign mandates, schedule spending or retry
// a transaction. All reads are injected (ChatReads), so the registry is pure and testable with mocks.
import { z } from "zod/v4";
import type { SwapToken } from "./swap-explorer.ts";
import { type Card, type CardKind, newCard, editCard, resolveAsset, usdToTokenAmount, remainingAfter, cardBrief, NETWORK_NAMES, networkKey, isLocked, LEND_ACTIONS } from "./chat-cards.ts";
import { units } from "./money.ts";

export interface HoldingRow { asset: string; network: string; kind: string; amount: string; usd: string | null; account: string | null; catalogId: string | null }
export interface Holdings { capturedAt: string; rows: HoldingRow[]; totalUsd: string | null; unvalued: number; coverage: string[]; /** Networks whose wallet balances were actually read (elsewhere a missing balance is unknown, not zero). */ covered: string[] }
export interface Limits {
  perAction: string; daily: string; remainingToday: string | null; maxMoveCost: string; protectedAssets: string[]; venues: string[];
  reserve: string | null; holdback: string | null; spendableNow: string | null; surplus: string | null; borrowingAllowed: boolean;
  upcoming: { label: string; amount: string; token: string; chain: string; due: string; id: string }[]; version: number | null;
}
export interface Market { tokenId: string; symbol: string; icon: string | null; supplyApy: number | null; borrowApy: number | null; utilization: number; canSupply: boolean; canBorrow: boolean; collateral: boolean; suppliedUsd: number | null }
export interface LendPosition { wallet: string; supplied: string; collateral: string; borrowed: string; available: string; health: string; priced: boolean }
export interface ChatReads {
  mode: "live" | "demo";
  accountId: string | null;
  /** Owned addresses per network (NEAR account, proven EVM and Solana wallets). */
  addresses: Record<string, string>;
  catalog(): Promise<SwapToken[]>;
  holdings(): Promise<Holdings>;
  limits(): Promise<Limits>;
  quote(p: { from: string; to: string; amount: string; slippage: number; sender?: string; recipient?: string }): Promise<{ routes: { venue: string; output: string; minimum: string; eta: number | null }[]; warnings: string[]; expiresAt: string }>;
  markets(): Promise<{ rows: Market[]; capturedAt: string }>;
  lendPosition(tokenId: string): Promise<LendPosition | null>;
  staking(): Promise<{ options: { venue: string; name: string; apy: string | null; exit: string }[]; positions: { id: string; venue: string; staked: string; unstaking: string; withdrawable: string }[]; note: string }>;
  research(network: "near" | "base" | "arb", address: string): Promise<Record<string, unknown>>;
  operations(limit: number): Promise<{ id: string; kind: string; state: string; amount: string; message: string; updatedAt: string; transactions: number }[]>;
  perps(): Promise<Record<string, unknown>>;
  checkPolicy(kind: string, asset: string, amountUsd: string): Promise<{ allowed: boolean; violations: { code: string; message: string }[]; remainingToday: string | null }>;
}
export interface ToolContext { reads: ChatReads; cards: Map<string, Card>; now: number }
export interface ToolOutcome { result: Record<string, unknown>; cards: Card[] }
interface ToolDef<S extends z.ZodType> { name: string; label: string; description: string; input: S; run(ctx: ToolContext, input: z.infer<S>): Promise<ToolOutcome> }
const def = <S extends z.ZodType>(t: ToolDef<S>) => t;

const amount = z.string().trim().regex(/^\d+(\.\d+)?$/, "plain decimal like 10 or 0.5").max(40);
const ticker = z.string().trim().min(1).max(80);
const network = z.string().trim().max(30);
const cut = (s: unknown, n = 160) => (typeof s === "string" ? s.slice(0, n) : s);
const net = (n: string) => NETWORK_NAMES[n] ?? n;

function heldMap(h: Holdings) {
  const m: Record<string, string> = {};
  for (const r of h.rows) if (r.catalogId && r.kind === "wallet") m[r.catalogId] = r.amount;
  return m;
}
function ownCard(ctx: ToolContext, id: string) {
  const c = ctx.cards.get(id);
  if (!c) throw new Error("No card with that id in this conversation.");
  return c;
}
async function swapEvidence(ctx: ToolContext, card: Card<"swap">, tokens?: SwapToken[]) {
  const list = tokens ?? (await ctx.reads.catalog());
  const from = list.find((t) => t.id === card.params.from), to = list.find((t) => t.id === card.params.to);
  if (!from || !to) return { error: "Asset no longer listed." };
  const out: Record<string, unknown> = {
    cardId: card.id, version: card.version,
    from: { id: from.id, symbol: from.symbol, network: net(from.network), contract: from.contract },
    to: { id: to.id, symbol: to.symbol, network: net(to.network), contract: to.contract },
    amount: card.params.amount, amountUsd: card.params.amountUsd, slippagePct: card.params.slippageBps / 100,
  };
  // Balance read and quote run in parallel; neither waits for the other.
  const holdingsRead = ctx.reads.holdings().catch(() => null);
  const quoteRead = (async () => {
    if (!card.params.amount) return null;
    const crossChain = from.network !== "near" || to.network !== "near";
    if (crossChain && (ctx.reads.mode === "demo" || !ctx.reads.addresses[from.network])) return null;
    // Send from the owned wallet that holds the most of this token (several wallets can hold it).
    const hold = (await holdingsRead)?.rows.filter((r) => r.catalogId === from.id && r.kind === "wallet" && r.account).sort((a, b) => (units(b.amount, from.decimals) > units(a.amount, from.decimals) ? 1 : -1))[0];
    return ctx.reads.quote({ from: from.id, to: to.id, amount: card.params.amount, slippage: card.params.slippageBps, sender: hold?.account ?? ctx.reads.addresses[from.network], recipient: ctx.reads.addresses[to.network] ?? (["base", "arb", "eth"].includes(to.network) ? ctx.reads.addresses.eth : undefined) }).catch((e: Error) => e);
  })();
  const h = await holdingsRead;
  const held = h ? heldMap(h)[from.id] ?? (h.covered.includes(from.network) ? "0" : null) : null;
  out.balance = held === null ? "not read for this network" : { held, ...(remainingAfter(held, card.params.amount, from.decimals) ?? {}), capturedAt: h?.capturedAt };
  if (!card.params.amount) { out.quote = "needs an amount"; return out; }
  const crossChain = from.network !== "near" || to.network !== "near";
  if (crossChain && ctx.reads.mode === "demo") { out.quote = { none: true, why: "The example workspace has no real wallets, so live cross-chain routes aren't quoted here. Switch to Personal with your own wallets." }; return out; }
  if (crossChain && !ctx.reads.addresses[from.network]) { out.quote = { none: true, why: `No ${net(from.network)} wallet of yours is connected, so there's no route yet. Connecting the wallet that holds the ${from.symbol} gets a live quote on the card.` }; return out; }
  const q = await quoteRead;
  if (q instanceof Error) out.quote = { error: cut(q.message) };
  else if (q) {
    const best = [...q.routes].sort((a, b) => (units(b.output, to.decimals) > units(a.output, to.decimals) ? 1 : -1))[0];
    out.quote = best ? { venue: best.venue, expectedOutput: best.output, minimumReceived: best.minimum, etaSeconds: best.eta, routes: q.routes.length, expiresAt: q.expiresAt, inApp: best.venue === "Rhea / Ref" ? from.network === "near" && to.network === "near" : ["near", "eth", "base", "arb", "bsc", "pol"].includes(from.network) || from.network === "sol" && from.contract === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } : { none: true, why: q.warnings.slice(0, 3).map((w) => cut(w)) };
  }
  return out;
}

export const TOOLS = [
  def({
    name: "get_holdings", label: "Checking your balances",
    description: "The owner's own wallets and positions: asset, network, kind (wallet, supplied, collateral, debt, staking), amount, USD value when priced, coverage. Never includes watched wallets. Set show=true to also put a portfolio card in the chat.",
    input: z.object({ show: z.boolean().default(false), focus: ticker.optional() }).strict(),
    async run(ctx, i) {
      const h = await ctx.reads.holdings();
      const rows = i.focus ? h.rows.filter((r) => r.asset.toUpperCase() === i.focus!.toUpperCase().replace(/^\$/, "")) : h.rows;
      const cards = i.show ? [newCard("portfolio", { capturedAt: h.capturedAt, rows: rows.slice(0, 40), totalUsd: i.focus ? null : h.totalUsd, unvalued: h.unvalued, coverage: h.coverage }, "assistant", [], ctx.now)] : [];
      return { result: { source: ctx.reads.mode === "demo" ? "fictional example" : "live", capturedAt: h.capturedAt, rows: rows.slice(0, 30).map((r) => ({ ...r, network: net(r.network) })), totalUsd: h.totalUsd, unvaluedRows: h.unvalued, coverage: h.coverage, ...(cards[0] ? { cardId: cards[0].id } : {}) }, cards };
    },
  }),
  def({
    name: "get_limits", label: "Reading your limits",
    description: "The owner's policy and commitments: per-action and daily limits (USD), what is left today, max moving cost, protected assets, allowed venues, reserve, holdback for dated payments, cash spendable now and surplus after commitments, and upcoming payments.",
    input: z.object({}).strict(),
    async run(ctx) { return { result: { ...(await ctx.reads.limits()) }, cards: [] }; },
  }),
  def({
    name: "check_limits", label: "Checking your limits",
    description: "Test a hypothetical action against the owner's policy without preparing anything: kind (supply, withdraw, swap, borrow, repay, stake, pay), asset, USD amount. Returns allowed or the exact violations. Set show=true to show a card when it's blocked.",
    input: z.object({ kind: z.enum(["supply", "withdraw", "swap", "borrow", "repay", "stake", "pay"]), asset: ticker, amountUsd: amount, show: z.boolean().default(true) }).strict(),
    async run(ctx, i) {
      const [r, l] = await Promise.all([ctx.reads.checkPolicy(i.kind, i.asset, i.amountUsd), ctx.reads.limits().catch(() => null)]);
      const cards: Card[] = [];
      if (!r.allowed && i.show) {
        const remedies = [
          ...(l && units(i.amountUsd) > units(l.perAction) ? [{ label: `Use ${l.perAction} USD`, prompt: `Do it with ${l.perAction} USD instead` }] : []),
          ...(l?.remainingToday && units(l.remainingToday) > 0n && units(i.amountUsd) > units(l.remainingToday) ? [{ label: `Use what's left today`, prompt: `Do it with ${l.remainingToday} USD instead` }] : []),
          { label: "Show my limits", prompt: "What are my limits and what's left today?" },
        ];
        cards.push(newCard("notice", { tone: "blocked", title: `Your policy blocks this ${i.kind}`, reasons: r.violations.slice(0, 5).map((v) => v.message.slice(0, 240)), remedies: remedies.slice(0, 3) }, "assistant", ["Limits are changed only in Policy, by you."], ctx.now));
      }
      return { result: { ...r, perAction: l?.perAction, daily: l?.daily, ...(cards[0] ? { cardId: cards[0].id } : {}) }, cards };
    },
  }),
  def({
    name: "find_token", label: "Searching tokens",
    description: "Search the swap catalog by ticker or name, optionally on one network. Returns canonical ids (network + contract) and prices.",
    input: z.object({ query: ticker, network: network.optional() }).strict(),
    async run(ctx, i) {
      const q = i.query.toLowerCase().replace(/^\$/, ""), n = networkKey(i.network ?? null);
      const list = (await ctx.reads.catalog()).filter((t) => (!n || t.network === n) && (t.symbol.toLowerCase() === q || t.name.toLowerCase().includes(q) || t.contract.toLowerCase() === q));
      return { result: { matches: list.slice(0, 8).map((t) => ({ id: t.id, symbol: t.symbol, name: cut(t.name, 40), network: net(t.network), contract: t.contract, priceUsd: t.price ?? null })), total: list.length }, cards: [] };
    },
  }),
  def({
    name: "draft_swap", label: "Preparing a swap draft",
    description: "Create an editable swap/bridge card (NEAR Intents or Rhea/Ref) and quote it. Give an amount in the sending token OR in USD, not both. If the asset's network is unclear, the result lists options: ask the owner with ask_choice. Never call this for a question that isn't a request to swap.",
    input: z.object({ from: ticker, fromNetwork: network.optional(), to: ticker, toNetwork: network.optional(), amount: amount.optional(), amountUsd: amount.optional(), slippagePct: z.number().min(0.1).max(5).optional() }).strict(),
    async run(ctx, i) {
      if (i.amount && i.amountUsd) throw new Error("Give amount or amountUsd, not both.");
      const [tokens, h] = await Promise.all([ctx.reads.catalog(), ctx.reads.holdings().catch(() => null)]);
      const held = h ? heldMap(h) : {};
      const a = resolveAsset(tokens, i.from, i.fromNetwork ?? null, held), b = resolveAsset(tokens, i.to, i.toNetwork ?? null, {});
      if (!a.ok || !b.ok) return { result: { needsChoice: true, from: a.ok ? a.token.id : a, to: b.ok ? b.token.id : b }, cards: [] };
      if (a.token.id === b.token.id) throw new Error("Sending and receiving assets are the same.");
      const amt = i.amountUsd ? usdToTokenAmount(i.amountUsd, a.token.price, a.token.decimals) : i.amount ?? null;
      if (i.amountUsd && !amt) return { result: { error: `No current price for ${a.token.symbol}, so a dollar amount can't be converted. Ask for a token amount.` }, cards: [] };
      const notes = [a.assumed && `Sending ${a.assumed}`, i.amountUsd && `$${i.amountUsd} ≈ ${amt} ${a.token.symbol} at $${a.token.price}`].filter(Boolean) as string[];
      const card = newCard("swap", { from: a.token.id, to: b.token.id, amount: amt, amountUsd: i.amountUsd ?? null, priceUsed: i.amountUsd ? a.token.price ?? null : null, slippageBps: Math.round((i.slippagePct ?? 1) * 100) }, "assistant", notes, ctx.now);
      return { result: await swapEvidence(ctx, card, tokens), cards: [card] };
    },
  }),
  def({
    name: "edit_card", label: "Updating the draft",
    description: "Change a card the owner refers to ('make it $5', 'use Base', 'withdraw instead'). Only the listed fields change. A card already handed to a wallet is never changed: a new card is made and the old one keeps its history.",
    input: z.object({
      cardId: z.string().uuid(),
      amount: amount.optional(), amountUsd: amount.optional(),
      from: ticker.optional(), fromNetwork: network.optional(), to: ticker.optional(), toNetwork: network.optional(),
      slippagePct: z.number().min(0.1).max(5).optional(),
      action: z.enum([...LEND_ACTIONS, "stake", "unstake"]).optional(),
      venue: z.string().max(64).optional(),
    }).strict(),
    async run(ctx, i) {
      const card = ownCard(ctx, i.cardId);
      if (i.amount && i.amountUsd) throw new Error("Give amount or amountUsd, not both.");
      const patch: Record<string, unknown> = {}, notes: string[] = [];
      let tokens: SwapToken[] | undefined;
      if (card.kind === "swap") {
        const p = card.params as Card<"swap">["params"];
        tokens = await ctx.reads.catalog();
        const h = await ctx.reads.holdings().catch(() => null);
        for (const side of ["from", "to"] as const) {
          const sym = i[side], netw = side === "from" ? i.fromNetwork : i.toNetwork;
          if (!sym && !netw) continue;
          const current = tokens.find((t) => t.id === p[side]);
          const r = resolveAsset(tokens, sym ?? current?.symbol ?? "", netw ?? (sym ? null : current?.network ?? null), side === "from" && h ? heldMap(h) : {});
          if (!r.ok) return { result: { needsChoice: true, side, ...r }, cards: [] };
          patch[side] = r.token.id;
          if (r.assumed) notes.push(`${side === "from" ? "Sending" : "Receiving"} ${r.assumed}`);
        }
        const fromId = (patch.from as string) ?? p.from, from = tokens.find((t) => t.id === fromId)!;
        if (i.amountUsd) {
          const amt = usdToTokenAmount(i.amountUsd, from.price, from.decimals);
          if (!amt) return { result: { error: `No current price for ${from.symbol}; ask for a token amount.` }, cards: [] };
          Object.assign(patch, { amount: amt, amountUsd: i.amountUsd, priceUsed: from.price ?? null });
          notes.push(`$${i.amountUsd} ≈ ${amt} ${from.symbol} at $${from.price}`);
        } else if (i.amount) Object.assign(patch, { amount: i.amount, amountUsd: null, priceUsed: null });
        else if (patch.from && p.amountUsd) {
          // Same dollar amount, new sending asset: convert again at its own price.
          const amt = usdToTokenAmount(p.amountUsd, from.price, from.decimals);
          Object.assign(patch, { amount: amt, priceUsed: from.price ?? null });
          if (amt) notes.push(`$${p.amountUsd} ≈ ${amt} ${from.symbol} at $${from.price}`);
        }
        if (i.slippagePct) patch.slippageBps = Math.round(i.slippagePct * 100);
      } else if (card.kind === "lend") {
        if (i.action && (LEND_ACTIONS as readonly string[]).includes(i.action)) patch.action = i.action;
        if (i.amount) patch.amount = i.amount;
        if (i.amountUsd) throw new Error("Lending cards take an amount in the asset itself.");
      } else if (card.kind === "stake") {
        if (i.action === "stake" || i.action === "unstake") patch.action = i.action;
        if (i.amount) patch.amount = i.amount;
        if (i.venue) patch.venue = i.venue;
      } else throw new Error(`A ${card.kind} card has nothing to edit.`);
      if (!Object.keys(patch).length) throw new Error("Nothing to change.");
      const { card: updated, created } = editCard(card, patch, "assistant", notes.length ? notes : null, ctx.now);
      const target = created ?? updated;
      const out = [updated, ...(created ? [created] : [])];
      const evidence = target.kind === "swap" ? await swapEvidence(ctx, target as Card<"swap">, tokens)
        : target.kind === "lend" ? { ...cardBrief(target), position: ctx.reads.accountId ? await ctx.reads.lendPosition((target as Card<"lend">).params.tokenId).catch(() => null) ?? "not read" : "no NEAR account connected" }
        : cardBrief(target);
      return { result: { ...evidence, ...(created ? { note: "The earlier card was already sent to a wallet, so this is a new card; the earlier one is unchanged.", previousCardId: card.id } : { previousVersionInvalidated: true }) }, cards: out };
    },
  }),
  def({
    name: "quote_swap", label: "Comparing routes",
    description: "Fresh routes for an existing swap card: expected output, minimum received, venue, expiry, and the remaining balance after it.",
    input: z.object({ cardId: z.string().uuid() }).strict(),
    async run(ctx, i) {
      const c = ownCard(ctx, i.cardId);
      if (c.kind !== "swap") throw new Error("Not a swap card.");
      return { result: await swapEvidence(ctx, c as Card<"swap">), cards: [] };
    },
  }),
  def({
    name: "get_lending", label: "Reading Rhea markets",
    description: "Rhea Lending markets on NEAR (variable supply and borrow APY, utilization, collateral use) and, for one asset, the owner's position there (wallet, supplied, collateral, borrowed, protocol liquidity, health).",
    input: z.object({ symbol: ticker.optional() }).strict(),
    async run(ctx, i) {
      const m = await ctx.reads.markets();
      const sym = i.symbol?.toUpperCase().replace(/^\$/, "");
      const rows = sym ? m.rows.filter((r) => r.symbol.toUpperCase() === sym || (sym === "NEAR" && r.tokenId === "wrap.near")) : m.rows.slice(0, 8);
      const position = sym && rows[0] && ctx.reads.accountId ? await ctx.reads.lendPosition(rows[0].tokenId).catch(() => null) : null;
      return { result: { capturedAt: m.capturedAt, ratesAreVariable: true, markets: rows.slice(0, 8).map((r) => ({ tokenId: r.tokenId, symbol: r.symbol, supplyApy: r.supplyApy, borrowApy: r.borrowApy, utilization: r.utilization, canSupply: r.canSupply, canBorrow: r.canBorrow, collateral: r.collateral })), ...(position ? { position } : {}) }, cards: [] };
    },
  }),
  def({
    name: "draft_lend", label: "Preparing a Rhea draft",
    description: "Create an editable Rhea Lending card: supply, withdraw, borrow, repay, collateral_add or collateral_release, for one asset, with an optional amount in that asset. The owner reviews health, limits and fees on the card before any wallet request.",
    input: z.object({ action: z.enum(LEND_ACTIONS), symbol: ticker, amount: amount.optional() }).strict(),
    async run(ctx, i) {
      const sym = i.symbol.toUpperCase().replace(/^\$/, "");
      const m = await ctx.reads.markets();
      const mk = m.rows.find((r) => (sym === "NEAR" || sym === "WNEAR") ? r.tokenId === "wrap.near" : r.symbol.toUpperCase() === sym);
      if (!mk) return { result: { error: `Rhea has no ${sym} market.`, markets: m.rows.slice(0, 8).map((r) => r.symbol) }, cards: [] };
      if (["supply", "collateral_add"].includes(i.action) && !mk.canSupply) return { result: { error: `Rhea isn't accepting ${sym} deposits now.` }, cards: [] };
      if (i.action === "borrow" && !mk.canBorrow) return { result: { error: `${sym} can't be borrowed on Rhea.` }, cards: [] };
      const [position, limits] = await Promise.all([ctx.reads.accountId ? ctx.reads.lendPosition(mk.tokenId).catch(() => null) : null, ctx.reads.limits().catch(() => null)]);
      const notes: string[] = [];
      const usdc = sym === "USDC";
      if (usdc && i.action === "supply" && limits?.surplus) notes.push(`${limits.surplus} USDC is free after your reserve and dated payments`);
      const card = newCard("lend", { action: i.action, tokenId: mk.tokenId, symbol: sym === "NEAR" ? "NEAR" : mk.symbol, icon: mk.icon, amount: i.amount ?? null, supplyApy: mk.supplyApy, borrowApy: mk.borrowApy }, "assistant", notes, ctx.now);
      return { result: { ...cardBrief(card), market: { supplyApy: mk.supplyApy, borrowApy: mk.borrowApy, utilization: mk.utilization, variable: true, capturedAt: m.capturedAt }, position: position ?? "not read", ...(usdc ? { availableAfterCommitments: limits?.surplus ?? null, holdback: limits?.holdback ?? null } : {}) }, cards: [card] };
    },
  }),
  def({
    name: "get_opportunities", label: "Looking at today's opportunities",
    description: "What the owner could do today: the highest Rhea supply rates right now, the LiNEAR staking rate, tokens trending on DexScreener (liquid ones only, display data, not recommendations), and suggestions built from the owner's holdings (idle stablecoins, NEAR to stake). Use for 'highest yield', 'what are people farming', 'what's trending', 'what should I do today'.",
    input: z.object({}).strict(),
    async run(ctx) {
      const [m, st, h, trend] = await Promise.all([
        ctx.reads.markets().catch(() => null), ctx.reads.staking().catch(() => null), ctx.reads.holdings().catch(() => null),
        fetch("https://api.dexscreener.com/token-boosts/top/v1", { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null),
      ]);
      const topRates = (m?.rows ?? []).filter((r) => r.canSupply && r.supplyApy !== null).sort((a, b) => (b.supplyApy ?? 0) - (a.supplyApy ?? 0)).slice(0, 6).map((r) => ({ symbol: r.symbol, supplyApy: r.supplyApy, utilization: r.utilization, venue: "Rhea Lending (NEAR)" }));
      const linear = st?.options.find((o) => o.venue === "linear")?.apy ?? null;
      const boosted = Array.isArray(trend) ? (trend as { chainId?: string; tokenAddress?: string; description?: string }[]).slice(0, 12).map((t) => ({ chain: String(t.chainId ?? ""), address: String(t.tokenAddress ?? "") })) : [];
      const { todayCards } = await import("./today.ts");
      const held = (h?.rows ?? []).filter((r) => r.kind === "wallet" && r.catalogId).map((r) => ({ tokenId: r.catalogId!, symbol: r.asset, network: r.network, amount: Number(r.amount), usd: r.usd !== null ? Number(r.usd) : null }));
      const cards = todayCards({ holdings: held, rates: (m?.rows ?? []).map((r) => ({ tokenId: r.tokenId, symbol: r.symbol, supplyApy: r.supplyApy })), stakeApy: linear !== null ? Number(linear) : null, held24h: {}, trending: [] });
      return { result: {
        ratesAreVariable: true, capturedAt: m?.capturedAt ?? null, topSupplyRates: topRates, linearStakingApy: linear,
        trendingOnDexScreener: { tokens: boosted, note: "Promoted ('boosted') tokens on DexScreener. Popularity, not safety or a recommendation; FlowVault can't see what other people are farming." },
        forYou: cards.map((c) => ({ title: c.title, detail: c.body, action: c.cta })),
        coverage: "Yields cover Rhea Lending and LiNEAR staking that FlowVault can execute. Other chains' protocols are not read yet.",
      }, cards: [] };
    },
  }),
  def({
    name: "get_staking", label: "Reading staking options",
    description: "Supported NEAR staking (LiNEAR liquid staking, native validators): APY, exit timing, and the owner's staking positions, including amounts that are unstaking or ready to claim.",
    input: z.object({}).strict(),
    async run(ctx) { return { result: { ...(await ctx.reads.staking()) }, cards: [] }; },
  }),
  def({
    name: "draft_stake", label: "Preparing a staking draft",
    description: "Create a staking card: stake NEAR with a supported venue, or start unstaking a position. Claiming finished unstakes happens from the position itself.",
    input: z.object({ action: z.enum(["stake", "unstake"]), amount: amount.optional(), venue: z.string().max(64).optional() }).strict(),
    async run(ctx, i) {
      const st = await ctx.reads.staking();
      const pos = i.action === "unstake" ? st.positions.find((p) => !i.venue || p.venue === i.venue) ?? null : null;
      if (i.action === "unstake" && !pos) return { result: { error: "No staking position to unstake.", positions: st.positions }, cards: [] };
      const venue = i.action === "unstake" ? pos!.venue : i.venue ?? st.options[0]?.venue ?? null;
      const card = newCard("stake", { action: i.action, venue, venueName: st.options.find((o) => o.venue === venue)?.name ?? venue, amount: i.amount ?? null, positionId: pos?.id ?? null, options: st.options.slice(0, 6) }, "assistant", [], ctx.now);
      return { result: { ...cardBrief(card), options: st.options, note: st.note }, cards: [card] };
    },
  }),
  def({
    name: "draft_payment", label: "Matching your payment",
    description: "Create a card for one of the owner's scheduled payments (by label, recipient name or id). FlowVault compares funding sources and the owner approves each step. New recipients are added in Calendar, not here.",
    input: z.object({ match: z.string().trim().min(1).max(100) }).strict(),
    async run(ctx, i) {
      const l = await ctx.reads.limits();
      const q = i.match.toLowerCase();
      const hits = l.upcoming.filter((o) => o.id === i.match || o.label.toLowerCase().includes(q));
      if (hits.length !== 1) return { result: hits.length ? { needsChoice: true, options: hits.slice(0, 5) } : { error: "No scheduled payment matches. Payments are added in Calendar.", upcoming: l.upcoming.slice(0, 5) }, cards: [] };
      const o = hits[0];
      const card = newCard("pay", { obligationId: o.id, label: o.label, amount: o.amount, token: o.token, chain: o.chain, dueDate: o.due }, "assistant", [], ctx.now);
      return { result: cardBrief(card), cards: [card] };
    },
  }),
  def({
    name: "draft_trade", label: "Preparing a trade",
    description: "Create a buy/sell card for a token by its chain and contract address (any DexScreener-listed token), routed through LI.FI with the owner's wallets.",
    input: z.object({ chain: z.string().trim().min(2).max(30), address: z.string().trim().min(20).max(100), symbol: z.string().trim().max(30) }).strict(),
    async run(ctx, i) {
      const card = newCard("trade", { chain: i.chain.toLowerCase(), address: i.address, symbol: i.symbol }, "assistant", [], ctx.now);
      return { result: cardBrief(card), cards: [card] };
    },
  }),
  def({
    name: "research_wallet", label: "Reading the public wallet",
    description: "Public holdings, supported positions and recent activity of any NEAR account or Base/Arbitrum address. Watched balances are never the owner's funds. Shows a research card.",
    input: z.object({ address: z.string().trim().min(2).max(100), network: z.enum(["near", "base", "arb"]).default("near") }).strict(),
    async run(ctx, i) {
      const r = await ctx.reads.research(i.network, i.address);
      const card = newCard("research", { network: i.network, address: i.address }, "assistant", [], ctx.now);
      return { result: { ownership: "watched · not your funds", ...r, cardId: card.id }, cards: [card] };
    },
  }),
  def({
    name: "get_operations", label: "Checking your recent operations",
    description: "The owner's recent wallet operations from FlowVault's journal: kind, state (prepared, awaiting_wallet, submitted, confirmed, failed, partial, unknown), amount, the journal's message (failure reason or outcome) and how many transactions were seen.",
    input: z.object({ limit: z.number().int().min(1).max(10).default(5) }).strict(),
    async run(ctx, i) { return { result: { operations: (await ctx.reads.operations(i.limit)).map((o) => ({ ...o, message: cut(o.message, 300) })) }, cards: [] }; },
  }),
  def({
    name: "get_perps", label: "Checking Hyperliquid",
    description: "Hyperliquid perps status for the owner's proven EVM wallets: funded or not, account value, open positions, whether the FlowVault agent is approved, and what setup is missing. Set show=true to show a perps card.",
    input: z.object({ show: z.boolean().default(false), coin: z.string().max(20).optional() }).strict(),
    async run(ctx, i) {
      const r = await ctx.reads.perps();
      const cards = i.show ? [newCard("perps", { coin: i.coin ?? null }, "assistant", [], ctx.now)] : [];
      return { result: { ...r, ...(cards[0] ? { cardId: cards[0].id } : {}) }, cards };
    },
  }),
  def({
    name: "ask_choice", label: "Asking a question",
    description: "Ask the owner one short question with 2–5 selectable answers when a request is ambiguous (which network, which card, which wallet, what 'half' means). Each option's prompt is what gets sent if they pick it.",
    input: z.object({ question: z.string().trim().min(3).max(200), options: z.array(z.object({ label: z.string().trim().min(1).max(60), prompt: z.string().trim().min(1).max(240), detail: z.string().max(120).optional() })).min(2).max(5) }).strict(),
    async run(ctx, i) {
      const card = newCard("choice", { question: i.question, options: i.options.map((o) => ({ ...o, detail: o.detail ?? null })) }, "assistant", [], ctx.now);
      return { result: { shown: true, cardId: card.id, note: "The owner sees the question and options. Stop here; don't repeat them in text." }, cards: [card] };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];
export const toolByName = new Map<string, (typeof TOOLS)[number]>(TOOLS.map((t) => [t.name, t]));
export const EXAMPLE_SAFE = new Set<string>(TOOLS.map((t) => t.name));

/** Anthropic tool definitions from the registry (JSON Schema from zod; strict inputs). */
export function anthropicTools() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { target: "draft-7" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as { type: "object"; [k: string]: unknown } };
  });
}

/**
 * Run one tool call. Input is validated against the tool's schema first; a malformed or unknown call returns an
 * error result (the model sees it, nothing runs). Tool errors are returned as data, never thrown to the stream.
 */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome & { ok: boolean; label: string }> {
  const tool = toolByName.get(name);
  if (!tool) return { ok: false, label: "", result: { error: "Unknown tool." }, cards: [] };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, label: tool.label, result: { error: "Invalid arguments: " + parsed.error.issues.slice(0, 3).map((x) => x.path.join(".") + " " + x.message).join("; ") }, cards: [] };
  try {
    const out = await (tool.run as (c: ToolContext, i: unknown) => Promise<ToolOutcome>)(ctx, parsed.data);
    for (const c of out.cards) ctx.cards.set(c.id, c);
    return { ok: true, label: tool.label, ...out };
  } catch (e) {
    return { ok: false, label: tool.label, result: { error: cut((e as Error).message, 300) }, cards: [] };
  }
}

/** The cards the model should know about this turn: open drafts first, newest first, compact. */
export function cardsContext(cards: Iterable<Card>) {
  const list = [...cards].filter((c) => !["choice", "notice"].includes(c.kind) && !c.supersededBy).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list.slice(0, 6).map((c) => ({ ...cardBrief(c), editable: !isLocked(c) }));
}
export type { CardKind };
