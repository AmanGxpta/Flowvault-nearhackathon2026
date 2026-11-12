// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: POLICY
export function PolicyView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          CONFIGURE · ACCOUNT POLICY
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
            background: "var(--fvb-EEF0E8)",
            color: "var(--fvc-4A5349)",
          }}
        >
          REVISION {v.polRev}
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
        Rules every action has to pass.
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
        Checked when an action is prepared and again at wallet handoff. Every change is saved as a revision, and actions
        prepared under an older revision must be re-checked.
      </p>
      <div style={{ marginTop: "30px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 460px", minWidth: "0", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "17px", fontWeight: "500" }}>Limits</div>
            <div
              style={{
                marginTop: "16px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))",
                gap: "14px",
              }}
            >
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--fvc-5B6458)",
                }}
              >
                Per action{" "}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                  }}
                >
                  <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                  <input
                    value={v.polD.perAction ?? ""}
                    onChange={v.onPerAction}
                    style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
                  />
                </div>
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--fvc-5B6458)",
                }}
              >
                Per day{" "}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                  }}
                >
                  <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                  <input
                    value={v.polD.daily ?? ""}
                    onChange={v.onDaily}
                    style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
                  />
                </div>
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--fvc-5B6458)",
                }}
              >
                Max moving cost{" "}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                  }}
                >
                  <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                  <input
                    value={v.polD.maxMove ?? ""}
                    onChange={v.onMaxMove}
                    style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>/ move</span>
                </div>
              </label>
            </div>
            <div
              style={{
                marginTop: "18px",
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                color: "var(--fvc-5B6458)",
              }}
            >
              <span>Used today · running total</span>
              <span style={{ fontWeight: "500", color: "var(--fvc-1E2A22)" }}>{v.polUsedLabel}</span>
            </div>
            <div
              style={{
                marginTop: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "var(--fvb-EEF0E8)",
                overflow: "hidden",
              }}
            >
              <div
                style={{ height: "100%", width: v.polUsedPct, background: "var(--fvb-4E7A4A)", borderRadius: "999px" }}
              ></div>
            </div>
            <div
              style={{
                marginTop: "16px",
                paddingTop: "14px",
                borderTop: "1px solid var(--fvb-EEF0E8)",
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "13.5px",
              }}
            >
              <span style={{ color: "var(--fvc-5B6458)" }}>Reserve floor and dated payments</span>
              <button
                type="button"
                onClick={v.goCalendar}
                style={{
                  border: "none",
                  background: "none",
                  padding: "0",
                  fontSize: "13.5px",
                  color: "var(--fvc-3F6B3C)",
                  cursor: "pointer",
                }}
              >
                {v.polHoldLabel} ↗
              </button>
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "17px", fontWeight: "500" }}>Asset priorities and permitted uses</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>
              P1 is used first among assets that pass every rule. Priority never overrides a rule, a reserve or a cash
              date.
            </div>
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column" }}>
              {(v.polAssets || []).map((a: any, i_a_0: number) => (
                <Fragment key={i_a_0}>
                  <div style={{ padding: "14px 0", borderTop: "1px solid var(--fvb-EEF0E8)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ flex: "1", minWidth: "160px" }}>
                        <div style={{ fontSize: "14.5px", fontWeight: "500" }}>{a.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{a.sub}</div>
                      </div>
                      {a.isProt ? (
                        <>
                          <span
                            style={{
                              fontSize: "10.5px",
                              letterSpacing: ".08em",
                              fontWeight: "600",
                              padding: "3px 7px",
                              borderRadius: "5px",
                              background: "var(--fvb-ECE8F4)",
                              color: "var(--fvc-5B4F8A)",
                            }}
                          >
                            PROTECTED
                          </span>
                        </>
                      ) : null}
                      <div
                        style={{
                          display: "flex",
                          gap: "3px",
                          background: "var(--fvb-F1F2EB)",
                          padding: "3px",
                          borderRadius: "9px",
                        }}
                      >
                        {(a.prio || []).map((t: any, i_t_1: number) => (
                          <Fragment key={i_t_1}>
                            <button
                              type="button"
                              onClick={t.onClick}
                              aria-label={a.name + " priority " + t.label}
                              aria-pressed={t.bg === "#fff"}
                              style={{
                                padding: "5px 10px",
                                border: "none",
                                borderRadius: "7px",
                                background: tc(t.bg, "bg"),
                                fontSize: "12.5px",
                                fontWeight: "600",
                                cursor: "pointer",
                                color: "var(--fvc-1E2A22)",
                              }}
                            >
                              {t.label}
                            </button>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {(a.uses || []).map((u: any, i_u_1: number) => (
                        <Fragment key={i_u_1}>
                          <button
                            type="button"
                            onClick={u.onClick}
                            aria-label={a.name + ": " + String(u.label).replace("✓ ", "")}
                            aria-pressed={String(u.label).startsWith("✓")}
                            style={{
                              padding: "5px 10px",
                              borderRadius: "999px",
                              border: `1px solid ${tc(u.border, "bg")}`,
                              background: tc(u.bg, "bg"),
                              color: tc(u.color, "fg"),
                              fontSize: "12.5px",
                              cursor: "pointer",
                            }}
                          >
                            {u.label}
                          </button>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "24px",
            }}
          >
            <div style={{ fontSize: "17px", fontWeight: "500" }}>Venues and safeguards</div>
            <div style={{ marginTop: "14px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {(v.polVenues || []).map((v: any, i_v_0: number) => (
                <Fragment key={i_v_0}>
                  <button
                    type="button"
                    onClick={v.onClick}
                    style={{
                      padding: "7px 12px",
                      borderRadius: "999px",
                      border: `1px ${tc(v.borderStyle, "bg")} ${tc(v.border, "bg")}`,
                      background: tc(v.bg, "bg"),
                      color: tc(v.color, "fg"),
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    {v.label}
                  </button>
                </Fragment>
              ))}
            </div>
            <div style={{ marginTop: "18px", display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 0",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  fontSize: "13.5px",
                }}
              >
                <span style={{ color: "var(--fvc-5B6458)" }}>Recipients</span>
                <span style={{ fontWeight: "500", textAlign: "right" }}>Calendar addresses only · first-use check</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 0",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  fontSize: "13.5px",
                }}
              >
                <span style={{ color: "var(--fvc-5B6458)" }}>Collateral on supply</span>
                <span style={{ fontWeight: "500", textAlign: "right" }}>Off by default</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 0",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  fontSize: "13.5px",
                }}
              >
                <span style={{ color: "var(--fvc-5B6458)" }}>New borrowing</span>
                <button
                  type="button"
                  onClick={v.toggleBorrow}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "999px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    background: "var(--fvb-FFFFFF)",
                    fontSize: "13px",
                    cursor: "pointer",
                    color: "var(--fvc-1E2A22)",
                  }}
                >
                  {v.polBorrowLabel}
                </button>
              </div>
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ flex: "1", fontSize: "17px", fontWeight: "500" }}>Agents and keys</div>
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
                ON-CHAIN MANDATE · IN PROGRESS
              </span>
            </div>
            <div style={{ marginTop: "6px", fontSize: "13px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>
              Agents may propose, never sign. Each holds a key that can only call propose; every proposal still waits
              for you.
            </div>
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  padding: "12px 0",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1", minWidth: "220px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "500", fontFamily: "'DM Mono',monospace" }}>
                    {v.agentName}
                  </div>
                  <div style={{ marginTop: "3px", fontSize: "12.5px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>
                    {v.agentSub}
                  </div>
                </div>
                {v.hasAgent ? (
                <button
                  type="button"
                  onClick={v.revokeAgent}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "9px",
                    border: "1px solid var(--fvb-E0B4A8)",
                    background: "var(--fvb-FFFFFF)",
                    color: "var(--fvc-9A3F32)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Revoke key
                </button>
                ) : null}
              </div>
              <div
                style={{
                  padding: "12px 0",
                  borderTop: "1px solid var(--fvb-EEF0E8)",
                  display: "flex",
                  gap: "12px",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1", minWidth: "220px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "500" }}>Assistant · NEAR AI Cloud</div>
                  <div style={{ marginTop: "3px", fontSize: "12.5px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>
                    No key · structured proposals only · checked by the engine before you see them
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: "14px",
                fontSize: "11px",
                letterSpacing: ".14em",
                fontWeight: "600",
                color: "var(--fvc-8A9285)",
              }}
            >
              PROPOSALS
            </div>
            <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {(v.proposals || []).map((p: any, i_p_0: number) => (
                <Fragment key={i_p_0}>
                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px solid var(--fvb-EEF0E8)",
                      borderRadius: "12px",
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: "1", minWidth: "220px" }}>
                      <div style={{ fontSize: "14px", fontWeight: "500" }}>{p.text}</div>
                      <div style={{ marginTop: "2px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                        {p.agent} · {p.why}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "10.5px",
                        letterSpacing: ".08em",
                        fontWeight: "600",
                        padding: "3px 7px",
                        borderRadius: "5px",
                        background: tc(p.stBg, "bg"),
                        color: tc(p.stColor, "fg"),
                      }}
                    >
                      {p.stLabel}
                    </span>
                    {p.isPending ? (
                      <>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={p.onReject}
                            style={{
                              padding: "7px 12px",
                              borderRadius: "9px",
                              border: "1px solid var(--fvb-DDE1D4)",
                              background: "var(--fvb-FFFFFF)",
                              fontSize: "13px",
                              cursor: "pointer",
                            }}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={p.onApprove}
                            style={{
                              padding: "7px 12px",
                              borderRadius: "9px",
                              border: "none",
                              background: "var(--fvb-2A4034)",
                              color: "var(--fvc-FFFFFF)",
                              fontSize: "13px",
                              cursor: "pointer",
                            }}
                          >
                            Approve
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </Fragment>
              ))}
            </div>
            <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
              {v.proposalsNote}
            </div>
          </div>
        </div>
        <div
          style={{
            flex: "1 1 320px",
            maxWidth: "420px",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div
            style={{
              borderRadius: "18px",
              padding: "20px",
              background: tc(v.polSave.bg, "bg"),
              border: `1px solid ${tc(v.polSave.border, "bg")}`,
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: "500", color: tc(v.polSave.color, "fg") }}>
              {v.polSave.title}
            </div>
            <div style={{ marginTop: "4px", fontSize: "12.5px", color: tc(v.polSave.color, "fg"), lineHeight: "1.5" }}>
              {v.polSave.sub}
            </div>
            <button
              type="button"
              onClick={v.savePolicy}
              disabled={!!v.polClean}
              style={{
                marginTop: "14px",
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                border: "none",
                background: tc(v.polSave.btnBg, "bg"),
                color: "var(--fvc-FFFFFF)",
                fontSize: "14px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Save as revision {v.polNextRev}
            </button>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "20px",
            }}
          >
            <div style={{ fontSize: "15.5px", fontWeight: "500" }}>Test an action</div>
            <div style={{ marginTop: "2px", fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{v.testAgainst}</div>
            {v.why.test ? (
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
                  <span style={{ flex: "1" }}>This is checked again at wallet handoff.</span>
                  <button
                    type="button"
                    onClick={v.dismissWhy.test}
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
            <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <select
                value={v.test.kind ?? ""}
                onChange={v.onTest.kind}
                aria-label="Action to test"
                style={{
                  padding: "9px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  fontSize: "13.5px",
                  background: "var(--fvb-FFFFFF)",
                }}
              >
                <option value="supply">Supply</option>
                <option value="pay">Pay</option>
                <option value="sell">Sell</option>
                <option value="pledge">Pledge (borrow)</option>
              </select>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  padding: "8px 10px",
                }}
              >
                <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                <input
                  value={v.test.amount ?? ""}
                  onChange={v.onTest.amount}
                  aria-label="Amount to test in USDC"
                  style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "14px" }}
                />
              </div>
              <select
                value={v.test.asset ?? ""}
                onChange={v.onTest.asset}
                aria-label="Asset to test"
                style={{
                  padding: "9px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  fontSize: "13.5px",
                  background: "var(--fvb-FFFFFF)",
                }}
              >
                <option value="usdc">USDC · NEAR</option>
                <option value="evmusdc">USDC · EVM</option>
                <option value="near">NEAR</option>
                <option value="staked">Staked NEAR</option>
                <option value="linear">LiNEAR</option>
                <option value="rnear">rNEAR</option>
                <option value="eth">ETH</option>
              </select>
              <select
                value={v.test.venue ?? ""}
                onChange={v.onTest.venue}
                aria-label="Venue to test"
                style={{
                  padding: "9px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  fontSize: "13.5px",
                  background: "var(--fvb-FFFFFF)",
                }}
              >
                <option value="rhea">Rhea Lending</option>
                <option value="oneclick">1Click</option>
                <option value="native">Validator</option>
                <option value="linear">LiNEAR</option>
                <option value="rnear">rNEAR</option>
                <option value="vault">USDC vault</option>
              </select>
            </div>
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "7px" }}>
              {(v.testRows || []).map((c: any, i_c_0: number) => (
                <Fragment key={i_c_0}>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      fontSize: "13px",
                      color: tc(c.color, "fg"),
                      lineHeight: "1.4",
                    }}
                  >
                    <span style={{ width: "12px" }}>{c.glyph}</span>
                    <span>{c.k}</span>
                  </div>
                </Fragment>
              ))}
            </div>
            <div
              style={{
                marginTop: "14px",
                padding: "11px 13px",
                borderRadius: "10px",
                background: tc(v.testVerdict.bg, "bg"),
                color: tc(v.testVerdict.color, "fg"),
                fontSize: "13px",
                fontWeight: "500",
              }}
            >
              {v.testVerdict.text}
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "20px",
            }}
          >
            <div style={{ fontSize: "15.5px", fontWeight: "500" }}>Where it’s enforced</div>
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "9px", fontSize: "13px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fvc-5B6458)" }}>When an action is prepared</span>
                <span style={{ color: "var(--fvc-3F6B3C)", fontWeight: "500" }}>✓ Built</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fvc-5B6458)" }}>Again at wallet handoff</span>
                <span style={{ color: "var(--fvc-3F6B3C)", fontWeight: "500" }}>✓ Built</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fvc-5B6458)" }}>On-chain mandate for agents</span>
                <button
                  type="button"
                  onClick={v.goRoadmap}
                  style={{
                    border: "none",
                    background: "none",
                    padding: "0",
                    color: "var(--fvc-8A9285)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Roadmap ↗
                </button>
              </div>
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "20px",
            }}
          >
            <div style={{ fontSize: "15.5px", fontWeight: "500" }}>Revisions</div>
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column" }}>
              {(v.revisions || []).map((r: any, i_r_0: number) => (
                <Fragment key={i_r_0}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px minmax(0,1fr)",
                      gap: "10px",
                      padding: "9px 0",
                      borderTop: "1px solid var(--fvb-F1F2EB)",
                    }}
                  >
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: "12.5px", color: "var(--fvc-4A5349)" }}>
                      rev {r.rev}
                    </span>
                    <div>
                      <div style={{ fontSize: "13px", lineHeight: "1.4" }}>{r.what}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--fvc-8A9285)" }}>{r.when}</div>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
