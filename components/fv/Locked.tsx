"use client";
// A section that needs a connected wallet: an illustrative preview, blurred and fading out, under a lock card with
// Connect wallet and Try Demo Mode. The preview never holds real figures and can't be focused or clicked.
// Used by Research, Portfolio and the watch features in Markets; Demo Mode never shows it.
import type { ReactNode } from "react";
import { Lock, PlayCircle, Sparkles, Wallet } from "lucide-react";

export function LockedPreview({ label, title, body, preview, connect, demo, compact = false }: {
  label: string;
  title: string;
  body: string;
  preview: ReactNode;
  connect: () => void;
  demo?: () => void;
  compact?: boolean;
}) {
  return <section className={"fv-hub-locked" + (compact ? " is-compact" : "")} aria-label={label}>
    <div className="fv-locked-preview" aria-hidden inert>{preview}</div>
    <div className="fv-lock-card fv-pop" role="region" aria-label={title}>
      <span className="fv-lock-icon"><Lock size={22} /></span>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="fv-lock-actions"><button type="button" className="fv-button fv-primary" onClick={connect}><Wallet size={15} /> Connect wallet</button>{demo && <button type="button" className="fv-button" onClick={demo}><PlayCircle size={15} /> Try Demo Mode</button>}</div>
      {demo && <small><Sparkles size={12} /> Demo Mode shows the full page with a fictional example workspace.</small>}
    </div>
  </section>;
}

/** Illustrative rows for a blurred list preview: symbol, a line of detail, a value. */
export function PreviewRows({ rows }: { rows: [string, string, string][] }) {
  return <div className="fv-panel fv-locked-rows">{rows.map(([a, b, c]) => <div key={a} className="fv-locked-row"><i>{a.slice(0, 1)}</i><span><strong>{a}</strong><small>{b}</small></span><b>{c}</b></div>)}</div>;
}
