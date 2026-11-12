// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: ADD OBLIGATION
export function AddObligationView({ v }: { v: any }) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--fvc-5B6458)" }}
        >
          What is it for?{" "}
          <input
            value={v.form.name ?? ""}
            onChange={v.onForm.name}
            placeholder="e.g. Studio rent"
            style={{
              padding: "12px",
              border: "1px solid var(--fvb-DDE1D4)",
              borderRadius: "10px",
              fontSize: "15px",
              outline: "none",
            }}
          />
        </label>
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))", gap: "12px" }}
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
            Recipient receives (net){" "}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: "1px solid var(--fvb-DDE1D4)",
                borderRadius: "10px",
                padding: "11px 12px",
              }}
            >
              <span style={{ color: "var(--fvc-8A9285)" }}>$</span>
              <input
                value={v.form.amount ?? ""}
                onChange={v.onForm.amount}
                style={{ flex: "1", width: "0", border: "none", outline: "none", fontSize: "15px" }}
              />
              <select
                value={v.form.token ?? "USDC"}
                onChange={v.onForm.token}
                aria-label="Token"
                style={{ border: "none", background: "transparent", fontSize: "12px", color: "var(--fvc-8A9285)", outline: "none", cursor: "pointer" }}
              >
                <option>USDC</option>
                <option>USDT</option>
              </select>
            </div>
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
            Destination chain{" "}
            <select
              value={v.form.chain ?? ""}
              onChange={v.onForm.chain}
              style={{
                padding: "12px",
                border: "1px solid var(--fvb-DDE1D4)",
                borderRadius: "10px",
                fontSize: "14.5px",
                background: "var(--fvb-FFFFFF)",
              }}
            >
              <option>Arbitrum</option>
              <option>Base</option>
              <option>Ethereum</option>
              <option>BNB Chain</option>
              <option>NEAR</option>
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
            Due date{" "}
            <input
              type="date"
              value={v.form.due ?? ""}
              onChange={v.onForm.due}
              style={{
                padding: "11px",
                border: "1px solid var(--fvb-DDE1D4)",
                borderRadius: "10px",
                fontSize: "14.5px",
              }}
            />
          </label>
        </div>
        <label
          style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--fvc-5B6458)" }}
        >
          Recipient address on {v.form.chain}{" "}
          <input
            value={v.form.recipient ?? ""}
            onChange={v.onForm.recipient}
            placeholder={v.addrPlaceholder}
            style={{
              padding: "12px",
              border: `1px solid ${tc(v.addrBorder, "bg")}`,
              borderRadius: "10px",
              fontSize: "14px",
              fontFamily: "'DM Mono',monospace",
              outline: "none",
            }}
          />
          <span style={{ fontSize: "12.5px", color: tc(v.addrMsgColor, "fg") }}>{v.addrMsg}</span>
        </label>
        {v.addrValid ? (
          <>
            <div
              style={{
                background: "var(--fvb-F4F5EF)",
                border: "1px solid var(--fvb-E8EBE1)",
                borderRadius: "14px",
                padding: "16px",
              }}
            >
              <div style={{ fontSize: "12px", letterSpacing: ".14em", fontWeight: "600", color: "var(--fvc-6F786B)" }}>
                FIRST TIME USING THIS ADDRESS
              </div>
              <div
                style={{
                  marginTop: "10px",
                  fontFamily: "'DM Mono',monospace",
                  fontSize: "14px",
                  lineHeight: "1.7",
                  wordBreak: "break-all",
                }}
              >
                {v.addrChunks}
              </div>
              <label
                style={{
                  marginTop: "12px",
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  fontSize: "13.5px",
                  color: "var(--fvc-1E2A22)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={!!v.form.confirmed}
                  onChange={v.onForm.confirmed}
                  style={{ marginTop: "3px", accentColor: "var(--fvc-2A4034)" }}
                />
                <span>
                  I checked the first and last characters ({v.addrEnds}) with the recipient, outside FlowVault.
                </span>
              </label>
            </div>
          </>
        ) : null}
        <label
          style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--fvc-5B6458)" }}
        >
          Note (optional){" "}
          <input
            value={v.form.note ?? ""}
            onChange={v.onForm.note}
            placeholder="Invoice number, context"
            style={{
              padding: "12px",
              border: "1px solid var(--fvb-DDE1D4)",
              borderRadius: "10px",
              fontSize: "14.5px",
              outline: "none",
            }}
          />
        </label>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--fvc-5B6458)" }}>
          Repeats{" "}
          <select
            value={v.form.recurrence ?? "none"}
            onChange={v.onForm.recurrence}
            style={{ padding: "6px 8px", border: "1px solid var(--fvb-DDE1D4)", borderRadius: "8px", fontSize: "13.5px", background: "var(--fvb-FFFFFF)" }}
          >
            <option value="none">No</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          <span style={{ fontSize: "12px", color: "var(--fvc-8A9285)" }}>{v.recurNote}</span>
        </label>
        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "center",
            padding: "14px 16px",
            borderRadius: "12px",
            background: tc(v.impact.bg, "bg"),
            fontSize: "13.5px",
            color: tc(v.impact.color, "fg"),
            lineHeight: "1.5",
          }}
        >
          {v.impact.text}
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
            onClick={v.saveOb}
            disabled={!!v.formInvalid}
            style={{
              padding: "12px 18px",
              borderRadius: "11px",
              border: "none",
              background: tc(v.saveObBg, "bg"),
              color: "var(--fvc-FFFFFF)",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
            }}
          >
            Add to plan as v{v.nextVersion}
          </button>
        </div>
      </div>
    </>
  );
}
