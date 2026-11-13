"use client";
// Ask FlowVault: a conversation with streaming answers and interactive operation cards. The server owns the
// conversation (scoped to this workspace and account); this panel renders it, streams new turns, and passes the
// owner's card actions to the same journals the screens use.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Info, Plus, RotateCcw, Sparkles, Square, X } from "lucide-react";
import type { Card, CardKind } from "@/lib/flowvault/chat-cards";
import type { StoredMessage } from "@/lib/flowvault/chat-store";
import { api, getScope, type Scope } from "../live";
import { ChatCard, type CardEnv } from "./ChatCards";

interface ChatView { id: string; messages: StoredMessage[]; cards: Record<string, Card>; pending: boolean }
interface Loaded { chat: ChatView; example: boolean; ai: { available: boolean; model: string }; addresses?: Record<string, string> }
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

export function AskPanel({ v }: { v: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const scope: Scope = getScope();
  const owner: string = v.acc ?? "";
  const [data, setData] = useState<Loaded | null>(null), [loadError, setLoadError] = useState("");
  const [input, setInput] = useState(""), [live, setLive] = useState<Live | null>(null), [banner, setBanner] = useState("");
  const abort = useRef<AbortController | null>(null), log = useRef<HTMLDivElement | null>(null), pinned = useRef(true), box = useRef<HTMLTextAreaElement | null>(null);
  const chatId = data?.chat.id;

  const load = useCallback(async (id?: string) => {
    try { const r = await api("/api/assistant/chat" + (id ? "?id=" + id : ""), undefined, "GET", scope) as Loaded; setData(r); setLoadError(""); }
    catch (e) { setLoadError((e as Error).message); }
  }, [scope]);
  // The conversation belongs to this workspace and account: reload whenever either changes, so a card from another
  // workspace or account is never on screen to act on.
  useEffect(() => { const t = setTimeout(() => { setData(null); setLive(null); void load(); }, 0); return () => { clearTimeout(t); abort.current?.abort(); }; }, [load, owner, scope]);

  // Keep the newest message in view only while the reader is at the bottom; reading older messages isn't interrupted.
  const onScroll = () => { const el = log.current; if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  useLayoutEffect(() => { const el = log.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; });

  const apply = (r: Loaded) => setData((d) => (d ? { ...d, ...r } : r));
  const post = useCallback(async (body: Record<string, unknown>) => {
    try { const r = await api("/api/assistant/chat", body, "POST", scope) as Loaded; apply(r); return r; }
    catch (e) { setBanner((e as Error).message); await load(chatId); return null; }
  }, [scope, load, chatId]);

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || live || !chatId) return;
    setInput(""); setBanner(""); pinned.current = true;
    const clientId = crypto.randomUUID();
    const ac = new AbortController(); abort.current = ac;
    setLive({ text: "", status: null, cardIds: [], error: null, userText: text });
    try {
      const res = await fetch("/api/assistant/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-FlowVault-Workspace": scope }, body: JSON.stringify({ op: "send", chatId, clientId, text }), signal: ac.signal });
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
  }, [live, chatId, scope, load]);
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
    navigate: (screen: string) => { v.closeAssistant?.(); v.navigate?.(screen); },
  }), [owner, data?.example, data?.addresses, chatId, send, load, post, v]);

  const example = !!data?.example;
  const suggestions = (() => { const m = messages.at(-1); return !live && m?.role === "assistant" && m.status === "complete" ? m.suggestions ?? [] : []; })();
  const empty = !!data && !messages.length && !live;

  return <>
    <div className="fv-ask-scrim" onClick={v.closeAssistant} />
    <div className="fv-ask" role="dialog" aria-label="Ask FlowVault" data-asst-panel="">
      <header className="fv-ask-head">
        <Sparkles size={18} className="fv-ask-mark" />
        <div><strong>Ask FlowVault</strong><small>{example ? "Example workspace · fictional figures" : owner ? "Your wallets, your approvals" : "Public research · connect a wallet for your funds"}</small></div>
        <button type="button" className="fv-icon-button" aria-label="New conversation" title="New conversation" disabled={!!live} onClick={() => void post({ op: "new" }).then(() => setLive(null))}><Plus size={17} /></button>
        <button type="button" className="fv-icon-button" aria-label="Close" onClick={v.closeAssistant}><X size={17} /></button>
      </header>
      <div className="fv-ask-log" ref={log} onScroll={onScroll} aria-live="polite" data-asst-log="">
        {!data && !loadError && <div className="fv-ask-loading"><span /><span /><span /></div>}
        {loadError && <div className="fv-notice" role="alert">{loadError} <button type="button" className="fv-text-button" onClick={() => void load()}>Try again</button></div>}
        {empty && <div className="fv-ask-empty">
          <Sparkles size={26} />
          <h2>What would you like to do?</h2>
          <p>Ask about your funds, compare options, or set up a swap, deposit or withdrawal. You review every operation here and approve it in your own wallet.</p>
          <div className="fv-ask-examples">{(example ? EXAMPLES_DEMO : EXAMPLES_LIVE).map((q) => <button type="button" key={q} onClick={() => void send(q)}>{q}</button>)}</div>
          {data && !data.ai.available && <p className="fv-muted fv-chat-small">Claude isn’t configured on this server. A built-in parser handles swaps, balances and wallet research.</p>}
        </div>}
        {messages.map((m, i) => m.role === "user"
          ? <div key={m.id} className="fv-ask-user">{m.text}</div>
          : <div key={m.id} className="fv-ask-ai">
            {m.status === "error" && <div className="fv-ask-error" role="alert"><span>{m.error ?? "No answer."}</span>{i === messages.length - 1 && lastUser >= 0 && <button type="button" className="fv-text-button" onClick={() => void send(messages[lastUser].text)}><RotateCcw size={13} /> Retry</button>}</div>}
            {m.text && <div className="fv-ask-text"><Prose text={m.text} /></div>}
            {m.status === "stopped" && <small className="fv-muted">Stopped.</small>}
            {m.cardIds.map((id) => { const c = data?.chat.cards[id]; if (!c) return null; return lastMention.get(id) === i ? <ChatCard key={id} card={c} env={{ ...env, answered: i < messages.length - 1 }} /> : <div key={id} className="fv-chat-moved">{c.kind === "choice" ? "" : "Updated below"}</div>; })}
            {(m.shared?.length || m.provider) && <details className="fv-ask-meta"><summary><Info size={12} /> {m.provider?.usedModel ? "Answered by " + (m.provider.model ?? "Claude") : "No AI used"}{m.progress?.length ? " · checked " + m.progress.length : ""}</summary>
              {m.provider?.usedModel ? <p>Shared with Claude: {(m.shared ?? []).join(", ") || "your question"}. Never shared: keys, signatures, other workspaces.</p> : <p>FlowVault’s built-in parser answered; nothing was sent to a model.</p>}
              {!!m.progress?.length && <p>Checked: {m.progress.join(" · ")}</p>}
            </details>}
          </div>)}
        {live && <div className="fv-ask-ai is-live">
          {live.error && <div className="fv-ask-error" role="alert"><span>{live.error}</span></div>}
          {live.text ? <div className="fv-ask-text"><Prose text={live.text} /><span className="fv-ask-caret" /></div> : !live.error && <div className="fv-ask-status"><span className="fv-ask-dots"><i /><i /><i /></span>{live.status ?? "Thinking"}</div>}
          {live.text && live.status && <div className="fv-ask-status"><span className="fv-ask-dots"><i /><i /><i /></span>{live.status}</div>}
          {live.cardIds.map((id) => data?.chat.cards[id] ? <ChatCard key={id} card={data.chat.cards[id]} env={{ ...env, answered: false }} /> : null)}
        </div>}
        {banner && <div className="fv-notice" role="alert">{banner}</div>}
      </div>
      <footer className="fv-ask-foot">
        {!!suggestions.length && <div className="fv-ask-suggest">{suggestions.map((s) => <button type="button" key={s} onClick={() => void send(s)}>{s}</button>)}</div>}
        <form className="fv-ask-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <textarea ref={box} rows={1} value={input} maxLength={2000} placeholder={example ? "Ask about the example workspace" : "Ask, or tell FlowVault what to do"} aria-label="Message Ask FlowVault"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }} />
          {live ? <button type="button" className="fv-ask-send is-stop" aria-label="Stop generating" onClick={stop}><Square size={14} /></button>
            : <button type="submit" className="fv-ask-send" aria-label="Send" disabled={!input.trim() || !chatId}><ArrowUp size={17} /></button>}
        </form>
        <small className="fv-ask-foot-note">FlowVault never signs for you. Answers use live reads; check the card before approving.</small>
      </footer>
    </div>
  </>;
}
