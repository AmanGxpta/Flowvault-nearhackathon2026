// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: ROADMAP
export function RoadmapView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          LATER · ROADMAP
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
          BUILD DIRECTION · NOT BUILT
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
        Where the account goes next.
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
        Each phase ships when its exit criteria are met. These are directions, not dates or revenue promises.
      </p>
      <div
        style={{
          marginTop: "30px",
          background: "var(--fvb-FFFFFF)",
          border: "1px solid var(--fvb-E3E6DB)",
          borderRadius: "18px",
          overflowX: "auto",
        }}
      >
        <div
          style={{
            minWidth: "680px",
            display: "grid",
            gridTemplateColumns: "52px minmax(0,1.3fr) minmax(0,1fr) 170px",
            gap: "18px",
            padding: "14px 24px",
            fontSize: "11px",
            letterSpacing: ".14em",
            color: "var(--fvc-8A9285)",
            fontWeight: "600",
            borderBottom: "1px solid var(--fvb-EEF0E8)",
          }}
        >
          <div>PHASE</div>
          <div>JOURNEY</div>
          <div>SHIPS WHEN</div>
          <div>STATUS</div>
        </div>
        {(v.roadmap || []).map((r: any, i_r_0: number) => (
          <Fragment key={i_r_0}>
            <div
              style={{
                minWidth: "680px",
                display: "grid",
                gridTemplateColumns: "52px minmax(0,1.3fr) minmax(0,1fr) 170px",
                gap: "18px",
                padding: "18px 24px",
                borderBottom: "1px solid var(--fvb-F1F2EB)",
                alignItems: "start",
              }}
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  background: tc(r.dotBg, "bg"),
                  color: tc(r.dotColor, "fg"),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "600",
                  fontSize: "14px",
                }}
              >
                {r.n}
              </div>
              <div>
                <div style={{ fontSize: "15.5px", fontWeight: "500" }}>{r.title}</div>
                <div style={{ marginTop: "3px", fontSize: "13px", color: "var(--fvc-5B6458)", lineHeight: "1.5" }}>
                  {r.journey}
                </div>
              </div>
              <div style={{ fontSize: "13px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>{r.exit}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                <span
                  style={{
                    fontSize: "10.5px",
                    letterSpacing: ".08em",
                    fontWeight: "600",
                    padding: "3px 7px",
                    borderRadius: "5px",
                    background: tc(r.stBg, "bg"),
                    color: tc(r.stColor, "fg"),
                  }}
                >
                  {r.status}
                </span>
                {r.hasLink ? (
                  <>
                    <button
                      type="button"
                      onClick={r.onLink}
                      style={{
                        border: "none",
                        background: "none",
                        padding: "0",
                        color: "var(--fvc-3F6B3C)",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      {r.linkLabel} ↗
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      <h3 style={{ margin: "36px 0 0", fontSize: "22px", fontWeight: "500", letterSpacing: "-0.02em" }}>
        Stretch work, not started
      </h3>
      <div
        style={{
          marginTop: "14px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,260px),1fr))",
          gap: "14px",
        }}
      >
        {(v.stretch || []).map((x: any, i_x_0: number) => (
          <Fragment key={i_x_0}>
            <div
              style={{
                background: "var(--fvb-F3F4EE)",
                border: "1px dashed var(--fvb-D5DACB)",
                borderRadius: "16px",
                padding: "20px",
              }}
            >
              <div style={{ fontSize: "15.5px", fontWeight: "500" }}>{x.t}</div>
              <div style={{ marginTop: "6px", fontSize: "13px", color: "var(--fvc-5B6458)", lineHeight: "1.55" }}>
                {x.d}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
