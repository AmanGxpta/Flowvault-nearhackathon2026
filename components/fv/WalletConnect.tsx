"use client";
// The wallet flow: a Connect dialog (NEAR, Ethereum and Solana wallets found in this browser) and the
// connected-wallet rows shown in the top-right menu, each with its own copy and disconnect buttons.
// Connecting asks for one free signature that proves ownership; it can never move funds.
import { useEffect, useRef } from "react";

export interface ConnectOption {
  key: string;
  name: string;
  icon?: string;
  glyph?: string;
  sub: string;
  connected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export interface ConnectGroup {
  title: string;
  options: ConnectOption[];
  empty?: string;
}
export interface ConnectModalModel {
  open: boolean;
  close: () => void;
  groups: ConnectGroup[];
  pending: { name: string; icon?: string; glyph?: string; hint: string } | null;
  error: string;
  dismissError: () => void;
  demo?: () => void;
}
export interface WalletRow {
  key: string;
  icon?: string;
  glyph?: string;
  title: string;
  sub: string;
  badge?: string;
  onCopy: () => void;
  onDisconnect: () => void;
}

const ink = "var(--fvc-1E2A22)";
const muted = "var(--fvc-6F786B)";
const line = "var(--fvb-E3E6DB)";

function WalletIcon({ icon, glyph, size = 32 }: { icon?: string; glyph?: string; size?: number }) {
  if (icon) return <img src={icon} alt="" width={size} height={size} style={{ borderRadius: size / 4, flexShrink: 0, objectFit: "contain" }} />;
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 4,
        background: "var(--fvb-EEF0E8)",
        color: ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
      }}
    >
      {glyph ?? "◇"}
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: "50%",
        border: "2px solid var(--fvb-DDE1D4)",
        borderTopColor: "var(--fvb-3F6B3C)",
        animation: "fvspin .8s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

export function ConnectWalletModal({ m }: { m: ConnectModalModel }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!m.open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        m.close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [m.open, m]);
  if (!m.open) return null;
  return (
    <div
      onClick={m.close}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(30,42,34,.34)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--fvb-FFFFFF)",
          color: ink,
          borderRadius: 20,
          boxShadow: "0 30px 80px rgba(30,42,34,.25)",
          outline: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "22px 22px 6px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" }}>Connect a wallet</div>
            <div style={{ marginTop: 4, fontSize: 13.5, lineHeight: 1.45, color: muted }}>
              You&apos;ll sign one free message to prove the wallet is yours. It can&apos;t move funds.
            </div>
          </div>
          <button
            type="button"
            onClick={m.close}
            aria-label="Close"
            style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 9, border: `1px solid ${line}`, background: "transparent", color: ink, cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>

        {m.pending ? (
          <div style={{ padding: "26px 22px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
            <WalletIcon icon={m.pending.icon} glyph={m.pending.glyph} size={52} />
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 16, fontWeight: 500 }}>
              <Spinner />
              Waiting for {m.pending.name}…
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: muted, maxWidth: 320 }}>{m.pending.hint}</div>
            <button
              type="button"
              onClick={m.close}
              style={{ marginTop: 6, padding: "9px 16px", borderRadius: 10, border: `1px solid ${line}`, background: "transparent", color: ink, fontSize: 14, cursor: "pointer" }}
              className="fvh5"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ padding: "8px 14px 6px" }}>
            {m.error ? (
              <div
                role="alert"
                style={{ margin: "6px 8px 4px", padding: "10px 12px", borderRadius: 10, background: "var(--fvb-F6E3DE)", color: "var(--fvc-9A3F32)", fontSize: 13, lineHeight: 1.45, display: "flex", gap: 10 }}
              >
                <span style={{ flex: 1 }}>{m.error}</span>
                <button type="button" onClick={m.dismissError} aria-label="Dismiss" style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 14 }}>
                  ×
                </button>
              </div>
            ) : null}
            {m.groups.map((g) => (
              <div key={g.title} style={{ marginTop: 10 }}>
                <div style={{ padding: "0 8px 6px", fontSize: 12, fontWeight: 600, color: muted }}>{g.title}</div>
                {g.options.length ? (
                  g.options.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={o.onClick}
                      disabled={o.disabled}
                      className={o.disabled ? undefined : "fvh5"}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 8px",
                        border: "none",
                        borderRadius: 12,
                        background: "transparent",
                        color: ink,
                        textAlign: "left",
                        cursor: o.disabled ? "default" : "pointer",
                        opacity: o.disabled ? 0.55 : 1,
                      }}
                    >
                      <WalletIcon icon={o.icon} glyph={o.glyph} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14.5, fontWeight: 500 }}>{o.name}</span>
                        {o.sub ? (
                          <span style={{ display: "block", fontSize: 12.5, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</span>
                        ) : null}
                      </span>
                      {o.connected ? (
                        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: "var(--fvb-E2EAD6)", color: "var(--fvc-3F6B3C)" }}>
                          Connected
                        </span>
                      ) : o.disabled ? null : (
                        <span aria-hidden style={{ flexShrink: 0, color: muted, fontSize: 16 }}>
                          ›
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div style={{ padding: "4px 8px 6px", fontSize: 13, color: muted, lineHeight: 1.45 }}>{g.empty}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ margin: "8px 22px 0", padding: "14px 0 18px", borderTop: `1px solid ${line}`, fontSize: 12.5, color: muted, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 180 }}>FlowVault never holds keys. You approve every action in your own wallet.</span>
          {m.demo && !m.pending ? (
            <button type="button" onClick={m.demo} style={{ border: "none", background: "transparent", padding: 0, color: "var(--fvc-3F6B3C)", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
              Just looking? Try Demo Mode →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="fvh5"
      style={{
        width: 30,
        height: 30,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: danger ? "var(--fvc-9A3F32)" : muted,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

/** One connected wallet in the account menu: icon, name, network · wallet, then copy and disconnect. */
export function ConnectedWalletRow({ w }: { w: WalletRow }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px 8px 10px", borderRadius: 10 }}>
      <WalletIcon icon={w.icon} glyph={w.glyph} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: ink }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.title}</span>
          {w.badge ? (
            <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 999, background: "var(--fvb-EEF0E8)", color: muted }}>{w.badge}</span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.sub}</div>
      </div>
      <IconButton label={"Copy address of " + w.title} onClick={w.onCopy}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      </IconButton>
      <IconButton label={"Disconnect " + w.title} onClick={w.onDisconnect} danger>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
          <path d="M14 7l5 5-5 5M19 12H9" />
        </svg>
      </IconButton>
    </div>
  );
}
