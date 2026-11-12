// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { Skel } from "../Skel";
import { tc } from "../theme";

// Design section: OVERVIEW
export function OverviewView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          {v.layerEyebrow}
        </span>
        <span
          style={{
            fontSize: "11px",
            letterSpacing: ".08em",
            fontWeight: "600",
            padding: "4px 8px",
            borderRadius: "6px",
            whiteSpace: "nowrap",
            background: tc(v.dataTagBg, "bg"),
            color: tc(v.dataTagColor, "fg"),
          }}
        >
          {v.dataTag}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "16px 24px", marginTop: "14px", flexWrap: "wrap" }}>
        <div style={{ flex: "1", minWidth: "260px" }}>
          <h1
            style={{
              margin: "0",
              fontSize: "clamp(34px,6vw,52px)",
              fontWeight: "500",
              letterSpacing: "-0.04em",
              lineHeight: "1.05",
            }}
          >
            {v.headline}
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: "16.5px", color: "var(--fvc-5B6458)" }}>
            Keep every dated payment covered. Put only the surplus to work.
          </p>
        </div>
        <div
          style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--fvc-6F786B)" }}
        >
          {v.planLabel}
        </div>
      </div>
      {v.showOnboarding ? (
        <>
          <div
            style={{
              marginTop: "34px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))",
              gap: "24px",
            }}
          >
            <div
              style={{
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "20px",
                padding: "34px",
              }}
            >
              <div style={{ fontSize: "12px", letterSpacing: ".2em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
                START YOUR PLAN
              </div>
              <h2 style={{ margin: "12px 0 6px", fontSize: "30px", fontWeight: "500", letterSpacing: "-0.03em" }}>
                Tell FlowVault what your money has to do.
              </h2>
              <p
                style={{
                  margin: "0",
                  color: "var(--fvc-5B6458)",
                  fontSize: "15px",
                  lineHeight: "1.6",
                  textWrap: "pretty",
                }}
              >
                Your reserve and dated payments decide how much is surplus. Nothing is supplied, paid or signed without
                your review.
              </p>
              <div style={{ marginTop: "26px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "14px 16px",
                    alignItems: "center",
                    padding: "18px",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "14px",
                    background: tc(v.onb.s1.bg, "bg"),
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      flexShrink: "0",
                      borderRadius: "50%",
                      background: tc(v.onb.s1.dotBg, "bg"),
                      color: tc(v.onb.s1.dotColor, "fg"),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "600",
                      fontSize: "14px",
                    }}
                  >
                    {v.onb.s1.glyph}
                  </div>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <div style={{ fontWeight: "600", fontSize: "15.5px" }}>Connect or watch a wallet</div>
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                      {v.onb.s1.sub}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={v.connectFirst}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "none",
                      background: "var(--fvb-2A4034)",
                      color: "var(--fvc-FFFFFF)",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Connect wallet
                  </button>
                  <div
                    style={{ flexBasis: "100%", display: "flex", gap: "8px", flexWrap: "wrap", paddingLeft: "48px" }}
                  >
                    <input
                      value={v.watchDraft ?? ""}
                      onChange={v.onWatchDraft}
                      placeholder="or watch name.near / 0x…"
                      style={{
                        flex: "1",
                        minWidth: "180px",
                        padding: "9px 12px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "14px",
                        fontFamily: "'DM Mono',monospace",
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={v.watchFirst}
                      style={{
                        padding: "9px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        cursor: "pointer",
                      }}
                    >
                      Watch
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "14px 16px",
                    alignItems: "center",
                    padding: "18px",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "14px",
                    background: tc(v.onb.s2.bg, "bg"),
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      flexShrink: "0",
                      borderRadius: "50%",
                      background: tc(v.onb.s2.dotBg, "bg"),
                      color: tc(v.onb.s2.dotColor, "fg"),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "600",
                      fontSize: "14px",
                    }}
                  >
                    {v.onb.s2.glyph}
                  </div>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <div style={{ fontWeight: "600", fontSize: "15.5px" }}>Set a reserve floor</div>
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                      USDC that always stays in your wallet.
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      border: "1px solid var(--fvb-DDE1D4)",
                      borderRadius: "10px",
                      padding: "8px 12px",
                      background: "var(--fvb-FFFFFF)",
                    }}
                  >
                    <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                    <input
                      value={v.reserveDraft ?? ""}
                      onChange={v.onReserveDraft}
                      style={{
                        border: "none",
                        outline: "none",
                        width: "90px",
                        fontSize: "15px",
                        background: "transparent",
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={v.saveReserve}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "none",
                      background: "var(--fvb-2A4034)",
                      color: "var(--fvc-FFFFFF)",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Save
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "14px 16px",
                    alignItems: "center",
                    padding: "18px",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "14px",
                    background: tc(v.onb.s3.bg, "bg"),
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      flexShrink: "0",
                      borderRadius: "50%",
                      background: tc(v.onb.s3.dotBg, "bg"),
                      color: tc(v.onb.s3.dotColor, "fg"),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "600",
                      fontSize: "14px",
                    }}
                  >
                    {v.onb.s3.glyph}
                  </div>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <div style={{ fontWeight: "600", fontSize: "15.5px" }}>Add the first dated payment</div>
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                      {v.onb.s3.sub}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={v.openAdd}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "1px solid var(--fvb-DDE1D4)",
                      background: "var(--fvb-FFFFFF)",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Add payment
                  </button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "14px 16px",
                    alignItems: "center",
                    padding: "18px",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "14px",
                    background: tc(v.onb.s4.bg, "bg"),
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      flexShrink: "0",
                      borderRadius: "50%",
                      background: tc(v.onb.s4.dotBg, "bg"),
                      color: tc(v.onb.s4.dotColor, "fg"),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "600",
                      fontSize: "14px",
                    }}
                  >
                    {v.onb.s4.glyph}
                  </div>
                  <div style={{ flex: "1", minWidth: "200px" }}>
                    <div style={{ fontWeight: "600", fontSize: "15.5px" }}>See what’s usable by date</div>
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                      Cash now, withdrawable by your payment date, and what’s committed.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={v.finishFirstRun}
                    disabled={!!v.onb.notReady}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "none",
                      background: tc(v.onb.s4.btnBg, "bg"),
                      color: "var(--fvc-FFFFFF)",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    Show me →
                  </button>
                </div>
              </div>
            </div>
            <div
              style={{
                background: "var(--fvb-2B4233)",
                borderRadius: "20px",
                padding: "34px",
                color: "var(--fvc-EAF0E2)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: "-120px",
                  bottom: "-140px",
                  width: "360px",
                  height: "360px",
                  borderRadius: "50%",
                  border: "44px solid rgba(255,255,255,.04)",
                }}
              ></div>
              <div style={{ fontSize: "12px", letterSpacing: ".2em", fontWeight: "600", color: "var(--fvc-A9BDA0)" }}>
                HOW IT DECIDES
              </div>
              <h3
                style={{
                  margin: "14px 0 0",
                  fontSize: "28px",
                  fontWeight: "500",
                  letterSpacing: "-0.03em",
                  lineHeight: "1.2",
                }}
              >
                The highest rate loses if it can’t pay you back in time.
              </h3>
              <div
                style={{
                  marginTop: "26px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  fontSize: "14.5px",
                  color: "var(--fvc-C9D6C1)",
                  lineHeight: "1.5",
                }}
              >
                <div>Holdback = reserve + payments due in your horizon.</div>
                <div>Surplus = everything above the holdback.</div>
                <div>
                  Strategies are ranked by what they net by your next payment date, after the cost of getting the money
                  back.
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
      {v.showPlanView ? (
        <>
          <div
            style={{
              marginTop: "34px",
              background: "var(--fvb-2B4233)",
              borderRadius: "22px",
              padding: "34px 36px",
              color: "var(--fvc-EAF0E2)",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexWrap: "wrap",
              gap: "24px 32px",
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: "-90px",
                top: "-120px",
                width: "380px",
                height: "380px",
                borderRadius: "50%",
                border: "46px solid rgba(255,255,255,.04)",
              }}
            ></div>
            <div style={{ position: "relative", flex: "1 1 420px", minWidth: "0" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <span
                  style={{ fontSize: "12px", letterSpacing: ".2em", fontWeight: "600", color: "var(--fvc-A9BDA0)" }}
                >
                  PLAN TO ACTION
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    letterSpacing: ".08em",
                    fontWeight: "600",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    whiteSpace: "nowrap",
                    background: tc(v.rec.tagBg, "bg"),
                    color: tc(v.rec.tagColor, "fg"),
                  }}
                >
                  {v.rec.tag}
                </span>
              </div>
              <h2
                style={{
                  margin: "14px 0 0",
                  fontSize: "34px",
                  fontWeight: "500",
                  letterSpacing: "-0.03em",
                  lineHeight: "1.15",
                  maxWidth: "720px",
                  textWrap: "pretty",
                }}
              >
                {v.rec.title}
              </h2>
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: "15.5px",
                  color: "var(--fvc-C9D6C1)",
                  lineHeight: "1.6",
                  maxWidth: "720px",
                  textWrap: "pretty",
                }}
              >
                {v.rec.body}
              </p>
              <div style={{ marginTop: "16px", fontSize: "12.5px", color: "var(--fvc-93A68B)" }}>
                A suggestion only. Nothing is prepared or signed until you review it and approve in your wallet.
              </div>
            </div>
            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                alignItems: "stretch",
              }}
            >
              <button
                type="button"
                onClick={v.rec.onClick}
                style={{
                  padding: "15px 22px",
                  borderRadius: "12px",
                  border: "none",
                  background: "var(--fvb-C9E86B)",
                  color: "var(--fvc-1E2A22)",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                className="fvh6"
              >
                {v.rec.cta} →
              </button>
              <button
                type="button"
                onClick={v.goCalendar}
                style={{
                  padding: "12px 22px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,.18)",
                  background: "transparent",
                  color: "var(--fvc-EAF0E2)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                Review your calendar
              </button>
            </div>
          </div>
          <div
            style={{
              marginTop: "20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              fontSize: "13px",
              color: "var(--fvc-5B6458)",
            }}
          >
            <span>Balances usable by</span>
            <div
              style={{
                display: "flex",
                gap: "4px",
                background: "var(--fvb-F1F2EB)",
                padding: "3px",
                borderRadius: "11px",
                flexWrap: "wrap",
              }}
            >
              {(v.pfDateTabs || []).map((t: any, i_t_0: number) => (
                <Fragment key={i_t_0}>
                  <button
                    type="button"
                    onClick={t.onClick}
                    style={{
                      padding: "7px 11px",
                      border: "none",
                      borderRadius: "9px",
                      background: tc(t.bg, "bg"),
                      color: "var(--fvc-1E2A22)",
                      fontSize: "13px",
                      cursor: "pointer",
                      boxShadow: tc(t.shadow, "bg"),
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.label}
                  </button>
                </Fragment>
              ))}
            </div>
            <span style={{ flex: "1" }}></span>
            <button
              type="button"
              onClick={v.goPortfolio}
              style={{
                border: "none",
                background: "none",
                padding: "0",
                fontSize: "13px",
                color: "var(--fvc-3F6B3C)",
                cursor: "pointer",
              }}
            >
              Same figures as Portfolio ↗
            </button>
          </div>
          <div
            style={{
              marginTop: "10px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
            }}
          >
            {(v.ovMetrics || []).map((m: any, i_m_0: number) => (
              <Fragment key={i_m_0}>
                <div style={{ padding: "22px 24px", borderLeft: tc(m.border, "bg") }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13.5px",
                      color: "var(--fvc-6F786B)",
                    }}
                  >
                    <span
                      style={{ width: "8px", height: "8px", borderRadius: "2px", background: tc(m.dot, "bg") }}
                    ></span>
                    {m.label}
                  </div>
                  <div style={{ marginTop: "10px", fontSize: "28px", fontWeight: "500", letterSpacing: "-0.03em" }}>
                    {<Skel v={m.value} />}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{m.sub}</div>
                </div>
              </Fragment>
            ))}
          </div>
          <div
            style={{
              marginTop: "12px",
              height: "10px",
              borderRadius: "999px",
              background: "var(--fvb-EEF0E8)",
              display: "flex",
              overflow: "hidden",
            }}
          >
            <div style={{ width: v.bar.reserve, background: "var(--fvb-D8B98F)" }}></div>
            <div style={{ width: v.bar.obs, background: "var(--fvb-9DB48C)" }}></div>
            <div style={{ width: v.bar.surplus, background: "var(--fvb-4E7A4A)" }}></div>
          </div>
          <div style={{ marginTop: "8px", display: "flex", gap: "18px", fontSize: "12px", color: "var(--fvc-6F786B)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--fvb-D8B98F)" }}
              ></span>
              Reserve
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--fvb-9DB48C)" }}
              ></span>
              Payments in horizon
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--fvb-4E7A4A)" }}
              ></span>
              Surplus
            </span>
            <span style={{ flex: "1" }}></span>
            <span>{v.barSrc}</span>
          </div>
          {v.judge ? (
            <>
              <div
                style={{
                  marginTop: "22px",
                  border: "1px dashed var(--fvb-DDC6A4)",
                  background: "var(--fvb-FBF6EE)",
                  borderRadius: "18px",
                  padding: "20px 24px",
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1", minWidth: "240px" }}>
                  <div style={{ fontSize: "16px", fontWeight: "500" }}>Try a risky action</div>
                  <div style={{ fontSize: "13.5px", color: "var(--fvc-6E4A1A)", marginTop: "4px" }}>
                    Supply 6,000 USDC in one go and see which rules refuse it. Example workspace only.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={v.tryRisky}
                  style={{
                    padding: "11px 16px",
                    borderRadius: "11px",
                    border: "1px solid var(--fvb-DDC6A4)",
                    background: "var(--fvb-FFFFFF)",
                    color: "var(--fvc-6E4A1A)",
                    fontSize: "14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open the policy test →
                </button>
              </div>
            </>
          ) : null}
          <div style={{ marginTop: "36px", display: "flex", alignItems: "baseline", gap: "12px" }}>
            <h3 style={{ margin: "0", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              Next {v.horizon} days
            </h3>
            <span style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)" }}>{v.obsCountLabel}</span>
            <span style={{ flex: "1" }}></span>
            <button
              type="button"
              onClick={v.openAdd}
              style={{
                padding: "9px 14px",
                borderRadius: "10px",
                border: "1px solid var(--fvb-DDE1D4)",
                background: "var(--fvb-FFFFFF)",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              + Add payment
            </button>
          </div>
          <div
            style={{
              marginTop: "16px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "26px 28px 22px",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "relative", height: "74px" }}>
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  right: "0",
                  top: "40px",
                  height: "2px",
                  background: "var(--fvb-E8EBE1)",
                }}
              ></div>
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  top: "30px",
                  fontSize: "11px",
                  color: "var(--fvc-6F786B)",
                  transform: "translateY(20px)",
                }}
              >
                Today · {v.todayLabel}
              </div>
              <div
                style={{
                  position: "absolute",
                  right: "0",
                  top: "30px",
                  fontSize: "11px",
                  color: "var(--fvc-6F786B)",
                  transform: "translateY(20px)",
                }}
              >
                {v.horizonEnd}
              </div>
              {(v.strip || []).map((s: any, i_s_0: number) => (
                <Fragment key={i_s_0}>
                  <div
                    style={{
                      position: "absolute",
                      left: s.left,
                      top: "0",
                      transform: "translateX(-50%)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ height: "20px", display: "flex", alignItems: "flex-end", marginTop: s.labelTop }}>
                      <div
                        style={{ fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", color: tc(s.color, "fg") }}
                      >
                        {s.amount}
                      </div>
                    </div>
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        background: tc(s.dot, "bg"),
                        border: "3px solid var(--fvb-FFFFFF)",
                        boxShadow: `0 0 0 1px ${tc(s.dot, "bg")}`,
                        marginTop: s.dotTop,
                      }}
                    ></div>
                  </div>
                </Fragment>
              ))}
            </div>
            <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", overflowX: "auto" }}>
              {(v.upcoming || []).map((o: any, i_o_0: number) => (
                <Fragment key={i_o_0}>
                  <div
                    style={{
                      minWidth: "760px",
                      display: "grid",
                      gridTemplateColumns: "72px minmax(0,1.4fr) minmax(0,1fr) 130px 120px 150px",
                      alignItems: "center",
                      gap: "16px",
                      padding: "14px 0",
                      borderTop: "1px solid var(--fvb-EEF0E8)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "18px", fontWeight: "500", letterSpacing: "-0.02em" }}>{o.dueLabel}</div>
                      <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{o.inDays}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: "500" }}>{o.name}</div>
                      <div
                        style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)", fontFamily: "'DM Mono',monospace" }}
                      >
                        {o.recipientShort}
                      </div>
                    </div>
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-5B6458)" }}>
                      {o.chain} · {o.asset}
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: "500", textAlign: "right" }}>{o.amountF}</div>
                    <div>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: "600",
                          letterSpacing: ".04em",
                          padding: "4px 9px",
                          borderRadius: "999px",
                          background: tc(o.stBg, "bg"),
                          color: tc(o.stColor, "fg"),
                        }}
                      >
                        {o.stLabel}
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={o.onPay}
                        style={{
                          padding: "9px 14px",
                          borderRadius: "10px",
                          border: tc(o.btnBorder, "bg"),
                          background: tc(o.btnBg, "bg"),
                          color: tc(o.btnColor, "fg"),
                          fontSize: "13.5px",
                          fontWeight: "500",
                          cursor: "pointer",
                        }}
                      >
                        {o.btnLabel}
                      </button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
            <div
              style={{
                marginTop: "8px",
                paddingTop: "14px",
                borderTop: "1px solid var(--fvb-EEF0E8)",
                fontSize: "12.5px",
                color: "var(--fvc-6F786B)",
                display: "flex",
                gap: "16px",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--fvb-4E7A4A)" }}
                ></span>
                Covered by wallet above reserve
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--fvb-C08A45)" }}
                ></span>
                Needs a Rhea withdrawal first
              </span>
            </div>
          </div>
          <div style={{ marginTop: "36px", display: "flex", alignItems: "baseline", gap: "12px" }}>
            <h3 style={{ margin: "0", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              Your portfolio, grouped
            </h3>
            <span style={{ flex: "1" }}></span>
            <button
              type="button"
              onClick={v.goPortfolio}
              style={{
                border: "none",
                background: "none",
                fontSize: "14px",
                color: "var(--fvc-4E7A4A)",
                cursor: "pointer",
              }}
            >
              Every position ↗
            </button>
          </div>
          <div
            style={{
              marginTop: "16px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              overflowX: "auto",
            }}
          >
            <div
              style={{
                minWidth: "640px",
                display: "grid",
                gridTemplateColumns: "minmax(0,1.6fr) 140px minmax(0,1.3fr) 170px",
                gap: "16px",
                padding: "14px 28px",
                fontSize: "11.5px",
                letterSpacing: ".16em",
                color: "var(--fvc-8A9285)",
                fontWeight: "600",
                borderBottom: "1px solid var(--fvb-EEF0E8)",
              }}
            >
              <div>POSITION</div>
              <div style={{ textAlign: "right" }}>BALANCE</div>
              <div>GETTING IT BACK</div>
              <div style={{ textAlign: "right" }}>ACTION</div>
            </div>
            {(v.ovPositions || []).map((p: any, i_p_0: number) => (
              <Fragment key={i_p_0}>
                <div
                  style={{
                    minWidth: "640px",
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.6fr) 140px minmax(0,1.3fr) 170px",
                    gap: "16px",
                    padding: "18px 28px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--fvb-F1F2EB)",
                  }}
                >
                  <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: tc(p.iconBg, "bg"),
                        color: tc(p.iconColor, "fg"),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "17px",
                      }}
                    >
                      {p.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: "500" }}>{p.name}</div>
                      <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{p.sub}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "15px", fontWeight: "500" }}>{<Skel v={p.balance} />}</div>
                  <div style={{ fontSize: "13.5px", color: "var(--fvc-5B6458)" }}>{p.exit}</div>
                  <div style={{ textAlign: "right" }}>
                    {p.isBtn ? (
                      <>
                        <button
                          type="button"
                          onClick={p.onAction}
                          style={{
                            padding: "8px 13px",
                            borderRadius: "10px",
                            border: "1px solid var(--fvb-DDE1D4)",
                            background: "var(--fvb-FFFFFF)",
                            fontSize: "13.5px",
                            cursor: "pointer",
                            color: "var(--fvc-1E2A22)",
                          }}
                        >
                          {p.action}
                        </button>
                      </>
                    ) : null}
                    {p.isLabel ? (
                      <>
                        <span style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{p.action}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
