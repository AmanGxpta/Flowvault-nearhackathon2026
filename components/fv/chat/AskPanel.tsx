"use client";
// Ask FlowVault: a conversation with streaming answers and interactive operation cards. The server owns the
// conversation (scoped to this workspace and account); this panel renders it, streams new turns, and passes the
// owner's card actions to the same journals the screens use. It docks beside the page (the page narrows to make
// room) or goes full screen with the conversation history alongside. Without a connected wallet the server allows
// one question; after that the panel asks for a wallet instead of taking more messages.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, History as HistoryIcon, Info, Maximize2, Minimize2, Pencil, RotateCcw, Search, Sparkles, Square, SquarePen, Wallet, X } from "lucide-react";
import type { Card, CardKind } from "@/lib/flowvault/chat-cards";
import type { StoredMessage } from "@/lib/flowvault/chat-store";
import { api, getScope, type Scope } from "../live";
import { ChatCard, type CardEnv } from "./ChatCards";

interface ChatView { id: string; messages: StoredMessage[]; cards: Record<string, Card>; pending: boolean }
interface Loaded { chat: ChatView; example: boolean; ai: { available: boolean; model: string }; addresses?: Record<string, string>; gate?: { connected: boolean; asked: number; allowance: number; questionsLeft: number | null } }
interface Summary { id: string; title: string; updatedAt: string; messages: number }
type Live = { text: string; status: string | null; cardIds: string[]; error: string | null; userText: string };

const EXAMPLES_LIVE = ["What do I hold right now?", "Swap $10 of ETH to NEAR", "What can I do with the USDC I'm not using?", "What is root.near invested in?"];
const EXAMPLES_DEMO = ["What do I hold right now?", "Put my idle USDC to work on Rhea", "Can I supply 6,000 USDC?", "What is root.near invested in?"];

/** Plain text with paragraphs, bullets and **bold**; never HTML from the model. */
function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  return <>{blocks.map((b, i) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""))}</li>)}</ul>;
    return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
  })}</>;
}

function groupByDay(chats: Summary[]) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = start.getTime(), week = today - 6 * 86_400_000;
  const groups: [string, Summary[]][] = [["Today", []], ["Previous 7 days", []], ["Older", []]];
  for (const c of chats) { const t = Date.parse(c.updatedAt); groups[t >= today ? 0 : t >= week ? 1 : 2][1].push(c); }
  return groups.filter(([, list]) => list.length);
}

/** Conversation history with search: the sidebar in full screen, an overlay when docked. */
function HistoryList({ scope, current, busy, open, startNew }: { scope: Scope; current?: string; busy: boolean; open: (id: string) => void; startNew: () => void }) {
  const [q, setQ] = useState(""), [chats, setChats] = useState<Summary[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api("/api/assistant/chat", { op: "list", ...(q.trim() ? { q: q.trim() } : {}) }, "POST", scope)
        .then((r: { chats: Summary[] }) => { if (live) { setChats(r.chats); setError(""); } })
        .catch((e: Error) => { if (live) setError(e.message); });
    }, q ? 220 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, scope, current]);
  return <div className="fv-ask-history">
    <button type="button" className="fv-ask-newchat" disabled={busy} onClick={startNew}><SquarePen size={15} /> New chat</button>
    <label className="fv-ask-search"><Search size={14} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" /></label>
    <div className="fv-ask-history-list">
      {error && <p className="fv-ask-history-empty">{error}</p>}
      {!error && !chats && <div className="fv-ask-loading"><span /><span /><span /></div>}
      {!error && chats && !chats.length && <p className="fv-ask-history-empty">{q ? "No chats mention that." : "Your chats will appear here."}</p>}
      {chats && groupByDay(chats).map(([label, list]) => <section key={label}>
        <h4>{label}</h4>
        {list.map((c) => <button type="button" key={c.id} className={c.id === current ? "is-on" : ""} aria-current={c.id === current ? "true" : undefined} disabled={busy} onClick={() => open(c.id)} title={c.title}>{c.title}</button>)}
      </section>)}
    </div>
  </div>;
}

/** Copy to the clipboard with a brief confirmation on the button. */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="fv-ask-act" aria-label={label} title={done ? "Copied" : label}
    onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}>
    {done ? <Check size={14} /> : <Copy size={14} />}
  </button>;
}

export function AskPanel({ v }: { v: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const scope: Scope = getScope();
  const owner: string = v.acc ?? "";
  const [data, setData] = useState<Loaded | null>(null), [loadError, setLoadError] = useState("");
  const [input, setInput] = useState(""), [live, setLive] = useState<Live | null>(null), [banner, setBanner] = useState("");
  const [full, setFull] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const abort = useRef<AbortController | null>(null), log = useRef<HTMLDivElement | null>(null), pinned = useRef(true), box = useRef<HTMLTextAreaElement | null>(null);
  const chatId = data?.chat.id;

  const load = useCallback(async (id?: string) => {
    try { const r = await api("/api/assistant/chat" + (id ? "?id=" + id : ""), undefined, "GET", scope) as Loaded; setData(r); setLoadError(""); }
    catch (e) { setLoadError((e as Error).message); }
  }, [scope]);
  // The conversation belongs to this workspace and account: reload whenever either changes, so a card from another
  // workspace or account is never on screen to act on.
  // Connecting a wallet lifts the one-question limit: reload so the panel takes messages again.
  useEffect(() => { const t = setTimeout(() => { setData(null); setLive(null); void load(); }, 0); return () => { clearTimeout(t); abort.current?.abort(); }; }, [load, owner, scope, v.notConnected, v.walletLive]);

  // Keep the newest message in view only while the reader is at the bottom; reading older messages isn't interrupted.
  const onScroll = () => { const el = log.current; if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  useLayoutEffect(() => { const el = log.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; });

  const apply = (r: Loaded) => setData((d) => (d ? { ...d, ...r } : r));
  const post = useCallback(async (body: Record<string, unknown>) => {
    try { const r = await api("/api/assistant/chat", body, "POST", scope) as Loaded; apply(r); return r; }
    catch (e) { setBanner((e as Error).message); await load(chatId); return null; }
  }, [scope, load, chatId]);

  // One question without a wallet. The server enforces it for a workspace with no proven wallet; a wallet proven
  // earlier but not connected in this browser right now is held to the same allowance here.
  const walletLive = !!v.walletLive;
  const guest = !!data && !data.example && (!data.gate?.connected || !walletLive);
  const locked = guest && !!data?.gate && data.gate.asked >= data.gate.allowance;
  const send = useCallback(async (raw: string, replaces?: string) => {
    const text = raw.trim();
    if (!text || live || !chatId) return;
    if (locked && !replaces) return;
    if (!replaces) setInput("");
    setEditing(null); setBanner(""); pinned.current = true;
    // An edit restarts the conversation from that question: drop it and everything after it from view.
    if (replaces) setData((d) => { if (!d) return d; const at = d.chat.messages.findIndex((m) => m.id === replaces); return at < 0 ? d : { ...d, chat: { ...d.chat, messages: d.chat.messages.slice(0, at) } }; });
    const clientId = crypto.randomUUID();
    const ac = new AbortController(); abort.current = ac;
    setLive({ text: "", status: null, cardIds: [], error: null, userText: text });
    try {
      const res = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-FlowVault-Workspace": scope }, body: JSON.stringify({ op: "send", chatId, clientId, text, ...(replaces ? { replaces } : {}) }), signal: ac.signal });
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error ?? "Ask FlowVault is unavailable."); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "start") setData((d) => d && { ...d, chat: { ...d.chat, messages: [...d.chat.messages, e.user] } });
          else if (e.type === "text") setLive((l) => l && { ...l, text: l.text + e.delta, status: null });
          else if (e.type === "status") setLive((l) => l && { ...l, status: e.label });
          else if (e.type === "card") { setData((d) => d && { ...d, chat: { ...d.chat, cards: { ...d.chat.cards, [e.card.id]: e.card } } }); setLive((l) => l && { ...l, cardIds: l.cardIds.includes(e.card.id) ? l.cardIds : [...l.cardIds, e.card.id] }); }
          else if (e.type === "error") setLive((l) => l && { ...l, error: e.message });
          else if (e.type === "done") setData((d) => d && { ...d, chat: { ...d.chat, cards: e.cards, messages: [...d.chat.messages, e.message] } });
          else if (e.type === "replay") await load(chatId);
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setBanner((e as Error).message);
    } finally {
      abort.current = null;
      setLive(null);
      // The server saved the stopped or finished turn; show its record.
      await load(chatId);
    }
  }, [live, chatId, scope, load, locked]);
  const stop = () => abort.current?.abort();

  // Questions asked from elsewhere in the app (suggested prompts, example stories) arrive queued.
  const queued = v.asstQueued as { id: string; q: string } | undefined, handled = useRef<string | null>(null);
  useEffect(() => {
    if (!queued || !chatId || live || handled.current === queued.id) return;
    handled.current = queued.id;
    const t = setTimeout(() => void send(queued.q), 0);
    return () => clearTimeout(t);
  }, [queued, chatId, live, send]);
  useEffect(() => { const t = setTimeout(() => box.current?.focus(), 50); return () => clearTimeout(t); }, []);
  // Escape leaves full screen first, then history; the docked panel stays until closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape" || e.defaultPrevented) return; if (historyOpen && !full) setHistoryOpen(false); else if (full) setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, historyOpen]);
  const openChat = (id: string) => { if (live || id === chatId) { setHistoryOpen(false); return; } setHistoryOpen(false); setEditing(null); setBanner(""); pinned.current = true; void load(id); };
  const startNew = () => { if (live) return; setHistoryOpen(false); setEditing(null); setBanner(""); void post({ op: "new" }).then(() => setLive(null)); };

  const messages = data?.chat.messages ?? [];
  const lastUser = messages.reduce((n, m, i) => (m.role === "user" ? i : n), -1);
  // A card lives at its latest mention only (one live copy of each operation); earlier mentions point to it.
  const lastMention = new Map<string, number>();
  messages.forEach((m, i) => m.cardIds.forEach((id) => lastMention.set(id, i)));
  if (live) live.cardIds.forEach((id) => lastMention.set(id, messages.length));
  const env = useMemo<Omit<CardEnv, "answered">>(() => ({
    owner, example: !!data?.example, addresses: data?.addresses ?? {},
    connect: () => (v.openConnect ?? v.connectFirst)?.(),
    send: (t: string) => void send(t),
    refresh: () => load(chatId),
    edit: async (card: Card, patch: Record<string, unknown>) => { const r = await post({ op: "edit", chatId, cardId: card.id, version: card.version, patch }); return r?.chat.cards[card.id] ?? null; },
    link: async (card: Card, ref: { attemptId?: string; planId?: string }, params?: Record<string, unknown>) => { await post({ op: "link", chatId, cardId: card.id, ...ref, ...(params ? { params } : {}) }); },
    spawn: async (kind: CardKind, params: Record<string, unknown>, note?: string) => { pinned.current = true; await post({ op: "spawn", chatId, kind, params, ...(note ? { note } : {}) }); },
    onSettled: () => v.refreshPortfolio?.(),
    // Docked, the page stays visible beside the chat; only a narrow window or full screen gets out of the way.
    navigate: (screen: string) => { setFull(false); if (window.matchMedia("(max-width: 1359px)").matches) v.closeAssistant?.(); v.navigate?.(screen); },
  }), [owner, data?.example, data?.addresses, chatId, send, load, post, v]);

  const example = !!data?.example;
  const suggestions = (() => { const m = messages.at(-1); return !live && m?.role === "assistant" && m.status === "complete" ? m.suggestions ?? [] : []; })();
  const empty = !!data && !messages.length && !live;
  // An earlier question can be edited while nothing after it reached a wallet or a plan (the server checks too).
  const editableFrom = (() => { const cards = data?.chat.cards ?? {}; let from = messages.length; for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].cardIds.some((id) => cards[id]?.link)) break; from = i; } return from; })();
  const subtitle = example ? "Example workspace · fictional figures" : !guest ? "Your wallets, your approvals" : locked ? "Connect a wallet to keep chatting" : "Public research · one question without a wallet";

  return <>
    {!full && <div className="fv-ask-scrim" onClick={v.closeAssistant} />}
    <div className={"fv-askpanel" + (full ? " is-full" : "")} role={full ? "dialog" : "complementary"} aria-modal={full || undefined} aria-label="Ask FlowVault" data-asst-panel="">
      {full && <aside className="fv-ask-side" aria-label="Chat history">
        <div className="fv-ask-side-head"><Sparkles size={16} className="fv-ask-mark" /><strong>Ask FlowVault</strong></div>
        <HistoryList scope={scope} current={chatId} busy={!!live} open={openChat} startNew={startNew} />
      </aside>}
      <div className="fv-ask-main">
      <header className="fv-ask-head">
        {!full && <Sparkles size={18} className="fv-ask-mark" />}
        <div><strong>{full ? (messages.find((m) => m.role === "user")?.text.slice(0, 80) ?? "New chat") : "Ask FlowVault"}</strong><small>{subtitle}</small></div>
        {!full && <button type="button" className={"fv-icon-button" + (historyOpen ? " is-on" : "")} aria-label="Chat history" aria-expanded={historyOpen} title="Chat history" onClick={() => setHistoryOpen((o) => !o)}><HistoryIcon size={17} /></button>}
        {!full && <button type="button" className="fv-icon-button" aria-label="New chat" title="New chat" disabled={!!live} onClick={startNew}><SquarePen size={16} /></button>}
        <button type="button" className="fv-icon-button fv-ask-fullbtn" aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"} onClick={() => { setFull((f) => !f); setHistoryOpen(false); }}>{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button type="button" className="fv-icon-button" aria-label="Close" title="Close" onClick={v.closeAssistant}><X size={17} /></button>
      </header>
      <div className="fv-ask-body">
      {historyOpen && !full && <div className="fv-ask-history-pop"><HistoryList scope={scope} current={chatId} busy={!!live} open={openChat} startNew={startNew} /></div>}
      <div className="fv-ask-log" ref={log} onScroll={onScroll} aria-live="polite" data-asst-log="">
        <div className="fv-ask-col">
        {!data && !loadError && <div className="fv-ask-loading"><span /><span /><span /></div>}
        {loadError && <div className="fv-notice" role="alert">{loadError} <button type="button" className="fv-text-button" onClick={() => void load()}>Try again</button></div>}
        {empty && <div className="fv-ask-empty">
          <Sparkles size={26} />
          <h2>What would you like to do?</h2>
          <p>Ask about your funds, compare options, or set up a swap, deposit or withdrawal. You review every operation here and approve it in your own wallet.</p>
          {!locked && <div className="fv-ask-examples">{(example ? EXAMPLES_DEMO : EXAMPLES_LIVE).map((q) => <button type="button" key={q} onClick={() => void send(q)}>{q}</button>)}</div>}
          {data && !data.ai.available && <p className="fv-muted fv-chat-small">NEAR AI Cloud isn’t configured on this server. A built-in parser handles swaps, balances and wallet research.</p>}
        </div>}
        {messages.map((m, i) => m.role === "user"
          ? editing?.id === m.id
            ? <form key={m.id} className="fv-ask-edit" onSubmit={(e) => { e.preventDefault(); void send(editing.text, m.id); }}>
              <textarea autoFocus rows={2} value={editing.text} maxLength={2000} aria-label="Edit your message" onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setEditing(null); } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(editing.text, m.id); } }} />
              <div><small>Sending restarts the conversation from here.</small><button type="button" className="fv-button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="fv-button fv-primary" disabled={!editing.text.trim() || !!live}>Send</button></div>
            </form>
            : <div key={m.id} className="fv-ask-user-row">
              <div className="fv-ask-user">{m.text}</div>
              <div className="fv-ask-acts">
                <CopyButton text={m.text} label="Copy message" />
                {i >= editableFrom && !live && !guest && <button type="button" className="fv-ask-act" aria-label="Edit message" title="Edit" onClick={() => setEditing({ id: m.id, text: m.text })}><Pencil size={14} /></button>}
              </div>
            </div>
          : <div key={m.id} className="fv-ask-ai">
            {m.status === "error" && <div className="fv-ask-error" role="alert"><span>{m.error ?? "No answer."}</span>{i === messages.length - 1 && lastUser >= 0 && <button type="button" className="fv-text-button" onClick={() => void send(messages[lastUser].text, messages[lastUser].id)}><RotateCcw size={13} /> Retry</button>}</div>}
            {m.text && <div className="fv-ask-text"><Prose text={m.text} /></div>}
            {m.status === "stopped" && <small className="fv-muted">Stopped.</small>}
            {m.cardIds.map((id) => { const c = data?.chat.cards[id]; if (!c) return null; return lastMention.get(id) === i ? <ChatCard key={id} card={c} env={{ ...env, answered: i < messages.length - 1 }} /> : <div key={id} className="fv-chat-moved">{c.kind === "choice" ? "" : "Updated below"}</div>; })}
            {(m.text || m.shared?.length || m.provider) && <div className="fv-ask-ai-foot">
              {m.text && <CopyButton text={m.text} label="Copy response" />}
              {(m.shared?.length || m.provider) && <details className="fv-ask-meta"><summary><Info size={12} /> {m.provider?.usedModel ? "Answered by " + (m.provider.model ?? "NEAR AI Cloud") : "No AI used"}{m.progress?.length ? " · checked " + m.progress.length : ""}</summary>
                {m.provider?.usedModel ? <p>Shared with NEAR AI Cloud: {(m.shared ?? []).join(", ") || "your question"}. Never shared: keys, signatures, other workspaces.</p> : <p>FlowVault’s built-in parser answered; nothing was sent to a model.</p>}
                {!!m.progress?.length && <p>Checked: {m.progress.join(" · ")}</p>}
              </details>}
            </div>}
          </div>)}
        {live && <div className="fv-ask-ai is-live">
          {live.error && <div className="fv-ask-error" role="alert"><span>{live.error}</span></div>}
          {live.text ? <div className="fv-ask-text"><Prose text={live.text} /><span className="fv-ask-caret" /></div> : !live.error && <div className="fv-ask-status"><span className="fv-ask-dots"><i /><i /><i /></span>{live.status ?? "Thinking"}</div>}
          {live.text && live.status && <div className="fv-ask-status"><span className="fv-ask-dots"><i /><i /><i /></span>{live.status}</div>}
          {live.cardIds.map((id) => data?.chat.cards[id] ? <ChatCard key={id} card={data.chat.cards[id]} env={{ ...env, answered: false }} /> : null)}
        </div>}
        {banner && <div className="fv-notice" role="alert">{banner}</div>}
        </div>
      </div>
      <footer className="fv-ask-foot">
        <div className="fv-ask-col">
        {locked && !live ? <div className="fv-ask-gate" role="status">
          <span className="fv-ask-gate-icon"><Wallet size={18} /></span>
          <div><strong>Connect a wallet to keep chatting</strong><p>You’ve used the question you get without a wallet. Connecting only reads your balances; FlowVault never signs for you.</p></div>
          <div className="fv-ask-gate-actions">
            <button type="button" className="fv-button fv-primary" onClick={() => (v.openConnect ?? v.connectFirst)?.()}><Wallet size={15} /> Connect wallet</button>
            {v.toggleJudge && <button type="button" className="fv-text-button" onClick={v.toggleJudge}>Try Demo Mode</button>}
          </div>
        </div> : <>
          {!!suggestions.length && !locked && <div className="fv-ask-suggest">{suggestions.map((s) => <button type="button" key={s} onClick={() => void send(s)}>{s}</button>)}</div>}
          <form className="fv-ask-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea ref={box} rows={1} value={input} maxLength={2000} placeholder={example ? "Ask about the example workspace" : "Ask, or tell FlowVault what to do"} aria-label="Message Ask FlowVault"
              onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }} />
            {live ? <button type="button" className="fv-ask-send is-stop" aria-label="Stop generating" onClick={stop}><Square size={14} /></button>
              : <button type="submit" className="fv-ask-send" aria-label="Send" disabled={!input.trim() || !chatId}><ArrowUp size={17} /></button>}
          </form>
          <small className="fv-ask-foot-note">{guest ? "One question without a wallet; connect one to keep chatting. " : ""}FlowVault never signs for you. Answers use live reads; check the card before approving.</small>
        </>}
        </div>
      </footer>
      </div>
      </div>
    </div>
  </>;
}
