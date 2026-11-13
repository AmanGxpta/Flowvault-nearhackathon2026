// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { AssistantSwapCard } from "../AssistantSwapCard";
import { Fragment } from "react";
import { tc } from "../theme";

// Design section: ASSISTANT
export function AssistantView({ v }: { v: any }) {
  return (
    <>
      <div
        onClick={v.closeAssistant}
        style={{ position: "fixed", inset: "0", zIndex: "39", background: "rgba(30,42,34,.08)" }}
      ></div>
      <div
        role="dialog"
        aria-label="Ask FlowVault" data-asst-panel=""
        style={{
          position: "fixed",
          top: "0",
          right: "0",
          bottom: "0",
          width: "440px",
          maxWidth: "100%",
          background: "var(--fvb-FFFFFF)",
          borderLeft: "1px solid var(--fvb-E3E6DB)",
          boxShadow: "-24px 0 60px rgba(30,42,34,.12)",
          zIndex: "40",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "22px 22px 16px", borderBottom: "1px solid var(--fvb-EEF0E8)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "var(--fvc-4E7A4A)", fontSize: "18px" }}>✦</span>
            <div style={{ flex: "1", fontSize: "19px", fontWeight: "500", letterSpacing: "-0.02em" }}>
              Ask FlowVault
            </div>
            <button
              type="button"
              onClick={v.closeAssistant}
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                border: "1px solid var(--fvb-E3E6DB)",
                background: "var(--fvb-FFFFFF)",
                cursor: "pointer",
                fontSize: "15px",
                color: "var(--fvc-4A5349)",
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "10.5px",
                letterSpacing: ".08em",
                fontWeight: "600",
                padding: "3px 7px",
                borderRadius: "5px",
                background: "var(--fvb-EEF0E8)",
                color: "var(--fvc-4A5349)",
                whiteSpace: "nowrap",
              }}
            >
              {v.asstTag1}
            </span>
            <span
              style={{
                fontSize: "10.5px",
                letterSpacing: ".08em",
                fontWeight: "600",
                padding: "3px 7px",
                borderRadius: "5px",
                background: "var(--fvb-F6EBDD)",
                color: "var(--fvc-8A5F25)",
                whiteSpace: "nowrap",
              }}
            >
              {v.asstTag2}
            </span>
          </div>
          <div style={{ marginTop: "10px", fontSize: "12.5px", color: "var(--fvc-6F786B)", lineHeight: "1.5" }}>
            The assistant explains the engine’s figures. It can’t sign or approve; only a structured proposal reaches
            the engine, and the engine decides.
          </div>
        </div>
        <div
          data-asst-log=""
          style={{
            flex: "1",
            overflow: "auto",
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          {v.asstEmpty ? (
            <>
              <div style={{ fontSize: "12px", letterSpacing: ".14em", fontWeight: "600", color: "var(--fvc-8A9285)" }}>
                QUESTIONS THE ENGINE CAN EVALUATE
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(v.asstSuggest || []).map((q: any, i_q_0: number) => (
                  <Fragment key={i_q_0}>
                    <button
                      type="button"
                      onClick={q.onClick}
                      style={{
                        textAlign: "left",
                        padding: "12px 14px",
                        borderRadius: "12px",
                        border: "1px solid var(--fvb-E3E6DB)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                        color: "var(--fvc-1E2A22)",
                        lineHeight: "1.4",
                      }}
                      className="fvh8"
                    >
                      {q.q}
                    </button>
                  </Fragment>
                ))}
              </div>
            </>
          ) : null}
          {(v.asstMsgs || []).map((msg: any, i_msg_0: number) => (
            <Fragment key={i_msg_0}>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {msg.isUser ? (
                  <>
                    <div
                      style={{
                        alignSelf: "flex-end",
                        maxWidth: "88%",
                        padding: "10px 14px",
                        borderRadius: "14px 14px 4px 14px",
                        background: "var(--fvb-2B4233)",
                        color: "var(--fvc-EAF0E2)",
                        fontSize: "14px",
                        lineHeight: "1.5",
                      }}
                    >
                      {msg.text}
                    </div>
                    <AssistantSwapCard text={String(msg.text ?? "")} open={(prefill) => { const u = new URL(window.location.href); for (const k of ["buy", "swap", "token"]) u.searchParams.delete(k); u.searchParams.set("swap", prefill); history.replaceState(null, "", u); v.closeAssistant?.(); v.navigate?.("swap"); window.dispatchEvent(new Event("fv-prefill")); }} />
                  </>
                ) : null}
                {msg.isAi ? (
                  <>
                    <div
                      style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--fvc-1E2A22)", textWrap: "pretty" }}
                    >
                      {msg.text}
                    </div>
                    {msg.hasChips ? (
                      <>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {(msg.chips || []).map((q: any, i_q_1: number) => (
                            <Fragment key={i_q_1}>
                              <button
                                type="button"
                                onClick={q.onClick}
                                style={{
                                  padding: "6px 11px",
                                  borderRadius: "999px",
                                  border: "1px solid var(--fvb-CDD6C1)",
                                  background: "var(--fvb-F4F7EE)",
                                  fontSize: "12.5px",
                                  cursor: "pointer",
                                  color: "var(--fvc-2F552D)",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {q.short}
                              </button>
                            </Fragment>
                          ))}
                        </div>
                      </>
                    ) : null}
                    {msg.hasProposal ? (
                      <>
                        <div
                          style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "12px", overflow: "hidden" }}
                        >
                          <div
                            style={{
                              padding: "9px 12px",
                              background: "var(--fvb-F4F5EF)",
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10.5px",
                                letterSpacing: ".14em",
                                fontWeight: "600",
                                color: "var(--fvc-6F786B)",
                                flex: "1",
                              }}
                            >
                              STRUCTURED PROPOSAL
                            </span>
                            <span
                              style={{
                                fontSize: "10.5px",
                                letterSpacing: ".06em",
                                fontWeight: "600",
                                padding: "3px 7px",
                                borderRadius: "5px",
                                background: tc(msg.vBg, "bg"),
                                color: tc(msg.vColor, "fg"),
                              }}
                            >
                              {msg.verdict}
                            </span>
                          </div>
                          <div style={{ padding: "4px 12px" }}>
                            {(msg.rows || []).map((r: any, i_r_1: number) => (
                              <Fragment key={i_r_1}>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: "10px",
                                    padding: "6px 0",
                                    borderBottom: "1px solid var(--fvb-F1F2EB)",
                                    fontSize: "12.5px",
                                  }}
                                >
                                  <span style={{ color: "var(--fvc-8A9285)", fontVariantNumeric: "tabular-nums" }}>
                                    {r.k}
                                  </span>
                                  <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.v}</span>
                                </div>
                              </Fragment>
                            ))}
                          </div>
                          <div
                            style={{ padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: "5px" }}
                          >
                            {(msg.checks || []).map((c: any, i_c_1: number) => (
                              <Fragment key={i_c_1}>
                                <div
                                  style={{ display: "flex", gap: "8px", fontSize: "12.5px", color: tc(c.color, "fg") }}
                                >
                                  <span style={{ width: "12px" }}>{c.glyph}</span>
                                  <span>{c.text}</span>
                                </div>
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}
                    <div style={{ fontSize: "11.5px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
                      Sent to the model: {msg.sent}
                    </div>
                    {msg.hasAction ? (
                      <>
                        <button
                          type="button"
                          onClick={msg.onAction}
                          style={{
                            alignSelf: "flex-start",
                            padding: "9px 14px",
                            borderRadius: "10px",
                            border: "none",
                            background: "var(--fvb-2A4034)",
                            color: "var(--fvc-FFFFFF)",
                            fontSize: "13.5px",
                            cursor: "pointer",
                          }}
                        >
                          {msg.actionLabel}
                        </button>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            </Fragment>
          ))}
        </div>
        <div style={{ padding: "14px 22px 20px", borderTop: "1px solid var(--fvb-EEF0E8)" }}>
          {v.asstHasMsgs ? (
            <>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "10px" }}>
                {(v.asstChips || []).map((q: any, i_q_0: number) => (
                  <Fragment key={i_q_0}>
                    <button
                      type="button"
                      onClick={q.onClick}
                      style={{
                        padding: "5px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--fvb-E3E6DB)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "12px",
                        cursor: "pointer",
                        color: "var(--fvc-4A5349)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {q.short}
                    </button>
                  </Fragment>
                ))}
              </div>
            </>
          ) : null}
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              border: "1px solid var(--fvb-DDE1D4)",
              borderRadius: "12px",
              padding: "6px 6px 6px 14px",
            }}
          >
            <input
              value={v.asstInput ?? ""}
              onChange={v.onAsstInput}
              onKeyDown={v.onAsstKey}
              placeholder="Ask about your plan"
              style={{ flex: "1", border: "none", outline: "none", fontSize: "14px", background: "transparent" }}
            />
            <button
              type="button"
              onClick={v.asstSend}
              style={{
                padding: "9px 14px",
                borderRadius: "9px",
                border: "none",
                background: "var(--fvb-2A4034)",
                color: "var(--fvc-FFFFFF)",
                fontSize: "13.5px",
                cursor: "pointer",
              }}
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
