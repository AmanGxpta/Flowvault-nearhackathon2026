// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { Skel } from "../Skel";
import { tc } from "../theme";

// Design section: CREDIT
export function CreditView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          DECIDE · CREDIT · PHASE 2 PREVIEW
        </span>
        <span
          style={{
            fontSize: "11px",
            letterSpacing: ".08em",
            fontWeight: "600",
            padding: "4px 8px",
            borderRadius: "6px",
            background: "var(--fvb-F6EBDD)",
            color: "var(--fvc-8A5F25)",
          }}
        >
          SIMULATION
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
        Borrow against what you keep.
      </h1>
      <p style={{ margin: "14px 0 0", fontSize: "16.5px", color: "var(--fvc-5B6458)" }}>
        Set how bad it could get. Capacity is the tightest of your cap, the protocol and your health floor.
      </p>
      {v.creditHas ? (
        <>
          <div
            style={{
              marginTop: "30px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))",
              gap: "20px",
              alignItems: "start",
            }}
          >
            <div
              style={{
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "18px",
                padding: "26px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    background: "var(--fvb-ECE8F4)",
                    color: "var(--fvc-6B5E99)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                  }}
                >
                  Ξ
                </div>
                <div style={{ flex: "1" }}>
                  <div style={{ fontSize: "17px", fontWeight: "500" }}>ETH on Arbitrum</div>
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>
                    {v.creditEthLine}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: "600",
                      padding: "5px 9px",
                      borderRadius: "7px",
                      background: "var(--fvb-F1F2EB)",
                      color: "var(--fvc-1E2A22)",
                    }}
                  >
                    {v.creditPrio}
                  </span>
                  <button
                    type="button"
                    onClick={v.goPolicy}
                    style={{
                      border: "none",
                      background: "none",
                      padding: "0",
                      fontSize: "13px",
                      color: "var(--fvc-3F6B3C)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Edit in Policy ↗
                  </button>
                </div>
              </div>
              <div style={{ marginTop: "26px", display: "flex", flexDirection: "column", gap: "22px" }}>
                {(v.sliders || []).map((sl: any, i_sl_0: number) => (
                  <Fragment key={i_sl_0}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                        <span style={{ color: "var(--fvc-4A5349)" }}>{sl.label}</span>
                        <span style={{ fontWeight: "600", fontFamily: "'DM Mono',monospace" }}>{sl.display}</span>
                      </div>
                      <input
                        type="range"
                        min={sl.min}
                        max={sl.max}
                        step={sl.step}
                        value={sl.value ?? ""}
                        onChange={sl.onChange}
                        aria-label={sl.label}
                        aria-valuetext={sl.display}
                        style={{ width: "100%", marginTop: "8px", accentColor: "var(--fvc-2A4034)" }}
                      />
                      <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{sl.hint}</div>
                    </div>
                  </Fragment>
                ))}
              </div>
              <div
                style={{
                  marginTop: "22px",
                  paddingTop: "18px",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  fontSize: "13px",
                  color: "var(--fvc-5B6458)",
                }}
              >
                Permissions{" "}
                <div style={{ marginTop: "10px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {(v.creditUses || []).map((u: any, i_u_0: number) => (
                    <Fragment key={i_u_0}>
                      <span
                        style={{
                          fontSize: "13px",
                          padding: "6px 10px",
                          borderRadius: "999px",
                          background: tc(u.bg, "bg"),
                          color: tc(u.color, "fg"),
                          border: `1px solid ${tc(u.border, "bg")}`,
                        }}
                      >
                        {u.label}
                      </span>
                    </Fragment>
                  ))}
                </div>
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                  {v.creditPermNote}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div
                style={{
                  background: "var(--fvb-2B4233)",
                  color: "var(--fvc-EAF0E2)",
                  borderRadius: "18px",
                  padding: "24px",
                }}
              >
                <div
                  style={{ fontSize: "12px", letterSpacing: ".18em", fontWeight: "600", color: "var(--fvc-A9BDA0)" }}
                >
                  NEW BORROWING CAPACITY
                </div>
                <div style={{ marginTop: "10px", fontSize: "44px", fontWeight: "500", letterSpacing: "-0.04em" }}>
                  {<Skel v={v.credit.capF} />}
                </div>
                <div style={{ marginTop: "6px", fontSize: "14px", color: "var(--fvc-C9D6C1)" }}>
                  Binding: {v.credit.binding}
                </div>
                {v.credit.blocked ? (
                  <>
                    <button
                      type="button"
                      onClick={v.goPolicy}
                      style={{
                        marginTop: "14px",
                        padding: "9px 14px",
                        borderRadius: "10px",
                        border: "none",
                        background: "var(--fvb-C9E86B)",
                        color: "var(--fvc-1E2A22)",
                        fontSize: "13.5px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      Allow in Policy ↗
                    </button>
                  </>
                ) : null}
              </div>
              <div
                style={{
                  background: "var(--fvb-FFFFFF)",
                  border: "1px solid var(--fvb-E3E6DB)",
                  borderRadius: "18px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  fontSize: "13.5px",
                }}
              >
                {(v.credit.rows || []).map((r: any, i_r_0: number) => (
                  <Fragment key={i_r_0}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "10px",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--fvb-F1F2EB)",
                      }}
                    >
                      <span style={{ color: tc(r.kc, "fg") }}>{r.k}</span>
                      <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: r.w }}>{<Skel v={r.v} />}</span>
                    </div>
                  </Fragment>
                ))}
                <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
                  Collateral is never reused across venues. Borrowing needs a separate new-debt approval and a repayment
                  plan tied to your calendar.
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: "36px", display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
            <h3 style={{ margin: "0", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              Every asset under stress
            </h3>
            <span style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)" }}>
              Collateral rules from policy rev {v.polRev} · minimum health {v.stHp}
            </span>
            <span style={{ flex: "1" }}></span>
            <button
              type="button"
              onClick={v.goPay}
              style={{
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid var(--fvb-DDE1D4)",
                background: "var(--fvb-FFFFFF)",
                fontSize: "13.5px",
                cursor: "pointer",
                color: "var(--fvc-1E2A22)",
              }}
            >
              Use as a source (preview) →
            </button>
          </div>
          <div
            style={{
              marginTop: "14px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              overflowX: "auto",
            }}
          >
            <div
              style={{
                minWidth: "920px",
                display: "grid",
                gridTemplateColumns: "36px minmax(0,1.1fr) minmax(0,1fr) 92px 92px 104px minmax(0,1.3fr) 104px",
                gap: "12px",
                padding: "13px 20px",
                fontSize: "11px",
                letterSpacing: ".12em",
                color: "var(--fvc-8A9285)",
                fontWeight: "600",
                borderBottom: "1px solid var(--fvb-EEF0E8)",
              }}
            >
              <div></div>
              <div>ASSET</div>
              <div>VENUE</div>
              <div>DRAWDOWN</div>
              <div>LTV CAP</div>
              <div style={{ textAlign: "right" }}>CAPACITY</div>
              <div>BINDING</div>
              <div style={{ textAlign: "right" }}>RUNNING</div>
            </div>
            {(v.stressRows || []).map((r: any, i_r_0: number) => (
              <Fragment key={i_r_0}>
                <div
                  style={{
                    minWidth: "920px",
                    display: "grid",
                    gridTemplateColumns: "36px minmax(0,1.1fr) minmax(0,1fr) 92px 92px 104px minmax(0,1.3fr) 104px",
                    gap: "12px",
                    padding: "12px 20px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--fvb-F1F2EB)",
                    fontSize: "13.5px",
                    opacity: r.opacity,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!r.on}
                    disabled={!!r.dis}
                    onChange={r.onToggle}
                    aria-label={`Include ${r.name}`}
                    style={{ accentColor: "var(--fvc-2A4034)", width: "16px", height: "16px" }}
                  />
                  <div>
                    <div style={{ fontWeight: "500" }}>{r.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                      {r.valueF} · {r.chain}
                    </div>
                  </div>
                  <div style={{ color: "var(--fvc-5B6458)" }}>{r.venue}</div>
                  <select
                    value={r.dd ?? ""}
                    onChange={r.onDd}
                    aria-label={r.name + " drawdown scenario"}
                    style={{
                      padding: "6px",
                      border: "1px solid var(--fvb-DDE1D4)",
                      borderRadius: "8px",
                      fontSize: "13px",
                      background: "var(--fvb-FFFFFF)",
                    }}
                  >
                    <option value="30">−30%</option>
                    <option value="50">−50%</option>
                    <option value="70">−70%</option>
                    <option value="90">−90%</option>
                  </select>
                  <select
                    value={r.cap ?? ""}
                    onChange={r.onCap}
                    aria-label={r.name + " LTV cap"}
                    style={{
                      padding: "6px",
                      border: "1px solid var(--fvb-DDE1D4)",
                      borderRadius: "8px",
                      fontSize: "13px",
                      background: "var(--fvb-FFFFFF)",
                    }}
                  >
                    <option value="30">30%</option>
                    <option value="50">50%</option>
                    <option value="70">70%</option>
                  </select>
                  <div style={{ textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: "500" }}>
                    {<Skel v={r.capF} />}
                  </div>
                  <div style={{ fontSize: "12.5px", color: tc(r.bindColor, "fg"), lineHeight: "1.4" }}>
                    {r.binding}
                    {r.canAllow ? (
                      <>
                        {" "}
                        ·{" "}
                        <button
                          type="button"
                          onClick={v.goPolicy}
                          style={{
                            border: "none",
                            background: "none",
                            padding: "0",
                            fontSize: "12.5px",
                            color: "var(--fvc-3F6B3C)",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          Allow in policy
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div style={{ textAlign: "right", fontFamily: "'DM Mono',monospace", color: "var(--fvc-5B6458)" }}>
                    {r.running}
                  </div>
                </div>
              </Fragment>
            ))}
            <div
              style={{
                minWidth: "920px",
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                padding: "14px 20px",
                background: "var(--fvb-F7F8F3)",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "var(--fvc-5B6458)" }}>
                Selected collateral · capacities never overlap; each asset counts once at its own venue
              </span>
              <span style={{ fontWeight: "600" }}>{<Skel v={v.stTotalF} />}</span>
            </div>
          </div>
        </>
      ) : null}
      {v.creditEmpty ? (
        <>
          <div
            style={{
              marginTop: "30px",
              border: "1px dashed var(--fvb-D5DACB)",
              borderRadius: "18px",
              padding: "clamp(28px,5vw,56px)",
              textAlign: "center",
              background: "var(--fvb-F3F4EE)",
            }}
          >
            <div style={{ fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              No collateral to stress yet.
            </div>
            <div
              style={{
                marginTop: "8px",
                color: "var(--fvc-6F786B)",
                fontSize: "15px",
                lineHeight: "1.5",
                maxWidth: "520px",
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              Assets you hold and allow as collateral in Policy appear here with their capacity under your drawdown.
            </div>
            <div
              style={{ marginTop: "20px", display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}
            >
              <button
                type="button"
                onClick={v.goOverview}
                style={{
                  padding: "12px 18px",
                  borderRadius: "11px",
                  border: "none",
                  background: "var(--fvb-2A4034)",
                  color: "var(--fvc-FFFFFF)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                Connect a wallet
              </button>
              <button
                type="button"
                onClick={v.goPolicy}
                style={{
                  padding: "12px 18px",
                  borderRadius: "11px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  background: "var(--fvb-FFFFFF)",
                  color: "var(--fvc-1E2A22)",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                Open Policy
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
