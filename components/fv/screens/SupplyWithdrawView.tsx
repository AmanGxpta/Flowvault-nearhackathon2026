// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: SUPPLY / WITHDRAW
export function SupplyWithdrawView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--fvc-5B6458)" }}
        >
          {v.opv.amountLabel}{" "}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: `1px solid ${tc(v.opv.amtBorder, "bg")}`,
              borderRadius: "14px",
              padding: "14px 16px",
            }}
          >
            <span style={{ color: "var(--fvc-8A9285)", fontSize: "22px" }}>$</span>
            <input
              value={v.op.amount ?? ""}
              onChange={v.onOpAmount}
              style={{
                flex: "1",
                width: "0",
                border: "none",
                outline: "none",
                fontSize: "30px",
                letterSpacing: "-0.02em",
              }}
            />
            <button
              type="button"
              onClick={v.opMax}
              style={{
                fontSize: "12px",
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid var(--fvb-DDE1D4)",
                background: "var(--fvb-FFFFFF)",
                cursor: "pointer",
              }}
            >
              Max {v.opv.maxF}
            </button>
          </div>
          <span style={{ fontSize: "12.5px", color: tc(v.opv.checkColor, "fg") }}>{v.opv.check}</span>
        </label>
        {v.opIsSupply ? (
          <>
            {v.why.supply ? (
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
                  <span style={{ flex: "1" }}>
                    Collateral stays off: supplying can never put your reserve at liquidation risk.
                  </span>
                  <button
                    type="button"
                    onClick={v.dismissWhy.supply}
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
            <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "16px", overflow: "hidden" }}>
              <div
                style={{
                  padding: "14px 18px",
                  background: "var(--fvb-F4F5EF)",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <span style={{ fontSize: "15.5px", fontWeight: "500", flex: "1" }}>Getting this back</span>
                <span style={{ fontSize: "12px", color: "var(--fvc-6F786B)" }}>Read before you supply</span>
              </div>
              {(v.exitRows || []).map((r: any, i_r_0: number) => (
                <Fragment key={i_r_0}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) auto",
                      gap: "4px 16px",
                      padding: "12px 18px",
                      borderTop: "1px solid var(--fvb-EEF0E8)",
                    }}
                  >
                    <div style={{ fontSize: "13.5px", color: "var(--fvc-4A5349)" }}>{r.k}</div>
                    <div style={{ fontSize: "14px", fontWeight: "500", textAlign: "right", color: tc(r.color, "fg") }}>
                      {r.v}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--fvc-8A9285)" }}>{r.src}</div>
                    <div style={{ fontSize: "11.5px", textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={r.onRetry}
                        style={{
                          border: "none",
                          background: "none",
                          padding: "0",
                          color: "var(--fvc-3F6B3C)",
                          cursor: "pointer",
                          fontSize: "11.5px",
                          textDecoration: "underline",
                          display: r.retryDisplay,
                        }}
                      >
                        Retry read
                      </button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "12px",
                background: "var(--fvb-E9EEDF)",
                fontSize: "13.5px",
                lineHeight: "1.5",
              }}
            >
              {v.opv.netLine}
            </div>
            <label
              style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "13.5px", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={!!v.op.ack}
                onChange={v.onOpAck}
                style={{ marginTop: "3px", accentColor: "var(--fvc-2A4034)" }}
              />
              <span>
                Rhea reports withdrawal timing as unverified. I understand getting this back depends on available
                liquidity at the time.
              </span>
            </label>
          </>
        ) : null}
        {v.opIsWithdraw ? (
          <>
            <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "16px", overflow: "hidden" }}>
              {(v.wdChecks || []).map((r: any, i_r_0: number) => (
                <Fragment key={i_r_0}>
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      padding: "13px 18px",
                      borderBottom: "1px solid var(--fvb-EEF0E8)",
                      fontSize: "13.5px",
                    }}
                  >
                    <span style={{ color: tc(r.color, "fg") }}>{r.glyph}</span>
                    <span style={{ flex: "1", color: "var(--fvc-4A5349)" }}>{r.k}</span>
                    <span style={{ fontWeight: "500" }}>{r.v}</span>
                  </div>
                </Fragment>
              ))}
            </div>
            <label
              style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "13.5px", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={!!v.op.ack}
                onChange={v.onOpAck}
                style={{ marginTop: "3px", accentColor: "var(--fvc-2A4034)" }}
              />
              <span>
                Rhea reports withdrawal timing as unverified. I understand it usually lands in one block but depends on
                available liquidity at the time.
              </span>
            </label>
          </>
        ) : null}
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", alignItems: "center" }}>
          <span style={{ flex: "1", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
            Preparing creates a payload for review. Nothing is signed.
          </span>
          <button
            type="button"
            onClick={v.closeModal}
            style={{
              padding: "12px 18px",
              borderRadius: "11px",
              border: "1px solid var(--fvb-DDE1D4)",
              background: "var(--fvb-FFFFFF)",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={v.opPrepare}
            disabled={!!v.opv.blocked}
            style={{
              padding: "12px 18px",
              borderRadius: "11px",
              border: "none",
              background: tc(v.opv.prepBg, "bg"),
              color: "var(--fvc-FFFFFF)",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            {v.opv.prepLabel}
          </button>
        </div>
      </div>
    </>
  );
}
