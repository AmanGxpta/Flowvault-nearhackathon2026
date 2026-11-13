// Ask FlowVault conversation API. GET loads this workspace's conversation (cards reconciled with the journals).
// POST op=send streams one assistant turn as NDJSON; op=edit applies the owner's change to a card; op=link ties a
// card to the journal attempt or plan the owner started from it (verified to belong to this session); op=spawn
// adds an owner-made card (e.g. Buy from a researched wallet); op=new starts a fresh conversation.
// The session decides ownership; nothing the client or the model sends is trusted for it.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { env } from "cloudflare:workers";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { chatLatest, chatGet, chatCreate, chatSave, chatUpdate, type Chat, type StoredMessage } from "@/lib/flowvault/chat-store";
import { runChat, fallbackTurn, suggestionsFor, CHAT_DEFAULT_MODEL, type ChatEvent, type ChatClient } from "@/lib/flowvault/chat-agent";
import { liveReads } from "@/lib/flowvault/chat-reads";
import { editCard, newCard, PARAMS, CARD_KINDS, HANDED_OFF, type Card } from "@/lib/flowvault/chat-cards";
import { readAttempt } from "@/lib/flowvault/attempts";
import { planGet } from "@/lib/flowvault/plans-store";
import { proven } from "@/lib/flowvault/account-registry";

function setting(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  return typeof binding === "string" && binding ? binding : process.env[name] || undefined;
}
const modelName = () => setting("ANTHROPIC_MODEL") || CHAT_DEFAULT_MODEL;
const TURN_TIMEOUT_MS = 90_000;

function scoped(s: SessionInfo, c: Chat) {
  if (c.slot !== s.slot) throw new Error("This conversation belongs to another workspace.");
  if (c.account && c.account !== s.account) throw new Error("This conversation belongs to another account.");
}
async function load(s: SessionInfo, id?: string | null) {
  const found = id ? await chatGet(s.id, id) : await chatLatest(s.id);
  if (id && !found) throw new Error("Conversation not found.");
  const cur = found ?? (await chatCreate(s.id, s.slot, s.account));
  scoped(s, cur.chat);
  return cur;
}
/** A failed attempt with no transactions was never sent (declined or never opened): its card stays a retryable draft. */
const attemptState = (a: { state: string; hashes: string[] }) => (a.state === "failed" && !a.hashes.length ? "not_sent" : a.state);
/** Reconcile each linked card with its journal: the attempt's or plan's own state is the only truth. */
async function syncLinks(s: SessionInfo, chat: Chat) {
  let changed = false;
  for (const c of Object.values(chat.cards)) {
    if (!c.link) continue;
    try {
      const state = c.link.attemptId ? attemptState((await readAttempt(s.id, c.link.attemptId)).attempt) : c.link.planId ? (await planGet(s.id, c.link.planId))?.plan.state : undefined;
      if (state && state !== c.link.state) { c.link = { ...c.link, state }; changed = true; }
    } catch { /* not in this session: leave as recorded, it can't be acted on from here */ }
  }
  return changed;
}
async function syncCard(s: SessionInfo, chatId: string, cardId: string) {
  const cur = await chatGet(s.id, chatId);
  const card = cur?.chat.cards[cardId];
  if (!cur || !card?.link) return;
  const one = { ...cur.chat, cards: { [cardId]: card } };
  if (await syncLinks(s, one)) await chatUpdate(s.id, chatId, (c) => { if (c.cards[cardId]) c.cards[cardId].link = card.link; });
}
/** The owner's verified addresses per network, so cards can quote from a wallet even when it holds nothing yet. */
function ownAddresses(s: SessionInfo) {
  if (s.workspace.mode !== "live") return {};
  const evm = (s.workspace.accounts ?? []).find((a) => a.chain === "evm" && proven(a))?.address.toLowerCase();
  return { ...(s.workspace.accountId ? { near: s.workspace.accountId } : {}), ...(evm ? { eth: evm, base: evm, arb: evm } : {}) };
}
function view(s: SessionInfo, chat: Chat) {
  return { addresses: ownAddresses(s), chat: { id: chat.id, messages: chat.messages, cards: chat.cards, pending: !!chat.pending && Date.now() - chat.pending.at < TURN_TIMEOUT_MS }, scope: s.slot, account: s.account, example: s.workspace.mode === "demo", ai: { available: !!setting("ANTHROPIC_API_KEY"), model: modelName() } };
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    let cur = await load(s, new URL(r.url).searchParams.get("id"));
    if (await syncLinks(s, cur.chat)) {
      const rev = await chatSave(s.id, cur.chat, cur.revision);
      if (rev === null) cur = (await chatGet(s.id, cur.chat.id))!;
    }
    return json(view(s, cur.chat), s.cookie);
  } catch (e) {
    return failure(e);
  }
}

const sendSchema = z.object({ op: z.literal("send"), chatId: z.string().uuid().optional(), clientId: z.string().uuid(), text: z.string().trim().min(1).max(2000) }).strict();
const editSchema = z.object({ op: z.literal("edit"), chatId: z.string().uuid(), cardId: z.string().uuid(), version: z.number().int().positive(), patch: z.record(z.string(), z.unknown()) }).strict();
const linkSchema = z.object({ op: z.literal("link"), chatId: z.string().uuid(), cardId: z.string().uuid(), attemptId: z.string().uuid().optional(), planId: z.string().min(8).max(100).optional(), /** The parameters the review was prepared from; applied with the link in one write. */ params: z.record(z.string(), z.unknown()).optional() }).strict();
const spawnSchema = z.object({ op: z.literal("spawn"), chatId: z.string().uuid(), kind: z.enum(CARD_KINDS), params: z.record(z.string(), z.unknown()), note: z.string().max(200).optional() }).strict();
const newSchema = z.object({ op: z.literal("new") }).strict();

export async function POST(r: Request) {
  try {
    mutation(r);
    const body = await r.json() as { op?: string };
    const s = await session(r);
    if (body.op === "new") { newSchema.parse(body); const cur = await chatCreate(s.id, s.slot, s.account); return json(view(s, cur.chat), s.cookie); }
    if (body.op === "edit") {
      const b = editSchema.parse(body);
      await syncCard(s, b.chatId, b.cardId);
      const { chat } = await chatUpdate(s.id, b.chatId, (c) => {
        scoped(s, c);
        const card = c.cards[b.cardId];
        if (!card) throw new Error("Card not found.");
        if (card.version !== b.version) throw Object.assign(new Error("This card changed. Showing the latest version."), { status: 409 });
        const { card: updated, created } = editCard(card, b.patch, "you");
        c.cards[updated.id] = updated;
        if (created) { c.cards[created.id] = created; c.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "That one was already sent to your wallet, so here is a new card with your change.", cardIds: [created.id], createdAt: new Date().toISOString(), status: "complete", provider: { model: null, usedModel: false } }); }
      });
      return json(view(s, chat), s.cookie);
    }
    if (body.op === "link") {
      const b = linkSchema.parse(body);
      if (!!b.attemptId === !!b.planId) throw new Error("Link one attempt or one plan.");
      // The reference must belong to this session's journal: never trusted from the client.
      const state = b.attemptId ? attemptState((await readAttempt(s.id, b.attemptId)).attempt) : (await planGet(s.id, b.planId!))?.plan.state;
      if (!state) throw new Error("Plan not found in this workspace.");
      const current = (await chatGet(s.id, b.chatId))?.chat.cards[b.cardId]?.link;
      // Re-check the card's existing link against its journal: something already handed to a wallet is never replaced.
      const currentState = current?.attemptId ? await readAttempt(s.id, current.attemptId).then((x) => attemptState(x.attempt)).catch(() => current.state) : current?.planId ? (await planGet(s.id, current.planId))?.plan.state ?? current.state : null;
      if (current && currentState && HANDED_OFF.has(currentState) && current.attemptId !== b.attemptId && current.planId !== b.planId)
        throw Object.assign(new Error("This card was already sent to your wallet. Start a new draft to try again."), { status: 409 });
      const { chat } = await chatUpdate(s.id, b.chatId, (c) => {
        scoped(s, c);
        const card = c.cards[b.cardId];
        if (!card) throw new Error("Card not found.");
        if (b.params) {
          const e = editCard(card, b.params, "you");
          if (e.created) throw Object.assign(new Error("This card was already sent to your wallet. Start a new draft to try again."), { status: 409 });
          Object.assign(card, e.card);
        }
        if (card.link && (card.link.attemptId !== b.attemptId || card.link.planId !== b.planId)) card.history = [...card.history, { version: card.version, params: card.params, at: card.link.at, by: card.by, link: card.link }].slice(-10);
        card.link = { ...(b.attemptId ? { attemptId: b.attemptId } : { planId: b.planId }), state, at: new Date().toISOString() };
      });
      return json(view(s, chat), s.cookie);
    }
    if (body.op === "spawn") {
      const b = spawnSchema.parse(body);
      if (!["swap", "trade", "lend", "stake"].includes(b.kind)) throw new Error("Only operation drafts can be added from a card.");
      const card = newCard(b.kind, PARAMS[b.kind].parse(b.params), "you", b.note ? [b.note] : []);
      const { chat } = await chatUpdate(s.id, b.chatId, (c) => {
        scoped(s, c);
        c.cards[card.id] = card;
        c.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", cardIds: [card.id], createdAt: card.createdAt, status: "complete", provider: { model: null, usedModel: false } });
      });
      return json(view(s, chat), s.cookie);
    }
    return send(r, s, sendSchema.parse(body));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 409) return json({ error: (e as Error).message }, undefined, 409);
    return failure(e);
  }
}

async function send(r: Request, s: SessionInfo, b: z.infer<typeof sendSchema>) {
  let cur = await load(s, b.chatId);
  // The journals are the truth: a card whose request reached a wallet is locked before the model can touch it.
  if (await syncLinks(s, cur.chat)) { const rev = await chatSave(s.id, cur.chat, cur.revision); cur = rev === null ? (await chatGet(s.id, cur.chat.id))! : { chat: cur.chat, revision: rev }; }
  const chat = cur.chat;
  // Idempotency: the same message (retry, double click, stream reconnect) never starts a second turn.
  const seen = chat.messages.find((m) => m.clientId === b.clientId);
  if (seen) {
    const reply = chat.messages.find((m) => m.replyTo === seen.id);
    return ndjson([{ type: "replay", chatId: chat.id, user: seen, message: reply ?? null, cards: chat.cards }]);
  }
  if (chat.pending && Date.now() - chat.pending.at < TURN_TIMEOUT_MS) throw new Error("Still answering your previous message. Wait for it or stop it first.");
  const user: StoredMessage = { id: crypto.randomUUID(), role: "user", text: b.text, cardIds: [], clientId: b.clientId, createdAt: new Date().toISOString() };
  const history = chat.messages.filter((m) => m.status !== "error" || m.role === "user").map((m) => ({ role: m.role, text: m.text, cardIds: m.cardIds }));
  chat.messages.push(user);
  chat.pending = { clientId: b.clientId, at: Date.now() };
  const rev = await chatSave(s.id, chat, cur.revision);
  if (rev === null) throw new Error("This conversation changed in another tab. Reload it and try again.");

  const cards = new Map<string, Card>(Object.entries(chat.cards));
  const atStart = new Map<string, string>(Object.entries(chat.cards).map(([id, c]) => [id, JSON.stringify([c.version, c.link, c.supersededBy])]));
  const ctx = { reads: liveReads(s, r), cards, now: Date.now() };
  const encoder = new TextEncoder();
  const abort = new AbortController();
  r.signal?.addEventListener("abort", () => abort.abort());
  const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
  const progress: string[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const write = (o: unknown) => { try { controller.enqueue(encoder.encode(JSON.stringify(o) + "\n")); } catch { /* client went away */ } };
      const emit = (e: ChatEvent) => { if (e.type === "status") progress.push(e.label); write(e); };
      write({ type: "start", chatId: chat.id, user });
      const key = setting("ANTHROPIC_API_KEY");
      let result;
      try {
        if (!key) result = await fallbackTurn(b.text, ctx, emit, "Claude isn't configured on this server, so this answer comes from FlowVault's built-in parser.");
        else {
          const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 }) as unknown as ChatClient;
          result = await runChat({ client, model: modelName(), history, userText: b.text, ctx, emit, signal: abort.signal });
        }
      } catch (e) {
        const message = providerError(e);
        emit({ type: "error", message, retryable: true });
        // Keep FlowVault useful: the built-in parser can still set up common cards (labeled, no AI text).
        result = await fallbackTurn(b.text, ctx, emit, "").catch(() => null);
        result = { text: result?.cardIds.length ? result.text.trim() : "", cardIds: result?.cardIds ?? [], status: "error" as const, error: message, model: null, usedModel: false, shared: [] };
      } finally { clearTimeout(timer); }
      const newCards = result.cardIds.map((id) => cards.get(id)!).filter(Boolean);
      const reply: StoredMessage = {
        id: crypto.randomUUID(), role: "assistant", text: result.text, cardIds: result.cardIds, replyTo: user.id, status: result.status, error: result.error,
        provider: { model: result.model, usedModel: result.usedModel }, shared: result.shared, progress: [...new Set(progress)].slice(0, 8), suggestions: result.status === "complete" ? suggestionsFor(newCards) : [], createdAt: new Date().toISOString(),
      };
      try {
        const { chat: saved } = await chatUpdate(s.id, chat.id, (c) => {
          for (const [id, card] of cards) {
            const prev = c.cards[id];
            const start = atStart.get(id);
            // The turn's version wins unless the owner edited or linked the card while the turn ran.
            const untouched = !prev || JSON.stringify([prev.version, prev.link, prev.supersededBy]) === start;
            if (untouched && (!start || start !== JSON.stringify([card.version, card.link, card.supersededBy]))) c.cards[id] = card;
          }
          c.messages.push(reply);
          c.pending = null;
        });
        write({ type: "done", message: reply, cards: saved.cards });
      } catch (e) {
        write({ type: "error", message: "Couldn't save this answer: " + (e as Error).message, retryable: true });
      }
      controller.close();
    },
    cancel() { abort.abort(); },
  });
  return ndjson(stream, s.cookie);
}

function ndjson(body: ReadableStream | unknown[], cookie?: string) {
  const stream = Array.isArray(body) ? new ReadableStream({ start(c) { for (const o of body) c.enqueue(new TextEncoder().encode(JSON.stringify(o) + "\n")); c.close(); } }) : body;
  const headers: Record<string, string> = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(stream, { headers });
}

/** Provider failures are explained, never shown as an AI answer. */
function providerError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return "Claude rejected this server's API key, so there's no AI answer. Cards and balances still work.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate limited right now. Try again in a moment.";
  if (e instanceof Anthropic.NotFoundError) return `The configured model (${modelName()}) isn't available to this API key.`;
  if (e instanceof Anthropic.BadRequestError) return "Claude refused the request format. Nothing was prepared.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Claude took too long to answer. Try again.";
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return "Claude is temporarily unavailable. Try again shortly.";
  return "Claude was unavailable: " + String((e as Error)?.message ?? e).slice(0, 160);
}
