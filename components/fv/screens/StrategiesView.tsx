// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { Skel } from "../Skel";
import { tc } from "../theme";

// Design section: STRATEGIES
export function StrategiesView({ v }: { v: any }) {
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
        Put the surplus to work.
      </h1>
      <p style={{ margin: "14px 0 0", fontSize: "16.5px", color: "var(--fvc-5B6458)" }}>
        Ranked by what each option nets by your payment date, after the cost of getting the money back.
      </p>
      {v.why.strat ? (
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
            <span style={{ flex: "1" }}>Ranked by what you keep by your date, not by headline APR.</span>
            <button
              type="button"
              onClick={v.dismissWhy.strat}
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
      {v.stratHas ? (
        <>
          <div
            style={{
              marginTop: "30px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "20px 24px",
              display: "flex",
              alignItems: "center",
              gap: "28px",
              flexWrap: "wrap",
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
              Amount to compare{" "}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  padding: "9px 12px",
                  width: "180px",
                }}
              >
                <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
                <input
                  value={v.cmpAmount ?? ""}
                  onChange={v.onCmpAmount}
                  style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
                />
                <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>USDC</span>
              </div>
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "13px",
                color: "var(--fvc-5B6458)",
              }}
            >
              Until the payment{" "}
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  background: "var(--fvb-F1F2EB)",
                  padding: "4px",
                  borderRadius: "12px",
                }}
              >
                {(v.cmpTabs || []).map((t: any, i_t_0: number) => (
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
                      }}
                    >
                      {t.label}
                    </button>
                  </Fragment>
                ))}
              </div>
            </div>
            <div
              style={{
                flex: "1",
                minWidth: "240px",
                fontSize: "12.5px",
                color: "var(--fvc-6F786B)",
                lineHeight: "1.6",
                fontFamily: "'DM Mono',monospace",
              }}
            >
              net to date = earnings over {v.cmpDays} {Number(v.cmpDays) === 1 ? "day" : "days"} − return-to-cash cost − withdrawal network cost
            </div>
          </div>
          <div
            style={{
              marginTop: "20px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))",
              gap: "20px",
            }}
          >
            {(v.strategies || []).map((s: any, i_s_0: number) => (
              <Fragment key={i_s_0}>
                <div
                  style={{
                    background: "var(--fvb-FFFFFF)",
                    border: `1px solid ${tc(s.border, "bg")}`,
                    borderRadius: "20px",
                    padding: "26px",
                    display: "flex",
                    flexDirection: "column",
                    opacity: s.opacity,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "50%",
                        background: tc(s.iconBg, "bg"),
                        color: tc(s.iconColor, "fg"),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "17px",
                      }}
                    >
                      {s.icon}
                    </div>
                    <span style={{ flex: "1" }}></span>
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: ".1em",
                        fontWeight: "600",
                        padding: "5px 9px",
                        borderRadius: "6px",
                        background: tc(s.tagBg, "bg"),
                        color: tc(s.tagColor, "fg"),
                      }}
                    >
                      {s.tag}
                    </span>
                  </div>
                  <div style={{ marginTop: "20px", fontSize: "26px", fontWeight: "500", letterSpacing: "-0.03em" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>{s.kind}</div>
                  <div
                    style={{
                      marginTop: "22px",
                      fontSize: "12px",
                      letterSpacing: ".14em",
                      fontWeight: "600",
                      color: "var(--fvc-8A9285)",
                    }}
                  >
                    NET TO {v.cmpDueUpper}
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "40px",
                      fontWeight: "500",
                      letterSpacing: "-0.04em",
                      color: tc(s.netColor, "fg"),
                    }}
                  >
                    {s.net}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{s.netSub}</div>
                  <div
                    style={{
                      marginTop: "18px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "13.5px",
                      paddingTop: "16px",
                      borderTop: "1px solid var(--fvb-EEF0E8)",
                    }}
                  >
                    {(s.rows || []).map((r: any, i_r_1: number) => (
                      <Fragment key={i_r_1}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                          <span style={{ color: "var(--fvc-5B6458)" }}>{r.k}</span>
                          <span
                            style={{ fontFamily: "'DM Mono',monospace", fontSize: "13px", color: tc(r.color, "fg") }}
                          >
                            {<Skel v={r.v} />}
                          </span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "7px" }}>
                    {(s.notes || []).map((n: any, i_n_1: number) => (
                      <Fragment key={i_n_1}>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            fontSize: "13px",
                            color: tc(n.color, "fg"),
                            lineHeight: "1.45",
                          }}
                        >
                          <span>{n.glyph}</span>
                          <span>{n.text}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ flex: "1", minHeight: "16px" }}></div>
                  <button
                    type="button"
                    onClick={s.onClick}
                    disabled={!!s.disabled}
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      borderRadius: "11px",
                      border: tc(s.btnBorder, "bg"),
                      background: tc(s.btnBg, "bg"),
                      color: tc(s.btnColor, "fg"),
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    {s.cta}
                  </button>
                </div>
              </Fragment>
            ))}
          </div>
          <div
            style={{
              marginTop: "20px",
              background: "var(--fvb-E9EEDF)",
              border: "1px solid var(--fvb-DCE4D0)",
              borderRadius: "18px",
              padding: "22px 26px",
              display: "flex",
              alignItems: "center",
              gap: "16px 24px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1" }}>
              <div style={{ fontSize: "18px", fontWeight: "500" }}>Baseline: keep it in your wallet</div>
              <div style={{ marginTop: "4px", fontSize: "14px", color: "var(--fvc-5B6458)" }}>
                Earns $0.00 by {v.cmpDue}. Any option above must beat this after costs. Rates are held constant: a
                scenario, not a forecast.
              </div>
            </div>
            <div style={{ fontSize: "13px", color: "var(--fvc-5B6458)", textAlign: "right" }}>
              Wallet surplus available to supply
              <div style={{ fontSize: "20px", fontWeight: "500", color: "var(--fvc-1E2A22)" }}>{v.walletSurplusF}</div>
            </div>
          </div>
          <div style={{ marginTop: "44px", display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
            <h3 style={{ margin: "0", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              Staking inside the plan
            </h3>
            <span style={{ fontSize: "13.5px", color: "var(--fvc-6F786B)" }}>{v.stkSub}</span>
            <span style={{ flex: "1" }}></span>
            <span
              style={{
                fontSize: "11px",
                letterSpacing: ".08em",
                fontWeight: "600",
                padding: "4px 8px",
                borderRadius: "6px",
                whiteSpace: "nowrap",
                background: "var(--fvb-F6EBDD)",
                color: "var(--fvc-8A5F25)",
              }}
            >
              {v.stkRateTag}
            </span>
          </div>
          <div
            style={{
              marginTop: "16px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "20px 24px",
              display: "flex",
              alignItems: "center",
              gap: "28px",
              flexWrap: "wrap",
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
              NEAR to stake{" "}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  borderRadius: "10px",
                  padding: "9px 12px",
                  width: "170px",
                }}
              >
                <input
                  value={v.stkAmt ?? ""}
                  onChange={v.onStkAmt}
                  style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
                />
                <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>NEAR</span>
              </div>
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "13px",
                color: "var(--fvc-5B6458)",
              }}
            >
              Must be back before{" "}
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  background: "var(--fvb-F1F2EB)",
                  padding: "4px",
                  borderRadius: "12px",
                  flexWrap: "wrap",
                }}
              >
                {(v.stkTabs || []).map((t: any, i_t_0: number) => (
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
            </div>
            <div
              style={{
                flex: "1",
                minWidth: "240px",
                fontSize: "12.5px",
                color: "var(--fvc-6F786B)",
                lineHeight: "1.6",
              }}
            >
              0.50 NEAR always stays liquid so you can unstake later. Earnings are compared only over the days before
              the money has to come back, with your {v.lead}-day lead.
            </div>
          </div>
          <div
            style={{
              marginTop: "16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,260px),1fr))",
              gap: "20px",
            }}
          >
            {(v.stakeCards || []).map((s: any, i_s_0: number) => (
              <Fragment key={i_s_0}>
                <div
                  style={{
                    background: "var(--fvb-FFFFFF)",
                    border: `1px solid ${tc(s.border, "bg")}`,
                    borderRadius: "20px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "50%",
                        background: "var(--fvb-ECE8F4)",
                        color: "var(--fvc-6B5E99)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "16px",
                      }}
                    >
                      N
                    </div>
                    <span style={{ flex: "1" }}></span>
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: ".08em",
                        fontWeight: "600",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        whiteSpace: "nowrap",
                        background: tc(s.tagBg, "bg"),
                        color: tc(s.tagColor, "fg"),
                      }}
                    >
                      {s.tag}
                    </span>
                  </div>
                  <div style={{ marginTop: "16px", fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>{s.kind}</div>
                  <div
                    style={{
                      marginTop: "18px",
                      fontSize: "12px",
                      letterSpacing: ".14em",
                      fontWeight: "600",
                      color: "var(--fvc-8A9285)",
                    }}
                  >
                    NET BEFORE {v.stkDueUpper}
                  </div>
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "32px",
                      fontWeight: "500",
                      letterSpacing: "-0.03em",
                      color: tc(s.netColor, "fg"),
                    }}
                  >
                    {s.net}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{s.netSub}</div>
                  <div
                    style={{
                      marginTop: "16px",
                      paddingTop: "14px",
                      borderTop: "1px solid var(--fvb-EEF0E8)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      fontSize: "13.5px",
                    }}
                  >
                    {(s.rows || []).map((r: any, i_r_1: number) => (
                      <Fragment key={i_r_1}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                          <span style={{ color: "var(--fvc-5B6458)" }}>{r.k}</span>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: "13px" }}>{<Skel v={r.v} />}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ marginTop: "14px", fontSize: "13px", color: "var(--fvc-5B6458)", lineHeight: "1.45" }}>
                    ◷ {s.exit}
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "13px", color: tc(s.fitColor, "fg"), lineHeight: "1.45" }}>
                    {s.fitText}
                  </div>
                  {s.poolOptions ? (
                    <label style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12.5px", color: "var(--fvc-5B6458)" }}>
                      Validator
                      <select
                        value={s.pool ?? ""}
                        onChange={s.onPool}
                        aria-label="Verified validator for native staking"
                        style={{ padding: "8px 10px", border: "1px solid var(--fvb-DDE1D4)", borderRadius: "9px", fontSize: "13px", background: "var(--fvb-FFFFFF)", fontFamily: "'DM Mono',monospace" }}
                      >
                        <option value="">{s.poolPlaceholder}</option>
                        {s.poolOptions.map((o: any) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div style={{ flex: "1", minHeight: "14px" }}></div>
                  <button
                    type="button"
                    onClick={s.onClick}
                    style={{
                      marginTop: "12px",
                      padding: "11px",
                      borderRadius: "11px",
                      border: tc(s.btnBorder, "bg"),
                      background: tc(s.btnBg, "bg"),
                      color: tc(s.btnColor, "fg"),
                      fontSize: "14px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    {s.cta}
                  </button>
                </div>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}
      {v.stratEmpty ? (
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
              {v.stratEmptyTitle}
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
              {v.stratEmptyBody}
            </div>
            <div
              style={{ marginTop: "20px", display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}
            >
              <button
                type="button"
                onClick={v.stratEmptyAction}
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
                {v.stratEmptyCta}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
