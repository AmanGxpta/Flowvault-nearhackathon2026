// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: ACTIVITY
export function ActivityView({ v }: { v: any }) {
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
      <h1
        style={{
          margin: "14px 0 0",
          fontSize: "clamp(34px,6vw,52px)",
          fontWeight: "500",
          letterSpacing: "-0.04em",
          lineHeight: "1.05",
        }}
      >
        Every step, verified.
      </h1>
      <p style={{ margin: "14px 0 0", fontSize: "16.5px", color: "var(--fvc-5B6458)" }}>
        Supplies, withdrawals and payouts as step timelines. “Confirmed” only appears after the final verified step.
      </p>
      <div
        style={{
          marginTop: "24px",
          display: "flex",
          gap: "6px",
          background: "var(--fvb-F1F2EB)",
          padding: "4px",
          borderRadius: "12px",
          width: "max-content",
          maxWidth: "100%",
        }}
      >
        {(v.actTabs || []).map((t: any, i_t_0: number) => (
          <Fragment key={i_t_0}>
            <button
              type="button"
              onClick={t.onClick}
              style={{
                padding: "8px 14px",
                border: "none",
                borderRadius: "9px",
                background: tc(t.bg, "bg"),
                color: "var(--fvc-1E2A22)",
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: tc(t.shadow, "bg"),
              }}
            >
              {t.label}
            </button>
          </Fragment>
        ))}
      </div>
      {v.actTimeline ? (
        <>
          <div style={{ marginTop: "26px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {(v.legend || []).map((l: any, i_l_0: number) => (
              <Fragment key={i_l_0}>
                <span
                  style={{
                    fontSize: "12px",
                    padding: "5px 10px",
                    borderRadius: "999px",
                    background: tc(l.bg, "bg"),
                    color: tc(l.color, "fg"),
                    border: `1px solid ${tc(l.border, "bg")}`,
                  }}
                >
                  {l.label}
                </span>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {(v.ops || []).map((op: any, i_op_0: number) => (
              <Fragment key={i_op_0}>
                <div
                  style={{
                    background: "var(--fvb-FFFFFF)",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "18px",
                    overflowX: "auto",
                  }}
                >
                  <button
                    type="button"
                    onClick={op.onToggle}
                    style={{
                      minWidth: "600px",
                      width: "100%",
                      display: "grid",
                      gridTemplateColumns: "44px minmax(0,1fr) 150px 150px 24px",
                      gap: "16px",
                      alignItems: "center",
                      padding: "18px 24px",
                      border: "none",
                      background: "var(--fvb-FFFFFF)",
                      textAlign: "left",
                      cursor: "pointer",
                      color: "var(--fvc-1E2A22)",
                    }}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: tc(op.iconBg, "bg"),
                        color: tc(op.iconColor, "fg"),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                      }}
                    >
                      {op.icon}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "15.5px",
                          fontWeight: "500",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>
                          {op.kind} · {op.title}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            letterSpacing: ".08em",
                            fontWeight: "600",
                            padding: "3px 6px",
                            borderRadius: "5px",
                            background: tc(op.srcBg, "bg"),
                            color: tc(op.srcColor, "fg"),
                          }}
                        >
                          {op.srcTag}
                        </span>
                      </div>
                      <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{op.sub}</div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: "15px", fontWeight: "500" }}>{op.amountF}</div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: "11.5px",
                          fontWeight: "600",
                          letterSpacing: ".04em",
                          padding: "4px 9px",
                          borderRadius: "999px",
                          background: tc(op.stBg, "bg"),
                          color: tc(op.stColor, "fg"),
                        }}
                      >
                        {op.stLabel}
                      </span>
                    </div>
                    <div style={{ color: "var(--fvc-8A9285)" }}>{op.chev}</div>
                  </button>
                  {op.isOpen ? (
                    <>
                      <div
                        style={{
                          minWidth: "600px",
                          padding: "6px 24px 22px 84px",
                          borderTop: "1px solid var(--fvb-F1F2EB)",
                        }}
                      >
                        {op.hasPhases ? (
                          <>
                            <div
                              style={{
                                marginTop: "14px",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "11px",
                                  letterSpacing: ".14em",
                                  fontWeight: "600",
                                  color: "var(--fvc-8A9285)",
                                  marginRight: "6px",
                                }}
                              >
                                1CLICK STATUS
                              </span>
                              {(op.phases || []).map((ph: any, i_ph_1: number) => (
                                <Fragment key={i_ph_1}>
                                  <span
                                    style={{
                                      fontFamily: "'DM Mono',monospace",
                                      fontSize: "11.5px",
                                      padding: "4px 8px",
                                      borderRadius: "6px",
                                      background: tc(ph.bg, "bg"),
                                      color: tc(ph.color, "fg"),
                                    }}
                                  >
                                    {ph.label}
                                  </span>
                                  <span style={{ color: "var(--fvc-B9C0B2)", fontSize: "12px" }}>{ph.arrow}</span>
                                </Fragment>
                              ))}
                            </div>
                          </>
                        ) : null}
                        {(op.steps || []).map((st: any, i_st_1: number) => (
                          <Fragment key={i_st_1}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "24px minmax(0,1fr) 160px 150px",
                                gap: "14px",
                                alignItems: "start",
                                paddingTop: "14px",
                                position: "relative",
                              }}
                            >
                              <div
                                style={{
                                  width: "20px",
                                  height: "20px",
                                  borderRadius: "50%",
                                  background: tc(st.dotBg, "bg"),
                                  border: `1.5px solid ${tc(st.dotBorder, "bg")}`,
                                  color: "var(--fvc-FFFFFF)",
                                  fontSize: "11px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  marginTop: "1px",
                                }}
                              >
                                {st.glyph}
                              </div>
                              <div>
                                <div style={{ fontSize: "14px", fontWeight: "500", color: tc(st.labelColor, "fg") }}>
                                  {st.label}
                                </div>
                                <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                                  {st.detail}
                                </div>
                              </div>
                              <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{st.time}</div>
                              <div
                                style={{ textAlign: "right", fontSize: "12.5px", fontFamily: "'DM Mono',monospace" }}
                              >
                                <a href="#" style={{ color: "var(--fvc-3F6B3C)", textDecoration: "none" }}>
                                  {st.hash}
                                </a>
                              </div>
                            </div>
                          </Fragment>
                        ))}
                        <div
                          style={{
                            marginTop: "16px",
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,210px),1fr))",
                            gap: "8px",
                          }}
                        >
                          {(op.meta || []).map((mt: any, i_mt_1: number) => (
                            <Fragment key={i_mt_1}>
                              <div
                                style={{
                                  padding: "10px 12px",
                                  border: "1px solid var(--fvb-EEF0E8)",
                                  borderRadius: "10px",
                                }}
                              >
                                <div style={{ fontSize: "11.5px", color: "var(--fvc-8A9285)" }}>{mt.k}</div>
                                <div
                                  style={{
                                    marginTop: "3px",
                                    fontSize: "12.5px",
                                    fontFamily: "'DM Mono',monospace",
                                    color: "var(--fvc-1E2A22)",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {mt.v}
                                </div>
                              </div>
                            </Fragment>
                          ))}
                        </div>
                        <div
                          style={{
                            marginTop: "12px",
                            padding: "12px 14px",
                            borderRadius: "12px",
                            background: tc(op.footBg, "bg"),
                            fontSize: "12.5px",
                            color: tc(op.footColor, "fg"),
                            lineHeight: "1.5",
                          }}
                        >
                          {op.foot}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </Fragment>
            ))}
            {v.noOps ? (
              <>
                <div
                  style={{
                    border: "1px dashed var(--fvb-D5DACB)",
                    borderRadius: "18px",
                    padding: "64px",
                    textAlign: "center",
                    background: "var(--fvb-F3F4EE)",
                  }}
                >
                  <div style={{ fontSize: "26px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                    Every good move starts with a plan.
                  </div>
                  <div style={{ marginTop: "8px", color: "var(--fvc-6F786B)", fontSize: "15px" }}>
                    Supplies, withdrawals and payouts appear here with every step linked.
                  </div>
                  <button
                    type="button"
                    onClick={v.goCalendar}
                    style={{
                      marginTop: "22px",
                      padding: "13px 20px",
                      borderRadius: "12px",
                      border: "none",
                      background: "var(--fvb-2A4034)",
                      color: "var(--fvc-FFFFFF)",
                      fontSize: "14.5px",
                      cursor: "pointer",
                    }}
                  >
                    Set up your calendar →
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {v.actStatement ? (
        <>
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))",
              gap: "12px",
            }}
          >
            {(v.stmtSummary || []).map((b: any, i_b_0: number) => (
              <Fragment key={i_b_0}>
                <div
                  style={{
                    background: "var(--fvb-FFFFFF)",
                    border: "1px solid var(--fvb-E3E6DB)",
                    borderRadius: "18px",
                    padding: "16px 18px",
                  }}
                >
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{b.k}</div>
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "22px",
                      fontWeight: "500",
                      letterSpacing: "-0.02em",
                      color: tc(b.color, "fg"),
                    }}
                  >
                    {b.v}
                  </div>
                </div>
              </Fragment>
            ))}
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
                minWidth: "900px",
                display: "grid",
                gridTemplateColumns: "minmax(0,1.5fr) 110px 100px 100px 100px 96px 100px 92px",
                gap: "12px",
                padding: "13px 22px",
                fontSize: "11px",
                letterSpacing: ".12em",
                color: "var(--fvc-8A9285)",
                fontWeight: "600",
                borderBottom: "1px solid var(--fvb-EEF0E8)",
              }}
            >
              <div>LINE</div>
              <div style={{ textAlign: "right" }}>IN / OUT</div>
              <div style={{ textAlign: "right" }}>CASH YIELD</div>
              <div style={{ textAlign: "right" }}>PRICE</div>
              <div style={{ textAlign: "right" }}>INCENTIVES</div>
              <div style={{ textAlign: "right" }}>FEES</div>
              <div style={{ textAlign: "right" }}>DEBT LEFT</div>
              <div></div>
            </div>
            {(v.stmtRows || []).map((r: any, i_r_0: number) => (
              <Fragment key={i_r_0}>
                <div
                  style={{
                    minWidth: "900px",
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.5fr) 110px 100px 100px 100px 96px 100px 92px",
                    gap: "12px",
                    padding: "13px 22px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--fvb-F1F2EB)",
                    fontSize: "13.5px",
                    fontFamily: "'DM Mono',monospace",
                  }}
                >
                  <div style={{ fontFamily: "'DM Sans',sans-serif" }}>
                    <div style={{ fontWeight: "500" }}>{r.title}</div>
                    <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{r.sub}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>{r.flow}</div>
                  <div style={{ textAlign: "right", color: "var(--fvc-3F6B3C)" }}>{r.yieldF}</div>
                  <div style={{ textAlign: "right", color: "var(--fvc-8A9285)" }}>{r.price}</div>
                  <div style={{ textAlign: "right", color: "var(--fvc-8A9285)" }}>{r.inc}</div>
                  <div style={{ textAlign: "right", color: "var(--fvc-8A5F25)" }}>{r.fees}</div>
                  <div style={{ textAlign: "right" }}>{r.debt}</div>
                  <div style={{ textAlign: "right", fontFamily: "'DM Sans',sans-serif" }}>
                    <button
                      type="button"
                      onClick={r.onOpen}
                      style={{
                        border: "none",
                        background: "none",
                        padding: "0",
                        fontSize: "13px",
                        color: "var(--fvc-3F6B3C)",
                        cursor: "pointer",
                      }}
                    >
                      Timeline ↗
                    </button>
                  </div>
                </div>
              </Fragment>
            ))}
            <div
              style={{
                minWidth: "900px",
                padding: "13px 22px",
                background: "var(--fvb-F7F8F3)",
                fontSize: "12.5px",
                color: "var(--fvc-6F786B)",
                lineHeight: "1.5",
              }}
            >
              Cash yield is accrued at Rhea’s variable rate and estimated until you withdraw. Network fees are converted
              at the example NEAR price. No incentives or debt exist in this account yet.
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
