// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { PlanCta } from "../PlanDock";
import { tc } from "../theme";

// Design section: PAY ON A DATE
export function PayOnADateView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          EXECUTE · PAY ON A DATE
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
        <span
          style={{
            fontSize: "11px",
            letterSpacing: ".08em",
            fontWeight: "600",
            padding: "4px 8px",
            borderRadius: "6px",
            whiteSpace: "nowrap",
            background: "var(--fvb-E7ECF3)",
            color: "var(--fvc-3F5A7A)",
          }}
        >
          {v.pyTag}
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
        State the outcome. FlowVault finds the sources.
      </h1>
      <p
        style={{
          margin: "14px 0 0",
          fontSize: "16.5px",
          color: "var(--fvc-5B6458)",
          maxWidth: "760px",
          textWrap: "pretty",
        }}
      >
        Every source your policy allows is compared at the same exact payout. Each leg is its own approval, and the
        payment is marked paid only after delivery is verified at the destination.
      </p>
      {v.why.pay ? (
        <>
          <div
            style={{
              marginTop: "16px",
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "10px 14px",
              borderRadius: "12px",
              background: "var(--fvb-F4F7EE)",
              border: "1px solid var(--fvb-DCE4D0)",
              fontSize: "13.5px",
              color: "var(--fvc-2F552D)",
              lineHeight: "1.45",
            }}
          >
            <span style={{ fontWeight: "700", letterSpacing: ".1em", fontSize: "10.5px" }}>WHY</span>
            <span style={{ flex: "1" }}>Marked paid only when delivery is verified on the destination chain.</span>
            <button
              type="button"
              onClick={v.dismissWhy.pay}
              aria-label="Dismiss"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "var(--fvc-5B6458)",
                fontSize: "14px",
                padding: "2px 4px",
              }}
            >
              ✕
            </button>
          </div>
        </>
      ) : null}
      {v.hasPy ? (
        <>
          <div
            style={{
              marginTop: "28px",
              display: "flex",
              gap: "6px",
              background: "var(--fvb-F1F2EB)",
              padding: "4px",
              borderRadius: "12px",
              flexWrap: "wrap",
              width: "max-content",
              maxWidth: "100%",
            }}
          >
            {(v.pyTabs || []).map((t: any, i_t_0: number) => (
              <Fragment key={i_t_0}>
                <button
                  type="button"
                  onClick={t.onClick}
                  style={{
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: "9px",
                    background: tc(t.bg, "bg"),
                    color: "var(--fvc-1E2A22)",
                    fontSize: "13.5px",
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
          {v.planCta ? <div style={{ marginTop: "14px" }}><PlanCta cta={v.planCta} /></div> : null}
          <div
            style={{
              marginTop: "16px",
              background: "var(--fvb-2B4233)",
              borderRadius: "22px",
              padding: "30px 34px",
              color: "var(--fvc-EAF0E2)",
              display: "flex",
              flexWrap: "wrap",
              gap: "20px 28px",
              alignItems: "flex-end",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: "-90px",
                top: "-120px",
                width: "340px",
                height: "340px",
                borderRadius: "50%",
                border: "44px solid rgba(255,255,255,.04)",
              }}
            ></div>
            <div style={{ position: "relative", minWidth: "0", flex: "1 1 320px" }}>
              <div style={{ fontSize: "12px", letterSpacing: ".2em", fontWeight: "600", color: "var(--fvc-A9BDA0)" }}>
                RECIPIENT RECEIVES EXACTLY
              </div>
              <div style={{ marginTop: "10px", fontSize: "46px", fontWeight: "500", letterSpacing: "-0.04em" }}>
                {v.pyHead.amount}
              </div>
              <div style={{ marginTop: "6px", fontSize: "15.5px", color: "var(--fvc-C9D6C1)" }}>{v.pyHead.line}</div>
              <div
                style={{
                  marginTop: "6px",
                  fontSize: "12.5px",
                  color: "var(--fvc-93A68B)",
                  fontFamily: /\s/.test(String(v.pyHead.addr)) || v.pyHead.addr === "not set" ? undefined : "'DM Mono',monospace",
                  wordBreak: "break-all",
                }}
              >
                {v.pyHead.addr}
              </div>
            </div>
            <div
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "auto auto",
                gap: "6px 22px",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "var(--fvc-A9BDA0)" }}>You send</span>
              <span style={{ textAlign: "right", fontWeight: "500" }}>{v.pyHead.send}</span>
              <span style={{ color: "var(--fvc-A9BDA0)" }}>Non-refundable fees</span>
              <span style={{ textAlign: "right" }}>{v.pyHead.fee}</span>
              <span style={{ color: "var(--fvc-A9BDA0)" }}>Refundable buffer</span>
              <span style={{ textAlign: "right" }}>{v.pyHead.buf}</span>
            </div>
          </div>
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,250px),1fr))",
              gap: "16px",
            }}
          >
            {(v.pyPlans || []).map((p: any, i_p_0: number) => (
              <Fragment key={i_p_0}>
                <div
                  style={{
                    background: "var(--fvb-FFFFFF)",
                    border: `1px solid ${tc(p.border, "bg")}`,
                    borderRadius: "20px",
                    padding: "22px",
                    display: "flex",
                    flexDirection: "column",
                    opacity: p.opacity,
                  }}
                >
                  <div style={{ display: "flex" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: ".08em",
                        fontWeight: "600",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        whiteSpace: "nowrap",
                        background: tc(p.tagBg, "bg"),
                        color: tc(p.tagColor, "fg"),
                      }}
                    >
                      {p.tag}
                    </span>
                  </div>
                  <div style={{ marginTop: "14px", fontSize: "19px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                    {p.name}
                  </div>
                  <div style={{ marginTop: "2px", fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{p.sub}</div>
                  <div
                    style={{
                      marginTop: "16px",
                      fontSize: "30px",
                      fontWeight: "500",
                      letterSpacing: "-0.03em",
                      color: tc(p.costColor, "fg"),
                    }}
                  >
                    {p.costF}
                  </div>
                  <div style={{ fontSize: "12.5px", color: tc(p.subColor, "fg"), lineHeight: "1.4" }}>{p.costSub}</div>
                  <div
                    style={{
                      marginTop: "14px",
                      paddingTop: "12px",
                      borderTop: "1px solid var(--fvb-EEF0E8)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "7px",
                      fontSize: "13px",
                    }}
                  >
                    {(p.rows || []).map((r: any, i_r_1: number) => (
                      <Fragment key={i_r_1}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                          <span style={{ color: "var(--fvc-5B6458)" }}>{r.k}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "12.5px", textAlign: "right" }}>
                            {r.v}
                          </span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ flex: "1", minHeight: "14px" }}></div>
                  <button
                    type="button"
                    onClick={p.onClick}
                    disabled={!!p.disabled}
                    style={{
                      marginTop: "12px",
                      padding: "11px",
                      borderRadius: "11px",
                      border: tc(p.btnBorder, "bg"),
                      background: tc(p.btnBg, "bg"),
                      color: tc(p.btnColor, "fg"),
                      fontSize: "13.5px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    {p.cta}
                  </button>
                </div>
              </Fragment>
            ))}
          </div>
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
              gap: "16px",
            }}
          >
            <div
              style={{
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "18px",
                padding: "22px",
              }}
            >
              <div style={{ fontSize: "15.5px", fontWeight: "500" }}>What the engine checked</div>
              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {(v.pyChecks || []).map((c: any, i_c_0: number) => (
                  <Fragment key={i_c_0}>
                    <div style={{ display: "flex", gap: "10px", fontSize: "13.5px", color: tc(c.color, "fg") }}>
                      <span style={{ width: "12px" }}>{c.glyph}</span>
                      <span>{c.text}</span>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
            <div
              style={{
                background: "var(--fvb-F3F4EE)",
                border: "1px dashed var(--fvb-D5DACB)",
                borderRadius: "18px",
                padding: "22px",
                fontSize: "13.5px",
                color: "var(--fvc-5B6458)",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontSize: "15.5px", fontWeight: "500", color: "var(--fvc-1E2A22)" }}>Coming soon</div>
              <div style={{ marginTop: "8px" }}>
                Plans that mix sources (part wallet, part Rhea), paying network fees from any asset, and borrowing to pay.
                Today each plan uses one source.
              </div>
              <button
                type="button"
                onClick={v.goRoadmap}
                style={{
                  marginTop: "12px",
                  border: "none",
                  background: "none",
                  padding: "0",
                  color: "var(--fvc-3F6B3C)",
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                See the roadmap ↗
              </button>
            </div>
          </div>
        </>
      ) : null}
      {v.noPy ? (
        <>
          <div
            style={{
              marginTop: "30px",
              border: "1px dashed var(--fvb-D5DACB)",
              borderRadius: "18px",
              padding: "56px",
              textAlign: "center",
              background: "var(--fvb-F3F4EE)",
            }}
          >
            <div style={{ fontSize: "26px", fontWeight: "500", letterSpacing: "-0.02em" }}>Nothing left to pay.</div>
            <div style={{ marginTop: "8px", color: "var(--fvc-6F786B)", fontSize: "15px" }}>
              Add a dated payment and FlowVault compares the sources your policy allows.
            </div>
            <button
              type="button"
              onClick={v.openAdd}
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
              Add a payment →
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
