// Ask FlowVault conversations, stored per workspace row (the signed-in account's workspace, this browser's own,
// or the example workspace) like the journals, so they are scoped to the right owner and move with the account
// when a browser signs in. Revision-checked writes; at most one turn in flight per conversation.
import { database } from "./store";
import type { Card } from "./chat-cards";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cardIds: string[];
  /** The owner's message id (idempotency: a resent message never starts a second turn). */
  clientId?: string;
  replyTo?: string;
  status?: "complete" | "stopped" | "error";
  error?: string;
  provider?: { model: string | null; usedModel: boolean };
  shared?: string[];
  progress?: string[];
  suggestions?: string[];
  createdAt: string;
}
export interface Chat {
  id: string;
  slot: "example" | "personal";
  account: string | null;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
  cards: Record<string, Card>;
  pending: { clientId: string; at: number } | null;
}
const MAX_MESSAGES = 80;
const TABLE = "CREATE TABLE IF NOT EXISTS assistant_chats (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL)";
async function db() {
  const d = await database();
  await d.prepare(TABLE).run();
  return d;
}
export async function chatLatest(sessionId: string) {
  const r = await (await db()).prepare("SELECT payload, revision FROM assistant_chats WHERE session_id=? ORDER BY updated_at DESC LIMIT 1").bind(sessionId).first<{ payload: string; revision: number }>();
  return r ? { chat: JSON.parse(r.payload) as Chat, revision: Number(r.revision) } : null;
}
export async function chatGet(sessionId: string, id: string) {
  const r = await (await db()).prepare("SELECT payload, revision FROM assistant_chats WHERE id=? AND session_id=?").bind(id, sessionId).first<{ payload: string; revision: number }>();
  return r ? { chat: JSON.parse(r.payload) as Chat, revision: Number(r.revision) } : null;
}
export async function chatCreate(sessionId: string, slot: Chat["slot"], account: string | null) {
  const at = new Date().toISOString();
  const chat: Chat = { id: crypto.randomUUID(), slot, account, createdAt: at, updatedAt: at, messages: [], cards: {}, pending: null };
  await (await db()).prepare("INSERT INTO assistant_chats (id, session_id, updated_at, revision, payload) VALUES (?,?,?,0,?)").bind(chat.id, sessionId, Date.now(), JSON.stringify(chat)).run();
  return { chat, revision: 0 };
}
/** Write if nobody else did since `revision`; returns the new revision or null on conflict. */
export async function chatSave(sessionId: string, chat: Chat, revision: number) {
  chat.updatedAt = new Date().toISOString();
  if (chat.messages.length > MAX_MESSAGES) {
    chat.messages = chat.messages.slice(-MAX_MESSAGES);
    const keep = new Set(chat.messages.flatMap((m) => m.cardIds));
    for (const [id, c] of Object.entries(chat.cards)) if (!keep.has(id) && !c.link) delete chat.cards[id];
  }
  const r = await (await db()).prepare("UPDATE assistant_chats SET payload=?, updated_at=?, revision=revision+1 WHERE id=? AND session_id=? AND revision=?").bind(JSON.stringify(chat), Date.now(), chat.id, sessionId, revision).run();
  return r.meta.changes === 1 ? revision + 1 : null;
}
/** Read-modify-write with retries on conflict. `change` may run more than once. */
export async function chatUpdate(sessionId: string, id: string, change: (c: Chat) => void) {
  for (let i = 0; i < 5; i++) {
    const cur = await chatGet(sessionId, id);
    if (!cur) throw new Error("Conversation not found.");
    change(cur.chat);
    const rev = await chatSave(sessionId, cur.chat, cur.revision);
    if (rev !== null) return { chat: cur.chat, revision: rev };
  }
  throw new Error("This conversation is being updated elsewhere. Try again.");
}
