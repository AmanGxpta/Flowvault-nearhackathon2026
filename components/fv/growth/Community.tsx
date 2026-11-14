"use client";
// Community on the dashboard: today's tips from other FlowVault users (each points at something FlowVault can do,
// never an outside link), upvotes and "use" that credit the author, sharing your own tip, and your points and invite
// link with a shareable card. Points record contribution; they aren't money. Demo Mode shows fictional tips.
import { useEffect, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Copy, Gift, Lightbulb, Share2 } from "lucide-react";
import { api } from "../live";
import { ago } from "../swap-format";
import { ShareCard } from "../WorkspaceViews";
import type { Tip, TipAction } from "@/lib/flowvault/growth";

interface Me { code: string; points: number; invited: number; invitedBy: string | null }
interface Read { tips: Tip[]; me: Me | null; rules: { tip: number; upvote: number; used: number; invite: number; welcome: number }; feeShare: { bps: number; text: string } }
const REF_KEY = "fv-invite-code";
const short = (a: string) => (a.length > 18 ? a.slice(0, 8) + "…" + a.slice(-6) : a);
const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const DEMO: Read = {
  tips: [
    { id: "d1", author: "maya.near", title: "Rhea USDt supply is above 9% today", detail: "Utilization is around 84%, so the rate may drop as people supply. Worth it for idle USDT.", action: { kind: "supply", tokenId: "usdt.tether-token.near", symbol: "USDt" }, createdAt: at(3), votes: 14, used: 6 },
    { id: "d2", author: "0x7a3…c19e", title: "LiNEAR staking stays liquid", detail: "If you hold NEAR long term, LiNEAR earns staking yield and you can still swap out.", action: { kind: "stake" }, createdAt: at(9), votes: 9, used: 3 },
    { id: "d3", author: "jun.near", title: "SOL dipped 6% overnight", detail: "Some are buying back in. Check liquidity before a big order.", action: { kind: "swap", to: "sol:native", symbol: "SOL" }, createdAt: at(14), votes: 4, used: 1 },
  ],
  me: { code: "example1", points: 120, invited: 3, invitedBy: null },
  rules: { tip: 10, upvote: 2, used: 5, invite: 25, welcome: 25 },
  feeShare: { bps: 0, text: "Fee share is off: FlowVault charges no fee today, so there's nothing to share." },
};

/** `compact` starts as one strip that cycles through the top tips with your points; it opens into the full view. */
export function Community({ example, signedIn, navigate, compact = false }: { example: boolean; signedIn: boolean; navigate: (screen: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact), [idx, setIdx] = useState(0), [paused, setPaused] = useState(false);
  const [data, setData] = useState<Read | null>(example ? DEMO : null), [error, setError] = useState(""), [sharing, setSharing] = useState(false), [card, setCard] = useState(false), [note, setNote] = useState("");
  const load = () => api("/api/growth", undefined, "GET").then((r) => setData(r as Read)).catch((e) => setError((e as Error).message));
  useEffect(() => { if (example) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [example, signedIn]);  
  // Invite links: ?ref=CODE is remembered in this browser and used once you're signed in.
  useEffect(() => {
    const url = new URL(window.location.href), ref = url.searchParams.get("ref");
    if (ref && /^[a-z0-9]{8}$/i.test(ref)) { try { localStorage.setItem(REF_KEY, ref.toLowerCase()); } catch { /* storage blocked */ } url.searchParams.delete("ref"); history.replaceState(null, "", url); }
  }, []);
  useEffect(() => {
    if (example || !data?.me || data.me.invitedBy) return;
    let code: string | null = null; try { code = localStorage.getItem(REF_KEY); } catch { /* storage blocked */ }
    if (!code || code === data.me.code) return;
    api("/api/growth", { op: "invite", code }).then(() => { try { localStorage.removeItem(REF_KEY); } catch { /* */ } setNote(`Invite applied: you and your inviter each got ${data.rules.welcome} points.`); void load(); }).catch(() => { try { localStorage.removeItem(REF_KEY); } catch { /* */ } });
  }, [data?.me?.code]); // eslint-disable-line react-hooks/exhaustive-deps -- once per signed-in account

  const go = (a: TipAction) => {
    const url = new URL(window.location.href);
    for (const k of ["supply", "swap", "tab", "sflow", "flow", "buy"]) url.searchParams.delete(k);
    if (a.kind === "supply") { url.searchParams.set("tab", "supply"); url.searchParams.set("supply", a.tokenId); history.replaceState(null, "", url); navigate("earn"); }
    else if (a.kind === "swap") { url.searchParams.set("buy", a.to); history.replaceState(null, "", url); navigate("swap"); window.dispatchEvent(new Event("fv-prefill")); }
    else { url.searchParams.set("tab", "stake"); history.replaceState(null, "", url); navigate("earn"); }
  };
  const mark = async (t: Tip, kind: "vote" | "used") => {
    if (example) { setData((d) => d && { ...d, tips: d.tips.map((x) => x.id === t.id ? { ...x, votes: x.votes + (kind === "vote" && !x.voted ? 1 : 0), voted: kind === "vote" ? true : x.voted } : x) }); if (kind === "used") go(t.action); return; }
    if (kind === "used") go(t.action);
    if (!signedIn || t.mine) return;
    await api("/api/growth", { op: kind, id: t.id }).catch(() => null); void load();
  };
  const tipCount = Math.min(data?.tips.length ?? 0, 5);
  useEffect(() => {
    if (open || paused || tipCount < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % tipCount), 6000); return () => clearInterval(t);
  }, [open, paused, tipCount]);
  if (!data) return error || !compact ? null : <div className="fv-panel fv-community-strip" aria-hidden><div className="fv-skel" style={{ width: 34, height: 34 }} /><div style={{ flex: 1 }}><div className="fv-skel fv-skel-line" style={{ width: 120, height: 10 }} /><div className="fv-skel fv-skel-line" style={{ width: "60%" }} /></div></div>;
  const link = data.me ? `${window.location.origin}/?ref=${data.me.code}` : "";
  const label = (a: TipAction) => a.kind === "supply" ? `Supply ${a.symbol}` : a.kind === "swap" ? `Buy ${a.symbol}` : "Stake NEAR";

  if (!open) {
    const tip = data.tips[idx % Math.max(tipCount, 1)];
    return <section className="fv-panel fv-community-strip fv-rise" aria-label="Community" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="fv-strip-icon"><Lightbulb size={16} /></span>
      {tip ? <div className="fv-strip-tip" key={tip.id} aria-live="polite">
        <small>Community tip{example ? " · example" : ""} · <ChevronUp size={11} />{tip.votes}{tip.used ? ` · used by ${tip.used}` : ""}</small>
        <strong>{tip.title}</strong>
      </div> : <div className="fv-strip-tip"><small>Community{example ? " · example" : ""}</small><strong>No tips today yet. Share what you&apos;re seeing.</strong></div>}
      {tip && <button type="button" className="fv-text-button" onClick={() => void mark(tip, "used")}>{label(tip.action)} <ArrowRight size={13} /></button>}
      {tipCount > 1 && <span className="fv-strip-dots" aria-hidden>{Array.from({ length: tipCount }, (_, i) => <i key={i} className={i === idx % tipCount ? "is-on" : ""} />)}</span>}
      {data.me && <button type="button" className="fv-points-badge" onClick={() => setOpen(true)} aria-label={`${data.me.points} points: open community and invites`}><Gift size={13} /> {data.me.points.toLocaleString()} pts</button>}
      <button type="button" className="fv-button" onClick={() => { setOpen(true); if (!tip) setSharing(true); }}>{tip ? `All tips` : "Share a tip"} <ChevronDown size={13} /></button>
    </section>;
  }
  return <section className={"fv-community" + (compact ? " fv-fadein" : "")} aria-label="Community">
    <div className="fv-panel fv-community-tips">
      <div className="fv-section-head"><div><h2><Lightbulb size={16} /> Tips from the community{example ? " · example" : ""}</h2><small className="fv-muted">Shared by FlowVault users. Unverified ideas, not advice; each opens the action in FlowVault for your own review.</small></div>
        <span className="fv-actions"><button type="button" className="fv-button" onClick={() => setSharing(!sharing)}>Share a tip</button>{compact && <button type="button" className="fv-icon-button" aria-label="Show less" onClick={() => { setOpen(false); setSharing(false); }}><ChevronUp size={16} /></button>}</span></div>
      {sharing && <TipForm example={example} signedIn={signedIn} rules={data.rules} done={(t) => { setSharing(false); if (t) { if (example) setData((d) => d && { ...d, tips: [{ ...t, id: "local-" + Date.now(), author: "you (example)", createdAt: new Date().toISOString(), votes: 0, used: 0, mine: true }, ...d.tips] }); else void load(); } }} />}
      {!data.tips.length && <p className="fv-muted">No tips yet today. Share the first one.</p>}
      <ol className="fv-tip-list">{data.tips.slice(0, 5).map((t) => <li key={t.id}>
        <button type="button" className={"fv-tip-vote" + (t.voted ? " is-on" : "")} disabled={t.mine || (!signedIn && !example)} aria-label="Upvote" onClick={() => void mark(t, "vote")}><ChevronUp size={15} /><span>{t.votes}</span></button>
        <div className="fv-tip-body"><strong>{t.title}</strong>{t.detail && <p>{t.detail}</p>}<small>{t.mine ? "you" : short(t.author)} · {ago(t.createdAt)}{t.used ? ` · used by ${t.used}` : ""}</small></div>
        <button type="button" className="fv-text-button fv-tip-use" onClick={() => void mark(t, "used")}>{label(t.action)} <ArrowRight size={13} /></button>
      </li>)}</ol>
    </div>
    {(data.me || example) && data.me && <div className="fv-panel fv-community-me">
      <div className="fv-section-head"><h2><Gift size={16} /> Your points</h2><strong className="fv-points">{data.me.points.toLocaleString()}</strong></div>
      <p className="fv-muted">Earn {data.rules.tip} for a tip, {data.rules.upvote} per upvote, {data.rules.used} each time someone uses it, and {data.rules.invite} for each person you invite (they get {data.rules.welcome} too). Points record what you contribute; they aren&apos;t money.</p>
      <label className="fv-invite">Your invite link<span><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="fv-icon-button" aria-label="Copy invite link" onClick={() => { try { void navigator.clipboard.writeText(link); setNote("Invite link copied."); } catch { /* clipboard blocked */ } }}><Copy size={14} /></button></span></label>
      <div className="fv-community-row"><span>{data.me.invited} {data.me.invited === 1 ? "person" : "people"} joined with your link</span><button type="button" className="fv-button" onClick={() => setCard(true)}><Share2 size={14} /> Share card</button></div>
      <small className="fv-muted">{data.feeShare.text}</small>
      {note && <p className="fv-notice" role="status">{note}</p>}
    </div>}
    {!data.me && !example && <div className="fv-panel fv-community-me"><h2><Gift size={16} /> Points and invites</h2><p className="fv-muted">Sign in with your NEAR wallet to share tips, earn points and get your invite link.</p></div>}
    {card && data.me && <ShareCard title="Run your crypto with a plan" subtitle="Join me on FlowVault" lines={["Every chain and wallet in one place", "Swap, earn and send in one flow", "Nothing moves without your approval"]} example={example} link={link} linkLabel="Copy invite link" linkNote="Invite link copied. Anyone who joins with it and signs in counts as your invite." close={() => setCard(false)} />}
  </section>;
}

function TipForm({ example, signedIn, rules, done }: { example: boolean; signedIn: boolean; rules: Read["rules"]; done: (t: Omit<Tip, "id" | "author" | "createdAt" | "votes" | "used"> | null) => void }) {
  const [title, setTitle] = useState(""), [detail, setDetail] = useState(""), [kind, setKind] = useState<"supply" | "stake" | "swap">("supply"), [market, setMarket] = useState(""), [token, setToken] = useState("");
  const [markets, setMarkets] = useState<{ token: string; symbol: string }[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { fetch("/api/rates").then((r) => r.json() as Promise<{ rows?: { token: string; symbol: string; canSupply: boolean }[] }>).then((b) => setMarkets((b.rows ?? []).filter((r) => r.canSupply).map((r) => ({ token: r.token, symbol: r.symbol })))).catch(() => {}); }, []);
  const action: TipAction | null = kind === "stake" ? { kind: "stake" } : kind === "supply" ? (market ? { kind: "supply", tokenId: market, symbol: markets.find((m) => m.token === market)?.symbol ?? "" } : null) : (/^[a-z0-9_-]{2,30}:[A-Za-z0-9._-]{2,90}$/.test(token) ? { kind: "swap", to: token, symbol: token.split(":")[1].slice(0, 12) } : null);
  async function submit() {
    if (!action) return setError(kind === "swap" ? "Enter the token as network:contract (e.g. sol:native)." : "Choose the market.");
    setBusy(true); setError("");
    try {
      if (!example) await api("/api/growth", { op: "tip", title, detail, action });
      done({ title, detail, action });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!signedIn && !example) return <p className="fv-muted">Sign in with your NEAR wallet to share a tip.</p>;
  return <div className="fv-tip-form">
    <label>What&apos;s happening<input value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rhea USDt supply is above 9% today" /></label>
    <label>Why it matters (optional)<textarea value={detail} maxLength={280} onChange={(e) => setDetail(e.target.value)} placeholder="No links: point the tip at an action below." /></label>
    <div className="fv-tip-kind" role="radiogroup" aria-label="What the tip points at">{(["supply", "stake", "swap"] as const).map((k) => <button type="button" role="radio" aria-checked={kind === k} key={k} onClick={() => setKind(k)}>{k === "supply" ? "A Rhea market" : k === "stake" ? "Staking NEAR" : "A token"}</button>)}</div>
    {kind === "supply" && <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Rhea market"><option value="">Choose a market</option>{markets.map((m) => <option key={m.token} value={m.token}>{m.symbol}</option>)}</select>}
    {kind === "swap" && <input value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="Token id, e.g. sol:native or base:0x…" aria-label="Token id" />}
    {error && <p className="fv-notice" role="alert">{error}</p>}
    <div className="fv-actions"><button type="button" className="fv-button" onClick={() => done(null)}>Cancel</button><button type="button" className="fv-button fv-primary" disabled={busy || title.trim().length < 8} onClick={() => void submit()}>Share tip · +{rules.tip} points{example ? " (example)" : ""}</button></div>
  </div>;
}
