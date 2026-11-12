// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: OPPORTUNITIES
export function OpportunitiesView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", letterSpacing: ".22em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
          DECIDE · OPPORTUNITIES
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
          SAMPLE REPORT
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
        Researched before anyone’s money goes in.
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
        Each opportunity gets a sourced report, a manual pilot with the owner’s own capital, and only then an approved
        template that can become a vault.
      </p>
      <div
        style={{
          marginTop: "28px",
          background: "var(--fvb-FFFFFF)",
          border: "1px solid var(--fvb-E3E6DB)",
          borderRadius: "18px",
          padding: "22px 24px",
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-4E7A4A)",
                border: "1.5px solid var(--fvb-4E7A4A)",
                color: "var(--fvc-FFFFFF)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✓
            </span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-9DB48C)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-1E2A22)" }}>Discovered</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>Nov 4 · agent scan</div>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-4E7A4A)",
                border: "1.5px solid var(--fvb-4E7A4A)",
                color: "var(--fvc-FFFFFF)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✓
            </span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-9DB48C)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-1E2A22)" }}>Reviewed</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>Nov 10 · report v2</div>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-C9E86B)",
                border: "1.5px solid var(--fvb-C9E86B)",
                color: "var(--fvc-1E2A22)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ●
            </span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-E3E6DB)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-1E2A22)" }}>Piloted</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>next · owner’s $1,500</div>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-FFFFFF)",
                border: "1.5px solid var(--fvb-D5DACB)",
                color: "var(--fvc-8A9285)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            ></span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-E3E6DB)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-8A9285)" }}>Template</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>approved config</div>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-FFFFFF)",
                border: "1.5px solid var(--fvb-D5DACB)",
                color: "var(--fvc-8A9285)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            ></span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-E3E6DB)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-8A9285)" }}>Vault</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>deployed, capped</div>
        </div>
        <div style={{ flex: "1 1 120px", minWidth: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "22px",
                height: "22px",
                flexShrink: "0",
                borderRadius: "50%",
                background: "var(--fvb-FFFFFF)",
                border: "1.5px solid var(--fvb-D5DACB)",
                color: "var(--fvc-8A9285)",
                fontSize: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            ></span>
            <span style={{ flex: "1", height: "2px", background: "var(--fvb-E3E6DB)" }}></span>
          </div>
          <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--fvc-8A9285)" }}>Monitored</div>
          <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>paused or retired</div>
        </div>
      </div>
      <div style={{ marginTop: "20px", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" }}>
        <div
          style={{
            flex: "999 1 520px",
            minWidth: "0",
            background: "var(--fvb-FFFFFF)",
            border: "1px solid var(--fvb-E3E6DB)",
            borderRadius: "18px",
            padding: "26px",
          }}
        >
          <div style={{ fontSize: "12px", letterSpacing: ".16em", fontWeight: "600", color: "var(--fvc-8A9285)" }}>
            SAMPLE · REPORT V2 · NOV 10
          </div>
          <div style={{ marginTop: "8px", fontSize: "24px", fontWeight: "500", letterSpacing: "-0.02em" }}>
            USDC lending market on a new NEAR protocol
          </div>
          <div style={{ marginTop: "14px" }}>
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
              <span style={{ color: "var(--fvc-6F786B)" }}>What it does</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                Lends USDC to over-collateralised borrowers. The rate follows utilisation.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Contracts and permissions</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                2 contracts, upgradeable by a 3-of-5 multisig. The admin can pause withdrawals.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Audits</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                One audit (2026), two medium findings fixed. No bug bounty yet.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Liquidity and exit</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                $3.1M supplied, 62% utilised. Withdrawals are limited by idle cash in the market.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Fees and rewards</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                Headline 14.2%, of which 5.1 points are token emissions ending Dec 31.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Backers</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                Two named funds, from the team’s own post. A sourced signal, not a technical one.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Capacity</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                About $150K before the rate falls below Rhea’s.
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
              <span style={{ color: "var(--fvc-6F786B)" }}>Evidence</span>
              <span style={{ color: "var(--fvc-1E2A22)", lineHeight: "1.5" }}>
                4 sources · 2 contract reads · assumptions listed in the report
              </span>
            </div>
          </div>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              background: "var(--fvb-FFFFFF)",
              border: "1px solid var(--fvb-E3E6DB)",
              borderRadius: "18px",
              padding: "22px",
            }}
          >
            <div style={{ fontSize: "15.5px", fontWeight: "500" }}>How it could fail</div>
            <div
              style={{
                marginTop: "10px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                fontSize: "13.5px",
                color: "var(--fvc-4A5349)",
                lineHeight: "1.5",
              }}
            >
              <div>Utilisation hits 100%, so exits wait for borrowers to repay.</div>
              <div>The admin pauses withdrawals during an incident.</div>
              <div>Emissions end and the rate falls to about 9%.</div>
            </div>
          </div>
          <div
            style={{
              background: "var(--fvb-2B4233)",
              color: "var(--fvc-EAF0E2)",
              borderRadius: "18px",
              padding: "22px",
            }}
          >
            <div style={{ fontSize: "12px", letterSpacing: ".16em", fontWeight: "600", color: "var(--fvc-A9BDA0)" }}>
              ENGINE VERDICT FOR YOUR PLAN
            </div>
            <div style={{ marginTop: "10px", fontSize: "15px", lineHeight: "1.55" }}>
              Not eligible yet. It isn’t an approved venue, and getting money out depends on utilisation, which can miss
              a payment date.
            </div>
            <button
              type="button"
              disabled={!!true}
              style={{
                marginTop: "16px",
                width: "100%",
                padding: "12px",
                borderRadius: "11px",
                border: "1px solid rgba(255,255,255,.2)",
                background: "transparent",
                color: "var(--fvc-A9BDA0)",
                fontSize: "14px",
                cursor: "not-allowed",
              }}
            >
              Manual pilots coming soon
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
