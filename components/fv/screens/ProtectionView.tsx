// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: PROTECTION
export function ProtectionView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          EXECUTE · PROTECTION
        </span>
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
          PREVIEW
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
          SAMPLE INCIDENT
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
        When a venue looks wrong, see what you can get out.
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
        FlowVault shows the evidence, what is exposed and every exit with its cost. Today you approve each exit
        yourself; automatic exits need a pre-approved emergency mandate.
      </p>
      <div
        style={{
          marginTop: "28px",
          border: "1px solid var(--fvb-EBCFC8)",
          borderRadius: "18px",
          overflow: "hidden",
          background: "var(--fvb-FFFFFF)",
        }}
      >
        <div
          style={{
            padding: "18px 24px",
            background: "var(--fvb-F6E3DE)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              letterSpacing: ".08em",
              fontWeight: "600",
              padding: "4px 8px",
              borderRadius: "6px",
              whiteSpace: "nowrap",
              background: "var(--fvb-9A3F32)",
              color: "var(--fvc-FFFFFF)",
            }}
          >
            SAMPLE
          </span>
          <span
            style={{ flex: "1", minWidth: "220px", fontSize: "17px", fontWeight: "500", color: "var(--fvc-5E2419)" }}
          >
            Rhea Lending · oracle price deviation reported
          </span>
          <span style={{ fontSize: "13px", color: "var(--fvc-7F3528)" }}>Detected 14:02 · confidence medium</span>
        </div>
        <div style={{ padding: "6px 24px 16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,180px) minmax(0,1fr)",
              gap: "16px",
              padding: "12px 0",
              borderTop: "1px solid var(--fvb-EEF0E8)",
              fontSize: "14px",
            }}
          >
            <span style={{ color: "var(--fvc-6F786B)" }}>Evidence</span>
            <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
              Protocol status post (official). On-chain: the NEAR/USDC oracle read 4.1% off the DEX price for 3 blocks.
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,180px) minmax(0,1fr)",
              gap: "16px",
              padding: "12px 0",
              borderTop: "1px solid var(--fvb-EEF0E8)",
              fontSize: "14px",
            }}
          >
            <span style={{ color: "var(--fvc-6F786B)" }}>Against it</span>
            <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
              The DEX pool was shallow at the time, which can explain the gap on its own.
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,180px) minmax(0,1fr)",
              gap: "16px",
              padding: "12px 0",
              borderTop: "1px solid var(--fvb-EEF0E8)",
              fontSize: "14px",
            }}
          >
            <span style={{ color: "var(--fvc-6F786B)" }}>Missing</span>
            <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
              No statement yet on whether borrows were affected.
            </span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        <div
          style={{
            flex: "1 1 320px",
            minWidth: "0",
            background: "var(--fvb-FFFFFF)",
            border: "1px solid var(--fvb-E3E6DB)",
            borderRadius: "18px",
            padding: "22px",
          }}
        >
          <div style={{ fontSize: "15.5px", fontWeight: "500" }}>Affected exposure</div>
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column" }}>
            {(v.protExposure || []).map((r: any, i_r_0: number) => (
              <Fragment key={i_r_0}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    padding: "11px 0",
                    borderTop: "1px solid var(--fvb-EEF0E8)",
                    fontSize: "14px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "500" }}>{r.k}</div>
                    <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{r.sub}</div>
                  </div>
                  <span style={{ fontWeight: "500" }}>{r.v}</span>
                </div>
              </Fragment>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                padding: "11px 0",
                borderTop: "1px solid var(--fvb-E3E6DB)",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              <span>Total exposed</span>
              <span>{v.protTotal}</span>
            </div>
          </div>
        </div>
        <div
          style={{
            flex: "2 1 440px",
            minWidth: "0",
            background: "var(--fvb-FFFFFF)",
            border: "1px solid var(--fvb-E3E6DB)",
            borderRadius: "18px",
            padding: "22px",
          }}
        >
          <div style={{ fontSize: "15.5px", fontWeight: "500" }}>Possible exits</div>
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column" }}>
            {(v.protExits || []).map((x: any, i_x_0: number) => (
              <Fragment key={i_x_0}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto",
                    gap: "4px 16px",
                    padding: "12px 0",
                    borderTop: "1px solid var(--fvb-EEF0E8)",
                    fontSize: "14px",
                  }}
                >
                  <div style={{ fontWeight: "500" }}>{x.k}</div>
                  <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "13px" }}>
                    {x.cost}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{x.sub}</div>
                  <div style={{ textAlign: "right", fontSize: "12px", color: tc(x.tagColor, "fg") }}>{x.tag}</div>
                </div>
              </Fragment>
            ))}
          </div>
          <button
            type="button"
            onClick={v.requestExit}
            disabled={!!v.protNone}
            style={{
              marginTop: "16px",
              padding: "13px 18px",
              borderRadius: "11px",
              border: "none",
              background: "var(--fvb-2A4034)",
              color: "var(--fvc-FFFFFF)",
              fontSize: "14.5px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            Request exit approval →
          </button>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
            Opens the normal withdrawal review for the full Rhea supply. Nothing moves until you approve in your wallet.
          </div>
        </div>
      </div>
    </>
  );
}
