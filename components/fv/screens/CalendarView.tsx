// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: CALENDAR
export function CalendarView({ v }: { v: any }) {
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
            What your money has to do.
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: "16.5px", color: "var(--fvc-5B6458)" }}>
            Dated payments and the reserve they sit on. Each one is paid exactly, on its date, with your approval.
          </p>
        </div>
        <button
          type="button"
          onClick={v.openAdd}
          style={{
            padding: "14px 20px",
            borderRadius: "12px",
            border: "none",
            background: "var(--fvb-2A4034)",
            color: "var(--fvc-FFFFFF)",
            fontSize: "15px",
            fontWeight: "500",
            cursor: "pointer",
          }}
        >
          + Add a payment
        </button>
      </div>
      <div style={{ marginTop: "34px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 520px", minWidth: "0", display: "flex", flexDirection: "column", gap: "24px" }}>
          {(v.obGroups || []).map((g: any, i_g_0: number) => (
            <Fragment key={i_g_0}>
              <div
                style={{
                  background: "var(--fvb-FFFFFF)",
                  border: "1px solid var(--fvb-E3E6DB)",
                  borderRadius: "18px",
                  overflowX: "auto",
                }}
              >
                <div
                  style={{
                    padding: "18px 24px",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                    borderBottom: "1px solid var(--fvb-EEF0E8)",
                  }}
                >
                  <div style={{ fontSize: "17px", fontWeight: "500" }}>{g.title}</div>
                  <div style={{ fontSize: "13px", color: "var(--fvc-8A9285)" }}>{g.sub}</div>
                </div>
                {(g.items || []).map((o: any, i_o_1: number) => (
                  <Fragment key={i_o_1}>
                    <div
                      style={{
                        minWidth: "620px",
                        display: "grid",
                        gridTemplateColumns: "64px minmax(0,1fr) 120px 120px 130px",
                        gap: "16px",
                        alignItems: "center",
                        padding: "16px 24px",
                        borderBottom: "1px solid var(--fvb-F1F2EB)",
                      }}
                    >
                      <div
                        style={{
                          width: "52px",
                          height: "56px",
                          borderRadius: "12px",
                          background: "var(--fvb-F4F5EF)",
                          border: "1px solid var(--fvb-E8EBE1)",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "10.5px",
                            letterSpacing: ".12em",
                            color: "var(--fvc-8A9285)",
                            fontWeight: "600",
                          }}
                        >
                          {o.mon}
                        </div>
                        <div style={{ fontSize: "20px", fontWeight: "500", lineHeight: "1.1" }}>{o.day}</div>
                      </div>
                      <div style={{ minWidth: "0" }}>
                        <div style={{ fontSize: "15.5px", fontWeight: "500" }}>{o.name}</div>
                        <div
                          style={{
                            marginTop: "3px",
                            fontSize: "12.5px",
                            color: "var(--fvc-6F786B)",
                            display: "flex",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span>{o.chain}</span>
                          <span>·</span>
                          <span style={{ fontFamily: "'DM Mono',monospace" }}>{o.recipientShort}</span>
                          <span>·</span>
                          <span>{o.inDays}</span>
                        </div>
                        <div style={{ marginTop: "3px", fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{o.note}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "15.5px", fontWeight: "500" }}>{o.amountF}</div>
                        <div style={{ fontSize: "11.5px", color: "var(--fvc-8A9285)" }}>net to recipient</div>
                      </div>
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
            </Fragment>
          ))}
          {v.noObs ? (
            <>
              <div
                style={{
                  border: "1px dashed var(--fvb-D5DACB)",
                  borderRadius: "18px",
                  padding: "56px",
                  textAlign: "center",
                  background: "var(--fvb-F3F4EE)",
                }}
              >
                <div style={{ fontSize: "26px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                  No dated payments yet.
                </div>
                <div style={{ marginTop: "8px", color: "var(--fvc-6F786B)", fontSize: "15px" }}>
                  Add the first one and FlowVault keeps it out of any strategy until it’s paid.
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
        </div>
        <div
          style={{
            flex: "1 1 300px",
            maxWidth: "420px",
            background: "var(--fvb-FFFFFF)",
            border: "1px solid var(--fvb-E3E6DB)",
            borderRadius: "18px",
            padding: "24px",
            position: "sticky",
            top: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ flex: "1", fontSize: "17px", fontWeight: "500" }}>Plan settings</div>
            <span
              style={{
                fontSize: "11px",
                letterSpacing: ".1em",
                fontWeight: "600",
                padding: "4px 8px",
                borderRadius: "6px",
                background: "var(--fvb-EEF0E8)",
                color: "var(--fvc-4A5349)",
              }}
            >
              VERSION {v.version}
            </span>
          </div>
          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "13px",
                color: "var(--fvc-5B6458)",
              }}
            >
              Reserve floor (always in wallet){" "}
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
                  value={v.planDraft.reserve ?? ""}
                  onChange={v.onPlanReserve}
                  style={{ flex: "1", border: "none", outline: "none", fontSize: "15px", color: "var(--fvc-1E2A22)" }}
                />
                <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>USDC</span>
              </div>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  fontSize: "13px",
                  color: "var(--fvc-5B6458)",
                }}
              >
                Planning horizon{" "}
                <select
                  value={v.planDraft.horizon ?? ""}
                  onChange={v.onPlanHorizon}
                  style={{
                    padding: "10px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    borderRadius: "10px",
                    fontSize: "14px",
                    background: "var(--fvb-FFFFFF)",
                  }}
                >
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
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
                Lead window{" "}
                <select
                  value={v.planDraft.lead ?? ""}
                  onChange={v.onPlanLead}
                  style={{
                    padding: "10px",
                    border: "1px solid var(--fvb-DDE1D4)",
                    borderRadius: "10px",
                    fontSize: "14px",
                    background: "var(--fvb-FFFFFF)",
                  }}
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="5">5 days</option>
                  <option value="7">7 days</option>
                </select>
              </label>
            </div>
            <div style={{ fontSize: "13px", color: "var(--fvc-5B6458)" }}>
              Approved venues{" "}
              <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "13px",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: "var(--fvb-E2EAD6)",
                    color: "var(--fvc-3F6B3C)",
                  }}
                >
                  {v.planRheaLabel}
                </span>
                <span
                  style={{
                    fontSize: "13px",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: "1px dashed var(--fvb-D5DACB)",
                    color: "var(--fvc-8A9285)",
                  }}
                >
                  USDC vaults · not verified
                </span>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13.5px",
                padding: "12px 0",
                borderTop: "1px solid var(--fvb-EEF0E8)",
              }}
            >
              <span style={{ color: "var(--fvc-5B6458)" }}>Max moving cost</span>
              <span style={{ fontWeight: "500" }}>{v.planMoveCost}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13.5px",
                paddingBottom: "12px",
                borderBottom: "1px solid var(--fvb-EEF0E8)",
              }}
            >
              <span style={{ color: "var(--fvc-5B6458)" }}>New borrowing</span>
              <span style={{ fontWeight: "500" }}>{v.planBorrowLabel}</span>
            </div>
            <div
              style={{
                background: "var(--fvb-F4F5EF)",
                borderRadius: "12px",
                padding: "14px",
                fontSize: "13px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fvc-6F786B)" }}>Holdback</span>
                <span style={{ fontWeight: "600" }}>{v.holdbackDraftF}</span>
              </div>
              <div style={{ color: "var(--fvc-8A9285)", fontSize: "12px" }}>
                Reserve + {v.holdbackCountDraft} unpaid payments due in {v.planDraft.horizon} days
              </div>
            </div>
            <button
              type="button"
              onClick={v.savePlan}
              disabled={!!v.planClean}
              style={{
                padding: "12px",
                borderRadius: "10px",
                border: "none",
                background: tc(v.savePlanBg, "bg"),
                color: "var(--fvc-FFFFFF)",
                fontSize: "14.5px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Save plan as v{v.nextVersion}
            </button>
            <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
              Saving a new version supersedes drafts and prepared transactions made under v{v.version}.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
