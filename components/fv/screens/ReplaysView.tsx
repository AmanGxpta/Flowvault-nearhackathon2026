// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: REPLAYS
export function ReplaysView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          ACCOUNT · REPLAYS
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
          SIMULATED FROM RECORDED RESPONSES
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
        Every path, without a wallet.
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
        {v.replaysIntro}
      </p>
      <div
        style={{
          marginTop: "30px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,300px),1fr))",
          gap: "16px",
        }}
      >
        {(v.replays || []).map((r: any, i_r_0: number) => (
          <Fragment key={i_r_0}>
            <div
              style={{
                background: "var(--fvb-FFFFFF)",
                border: "1px solid var(--fvb-E3E6DB)",
                borderRadius: "18px",
                padding: "22px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                  {r.n}
                </span>
                <span style={{ flex: "1" }}></span>
                <span
                  style={{
                    fontSize: "10.5px",
                    letterSpacing: ".08em",
                    fontWeight: "600",
                    padding: "3px 7px",
                    borderRadius: "5px",
                    background: tc(r.endBg, "bg"),
                    color: tc(r.endColor, "fg"),
                  }}
                >
                  {r.end}
                </span>
              </div>
              <div style={{ marginTop: "12px", fontSize: "19px", fontWeight: "500", letterSpacing: "-0.02em" }}>
                {r.title}
              </div>
              <div
                style={{
                  marginTop: "6px",
                  fontSize: "13.5px",
                  color: "var(--fvc-5B6458)",
                  lineHeight: "1.55",
                  textWrap: "pretty",
                }}
              >
                {r.desc}
              </div>
              <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                Recorded: <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--fvc-4A5349)" }}>{r.src}</span>
              </div>
              <div style={{ flex: "1", minHeight: "14px" }}></div>
              <button
                type="button"
                onClick={r.onClick}
                style={{
                  marginTop: "14px",
                  padding: "11px",
                  borderRadius: "11px",
                  border: "1px solid var(--fvb-DDE1D4)",
                  background: "var(--fvb-FFFFFF)",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--fvc-1E2A22)",
                }}
                className="fvh7"
              >
                Run replay →
              </button>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
