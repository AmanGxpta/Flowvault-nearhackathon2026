"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- API JSON from /api/funding and wallet errors */
// Convert to NEAR: USDC on Ethereum, Base, Arbitrum or Solana → NEAR in your NEAR account, then stake it.
// Steps: preview quote → send the USDC from your Ethereum wallet (you approve it there) → 1Click delivers
// wNEAR → unwrap it into NEAR (you approve it in your NEAR wallet) → stake. FlowVault signs nothing.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./live";
import { FUND_NETWORK, detectUsdcGas, sendWithUsdcGas } from "@/lib/flowvault/gas-abstraction-client"; // Stream A: USDC network fees

export interface ConvertSource {
  key: string;
  /** "sol" (Stream A): Solana USDC, sent by Phantom/Solflare/… through /api/funding/solana. */
  chain: "eth" | "base" | "arb" | "sol";
  chainName: string;
  address: string;
  short: string;
  usdc: string;
  walletName: string | null;
  icon?: string;
  session: unknown | null;
}
export interface ConvertModel {
  open: boolean;
  close: () => void;
  account: string | null;
  sources: ConvertSource[];
  preset?: { amount?: string; chain?: string; stake?: boolean } | null;
  fund: (body: Record<string, unknown>) => Promise<any>;
  status: (id: string) => Promise<any>;
  send: (session: unknown, tx: any, depositAddress: string, amountRaw: string) => Promise<string>;
  unwrap: () => Promise<{ amountRaw: string; near: string }>;
  register: () => Promise<void>;
  stake: (near: string) => void;
  connect: () => void;
  done: (msg: string) => void;
}

type Step = "form" | "sending" | "tracking" | "delivered" | "unwrapping" | "ready" | "failed";
const ink = "var(--fvc-1E2A22)";
const muted = "var(--fvc-6F786B)";
const line = "var(--fvb-E3E6DB)";
const near = (raw: string | null | undefined, dp = 4) => (raw ? (Number(BigInt(raw) / 10n ** 18n) / 1e6).toFixed(dp) : "—");
const STATUS_TEXT: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your USDC to arrive at 1Click…",
  KNOWN_DEPOSIT_TX: "1Click sees your transfer · waiting for confirmations…",
  PROCESSING: "Converting USDC to NEAR…",
  SUCCESS: "Delivered to your NEAR account.",
  INCOMPLETE_DEPOSIT: "The deposit was smaller than quoted; 1Click will refund it to the address it came from.",
  REFUNDED: "1Click refunded the USDC to the address it came from. Nothing was converted.",
  FAILED: "The conversion failed. Any USDC received is refunded to the address it came from.",
  // Solana (Stream A): outcomes the source chain itself decides.
  NOT_SENT: "Your wallet never sent it and the transaction expired, so it can't land. Your USDC is still in your wallet; try again.",
  SOURCE_FAILED: "The transfer failed on Solana, so nothing reached 1Click. Your USDC stayed in your wallet (only the network fee was spent).",
  UNCERTAIN: "Your wallet didn't confirm whether it sent. Checking the deposit address with 1Click instead of guessing — don't send it again yet.",
};
const ENDED = ["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT", "NOT_SENT", "SOURCE_FAILED"];

function Btn({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={primary ? undefined : "fvh5"}
      style={{
        padding: "11px 16px",
        borderRadius: 11,
        border: primary ? "none" : `1px solid ${line}`,
        background: primary ? (disabled ? "var(--fvb-B9C0B2)" : "var(--fvb-2A4034)") : "transparent",
        color: primary ? "var(--fvc-FFFFFF)" : ink,
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function ConvertNearDialog({ m }: { m: ConvertModel }) {
  // Mounted fresh each time the dialog opens (Shell renders it only while open), so state starts from props.
  const first = m.sources.find((x) => x.chain === m.preset?.chain && x.session) ?? m.sources.find((x) => x.session) ?? m.sources[0];
  const [srcKey, setSrcKey] = useState(first?.key ?? "");
  const [amount, setAmount] = useState(m.preset?.amount ?? "");
  const [quoted, setQuoted] = useState<{ key: string; quote: any } | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [quoteErr, setQuoteErr] = useState<{ key: string; msg: string } | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [job, setJob] = useState<{ id: string; quote: any; txHash?: string; status?: string; wnearRaw?: string | null } | null>(null);
  const [nearOut, setNearOut] = useState("");
  const [registering, setRegistering] = useState(false);
  const [retry, setRetry] = useState(0);
  const jobRef = useRef<{ id: string; quote: any } | null>(null);
  // Stream A: network fee in USDC via Circle Paymaster — shown only when this wallet reports it can.
  const [gasPay, setGasPay] = useState<"eth" | "usdc">("eth");
  const [gasCap, setGasCap] = useState<{ key: string; supported: boolean } | null>(null);
  const [gasEst, setGasEst] = useState<{ key: string; supported: boolean; quote?: any; reason?: string } | null>(null);
  const [gasId, setGasId] = useState<string | null>(null);
  const [gasPaid, setGasPaid] = useState<string | null>(null);

  const src = useMemo(() => m.sources.find((x) => x.key === srcKey) ?? m.sources[0] ?? null, [m.sources, srcKey]);
  const qKey = src && Number(amount) > 0 ? src.key + "|" + amount.trim() : "";
  const quote = quoted && quoted.key === qKey ? quoted.quote : null;
  const busy = !!qKey && busyKey === qKey;
  const shownErr = err || (quoteErr && quoteErr.key === qKey ? quoteErr.msg : "");

  // Live preview: a dry quote 600 ms after the amount or source changes.
  useEffect(() => {
    if (step !== "form" || !src || !qKey) return;
    const t = setTimeout(() => {
      setBusyKey(qKey);
      m.fund({ action: "quote", chain: src.chain, from: src.address, amount: amount.trim() })
        .then((r) => {
          setQuoted({ key: qKey, quote: r.quote });
          setQuoteErr(null);
        })
        .catch((e) => setQuoteErr({ key: qKey, msg: e.message }))
        .finally(() => setBusyKey((k) => (k === qKey ? "" : k)));
    }, 600);
    return () => clearTimeout(t);
  }, [qKey, step, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsRegister = /registered with wNEAR/.test(shownErr);
  const register = async () => {
    setRegistering(true);
    setErr("");
    try {
      await m.register();
      setQuoteErr(null);
      setRetry((n) => n + 1);
    } catch (e: any) {
      setErr(/reject|denied|cancel/i.test(String(e?.message)) ? "You declined in your NEAR wallet. Nothing was registered." : String(e?.message ?? e));
    } finally {
      setRegistering(false);
    }
  };

  // Track delivery every 6 s until 1Click reports a final state.
  useEffect(() => {
    if (step !== "tracking" || !job) return;
    let alive = true;
    const tick = () =>
      m.status(job.id).then(
        (r) => {
          if (!alive) return;
          setJob((j) => (j ? { ...j, status: r.status === "PENDING_DEPOSIT" && j.status === "UNCERTAIN" ? "UNCERTAIN" : r.status, wnearRaw: r.wnearRaw } : j));
          if (r.status === "SUCCESS") setStep("delivered");
          else if (ENDED.includes(r.status)) setStep("failed");
        },
        () => undefined,
      );
    void tick();
    const iv = setInterval(tick, 6000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [step, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const gasNet = src && src.chain !== "sol" ? FUND_NETWORK[src.chain] : null;
  const usdcGas = !!src && !!gasNet && !!src.session && gasCap?.key === src.key && gasCap.supported;
  useEffect(() => {
    if (!src || !gasNet || !src.session) return;
    let live = true;
    detectUsdcGas(src.session as any, gasNet).then((r) => live && setGasCap({ key: src.key, supported: r.supported }), () => undefined);
    return () => {
      live = false;
    };
  }, [src?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!usdcGas || gasPay !== "usdc" || !qKey || !src || !gasNet) return;
    const t = setTimeout(() => {
      const amountRaw = String(Math.round(Number(amount) * 1e6));
      api("/api/gas", { action: "estimate", network: gasNet, from: src.address, amountRaw }, "POST", "personal").then((r) => setGasEst({ key: qKey, ...r }), (e) => setGasEst({ key: qKey, supported: false, reason: String(e?.message ?? e) }));
    }, 600);
    return () => clearTimeout(t);
  }, [qKey, gasPay, usdcGas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gasId || (step !== "tracking" && step !== "delivered" && step !== "failed")) return;
    api("/api/gas?id=" + encodeURIComponent(gasId), undefined, "GET", "personal").then((r) => r.chargedUsdcRaw && setGasPaid((Number(r.chargedUsdcRaw) / 1e6).toFixed(4)), () => undefined);
  }, [gasId, step, job?.status]);
  const est = gasEst && gasEst.key === qKey ? gasEst : null;
  const payInUsdc = usdcGas && gasPay === "usdc";
  const amountOk = !!src && Number(amount) > 0 && Number(amount) <= Number(src.usdc) && (!payInUsdc || !!est?.supported);
  const send = async () => {
    if (!src || !src.session) return;
    jobRef.current = null;
    setErr("");
    setStep("sending");
    try {
      const prep = await m.fund({ action: "prepare", chain: src.chain, from: src.address, amount: amount.trim() });
      jobRef.current = { id: prep.id, quote: prep.quote };
      setJob({ id: prep.id, quote: prep.quote });
      const hash = payInUsdc && gasNet
        ? await sendWithUsdcGas(src.session as any, gasNet, prep.tx, prep.quote.depositAddress, prep.quote.amountInRaw, api).then((r) => (setGasId(r.gasId), r.hash))
        : await m.send(src.session, prep.tx, prep.quote.depositAddress, prep.quote.amountInRaw);
      await m.fund({ action: "submitted", id: prep.id, txHash: hash }).catch(() => undefined);
      setJob({ id: prep.id, quote: prep.quote, txHash: hash, status: "KNOWN_DEPOSIT_TX" });
      setStep("tracking");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const declined = e?.code === 4001 || /reject|denied|declin|cancel/i.test(msg);
      // Solana (Stream A): an unclear wallet answer after preparing is tracked by deposit address, never re-sent blind.
      const pending = jobRef.current;
      if (src.chain === "sol" && pending && !declined && !/doesn.t match|isn.t the transfer|unexpected/i.test(msg)) {
        await m.fund({ action: "uncertain", id: pending.id }).catch(() => undefined);
        setJob({ ...pending, status: "UNCERTAIN" });
        setStep("tracking");
        return;
      }
      setErr(declined ? "You declined in " + (src.walletName ?? "your wallet") + ". Nothing was sent." : msg);
      setStep("form");
    }
  };
  const unwrap = async () => {
    setErr("");
    setStep("unwrapping");
    try {
      const r = await m.unwrap();
      setNearOut(r.near);
      setStep("ready");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setStep("delivered");
    }
  };

  const steps = ["Send USDC", "Receive NEAR", "Unwrap", "Stake"];
  const at = step === "form" || step === "sending" ? 0 : step === "tracking" || step === "failed" ? 1 : step === "delivered" || step === "unwrapping" ? 2 : 3;
  return (
    <div onClick={m.close} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(30,42,34,.34)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Convert USDC to NEAR"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--fvb-FFFFFF)", color: ink, borderRadius: 20, boxShadow: "0 30px 80px rgba(30,42,34,.25)", padding: "22px 24px 20px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em" }}>Convert USDC to NEAR</div>
            <div style={{ marginTop: 4, fontSize: 13.5, lineHeight: 1.45, color: muted }}>
              Through NEAR Intents. You approve each step in your own wallet; FlowVault never signs.
            </div>
          </div>
          <button type="button" onClick={m.close} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${line}`, background: "transparent", color: ink, cursor: "pointer", fontSize: 16 }}>
            ×
          </button>
        </div>

        <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 4px", display: "flex", gap: 6 }}>
          {steps.map((label, i) => (
            <li key={label} style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: i <= at ? "var(--fvc-3F6B3C)" : "var(--fvc-A0A79A)" }}>
              <div style={{ height: 3, borderRadius: 2, marginBottom: 6, background: i <= at ? "var(--fvb-4E7A4A)" : "var(--fvb-E6E8DF)" }} />
              {label}
            </li>
          ))}
        </ol>

        {!m.account ? (
          <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.5 }}>
            Connect your NEAR wallet first: the NEAR is delivered to your NEAR account.
            <div style={{ marginTop: 14 }}>
              <Btn primary onClick={m.connect}>Connect wallet →</Btn>
            </div>
          </div>
        ) : !m.sources.length ? (
          <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.5, color: muted }}>
            No USDC found on Ethereum, Base, Arbitrum or Solana in your connected wallets. Connect the wallet that holds it from the wallet menu.
            <div style={{ marginTop: 14 }}>
              <Btn onClick={m.connect}>Connect a wallet →</Btn>
            </div>
          </div>
        ) : step === "form" || step === "sending" ? (
          <>
            <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 600, color: muted }}>From</div>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              {m.sources.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setSrcKey(x.key)}
                  disabled={step === "sending"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    textAlign: "left",
                    cursor: "pointer",
                    color: ink,
                    background: src?.key === x.key ? "var(--fvb-F4F7EE)" : "transparent",
                    border: `1px solid ${src?.key === x.key ? "var(--fvb-9DB48C)" : line}`,
                  }}
                >
                  {x.icon ? <img src={x.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} /> : <span style={{ width: 24, textAlign: "center" }}>{x.chain === "sol" ? "◎" : "Ξ"}</span>}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14 }}>{Number(x.usdc).toFixed(2)} USDC on {x.chainName}</span>
                    <span style={{ display: "block", fontSize: 12, color: muted }}>
                      {x.short} · {x.session ? x.walletName : "not connected in this browser"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <label style={{ display: "block", marginTop: 14, fontSize: 12.5, fontWeight: 600, color: muted }}>
              Amount
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, border: `1px solid ${line}`, borderRadius: 11, padding: "0 10px" }}>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={step === "sending"}
                  style={{ flex: 1, border: "none", outline: "none", padding: "11px 0", fontSize: 16, background: "transparent", color: ink, fontVariantNumeric: "tabular-nums" }}
                />
                <span style={{ fontSize: 13, color: muted }}>USDC</span>
                {src ? (
                  <button type="button" onClick={() => setAmount(src.usdc)} style={{ border: "none", background: "var(--fvb-EEF0E8)", color: ink, borderRadius: 7, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>
                    Max
                  </button>
                ) : null}
              </div>
            </label>
            <div style={{ marginTop: 12, minHeight: 64, padding: "12px 14px", borderRadius: 12, background: "var(--fvb-F4F5EF)", fontSize: 13.5, lineHeight: 1.5 }}>
              {busy ? (
                <span style={{ color: muted }}>Getting a quote…</span>
              ) : quote ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 500 }}>
                    You get ≈ {Number(quote.nearOut).toFixed(4)} NEAR
                  </div>
                  <div style={{ color: muted }}>
                    At least {Number(quote.minNearOut).toFixed(4)} NEAR · about {Math.max(1, Math.round(quote.seconds / 60))} min · {quote.usdOut ? "worth ≈ $" + Number(quote.usdOut).toFixed(2) + " · " : ""}network fee paid in {src?.chain === "sol" ? "SOL" : "ETH"} by your wallet
                  </div>
                </>
              ) : (
                <span style={{ color: muted }}>{amount && src && Number(amount) > Number(src.usdc) ? "That’s more than this address holds." : "Enter an amount to see how much NEAR you get."}</span>
              )}
            </div>
            {usdcGas ? (
              <div role="radiogroup" aria-label="Pay the network fee in" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 13, lineHeight: 1.45 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: muted }}>Network fee in</span>
                  {(["eth", "usdc"] as const).map((g) => (
                    <label key={g} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                      <input type="radio" name="fv-gas" checked={gasPay === g} onChange={() => setGasPay(g)} disabled={step === "sending"} />
                      {g === "eth" ? "ETH (your wallet)" : "USDC (Circle Paymaster)"}
                    </label>
                  ))}
                </div>
                {gasPay === "usdc" ? (
                  <div style={{ marginTop: 6, color: muted, fontSize: 12.5 }}>
                    {!est ? "Estimating the fee…"
                      : est.supported && est.quote ? <>You send {amount} USDC + fee ≈ ${(Number(est.quote.gasUsdcRaw) / 1e6).toFixed(3)} gas + ${(Number(est.quote.markupUsdcRaw) / 1e6).toFixed(3)} Circle’s 10% · at most ${(Number(est.quote.maxChargeUsdcRaw) / 1e6).toFixed(2)}. You sign one USDC permit for that maximum to Circle’s paymaster; the actual fee is read from the receipt.</>
                      : <span style={{ color: "var(--fvc-9A3F32)" }}>{String(est.reason ?? "Not available right now").replace(/^[A-Z_]+: /, "")}. Choose ETH to send now.</span>}
                  </div>
                ) : null}
              </div>
            ) : null}
            {needsRegister ? (
              <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: 10, background: "var(--fvb-FBF6EE)", fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 500 }}>One-time step: register {m.account} for wNEAR</div>
                <div style={{ color: muted }}>1Click delivers NEAR as wNEAR, and the wNEAR contract needs your account registered first. It costs about 0.00125 NEAR, which you approve in your NEAR wallet.</div>
                <div style={{ marginTop: 10 }}>
                  <Btn primary disabled={registering} onClick={register}>{registering ? "Approve in your NEAR wallet…" : "Register for wNEAR →"}</Btn>
                </div>
              </div>
            ) : shownErr ? (
              <div role="alert" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--fvb-F6E3DE)", color: "var(--fvc-9A3F32)", fontSize: 13 }}>{shownErr}</div>
            ) : null}
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <Btn onClick={m.close}>Cancel</Btn>
              {src && !src.session ? (
                <Btn primary onClick={m.connect}>Connect {src.short} →</Btn>
              ) : (
                <Btn primary disabled={!quote || !amountOk || step === "sending"} onClick={send}>
                  {step === "sending" ? "Approve in " + (src?.walletName ?? "your wallet") + "…" : "Send from " + (src?.walletName ?? "wallet") + " →"}
                </Btn>
              )}
            </div>
            {step === "sending" ? (
              <div style={{ marginTop: 10, fontSize: 12.5, color: muted, textAlign: "right" }}>If nothing opened, click the {src?.walletName ?? "wallet"} icon in your browser’s toolbar.</div>
            ) : null}
          </>
        ) : step === "tracking" || step === "failed" ? (
          <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 500, color: step === "failed" ? "var(--fvc-9A3F32)" : ink }}>{STATUS_TEXT[job?.status ?? "KNOWN_DEPOSIT_TX"] ?? "Checking…"}</div>
            <div style={{ marginTop: 6, color: muted, fontSize: 13 }}>
              {job?.quote.amountIn} USDC → ≈ {Number(job?.quote.nearOut ?? 0).toFixed(4)} NEAR to {m.account}. Usually about {Math.max(1, Math.round((job?.quote.seconds ?? 60) / 60))} min after your transfer confirms. You can close this; it keeps going.
            </div>
            {job?.txHash ? <div style={{ marginTop: 8, fontSize: 12, color: muted, wordBreak: "break-all" }}>Your transfer: <span style={{ fontFamily: "'DM Mono',monospace" }}>{job.txHash}</span></div> : null}
            {gasId ? <div style={{ marginTop: 4, fontSize: 12, color: muted }}>Network fee paid in USDC: {gasPaid ? gasPaid + " USDC (from the finalized receipt, incl. Circle’s 10%)" : "confirming…"}</div> : null}
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <Btn onClick={m.close}>Close</Btn>
            </div>
          </div>
        ) : step === "delivered" || step === "unwrapping" ? (
          <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 500 }}>{near(job?.wnearRaw)} wNEAR arrived in {m.account}.</div>
            <div style={{ marginTop: 6, color: muted, fontSize: 13 }}>
              Staking needs plain NEAR, so unwrap it first. Your NEAR wallet asks you to approve one call to wrap.near (it costs 1 yoctoNEAR plus a tiny network fee).
            </div>
            {err ? <div role="alert" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--fvb-F6E3DE)", color: "var(--fvc-9A3F32)", fontSize: 13 }}>{err}</div> : null}
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn onClick={m.close}>Later</Btn>
              <Btn primary disabled={step === "unwrapping"} onClick={unwrap}>{step === "unwrapping" ? "Approve in your NEAR wallet…" : "Unwrap to NEAR →"}</Btn>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 16, fontSize: 14, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 500 }}>{nearOut} NEAR is ready in {m.account}.</div>
            <div style={{ marginTop: 6, color: muted, fontSize: 13 }}>Stake it from Strategies: pick LiNEAR or a verified validator, review the plan, then approve it in your wallet.</div>
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn onClick={() => { m.done("Converted to " + nearOut + " NEAR."); m.close(); }}>Done</Btn>
              <Btn primary onClick={() => m.stake(nearOut)}>Stake it →</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
