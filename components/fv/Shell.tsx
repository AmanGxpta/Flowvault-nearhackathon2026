// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment, useState } from "react";
import { CommandSearch, PortfolioHome, EarnDesk, BorrowDesk, TradeDesk, ResearchDesk, SwapDesk, SendDesk, RiskDesk, ActivityDesk, destinations } from "./WorkspaceViews";
import { MoreHorizontal } from "lucide-react";
import { tc } from "./theme";
import { ThemeToggle } from "./ThemeToggle";
import { ConnectWalletModal, ConnectedWalletRow } from "./WalletConnect";
import { ResearchHub } from "./hub/ResearchHub";
import { NotificationBell, notesFrom } from "./NotificationBell";
import { ConvertNearDialog } from "./ConvertNear";
import { OverviewView } from "./screens/OverviewView";
import { CalendarView } from "./screens/CalendarView";
import { StrategiesView } from "./screens/StrategiesView";
import { ActivityView } from "./screens/ActivityView";
import { PortfolioView } from "./screens/PortfolioView";
import { PolicyView } from "./screens/PolicyView";
import { PayOnADateView } from "./screens/PayOnADateView";
import { ReplaysView } from "./screens/ReplaysView";
import { RoadmapView } from "./screens/RoadmapView";
import { OpportunitiesView } from "./screens/OpportunitiesView";
import { ProtectionView } from "./screens/ProtectionView";
import { LendingVenues } from "./LendingVenues";
import { CreditView } from "./screens/CreditView";
import { AskPanel } from "./chat/AskPanel";
import { WalletSheetView } from "./screens/WalletSheetView";
import { AddObligationView } from "./screens/AddObligationView";
import { SupplyWithdrawView } from "./screens/SupplyWithdrawView";
import { PayView } from "./screens/PayView";
import { ModalShellView } from "./screens/ModalShellView";

export function Shell({ v }: { v: any }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <a href="#fv-main" className="fv-skip">
        Skip to content
      </a>
      <div className={"fv-workspace" + (v.asstOpen ? " fv-asst-docked" : "")}
        style={{
          display: "flex",
          flexDirection: v.shellDir,
          minHeight: "100vh",
          background: "var(--fvb-F6F6F1)",
          position: "relative",
        }}
      >
        {v.notMobile ? (
          <>
            <aside
              style={{
                width: v.asideW,
                flexShrink: "0",
                background: "var(--fvb-EEF0E8)",
                borderRight: "1px solid var(--fvb-E2E5DA)",
                display: "flex",
                flexDirection: "column",
                padding: `22px ${v.asidePadX} 14px`,
                position: "sticky",
                top: "0",
                height: "100vh",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  flexShrink: "0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: v.navJustify,
                  gap: "10px",
                  padding: "0 4px",
                }}
              >
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    flexShrink: "0",
                    borderRadius: "11px",
                    background: "var(--fvb-2B4233)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--fvc-C9E86B)",
                    fontSize: "24px",
                    fontWeight: "600",
                    fontStyle: "italic",
                  }}
                >
                  f
                </div>
                <div
                  style={{
                    display: v.lblDisp,
                    fontSize: "24px",
                    fontWeight: "600",
                    letterSpacing: "-0.04em",
                    color: "var(--fvc-22352A)",
                  }}
                >
                  flowvault
                </div>
              </div>
              <button
                type="button"
                onClick={v.toggleWsMenu}
                title={v.wsName}
                style={{
                  flexShrink: "0",
                  marginTop: "18px",
                  padding: "10px 6px",
                  border: "none",
                  borderTop: "1px solid var(--fvb-E0E3D7)",
                  borderBottom: "1px solid var(--fvb-E0E3D7)",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: v.navJustify,
                  gap: "12px",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--fvc-1E2A22)",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    flexShrink: "0",
                    borderRadius: "10px",
                    background: tc(v.wsInitBg, "bg"),
                    border: "1px solid var(--fvb-D5DEC8)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "600",
                    color: "var(--fvc-2B4233)",
                  }}
                >
                  {v.wsInitial}
                </div>
                <div style={{ display: v.lblDisp, flex: "1", minWidth: "0" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600" }}>{v.wsName}</div>
                  <div style={{ fontSize: "12px", color: "var(--fvc-6F786B)" }}>{v.wsRole}</div>
                </div>
                <svg
                  style={{ display: v.lblDisp, flexShrink: "0" }}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--fvc-4A5349)"
                  strokeWidth="2"
                >
                  <path d="m6 9 6 6 6-6"></path>
                </svg>
              </button>
              <nav
                aria-label="Main"
                style={{
                  flex: "1 1 0",
                  minHeight: "0",
                  overflowY: "auto",
                  overflowX: "hidden",
                  marginTop: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  paddingBottom: "8px",
                }}
              >
                {(v.navGroups || []).map((g: any, i_g_0: number) => (
                  <Fragment key={i_g_0}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: "0" }}>
                      <div style={{ display: v.fullFlex, padding: "0 10px 4px", alignItems: "baseline", gap: "8px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "600",
                            color: "var(--fvc-A0A79A)",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          aria-hidden
                        >
                          •
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            letterSpacing: ".2em",
                            fontWeight: "600",
                            color: "var(--fvc-6F786B)",
                          }}
                        >
                          {g.title}
                        </span>
                      </div>
                      <div
                        style={{
                          display: v.railDivider,
                          height: "1px",
                          background: "var(--fvb-E0E3D7)",
                          margin: "0 8px 6px",
                        }}
                      ></div>
                      {(g.items || []).map((n: any, i_n_1: number) => (
                        <Fragment key={i_n_1}>
                          {n.isStatic ? (
                            <>
                              <div
                                title={`${n.label} · not available yet`}
                                aria-disabled="true"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: v.navJustify,
                                  gap: "12px",
                                  padding: "7px 12px",
                                  fontSize: "13.5px",
                                  color: "var(--fvc-9AA195)",
                                  cursor: "default",
                                }}
                              >
                                <span
                                  style={{ width: "22px", display: "flex", justifyContent: "center", fontSize: "14px" }}
                                >
                                  {(() => { const Item = destinations.find(d => d.label === n.label)?.Icon; return Item ? <Item size={18} /> : n.icon; })()}
                                </span>
                                <span style={{ display: v.lblDisp, flex: "1" }}>{n.label}</span>
                                <span
                                  style={{
                                    display: v.lblDisp,
                                    fontSize: "10px",
                                    letterSpacing: ".06em",
                                    padding: "2px 6px",
                                    borderRadius: "5px",
                                    border: "1px solid var(--fvb-D9DDCF)",
                                    fontWeight: "600",
                                    color: "var(--fvc-8A9285)",
                                  }}
                                >
                                  {n.badge}
                                </span>
                              </div>
                            </>
                          ) : null}
                          {n.isLink ? (
                            <>
                              <button
                                type="button"
                                onClick={n.go}
                                title={n.label}
                                aria-label={n.label}
                                aria-current={n.active ? "page" : undefined}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: v.navJustify,
                                  gap: "12px",
                                  padding: "9px 12px",
                                  border: "none",
                                  borderRadius: "11px",
                                  background: tc(n.bg, "bg"),
                                  color: tc(n.color, "fg"),
                                  fontSize: "14.5px",
                                  fontWeight: n.weight,
                                  cursor: "pointer",
                                  textAlign: "left",
                                  position: "relative",
                                  flexShrink: "0",
                                }}
                                className="fvh1"
                              >
                                <span
                                  style={{
                                    position: "absolute",
                                    left: "0",
                                    top: "9px",
                                    bottom: "9px",
                                    width: "3px",
                                    borderRadius: "3px",
                                    background: tc(n.bar, "bg"),
                                  }}
                                ></span>
                                <span
                                  style={{ width: "22px", display: "flex", justifyContent: "center", fontSize: "15px" }}
                                >
                                  {(() => { const Item = destinations.find(d => d.label === n.label)?.Icon; return Item ? <Item size={18} /> : n.icon; })()}
                                </span>
                                <span style={{ display: v.lblDisp, flex: "1" }}>{n.label}</span>
                                <span
                                  style={{
                                    display: v.lblDisp,
                                    fontSize: "10.5px",
                                    padding: "2px 7px",
                                    whiteSpace: "nowrap",
                                    borderRadius: "999px",
                                    background: tc(n.badgeBg, "bg"),
                                    color: "var(--fvc-8A5F25)",
                                    fontWeight: "600",
                                  }}
                                >
                                  {n.badge}
                                </span>
                              </button>
                            </>
                          ) : null}
                        </Fragment>
                      ))}
                    </div>
                  </Fragment>
                ))}
              </nav>
              <div
                style={{
                  flexShrink: "0",
                  padding: "12px 8px 0",
                  borderTop: "1px solid var(--fvb-E0E3D7)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: v.navJustify,
                  gap: "8px",
                  fontSize: "12.5px",
                  color: "var(--fvc-4A5349)",
                }}
              >
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    flexShrink: "0",
                    borderRadius: "50%",
                    background: "var(--fvb-6E9A5E)",
                  }}
                ></span>
                <span style={{ display: v.lblDisp, flex: "1", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.footNet || "NEAR mainnet"}</span>
                <ThemeToggle size={28} />
              </div>
            </aside>
          </>
        ) : null}
        {v.isMobile ? (
          <>
            <div
              style={{
                position: "sticky",
                top: "0",
                zIndex: "30",
                background: "var(--fvb-EEF0E8)",
                borderBottom: "1px solid var(--fvb-E2E5DA)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "9px",
                    background: "var(--fvb-2B4233)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--fvc-C9E86B)",
                    fontSize: "20px",
                    fontWeight: "600",
                    fontStyle: "italic",
                  }}
                >
                  f
                </div>
                <div
                  style={{
                    flex: "1",
                    fontSize: "20px",
                    fontWeight: "600",
                    letterSpacing: "-0.04em",
                    color: "var(--fvc-22352A)",
                  }}
                >
                  flowvault
                </div>
                <button
                  type="button"
                  onClick={v.toggleWsMenu}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    background: "var(--fvb-FFFFFF)",
                    fontSize: "13px",
                    cursor: "pointer",
                    color: "var(--fvc-1E2A22)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.wsName} ▾
                </button>
                <ThemeToggle size={36} />
              </div>
              <nav aria-label="Main" style={{ display: "none" }}>
                {(v.navFlat || []).map((n: any, i_n_0: number) => (
                  <Fragment key={i_n_0}>
                    <button
                      type="button"
                      onClick={n.go}
                      style={{
                        flexShrink: "0",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 12px",
                        borderRadius: "999px",
                        border: `1px solid ${tc(n.mBorder, "bg")}`,
                        background: tc(n.mBg, "bg"),
                        fontSize: "13.5px",
                        color: "var(--fvc-1E2A22)",
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      <span>{(() => { const Item = destinations.find(d => d.label === n.label)?.Icon; return Item ? <Item size={18} /> : n.icon; })()}</span>
                      <span>{n.label}</span>
                    </button>
                  </Fragment>
                ))}
              </nav>
            </div>
          </>
        ) : null}
        {v.wsMenuOpen ? (
          <>
            <div onClick={v.closeMenu} style={{ position: "fixed", inset: "0", zIndex: "44" }}></div>
            <div
              role="menu"
              style={{
                position: "fixed",
                left: v.wsMenuLeft,
                top: v.wsMenuTop,
                zIndex: "45",
                width: "290px",
                maxWidth: "calc(100vw - 32px)",
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "14px",
                boxShadow: "0 16px 40px rgba(30,42,34,.16)",
                padding: "6px",
              }}
            >
              {(v.wsItems || []).map((it: any, i_it_0: number) => (
                <Fragment key={i_it_0}>
                  <button
                    type="button"
                    onClick={it.onClick}
                    style={{
                      width: "100%",
                      display: "flex",
                      gap: "10px",
                      alignItems: "flex-start",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      borderRadius: "10px",
                      background: "transparent",
                      cursor: "pointer",
                      color: "var(--fvc-1E2A22)",
                    }}
                    className="fvh2"
                  >
                    <span style={{ width: "14px", color: "var(--fvc-3F6B3C)", fontWeight: "600" }}>{it.check}</span>
                    <span style={{ flex: "1" }}>
                      <span style={{ display: "block", fontSize: "14px", fontWeight: "500" }}>{it.t}</span>
                      <span
                        style={{ display: "block", fontSize: "12px", color: "var(--fvc-8A9285)", marginTop: "2px" }}
                      >
                        {it.d}
                      </span>
                    </span>
                  </button>
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
        <main id="fv-main" tabIndex={-1} style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", outline: "none" }}>
          {v.judge ? (
            <>
              <div
                style={{
                  background: "var(--fvb-8A5F25)",
                  color: "var(--fvc-FFF6E8)",
                  padding: `9px ${v.padX}`,
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "13px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: "700", letterSpacing: ".1em", fontSize: "11px", whiteSpace: "nowrap" }}>
                  EXAMPLE WORKSPACE
                </span>
                <span style={{ flex: "1", minWidth: "200px" }}>
                  Fictional data · nothing can be signed. Your personal workspace is separate.
                </span>
                <button
                  type="button"
                  onClick={v.goReplays}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,.4)",
                    background: "transparent",
                    color: "var(--fvc-FFF6E8)",
                    fontSize: "12.5px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open replays →
                </button>
                <button
                  type="button"
                  onClick={v.resetExample}
                  aria-label="Reset the example workspace to its fictional seed"
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,.4)",
                    background: "transparent",
                    color: "var(--fvc-FFF6E8)",
                    fontSize: "12.5px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.resetLabel || "Reset example"}
                </button>
                <button
                  type="button"
                  onClick={v.leaveDemo}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: "var(--fvb-FFF6E8)",
                    color: "var(--fvc-6E4A1A)",
                    fontSize: "12.5px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Leave
                </button>
              </div>
            </>
          ) : null}
          {v.replayOn ? (
            <>
              <div
                style={{
                  background: "var(--fvb-3F5A7A)",
                  color: "var(--fvc-EEF3F9)",
                  padding: `9px ${v.padX}`,
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "13px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: "700", letterSpacing: ".1em", fontSize: "11px" }}>REPLAY</span>
                <span style={{ flex: "1", minWidth: "200px" }}>
                  Running on a frozen copy of this workspace. Closing the dialog restores every figure; the result is
                  kept in Activity as a replay.
                </span>
              </div>
            </>
          ) : null}
          <header
            style={{
              minHeight: "78px",
              borderBottom: "1px solid var(--fvb-E6E8DF)",
              display: "flex",
              alignItems: "center",
              padding: `12px ${v.padX}`,
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                flex: "1 1 180px",
                minWidth: "140px",
                display: "flex",
                gap: "10px",
                fontSize: "15px",
                color: "var(--fvc-8A9285)",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span>Workspace</span>
              <span>/</span>
              <span style={{ color: "var(--fvc-1E2A22)", overflow: "hidden", textOverflow: "ellipsis" }}>
                {v.crumb}
              </span>
            </div>
            <CommandSearch v={v} />
            <button className="fv-button fv-primary" type="button" onClick={v.goPay}>Send ↗</button>
            <button
              type="button"
              onClick={v.openAssistant}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "11px 14px",
                borderRadius: "12px",
                border: "none",
                background: "var(--fvb-2B4233)",
                color: "var(--fvc-EAF0E2)",
                fontSize: "14px",
                fontWeight: "500",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              className="fvh4 fv-ask-trigger"
            >
              <span style={{ color: "var(--fvc-C9E86B)" }}>✦</span>Ask FlowVault
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={v.judgeKnob === "14px"}
              onClick={v.toggleJudge}
              title={v.judgeKnob === "14px" ? "Showing the fictional example workspace. Switch off to return to your own." : "Show the fictional example workspace"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "9px",
                padding: "10px 12px",
                borderRadius: "12px",
                border: `1px solid ${tc(v.judgeBorder, "bg")}`,
                background: tc(v.judgeBg, "bg"),
                color: "var(--fvc-1E2A22)",
                fontSize: "14px",
                fontWeight: "500",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: "28px",
                  height: "16px",
                  flexShrink: "0",
                  borderRadius: "999px",
                  background: tc(v.judgeTrack, "bg"),
                  position: "relative",
                  display: "inline-block",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "2px",
                    left: v.judgeKnob,
                    width: "12px",
                    height: "12px",
                    borderRadius: "50%",
                    background: "var(--fvb-FFFFFF)",
                    transition: "left .15s",
                  }}
                ></span>
              </span>
              Demo Mode
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={v.acctConnectOnly ? v.openConnect : v.toggleAcct}
                aria-haspopup={v.acctConnectOnly ? "dialog" : "menu"}
                aria-expanded={v.acctConnectOnly ? undefined : !!v.acctMenuOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 12px",
                  border: "1px solid var(--fvb-E3E6DB)",
                  background: "var(--fvb-FFFFFF)",
                  borderRadius: "12px",
                  fontSize: "14px",
                  fontWeight: v.acctConnectOnly ? 500 : 400,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  color: "var(--fvc-1E2A22)",
                  maxWidth: "260px",
                }}
                className="fvh5"
              >
                {v.acctIcon ? (
                  <img src={v.acctIcon} alt="" width={18} height={18} style={{ borderRadius: "5px", flexShrink: 0 }} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--fvc-1E2A22)" strokeWidth="1.8" style={{ flexShrink: 0 }}>
                    <rect x="3" y="6" width="18" height="14" rx="2"></rect>
                    <path d="M16 13h2M3 9l13-5v2"></path>
                  </svg>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v.acctLabel}</span>
                {v.acctConnectOnly ? null : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fvc-1E2A22)" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="m6 9 6 6 6-6"></path>
                  </svg>
                )}
              </button>
              {v.acctMenuOpen ? (
                <>
                  <div onClick={v.closeMenu} style={{ position: "fixed", inset: "0", zIndex: "44" }}></div>
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      right: "0",
                      top: "calc(100% + 6px)",
                      zIndex: "45",
                      width: "300px",
                      maxWidth: "calc(100vw - 24px)",
                      maxHeight: "calc(100vh - 90px)",
                      overflowY: "auto",
                      background: "var(--fvb-FFFFFF)",
                      border: "1px solid var(--fvb-E3E6DB)",
                      borderRadius: "14px",
                      boxShadow: "0 16px 40px rgba(30,42,34,.16)",
                      padding: "6px",
                    }}
                  >
                    {/* Network status and Pay or move money live here; Demo Mode is a switch in the header row. */}
                    <div
                      title={v.netLabel}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        padding: "8px 12px",
                        fontSize: "13px",
                        color: tc(v.netColor, "fg"),
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{ width: "6px", height: "6px", flexShrink: "0", borderRadius: "50%", background: tc(v.netColor, "bg") }}
                      ></span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{v.netLabel}</span>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        v.closeMenu?.();
                        v.openIntent();
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        borderRadius: "9px",
                        background: "transparent",
                        fontSize: "14px",
                        cursor: "pointer",
                        color: "var(--fvc-1E2A22)",
                      }}
                      className="fvh5"
                    >
                      ↗ Pay or move money
                    </button>
                    <div style={{ height: "1px", background: "var(--fvb-E6E8DF)", margin: "6px 4px" }}></div>
                    {v.acctWallets ? (
                      <>
                        <div style={{ padding: "8px 12px 4px", fontSize: "12px", fontWeight: 600, color: "var(--fvc-6F786B)" }}>
                          Connected wallets
                        </div>
                        {v.acctWallets.map((w: any) => (
                          <ConnectedWalletRow key={w.key} w={w} />
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={v.openConnect}
                          className="fvh5"
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "9px 10px",
                            marginTop: "2px",
                            border: "none",
                            borderRadius: "10px",
                            background: "transparent",
                            fontSize: "14px",
                            cursor: "pointer",
                            color: "var(--fvc-3F6B3C)",
                            textAlign: "left",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: "28px",
                              height: "28px",
                              flexShrink: 0,
                              borderRadius: "7px",
                              border: "1px dashed var(--fvb-C9D6C1)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "16px",
                            }}
                          >
                            +
                          </span>
                          Connect another wallet
                        </button>
                        {v.acctOffline ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={v.acctOffline.onClick}
                            className="fvh5"
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              border: "none",
                              borderRadius: "9px",
                              background: "transparent",
                              fontSize: "12.5px",
                              cursor: "pointer",
                              color: "var(--fvc-6F786B)",
                              textAlign: "left",
                            }}
                          >
                            {v.acctOffline.label} →
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ padding: "8px 12px 6px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                        {v.acctMenuNote}
                      </div>
                    )}
                    {(v.acctItems || []).map((it: any, i_it_0: number) => (
                      <Fragment key={i_it_0}>
                        {it.heading ? (
                          <div style={{ padding: "10px 12px 4px", fontSize: "11px", letterSpacing: ".12em", fontWeight: 600, color: "var(--fvc-8A9285)" }}>{it.heading}</div>
                        ) : it.divider ? (
                          <div style={{ height: "1px", background: "var(--fvb-E6E8DF)", margin: "6px 4px" }}></div>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={it.onClick}
                            disabled={!!it.disabled}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: it.sub ? "8px 12px" : "10px 12px",
                              border: "none",
                              borderRadius: "9px",
                              background: "transparent",
                              fontSize: "14px",
                              cursor: it.disabled ? "default" : "pointer",
                              color: tc(it.disabled ? "#8A9285" : it.color, "fg"),
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                            className={it.disabled ? undefined : "fvh5"}
                          >
                            {it.icon ? (
                              <img src={it.icon} alt="" width={20} height={20} style={{ borderRadius: "5px", flexShrink: 0 }} />
                            ) : it.glyph ? (
                              <span aria-hidden style={{ width: "20px", textAlign: "center", flexShrink: 0, fontSize: "13px" }}>{it.glyph}</span>
                            ) : null}
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                              {it.sub ? <span style={{ display: "block", fontSize: "12px", color: "var(--fvc-8A9285)", whiteSpace: "normal" }}>{it.sub}</span> : null}
                            </span>
                          </button>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <NotificationBell notes={notesFrom(v)} />
          </header>
          <div className="fv-canvas"
            style={{
              flex: "1",
              padding: `${v.padTop} ${v.padX} 28px`,
              maxWidth: "1280px",
              width: "100%",
              boxSizing: "border-box",
              minWidth: "0",
            }}
          >
            {v.isOverview ? <PortfolioHome v={v} /> : null}
            {v.isCalendar ? <SendDesk key="scheduled" v={v} /> : null}
            {v.isStrategies ? <EarnDesk v={v} /> : null}
            {v.isActivity ? <ActivityDesk v={v} /> : null}
            {v.isPortfolio ? <PortfolioHome v={v} /> : null}
            {v.isHub ? <ResearchHub key={String(!!v.judge) + ":" + v.acc} v={v} /> : null}
            {v.isPolicy ? <RiskDesk v={v} /> : null}
            {v.isPay ? <SendDesk key="send" v={v} /> : null}
            {v.isReplays ? <ReplaysView v={v} /> : null}
            {v.isRoadmap ? <RoadmapView v={v} /> : null}
            {v.isOpps ? <OpportunitiesView v={v} /> : null}
            {v.isProt ? <ProtectionView v={v} /> : null}
            {v.isCredit ? <BorrowDesk v={v} /> : null}
            {v.isTrade ? <TradeDesk v={v} /> : null}
            {v.isSwap ? <SwapDesk v={v} /> : null}
            {v.isResearch ? <ResearchDesk key={v.lendingScope + ":" + v.acc} v={v} /> : null}
          </div>
          <footer
            style={{
              margin: `0 ${v.padX}`,
              padding: "18px 0 24px",
              borderTop: "1px solid var(--fvb-E6E8DF)",
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 16px",
              fontSize: "12.5px",
              color: "var(--fvc-8A9285)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "7px", flex: "1" }}>
              <span
                style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--fvb-6E9A5E)" }}
              ></span>
              {v.footLabel}
            </span>
            <span className="fv-statusbar">
              {v.notConnected && !v.walletLive && <button type="button" className="is-nc" onClick={() => (v.openConnect ?? v.connectFirst)?.()}><small>Wallet</small><b>Not connected</b></button>}
              {(!v.notConnected || v.walletLive) && (v.pfBalances ?? []).slice(0, 2).map((b: any) => <button type="button" key={b.label} onClick={() => v.navigate("portfolio")}><small>{b.label === "Net worth" ? "Portfolio" : b.label}</small><b>{b.value}</b></button>)}
              {(() => { const n = (v.pfRows ?? []).find((r: any) => r.symbol === "NEAR" && (!r.kind || r.kind === "wallet")); return n ? <button type="button" onClick={() => v.navigate("swap")}><small>NEAR</small><b>{n.quantity ?? n.value}</b></button> : null; })()}
              {v.upcoming?.[0] ? <button type="button" onClick={v.goCalendar}><small>Next payment</small><b>{v.upcoming[0].amountF ?? v.upcoming[0].amount} {v.upcoming[0].asset ?? "USDC"} · {v.upcoming[0].dueLabel ?? v.upcoming[0].due}</b></button> : null}
              <button type="button" onClick={v.goPolicy}><small>Guardrails</small><b>On</b></button>
            </span>
          </footer>
        </main>
        <nav className="fv-mobile-nav" aria-label="Primary navigation">
          {destinations.filter(d => ['portfolio','swap','trade','research'].includes(d.id)).map(({id,label,Icon}) => <button key={id} aria-current={v.screen === id ? 'page' : undefined} onClick={() => { setMore(false); v.navigate(id); }}><Icon size={20}/>{label}</button>)}
          <button aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={20}/>More</button>
        </nav>
        {more ? <div className="fv-mobile-more"><strong>More from FlowVault</strong>{v.navFlat.filter((n: any) => !['Portfolio','Swap','Trade','Markets'].includes(n.label)).map((n: any) => <button key={n.label} onClick={() => { setMore(false); n.go(); }}>{n.label} →</button>)}</div> : null}
        {v.asstOpen ? <AskPanel key={v.lendingScope ?? "personal"} v={v} /> : null}
        {v.modalOpen ? <ModalShellView v={v} /> : null}
        {v.connectModal ? <ConnectWalletModal m={v.connectModal} /> : null}
        {v.convertModal?.open ? <ConvertNearDialog m={v.convertModal} /> : null}
        {v.hasToast ? (
          <>
            <div role="status" aria-live="polite"
              style={{
                position: "fixed",
                left: "50%",
                bottom: "28px",
                transform: "translateX(-50%)",
                background: "var(--fvb-1F2A24)",
                color: "var(--fvc-FFFFFF)",
                padding: "13px 20px",
                borderRadius: "12px",
                fontSize: "14px",
                zIndex: "60",
                boxShadow: "0 12px 30px rgba(0,0,0,.2)",
              }}
            >
              {v.toast}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
