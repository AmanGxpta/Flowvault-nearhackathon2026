"use client";
// What the Research page shows before a wallet is connected: public explainers anyone can read, today's live yields
// from public rate reads, and below them a blurred preview of the personal research with a lock and Connect wallet.
// Nothing here reads or needs an account. Demo Mode never shows this; it opens the full page.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, BookOpen, CalendarClock, Check, Layers, Wallet, X, Zap } from "lucide-react";
import { LockedPreview } from "../Locked";
import { PUBLIC_POSTS, type PublicPost } from "@/lib/flowvault/public-research";
import type { YieldRate } from "./YieldsTable";

const pct = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) + "%" : null);

export function PublicResearch({ rates, stakeApy, loading }: { rates: YieldRate[]; stakeApy: number | null; loading: boolean }) {
  const [open, setOpen] = useState<PublicPost | null>(null);
  const usdc = rates.find((r) => r.symbol === "USDC")?.supplyApy ?? null;
  const live = (p: PublicPost) => (p.live === "usdc" ? pct(usdc) && `USDC ${pct(usdc)} today` : p.live === "linear" ? pct(stakeApy) && `LiNEAR ${pct(stakeApy)} today` : null);
  const top = rates.filter((r) => (r.supplyApy ?? 0) >= 0.5 && (r.suppliedUsd ?? 0) >= 1_000_000).sort((a, b) => b.supplyApy! - a.supplyApy!).slice(0, 4);
  const [feature, ...rest] = PUBLIC_POSTS;

  return <section className="fv-public" aria-label="Public research">
    <div className="fv-hub-section-head"><div><h2>Public research</h2><p>Free to read: how the venues work, what the checks protect you from, and today&apos;s live yields. Education, not advice.</p></div></div>
    <div className="fv-public-grid">
      <button type="button" className="fv-post is-feature fv-rise" style={{ ["--i" as string]: 0 }} onClick={() => setOpen(feature)}>
        <span className="fv-post-kicker">{feature.kicker}{live(feature) ? <em>{live(feature)}</em> : null}</span>
        <strong>{feature.title}</strong><p>{feature.summary}</p>
        <span className="fv-post-foot"><BookOpen size={13} /> {feature.minutes} min read <ArrowRight size={13} /></span>
      </button>
      <div className="fv-public-list">{rest.map((p, i) => <button type="button" key={p.id} className="fv-post fv-rise" style={{ ["--i" as string]: i + 1 }} onClick={() => setOpen(p)}>
        <span className="fv-post-kicker">{p.kicker}{live(p) ? <em>{live(p)}</em> : null}</span>
        <strong>{p.title}</strong><span className="fv-post-foot">{p.minutes} min read <ArrowRight size={13} /></span>
      </button>)}</div>
      <aside className="fv-panel fv-public-yields fv-rise" style={{ ["--i" as string]: 4 }} aria-label="Live yields today">
        <h3><span className="fv-live-dot" /> Live yields today</h3>
        <ul>
          {loading && !top.length && [0, 1, 2, 3].map((i) => <li key={i}><div className="fv-skel fv-skel-line" style={{ width: 70 }} /><div className="fv-skel fv-skel-line" style={{ width: 50 }} /></li>)}
          {top.map((r) => <li key={r.token}><span>{r.symbol} <small>Rhea supply</small></span><b>{pct(r.supplyApy)}</b></li>)}
          {stakeApy ? <li><span>NEAR <small>LiNEAR staking</small></span><b>{pct(stakeApy)}</b></li> : null}
        </ul>
        <small className="fv-muted">Variable rates read from Rhea and LiNEAR just now.</small>
      </aside>
    </div>
    {open && <PostReader post={open} usdc={pct(usdc)} linear={pct(stakeApy)} close={() => setOpen(null)} />}
  </section>;
}

function PostReader({ post, usdc, linear, close }: { post: PublicPost; usdc: string | null; linear: string | null; close: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [close]);
  const fill = (t: string) => t.replace("{usdc}", usdc ?? "being read").replace("{linear}", linear ?? "being read");
  return createPortal(<div className="fv-dialog-backdrop fv-fadein" onClick={close}>
    <article className="fv-dialog fv-post-reader fv-pop" role="dialog" aria-modal="true" aria-label={post.title} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>
      <small className="fv-post-kicker">{post.kicker} · {post.minutes} min read · FlowVault research</small>
      <h2>{post.title}</h2>
      <p className="fv-post-lede">{post.summary}</p>
      {post.body.map((b, i) => <div key={i}>{b.h && <h3>{b.h}</h3>}<p>{fill(b.p)}</p></div>)}
      <p className="fv-muted fv-fineprint">Education, not financial advice. Rates are variable and read live; past rates don&apos;t predict future ones.</p>
    </article>
  </div>, document.body);
}

/** The personal research under a lock: an illustrative brief and counts (never real figures), blurred. */
export function LockedResearch({ connect, demo }: { connect: () => void; demo: () => void }) {
  const lines: [string, string][] = [["Portfolio", "≈ $24,310 across 4 chains. Largest: USDC, ETH, NEAR."], ["Cash", "Spendable now $6,200; available after your reserve and payments $2,140."], ["Idle money", "Put $2,140 of idle stablecoins to work at today's best rate."], ["Next 7 days", "1,500 USDC to Payroll on Friday."]];
  return <LockedPreview label="Your research, locked until a wallet is connected" title="Your research is locked" connect={connect} demo={demo}
    body="Connect a wallet to unlock a daily brief built from what you hold, ideas for idle money, strategies, automations and approvals. FlowVault reads balances; it never signs for you."
    preview={<>
      <div className="fv-hub-stats">{([["Active strategies", "3", <Layers key="l" size={16} />], ["Pending approvals", "1", <Check key="c" size={16} />], ["Automations running", "2", <Zap key="z" size={16} />], ["Deployable capital", "$2,140", <Wallet key="w" size={16} />]] as const).map(([label, value, icon]) => <div key={label} className="fv-hub-stat"><span className="fv-hub-stat-icon">{icon}</span><span className="fv-hub-stat-body"><span>{label}</span><strong>{value}</strong><small>this week</small></span></div>)}</div>
      <div className="fv-panel fv-brief"><div className="fv-brief-head"><span className="fv-brief-icon"><CalendarClock size={17} /></span><div><h2>Your brief</h2><small>Every morning at 8:00</small></div></div>
        <ol className="fv-brief-items">{lines.map(([l, t]) => <li key={l} className="fv-brief-item is-good"><span className="fv-brief-label">{l}</span><span className="fv-brief-text">{t}</span><span /></li>)}</ol></div>
    </>} />;
}
