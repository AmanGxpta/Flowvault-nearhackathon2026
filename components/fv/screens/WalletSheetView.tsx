// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: WALLET SHEET
export function WalletSheetView({ v }: { v: any }) {
  return (
    <>
      <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "18px", overflow: "hidden" }}>
        <div
          style={{
            background: "var(--fvb-1F2A24)",
            color: "var(--fvc-FFFFFF)",
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
          }}
        >
          <span
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "6px",
              background: "var(--fvb-C9E86B)",
              color: "var(--fvc-1E2A22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: "700",
            }}
          >
            M
          </span>
          MyNearWallet<span style={{ flex: "1" }}></span>
          <span style={{ fontSize: "12px", opacity: ".7" }}>{v.acc}</span>
        </div>
        <div style={{ padding: "22px" }}>
          <div style={{ fontSize: "13px", color: "var(--fvc-6F786B)" }}>FlowVault is requesting approval for</div>
          <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em" }}>
            {v.wallet.action}
          </div>
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13.5px" }}>
            {(v.wallet.rows || []).map((r: any, i_r_0: number) => (
              <Fragment key={i_r_0}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ color: "var(--fvc-6F786B)" }}>{r.k}</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: "13px" }}>{r.v}</span>
                </div>
              </Fragment>
            ))}
          </div>
          <div style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <button
              type="button"
              onClick={v.wallet.onReject}
              style={{
                padding: "12px",
                borderRadius: "11px",
                border: "1px solid var(--fvb-DDE1D4)",
                background: "var(--fvb-FFFFFF)",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Reject
            </button>
            <button
              type="button"
              onClick={v.walletApprove}
              style={{
                padding: "12px",
                borderRadius: "11px",
                border: "none",
                background: "var(--fvb-1F2A24)",
                color: "var(--fvc-FFFFFF)",
                fontSize: "14px",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Approve
            </button>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--fvc-8A9285)", textAlign: "center" }}>
        Simulated wallet · FlowVault never signs or holds funds.
      </div>
    </>
  );
}
