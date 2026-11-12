// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { Skel } from "../Skel";
import { tc } from "../theme";

// Design section: PORTFOLIO
export function PortfolioView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          OBSERVE · ONE CAPITAL ACCOUNT
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: "24px", marginTop: "14px", flexWrap: "wrap" }}>
        <div style={{ flex: "1", minWidth: "320px" }}>
          <h1
            style={{
              margin: "0",
              fontSize: "clamp(34px,6vw,52px)",
              fontWeight: "500",
              letterSpacing: "-0.04em",
              lineHeight: "1.05",
            }}
          >
            Everything you own, counted once.
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
            Wallet tokens, Rhea positions and staking on NEAR, Base and Arbitrum. What you can use by a date is shown
            separately from what you own.
          </p>
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--fvc-5B6458)" }}
        >
          Usable by{" "}
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
            {(v.pfDateTabs || []).map((t: any, i_t_0: number) => (
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
      </div>
      {v.pfHas ? (
        <>
          <div
            style={{
              marginTop: "28px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))",
              gap: "12px",
            }}
          >
            {(v.pfBalances || []).map((b: any, i_b_0: number) => (
              <Fragment key={i_b_0}>
                <div
                  style={{
                    background: tc(b.bg, "bg"),
                    color: tc(b.color, "fg"),
                    border: `1px solid ${tc(b.border, "bg")}`,
                    borderRadius: "16px",
                    padding: "18px",
                  }}
                >
                  <div style={{ fontSize: "12.5px", opacity: ".8" }}>{b.label}</div>
                  <div style={{ marginTop: "10px", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.03em" }}>
                    {<Skel v={b.value} />}
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "12px", opacity: ".75", lineHeight: "1.4" }}>{b.sub}</div>
                </div>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: "24px", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
            <div
              style={{
                flex: "1 1 260px",
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "18px",
                padding: "20px",
              }}
            >
              <div style={{ fontSize: "16px", fontWeight: "500" }}>Accounts</div>
              <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                {(v.pfAccounts || []).map((a: any, i_a_0: number) => (
                  <Fragment key={i_a_0}>
                    <div style={{ padding: "12px", border: "1px solid var(--fvb-EEF0E8)", borderRadius: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{ fontSize: "14px", fontWeight: "500", flex: "1", fontFamily: "'DM Mono',monospace" }}
                        >
                          {a.name}
                        </span>
                        <span
                          style={{
                            fontSize: "10.5px",
                            letterSpacing: ".06em",
                            fontWeight: "600",
                            padding: "3px 7px",
                            borderRadius: "5px",
                            background: tc(a.tagBg, "bg"),
                            color: tc(a.tagColor, "fg"),
                          }}
                        >
                          {a.tag}
                        </span>
                        {a.onRemove ? (
                          <button type="button" onClick={a.onRemove} aria-label={"Stop watching " + a.name} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--fvc-8A9285)", fontSize: "15px", padding: "0 2px" }}>×</button>
                        ) : null}
                      </div>
                      <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>{a.sub}</div>
                    </div>
                  </Fragment>
                ))}
                <button
                  type="button"
                  onClick={v.toggleWatch}
                  style={{
                    padding: "10px",
                    borderRadius: "10px",
                    border: "1px dashed var(--fvb-CDD3C2)",
                    background: "transparent",
                    fontSize: "13.5px",
                    color: "var(--fvc-4A5349)",
                    cursor: "pointer",
                  }}
                >
                  + Watch an address
                </button>
                {v.watchOpen ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input value={v.watchDraft ?? ""} onChange={v.onWatchDraft} placeholder="name.near or 0x…" aria-label="Address to watch" style={{ flex: "1", minWidth: "140px", padding: "9px 12px", border: "1px solid var(--fvb-DDE1D4)", borderRadius: "10px", fontSize: "13.5px", fontFamily: "'DM Mono',monospace", outline: "none" }} />
                    <button type="button" onClick={v.watchFirst} style={{ padding: "9px 14px", borderRadius: "10px", border: "1px solid var(--fvb-DDE1D4)", background: "var(--fvb-FFFFFF)", cursor: "pointer", fontSize: "13.5px" }}>{v.watchMine ? "Add" : "Watch"}</button>
                    <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12.5px", color: "var(--fvc-5B6458)", width: "100%", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!v.watchMine} onChange={v.onWatchMine} style={{ accentColor: "var(--fvc-2A4034)" }} />
                      {v.watchMineLabel}
                    </label>
                  </div>
                ) : null}
              </div>
              <div style={{ marginTop: "16px", fontSize: "12px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
                Watching never implies ownership. Watched accounts are excluded from net worth and can never approve or
                move funds.
              </div>
            </div>
            <div
              style={{
                flex: "999 1 560px",
                minWidth: "0",
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "18px",
                overflowX: "auto",
              }}
            >
              <div
                style={{
                  minWidth: "660px",
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.4fr) 84px 104px minmax(0,1fr) 128px",
                  gap: "14px",
                  padding: "14px 22px",
                  fontSize: "11px",
                  letterSpacing: ".14em",
                  color: "var(--fvc-8A9285)",
                  fontWeight: "600",
                  borderBottom: "1px solid var(--fvb-EEF0E8)",
                }}
              >
                <div>EXPOSURE</div>
                <div>CHAIN</div>
                <div style={{ textAlign: "right" }}>VALUE</div>
                <div>USABLE BY {v.pfDlUpper}</div>
                <div>STATE</div>
              </div>
              {(v.pfRows || []).map((r: any, i_r_0: number) => (
                <Fragment key={i_r_0}>
                  <div
                    style={{
                      minWidth: "660px",
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1.4fr) 84px 104px minmax(0,1fr) 128px",
                      gap: "14px",
                      padding: "13px 22px",
                      alignItems: "center",
                      borderBottom: "1px solid var(--fvb-F1F2EB)",
                      fontSize: "14px",
                      opacity: r.opacity,
                    }}
                  >
                    <div style={{ minWidth: "0" }}>
                      <div style={{ fontWeight: "500" }}>{r.name}</div>
                      <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{r.sub}</div>
                    </div>
                    <div style={{ color: "var(--fvc-5B6458)", fontSize: "13px" }}>{r.chain}</div>
                    <div style={{ textAlign: "right", fontWeight: "500", color: tc(r.valColor, "fg") }}>{r.value}</div>
                    <div style={{ minWidth: "0" }}>
                      <div style={{ fontSize: "13px", fontWeight: "500", color: tc(r.byColor, "fg") }}>{r.by}</div>
                      <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{r.path}</div>
                    </div>
                    <div style={{ minWidth: "0" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          letterSpacing: ".08em",
                          fontWeight: "600",
                          padding: "3px 6px",
                          borderRadius: "5px",
                          background: tc(r.tagBg, "bg"),
                          color: tc(r.tagColor, "fg"),
                        }}
                      >
                        {r.tag}
                      </span>
                      <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--fvc-8A9285)" }}>{r.src}</div>
                    </div>
                  </div>
                </Fragment>
              ))}
              <div
                style={{
                  padding: "14px 22px",
                  fontSize: "12.5px",
                  color: "var(--fvc-6F786B)",
                  background: "var(--fvb-F7F8F3)",
                }}
              >
                Coverage: NEAR, Base and Arbitrum of 7 target chains. Unsupported positions are shown as unvalued, never
                zero.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "20px",
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
              <div style={{ fontSize: "17px", fontWeight: "500" }}>Staking lifecycle</div>
              <div style={{ fontSize: "13px", color: "var(--fvc-8A9285)" }}>{v.pfStakeHead}</div>
            </div>
            <div
              style={{
                marginTop: "16px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))",
                gap: "12px",
              }}
            >
              {(v.pfStake || []).map((st: any, i_st_0: number) => (
                <Fragment key={i_st_0}>
                  <div
                    style={{
                      padding: "16px",
                      borderRadius: "14px",
                      background: tc(st.bg, "bg"),
                      border: "1px solid var(--fvb-EEF0E8)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11.5px",
                        letterSpacing: ".14em",
                        fontWeight: "600",
                        color: "var(--fvc-6F786B)",
                      }}
                    >
                      {st.label}
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                      {<Skel v={st.v} />}
                    </div>
                    <div style={{ marginTop: "4px", fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{st.sub}</div>
                  </div>
                </Fragment>
              ))}
            </div>
            <div
              style={{
                marginTop: "14px",
                fontSize: "13.5px",
                color: "var(--fvc-4A5349)",
                lineHeight: "1.6",
                textWrap: "pretty",
              }}
            >
              {v.pfStakeNote}
            </div>
          </div>
        </>
      ) : null}
      {v.pfEmpty ? (
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
            <div style={{ fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>Nothing to count yet.</div>
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
              Connect a wallet or watch an address. FlowVault reads balances and positions; it never holds funds.
            </div>
            <div
              style={{ marginTop: "20px", display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}
            >
              <button
                type="button"
                onClick={v.connectFirst}
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
                Connect wallet
              </button>
              <button
                type="button"
                onClick={v.goOverview}
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
                Watch an address
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
