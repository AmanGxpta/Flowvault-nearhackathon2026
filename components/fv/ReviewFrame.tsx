"use client";
// The frame around an operation review: a modal over the page on the screens, or inline inside an Ask FlowVault
// card. Only the frame differs; preparation, policy checks, wallet handoff and tracking are the same code.
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function ReviewFrame({ inline, busy, close, className, label, children }: { inline?: boolean; busy: boolean; close: () => void; className: string; label: string; children: ReactNode }) {
  if (inline) return <div className={className + " fv-review-inline"} role="group" aria-label={label}>{children}</div>;
  return createPortal(<div className="fv-dialog-backdrop" onClick={() => { if (!busy) close(); }}>
    <div className={className} role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}>{children}</div>
  </div>, document.body);
}
