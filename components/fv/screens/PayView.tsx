// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: PAY
export function PayView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
        <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "16px", padding: "6px 18px" }}>
          {(v.pv.summary || []).map((r: any, i_r_0: number) => (
            <Fragment key={i_r_0}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "11px 0",
                  borderBottom: "1px solid var(--fvb-F1F2EB)",
                  fontSize: "14px",
                }}
              >
                <span style={{ color: "var(--fvc-6F786B)" }}>{r.k}</span>
                <span
                  style={{
                    textAlign: "right",
                    fontFamily: r.font,
                    fontSize: "13.5px",
                    wordBreak: "break-all",
                    maxWidth: "70%",
                  }}
                >
                  {r.v}
                </span>
              </div>
            </Fragment>
          ))}
        </div>
        <div style={{ fontSize: "13px", color: "var(--fvc-5B6458)", lineHeight: "1.5" }}>
          The recipient receives exactly {v.pv.amountF}. Fees and a refundable buffer are added on top of what you send.
        </div>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
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
            onClick={v.payToSources}
            style={{
              padding: "12px 18px",
              borderRadius: "11px",
              border: "none",
              background: "var(--fvb-2A4034)",
              color: "var(--fvc-FFFFFF)",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            Details are correct · check sources →
          </button>
        </div>
      </div>
    </>
  );
}
