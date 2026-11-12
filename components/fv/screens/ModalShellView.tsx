// Generated from docs/design/FlowVault.html by the design converter, then edited by hand.
/* eslint-disable */
import { Fragment } from "react";
import { tc } from "../theme";
import { WalletSheetView } from "./WalletSheetView";
import { AddObligationView } from "./AddObligationView";
import { SupplyWithdrawView } from "./SupplyWithdrawView";
import { PayView } from "./PayView";

// Design section: MODAL SHELL
export function ModalShellView({ v }: { v: any }) {
  return (
    <>
      <div
        onClick={v.closeModal}
        style={{
          position: "fixed",
          inset: "0",
          background: "rgba(30,42,34,.34)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: "50",
          padding: "16px",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={v.dialogLabel || "FlowVault dialog"}
          tabIndex={-1}
          onClick={v.stop}
          style={{
            width: "680px",
            maxWidth: "100%",
            maxHeight: "92%",
            overflow: "auto",
            background: "var(--fvb-FFFFFF)",
            borderRadius: "22px",
            boxShadow: "0 30px 80px rgba(30,42,34,.25)",
          }}
        >
          <div style={{ padding: "26px 30px 0", display: "flex", alignItems: "flex-start", gap: "16px" }}>
            <div style={{ flex: "1" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span
                  style={{ fontSize: "11.5px", letterSpacing: ".2em", fontWeight: "600", color: "var(--fvc-6F786B)" }}
                >
                  {v.m.eyebrow}
                </span>
                {v.replayOn ? (
                  <>
                    <span
                      style={{
                        fontSize: "10.5px",
                        letterSpacing: ".08em",
                        fontWeight: "600",
                        padding: "3px 7px",
                        borderRadius: "5px",
                        background: "var(--fvb-E7ECF3)",
                        color: "var(--fvc-3F5A7A)",
                      }}
                    >
                      REPLAY · NOTHING IS SAVED
                    </span>
                  </>
                ) : null}
              </div>
              <div style={{ marginTop: "8px", fontSize: "26px", fontWeight: "500", letterSpacing: "-0.03em" }}>
                {v.m.title}
              </div>
            </div>
            <button
              type="button"
              onClick={v.closeModal}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                border: "1px solid var(--fvb-E3E6DB)",
                background: "var(--fvb-FFFFFF)",
                cursor: "pointer",
                fontSize: "16px",
                color: "var(--fvc-4A5349)",
              }}
            >
              ✕
            </button>
          </div>
          {v.m.hasSteps ? (
            <>
              <div style={{ margin: "18px 30px 0", display: "flex", gap: "6px" }}>
                {(v.m.steps || []).map((s: any, i_s_0: number) => (
                  <Fragment key={i_s_0}>
                    <div style={{ flex: "1" }}>
                      <div style={{ height: "3px", borderRadius: "3px", background: tc(s.bar, "bg") }}></div>
                      <div
                        style={{ marginTop: "7px", fontSize: "12px", color: tc(s.color, "fg"), fontWeight: s.weight }}
                      >
                        {s.label}
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            </>
          ) : null}
          <div style={{ padding: "22px 30px 28px" }}>
            {v.isConfirm ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  <div
                    style={{ fontSize: "14.5px", color: "var(--fvc-4A5349)", lineHeight: "1.6", textWrap: "pretty" }}
                  >
                    {v.confirmText}
                  </div>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={v.closeModal}
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
                      {v.confirmNoLabel ?? "Keep it protected"}
                    </button>
                    <button
                      type="button"
                      onClick={v.confirmYes}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-E0B4A8)",
                        background: "var(--fvb-FFFFFF)",
                        color: "var(--fvc-9A3F32)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      {v.confirmYesLabel ?? "Remove protection"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.isIntent ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "16px",
                      color: "var(--fvc-4A5349)",
                      lineHeight: "1.4",
                    }}
                  >
                    <span>Pay</span>
                    <input
                      value={v.intent.amount ?? ""}
                      onChange={v.onIntent.amount}
                      aria-label="Amount"
                      style={{
                        width: "110px",
                        padding: "9px 10px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "15px",
                        outline: "none",
                      }}
                    />
                    <select
                      value={v.intent.asset ?? ""}
                      onChange={v.onIntent.asset}
                      aria-label="Token"
                      style={{
                        padding: "9px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "14.5px",
                        background: "var(--fvb-FFFFFF)",
                      }}
                    >
                      <option>USDT</option>
                      <option>USDC</option>
                    </select>
                    <span>to</span>
                    <select
                      value={v.intent.rid ?? ""}
                      onChange={v.onIntent.rid}
                      aria-label="Recipient"
                      style={{
                        padding: "9px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "14.5px",
                        background: "var(--fvb-FFFFFF)",
                        maxWidth: "100%",
                      }}
                    >
                      {(v.intentRecips || []).map((r: any, i_r_0: number) => (
                        <Fragment key={i_r_0}>
                          <option value={r.id}>{r.label}</option>
                        </Fragment>
                      ))}
                      <option value="new">New recipient…</option>
                    </select>
                    <span>on</span>
                    <select
                      value={v.intent.chain ?? ""}
                      onChange={v.onIntent.chain}
                      aria-label="Chain"
                      style={{
                        padding: "9px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "14.5px",
                        background: "var(--fvb-FFFFFF)",
                      }}
                    >
                      <option>BNB Chain</option>
                      <option>Arbitrum</option>
                      <option>Base</option>
                      <option>Ethereum</option>
                      <option>NEAR</option>
                    </select>
                    <span>by</span>
                    <input
                      type="date"
                      value={v.intent.due ?? ""}
                      onChange={v.onIntent.due}
                      aria-label="Date"
                      style={{
                        padding: "8px 10px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        borderRadius: "10px",
                        fontSize: "14.5px",
                      }}
                    />
                  </div>
                  {v.intentNew ? (
                    <>
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          fontSize: "13px",
                          color: "var(--fvc-5B6458)",
                        }}
                      >
                        Recipient address on {v.intent.chain}{" "}
                        <input
                          value={v.intent.addr ?? ""}
                          onChange={v.onIntent.addr}
                          placeholder="0x… or name.near"
                          style={{
                            padding: "11px",
                            border: "1px solid var(--fvb-DDE1D4)",
                            borderRadius: "10px",
                            fontSize: "14px",
                            fontFamily: "'DM Mono',monospace",
                            outline: "none",
                          }}
                        />
                        <span style={{ fontSize: "12.5px", color: tc(v.intentAddrColor, "fg") }}>
                          {v.intentAddrMsg}
                        </span>
                      </label>
                    </>
                  ) : null}
                  <div
                    style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center", fontSize: "14px" }}
                  >
                    <label style={{ display: "flex", gap: "8px", alignItems: "center", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!v.intent.save}
                        onChange={v.onIntent.save}
                        style={{ accentColor: "var(--fvc-2A4034)" }}
                      />
                      Save as dated payment
                    </label>
                    <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      Repeats{" "}
                      <select
                        value={v.intent.repeats ?? ""}
                        onChange={v.onIntent.repeats}
                        style={{
                          padding: "6px 8px",
                          border: "1px solid var(--fvb-DDE1D4)",
                          borderRadius: "8px",
                          fontSize: "13.5px",
                          background: "var(--fvb-FFFFFF)",
                        }}
                      >
                        <option value="none">No</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </label>
                  </div>
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      background: "var(--fvb-F4F5EF)",
                      fontSize: "13.5px",
                      color: "var(--fvc-5B6458)",
                      lineHeight: "1.5",
                    }}
                  >
                    {v.intentNote}
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
                      onClick={v.submitIntent}
                      disabled={!!v.intentInvalid}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "none",
                        background: tc(v.intentBtnBg, "bg"),
                        color: "var(--fvc-FFFFFF)",
                        fontSize: "14px",
                        fontWeight: "500",
                        cursor: "pointer",
                      }}
                    >
                      Compare sources →
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.wallet.show ? <WalletSheetView v={v} /> : null}
            {v.isAdd ? <AddObligationView v={v} /> : null}
            {v.isOpReview ? <SupplyWithdrawView v={v} /> : null}
            {v.isOpPrepared ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: ".1em",
                        fontWeight: "600",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: "var(--fvb-E7ECF3)",
                        color: "var(--fvc-3F5A7A)",
                      }}
                    >
                      PREPARED · NOT SIGNED
                    </span>
                    <span style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>
                      {v.opv.prepTime}
                    </span>
                  </div>
                  <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "16px", padding: "6px 18px" }}>
                    {(v.opv.payload || []).map((r: any, i_r_0: number) => (
                      <Fragment key={i_r_0}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            padding: "10px 0",
                            borderBottom: "1px solid var(--fvb-F1F2EB)",
                            fontSize: "13.5px",
                          }}
                        >
                          <span style={{ color: "var(--fvc-6F786B)" }}>{r.k}</span>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: "13px", textAlign: "right" }}>
                            {r.v}
                          </span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={v.opBack}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={v.opToWallet}
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
                      Open wallet to approve →
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.isOpTracking ? (
              <>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {(v.opv.track || []).map((st: any, i_st_0: number) => (
                    <Fragment key={i_st_0}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "28px minmax(0,1fr) auto",
                          gap: "12px",
                          padding: "12px 0",
                          borderBottom: "1px solid var(--fvb-F1F2EB)",
                        }}
                      >
                        <div
                          style={{
                            width: "22px",
                            height: "22px",
                            borderRadius: "50%",
                            background: tc(st.dotBg, "bg"),
                            border: `1.5px solid ${tc(st.dotBorder, "bg")}`,
                            color: "var(--fvc-FFFFFF)",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            animation: st.anim,
                          }}
                        >
                          {st.glyph}
                        </div>
                        <div>
                          <div style={{ fontSize: "14.5px", fontWeight: "500", color: tc(st.labelColor, "fg") }}>
                            {st.label}
                          </div>
                          <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{st.detail}</div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                          <div>{st.time}</div>
                          <div style={{ fontFamily: "'DM Mono',monospace", color: "var(--fvc-3F6B3C)" }}>{st.hash}</div>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "16px",
                      borderRadius: "14px",
                      background: tc(v.opv.finBg, "bg"),
                      color: tc(v.opv.finColor, "fg"),
                      fontSize: "14px",
                      lineHeight: "1.5",
                    }}
                  >
                    {v.opv.finText}
                  </div>
                  <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={v.goActivityClose}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      {v.replayOn ? "Back to replays" : "View in Activity"}
                    </button>
                    <button
                      type="button"
                      onClick={v.closeModal}
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
                      {v.opv.closeLabel}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.payConfirm ? <PayView v={v} /> : null}
            {v.paySources ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      fontSize: "13.5px",
                    }}
                  >
                    <span style={{ color: "var(--fvc-5B6458)" }}>
                      Chosen plan: <span style={{ color: "var(--fvc-1E2A22)", fontWeight: "600" }}>{v.pv.chosen}</span>
                    </span>
                    <span style={{ color: "var(--fvc-5B6458)" }}>{v.pv.chosenCost}</span>
                  </div>
                  {(v.pv.legs || []).map((l: any, i_l_0: number) => (
                    <Fragment key={i_l_0}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "32px minmax(0,1fr) auto",
                          gap: "14px",
                          alignItems: "center",
                          padding: "16px 18px",
                          border: `1px solid ${tc(l.border, "bg")}`,
                          borderRadius: "14px",
                          background: tc(l.bg, "bg"),
                        }}
                      >
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: tc(l.dotBg, "bg"),
                            color: "var(--fvc-FFFFFF)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "13px",
                            fontWeight: "600",
                          }}
                        >
                          {l.glyph}
                        </div>
                        <div>
                          <div style={{ fontSize: "14.5px", fontWeight: "500" }}>{l.title}</div>
                          <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)", marginTop: "2px" }}>
                            {l.sub}
                          </div>
                        </div>
                        <div style={{ fontSize: "15px", fontWeight: "500" }}>{l.amount}</div>
                      </div>
                    </Fragment>
                  ))}
                  <div style={{ border: "1px solid var(--fvb-E3E6DB)", borderRadius: "14px", overflow: "hidden" }}>
                    <div
                      style={{
                        padding: "9px 16px",
                        background: "var(--fvb-F4F5EF)",
                        fontSize: "11px",
                        letterSpacing: ".14em",
                        fontWeight: "600",
                        color: "var(--fvc-6F786B)",
                      }}
                    >
                      OTHER SOURCES COMPARED
                    </div>
                    {(v.pv.alts || []).map((a: any, i_a_0: number) => (
                      <Fragment key={i_a_0}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            padding: "10px 16px",
                            borderTop: "1px solid var(--fvb-EEF0E8)",
                            fontSize: "13px",
                          }}
                        >
                          <span style={{ color: "var(--fvc-1E2A22)" }}>{a.name}</span>
                          <span style={{ color: tc(a.color, "fg"), textAlign: "right" }}>{a.note}</span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "13.5px",
                      padding: "2px 4px",
                      color: "var(--fvc-5B6458)",
                    }}
                  >
                    <span>Reserve after payment</span>
                    <span style={{ fontWeight: "500", color: "var(--fvc-1E2A22)" }}>{v.pv.reserveAfter}</span>
                  </div>
                  <div style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)", lineHeight: "1.5" }}>
                    {v.pv.sourcesNote}
                  </div>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={v.payBack}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={v.pv.sourcesAction}
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
                      {v.pv.sourcesCta}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.payQuote ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: ".1em",
                        fontWeight: "600",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: "var(--fvb-E7ECF3)",
                        color: "var(--fvc-3F5A7A)",
                      }}
                    >
                      {v.pv.quoteTag}
                    </span>
                    <span style={{ flex: "1", fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>{v.pv.quoteSrc}</span>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        fontFamily: "'DM Mono',monospace",
                        color: tc(v.pv.expColor, "fg"),
                      }}
                    >
                      {v.pv.expLabel}
                    </span>
                  </div>
                  {v.pv.expired ? (
                    <>
                      <div
                        style={{
                          padding: "14px 16px",
                          borderRadius: "12px",
                          background: "var(--fvb-F6EBDD)",
                          color: "var(--fvc-7A521E)",
                          fontSize: "13.5px",
                          lineHeight: "1.5",
                        }}
                      >
                        This quote expired before any deposit. Nothing was sent. Get a new quote to continue; the old
                        deposit address is no longer valid.
                      </div>
                    </>
                  ) : null}
                  <div
                    style={{
                      border: "1px solid var(--fvb-E3E6DB)",
                      borderRadius: "16px",
                      overflow: "hidden",
                      opacity: v.pv.quoteOpacity,
                    }}
                  >
                    <div
                      style={{
                        padding: "18px",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "16px",
                        background: "var(--fvb-F7F8F3)",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12px", color: "var(--fvc-6F786B)" }}>You send</div>
                        <div
                          style={{ marginTop: "4px", fontSize: "26px", fontWeight: "500", letterSpacing: "-0.02em" }}
                        >
                          {v.pv.depositF}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "var(--fvc-6F786B)" }}>Recipient gets exactly</div>
                        <div
                          style={{ marginTop: "4px", fontSize: "26px", fontWeight: "500", letterSpacing: "-0.02em" }}
                        >
                          {v.pv.amountF}
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "6px 18px" }}>
                      {(v.pv.quoteRows || []).map((r: any, i_r_0: number) => (
                        <Fragment key={i_r_0}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "12px",
                              padding: "10px 0",
                              borderBottom: "1px solid var(--fvb-F1F2EB)",
                              fontSize: "13.5px",
                            }}
                          >
                            <span style={{ color: "var(--fvc-6F786B)" }}>{r.k}</span>
                            <span
                              style={{ fontFamily: "'DM Mono',monospace", fontSize: "13px", color: tc(r.color, "fg") }}
                            >
                              {r.v}
                            </span>
                          </div>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={v.payBack}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={v.pv.quoteAction}
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
                      {v.pv.quoteCta}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.payTracking ? (
              <>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {(v.pv.track || []).map((st: any, i_st_0: number) => (
                    <Fragment key={i_st_0}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "28px minmax(0,1fr) auto",
                          gap: "12px",
                          padding: "11px 0",
                          borderBottom: "1px solid var(--fvb-F1F2EB)",
                        }}
                      >
                        <div
                          style={{
                            width: "22px",
                            height: "22px",
                            borderRadius: "50%",
                            background: tc(st.dotBg, "bg"),
                            border: `1.5px solid ${tc(st.dotBorder, "bg")}`,
                            color: "var(--fvc-FFFFFF)",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            animation: st.anim,
                          }}
                        >
                          {st.glyph}
                        </div>
                        <div>
                          <div style={{ fontSize: "14.5px", fontWeight: "500", color: tc(st.labelColor, "fg") }}>
                            {st.label}
                          </div>
                          <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{st.detail}</div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: "12px", color: "var(--fvc-8A9285)" }}>
                          <div>{st.time}</div>
                          <div style={{ fontFamily: "'DM Mono',monospace", color: "var(--fvc-3F6B3C)" }}>{st.hash}</div>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                  {v.pv.isStuck ? (
                    <>
                      <div
                        style={{
                          marginTop: "16px",
                          border: "1px solid var(--fvb-EBCFC8)",
                          borderRadius: "14px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            padding: "14px 16px",
                            background: "var(--fvb-F6E3DE)",
                            color: "var(--fvc-7F3528)",
                            fontSize: "14px",
                            fontWeight: "500",
                          }}
                        >
                          Status unknown. Your deposit is safe to trace; do not pay again.
                        </div>
                        <div style={{ padding: "6px 16px" }}>
                          {(v.pv.recovery || []).map((r: any, i_r_0: number) => (
                            <Fragment key={i_r_0}>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: "12px",
                                  padding: "9px 0",
                                  borderBottom: "1px solid var(--fvb-F4ECE9)",
                                  fontSize: "13px",
                                }}
                              >
                                <span style={{ color: "var(--fvc-6F786B)" }}>{r.k}</span>
                                <span style={{ fontFamily: "'DM Mono',monospace" }}>{r.v}</span>
                              </div>
                            </Fragment>
                          ))}
                        </div>
                        <div
                          style={{
                            padding: "12px 16px",
                            display: "flex",
                            gap: "10px",
                            alignItems: "center",
                            fontSize: "12.5px",
                            color: "var(--fvc-7F3528)",
                          }}
                        >
                          <span style={{ flex: "1" }}>
                            “Pay again” stays disabled until 1Click returns success or refund, so this can never pay
                            twice.
                          </span>
                          <button
                            type="button"
                            onClick={v.payRecheck}
                            style={{
                              padding: "9px 14px",
                              borderRadius: "10px",
                              border: "1px solid var(--fvb-DDBDB4)",
                              background: "var(--fvb-FFFFFF)",
                              fontSize: "13px",
                              cursor: "pointer",
                            }}
                          >
                            Check status again
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "16px",
                      borderRadius: "14px",
                      background: tc(v.pv.finBg, "bg"),
                      color: tc(v.pv.finColor, "fg"),
                      fontSize: "14px",
                      lineHeight: "1.5",
                    }}
                  >
                    {v.pv.finText}
                  </div>
                  <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      onClick={v.goActivityClose}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "11px",
                        border: "1px solid var(--fvb-DDE1D4)",
                        background: "var(--fvb-FFFFFF)",
                        fontSize: "14px",
                        cursor: "pointer",
                      }}
                    >
                      View in Activity
                    </button>
                    <button
                      type="button"
                      onClick={v.pv.finAction}
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
                      {v.pv.finCta}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {v.showOutcome ? (
              <>
                <div
                  style={{
                    marginTop: "22px",
                    padding: "10px 12px",
                    border: "1px dashed var(--fvb-CDD3C2)",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                    fontSize: "12px",
                    color: "var(--fvc-6F786B)",
                  }}
                >
                  <span>Prototype outcome:</span>
                  {(v.outcomes || []).map((o: any, i_o_0: number) => (
                    <Fragment key={i_o_0}>
                      <button
                        type="button"
                        onClick={o.onClick}
                        style={{
                          padding: "5px 10px",
                          borderRadius: "999px",
                          border: `1px solid ${tc(o.border, "bg")}`,
                          background: tc(o.bg, "bg"),
                          color: tc(o.color, "fg"),
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        {o.label}
                      </button>
                    </Fragment>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
