"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewFrame } from "./ReviewFrame";
import { ArrowRight, Check, ShieldCheck, ShieldAlert, X, ExternalLink, RefreshCw } from "lucide-react";
import { TokenIcon } from "./AssetIdentity";
import { coreIdentity } from "./useTokenCatalog";
import { api } from "./live";
import { fmtAmount, fmtUsd } from "./swap-format";
import { signSwap, signIntentsNear } from "@/lib/flowvault/wallet";
import { sendIntentsDeposit, evmSessionFor, type WalletSession } from "@/lib/flowvault/wallets";
import type { IntentsPreparation } from "@/lib/flowvault/swap-intents";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import type { SwapPreparation } from "@/lib/flowvault/swap-exec";
import type { WalletAttempt } from "@/lib/flowvault/execution";

interface Prepared {
  attempt: WalletAttempt;
  review: { output: string; minimum: string; inputUsd: string | null; minOutUsd: string | null; gasNearBound: string; steps: { receiver: string; methods: string[] }[]; hops?: number; route?: string; eta?: number | null; gasUsd?: string | null; sender?: string; recipient?: string; fromNetwork?: string; toNetwork?: string; expiresAt: string; unwrapNote?: string; warning?: string };
  policy: { allowed: boolean; violations: { code: string; message: string }[]; missingEntries: { label: string }[]; revision: number; version: number };
}
type Phase = "preparing" | "review" | "allowing" | "wallet" | "settling" | "done" | "failed" | "error";
const FIXABLE = new Set(["VENUE_NOT_ALLOWED", "METHOD_NOT_ALLOWED", "NESTED_RECEIVER_NOT_ALLOWED", "ASSET_USE_NOT_ALLOWED", "ASSET_SCOPE_UNVERIFIED"]);
const STEP_NAMES: Record<string, string> = { near_deposit: "Wrap NEAR", storage_deposit: "Register token", ft_transfer_call: "Swap on Rhea / Ref", ft_transfer: "Deposit to NEAR Intents" };
const EXPLORERS: Record<string, string> = { eth: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", arb: "https://arbiscan.io/tx/", bsc: "https://bscscan.com/tx/", pol: "https://polygonscan.com/tx/" };
const explorerFor = (network: string, h: string) => h.startsWith("0x") ? (EXPLORERS[network] ?? "https://etherscan.io/tx/") + h : "https://nearblocks.io/txns/" + h;
const short = (a?: string) => !a ? "" : a.length > 18 ? a.slice(0, 8) + "…" + a.slice(-6) : a;
const NET: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", pol: "Polygon" };

export function SwapReview({ from, to, amount, slippage, close, onSettled, route = "ref", sender, recipient, inline, onAttempt, resumeId, journey, payTo }: { from: SwapToken; to: SwapToken; amount: string; slippage: number; close: () => void; onSettled: () => void; route?: "ref" | "intents"; sender?: string; recipient?: string; inline?: boolean; onAttempt?: (a: WalletAttempt) => Promise<void> | void; resumeId?: string; journey?: "stake";
  /** Deliver to someone else's address (collect and send); the recipient is checked against your permissions. */
  payTo?: boolean }) {
  const intents = route === "intents";
  const explorer = (h: string) => explorerFor(from.network, h);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [attempt, setAttempt] = useState<WalletAttempt | null>(null);
  const [error, setError] = useState(""), [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const onAttemptRef = useRef(onAttempt);
  useEffect(() => { onAttemptRef.current = onAttempt; }, [onAttempt]);
  // The wallet that holds the token (already proven to FlowVault); looked up again whenever the window regains focus.
  const [senderSession, setSenderSession] = useState<WalletSession | null>(null);
  const holder = intents && from.network !== "near" ? (prep?.attempt.preparation as unknown as IntentsPreparation | undefined)?.accountId : undefined;
  useEffect(() => {
    if (!holder) return;
    let live = true;
    const look = () => void evmSessionFor(holder).then(sess => { if (live) setSenderSession(sess); });
    look(); window.addEventListener("focus", look);
    return () => { live = false; window.removeEventListener("focus", look); };
  }, [holder]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const restored = useRef(false), initialResumeId = useRef(resumeId);
  const prepare = useCallback(async () => {
    setPhase("preparing"); setError("");
    try {
      const restore = initialResumeId.current && !restored.current;
      restored.current = true;
      const r = await api("/api/swap/execute", restore ? {action:"resume",id:initialResumeId.current} : { action: "prepare", route, from: from.id, to: to.id, amount, slippage, ...(intents ? { sender, recipient, ...(payTo ? { payTo: true } : {}) } : {}) }) as Prepared;
      if (!alive.current) return;
      if (!restore) await onAttemptRef.current?.(r.attempt);
      if (!alive.current) return;
      setPrep(r); setAttempt(r.attempt); setPhase("review");
    } catch (e) { if (alive.current) { setError((e as Error).message); setPhase("error"); } }
  }, [from.id, to.id, amount, slippage, route, sender, recipient, intents]);
  useEffect(() => { const t = setTimeout(() => void prepare(), 0); return () => clearTimeout(t); }, [prepare]);
  useEffect(() => {
    if (inline) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !["wallet", "settling"].includes(phase)) close(); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [phase, close, inline]);

  async function allow() {
    if (!prep) return;
    setPhase("allowing"); setError("");
    try { await api("/api/swap/execute", { action: "allow", id: prep.attempt.id, revision: prep.policy.revision }); await prepare(); }
    catch (e) { setError((e as Error).message); setPhase("review"); }
  }
  async function poll(id: string) {
    // Ref settles in seconds; NEAR Intents delivery usually takes 20–90 seconds after the deposit lands.
    for (let i = 0; i < (intents ? 90 : 24) && alive.current; i++) {
      const r = await api("/api/transactions", { id, action: "check" }).catch(() => null) as { attempt?: WalletAttempt } | null;
      if (r?.attempt) {
        setAttempt(r.attempt);
        if (["confirmed", "failed", "partial"].includes(r.attempt.state)) return r.attempt;
      }
      await new Promise(res => setTimeout(res, 2500));
    }
    return null;
  }
  async function approve() {
    if (!prep) return;
    const id = prep.attempt.id;
    setError(""); setPhase("wallet");
    const url = new URL(window.location.href);
    // authorized: the journal reserved this swap; opened: a wallet may have sent something. Only an opened request
    // that didn't come back is "uncertain"; anything before that, or a refusal, is recorded as not sent.
    let authorized = false, opened = false;
    try {
      await api("/api/transactions", { id, action: "authorize" });
      authorized = true;
      // Persist the request before the wallet opens, so a redirect wallet returns to this journal entry.
      url.searchParams.set("fv_attempt", id); history.replaceState(null, "", url);
      let hashes: string[];
      const ip = prep.attempt.preparation as unknown as IntentsPreparation;
      if (intents && ip.evmTx) {
        const wallet = senderSession?.address.toLowerCase() === ip.accountId.toLowerCase() ? senderSession : await evmSessionFor(ip.accountId);
        if (!wallet) throw new Error(`Connect ${short(ip.accountId)} in its wallet first (wallet menu › Connect another wallet). Nothing was sent.`);
        opened = true;
        hashes = [await sendIntentsDeposit(wallet, ip)];
      } else {
        opened = true;
        const outcomes = await (intents ? signIntentsNear(ip) : signSwap(prep.attempt.preparation as unknown as SwapPreparation));
        hashes = ((outcomes ?? []) as { transaction: { hash: string } }[]).map(o => o.transaction.hash);
      }
      setPhase("settling");
      const attached = await api("/api/transactions", { id, action: hashes.length ? "attach" : "uncertain", hashes }) as { attempt: WalletAttempt };
      setAttempt(attached.attempt);
      const final = ["confirmed", "failed", "partial"].includes(attached.attempt.state) ? attached.attempt : await poll(id);
      if (!alive.current) return;
      setPhase(final?.state === "confirmed" ? "done" : final ? "failed" : "settling");
      onSettled();
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const refused = err?.code === 4001 || /reject|denied|declin|cancel|isn’t available|Select 0x|doesn’t match|Connect 0x/i.test(String(err?.message ?? e));
      if (authorized) await api("/api/transactions", { id, action: !opened || refused ? "declined" : "uncertain" }).catch(() => {});
      onSettled();
      if (alive.current) { setError(refused && opened ? "You declined in your wallet. Nothing was sent." : (e as Error).message); setPhase("error"); }
    } finally {
      url.searchParams.delete("fv_attempt"); history.replaceState(null, "", url);
    }
  }

  // An earlier swap from the same wallet is unresolved: ask the journal to check it (wallet nonce + NEAR Intents
  // status), then start this swap again. If it is still genuinely open, the message says why.
  const [checking, setChecking] = useState(false);
  async function checkEarlier() {
    setChecking(true);
    try {
      const sender = (prep?.attempt.preparation as unknown as { accountId?: string } | undefined)?.accountId?.toLowerCase();
      const list = await api("/api/transactions", undefined, "GET") as { attempts?: WalletAttempt[] };
      for (const other of list.attempts ?? [])
        if (other.kind === "swap" && ["awaiting_wallet", "unknown", "submitted"].includes(other.state) && (!sender || other.accountId.toLowerCase() === sender) && other.id !== prep?.attempt.id)
          await api("/api/transactions", { id: other.id, action: "check" }).catch(() => null);
    } finally { setChecking(false); }
    await prepare();
  }
  const review = prep?.review;
  // EVM deposits are sent by the wallet that holds the token; say so before Approve if it isn't available here.
  const evmSender = intents && from.network !== "near" ? (prep?.attempt.preparation as unknown as IntentsPreparation | undefined)?.accountId : undefined;
  const senderMissing = !!evmSender && senderSession?.address.toLowerCase() !== evmSender.toLowerCase();
  const left = review ? Math.max(0, Math.floor((Date.parse(review.expiresAt) - now) / 1000)) : 0;
  const result = (attempt?.preparation as unknown as SwapPreparation | undefined)?.result;
  const blocked = prep && !prep.policy.allowed;
  const fixable = blocked && prep.policy.violations.every(v => FIXABLE.has(v.code));
  const stage = phase === "done" ? 4 : phase === "settling" ? 3 : phase === "wallet" ? 2 : 1;

  return <ReviewFrame inline={inline} busy={["wallet", "settling"].includes(phase)} close={close} className={"fv-dialog fv-swap-confirm is-" + phase} label={journey === "stake" ? "Fund your stake" : "Review swap"}>
      <div className="fv-confirm-progress"><span style={{ width: `${stage * 25}%` }} /></div>
      {!["wallet", "settling"].includes(phase) && !inline && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
      <div className="fv-confirm-pair">
        <TokenIcon symbol={from.symbol} network={from.network} core={coreIdentity(from)} image={from.icon} size={52} />
        <span className={"fv-confirm-arrow" + (["preparing", "allowing", "wallet", "settling"].includes(phase) ? " is-moving" : "")}>{phase === "done" ? <Check size={20} /> : <ArrowRight size={20} />}</span>
        <TokenIcon symbol={to.symbol} network={to.network} core={coreIdentity(to)} image={to.icon} size={52} />
      </div>
      <h2>{phase === "preparing" ? "Preparing your swap" : phase === "allowing" ? "Updating your policy" : phase === "wallet" ? "Confirm in your wallet" : phase === "settling" ? (intents && (attempt?.preparation as unknown as IntentsPreparation)?.result ? "Delivering on " + (NET[to.network] ?? to.network) : "Settling on " + (NET[from.network] ?? from.network)) : phase === "done" ? "Swap complete" : phase === "failed" ? "Swap did not complete" : phase === "error" ? "Swap not sent" : journey === "stake" ? "Fund your stake" : "Review swap"}</h2>
      <p className="fv-confirm-sub">{phase === "preparing" ? "Fresh quote, balances, fees and your limits." : phase === "wallet" ? "Approve the transactions in the wallet window. This card stays until the network finalizes them." : phase === "settling" ? (intents ? attempt?.message ?? "Waiting for the deposit to land." : "Waiting for final receipts. This usually takes a few seconds.") : phase === "done" ? attempt?.message : phase === "failed" ? attempt?.message : phase === "error" ? error : "Exact transactions, checked against your limits before your wallet opens."}</p>

      {review && phase !== "error" && <div className="fv-confirm-table">
        <div><span>You pay</span><strong>{fmtAmount(amount)} {from.symbol}{review.inputUsd && <small> · {fmtUsd(review.inputUsd)}</small>}</strong></div>
        <div><span>{phase === "done" ? "You received" : journey === "stake" ? "NEAR for staking" : "You receive"}</span><strong>{phase === "done" && result ? fmtAmount(result.received) : "≈ " + fmtAmount(review.output)} {to.symbol}</strong></div>
        {phase !== "done" && <div><span>Minimum</span><strong>{fmtAmount(review.minimum)} {to.symbol}{review.minOutUsd && <small> · {fmtUsd(review.minOutUsd)}</small>} · {slippage / 100}% slippage</strong></div>}
        <div><span>Route</span><strong className="fv-confirm-route">{intents ? `NEAR Intents${review.eta ? " · ~" + review.eta + "s" : ""}` : `Rhea / Ref${(review.hops ?? 1) > 1 ? ` · ${review.hops} hops` : ""}`}</strong></div>
        {intents && !journey && <div><span>From → to</span><strong>{short(review.sender)} ({NET[from.network] ?? from.network}) → {short(review.recipient)} ({NET[to.network] ?? to.network})</strong></div>}
        <div><span>Network fees</span><strong>{intents && from.network !== "near" ? (review.gasUsd ? "up to " + fmtUsd(review.gasUsd) + " in ETH" : "paid in ETH") : "up to " + fmtAmount(review.gasNearBound) + " NEAR"}</strong></div>
      </div>}

      {review && phase === "review" && <details open={journey ? undefined : true} className="fv-payment-tx-details"><summary>Transaction details</summary><ol className="fv-confirm-steps">{review.steps.map((s, i) => <li key={i}><span>{i + 1}</span>{s.methods.map(m => STEP_NAMES[m] ?? m).join(" + ")}<small>{s.receiver}</small></li>)}</ol></details>}
      {review?.unwrapNote && phase === "review" && <p className="fv-muted fv-confirm-note">{review.unwrapNote}</p>}
      {review?.warning && phase === "review" && <p role="status" className="fv-notice">{review.warning}</p>}

      {prep && phase === "review" && (prep.policy.allowed
        ? <div className="fv-policy-check is-ok"><ShieldCheck size={17} /><div><strong>Within your limits</strong><small>Per-action cap, daily cap, cost limit and approved venues checked · policy v{prep.policy.version}</small></div></div>
        : <div className="fv-policy-check is-blocked"><ShieldAlert size={17} /><div><strong>{fixable ? (intents ? "NEAR Intents swaps aren’t in your policy yet" : "Rhea / Ref swaps aren’t in your policy yet") : "Your policy blocks this swap"}</strong>
          <ul>{prep.policy.violations.slice(0, 4).map(v => <li key={v.code + v.message}>{v.message}</li>)}</ul>
          {fixable && <small>Allowing adds exactly: {prep.policy.missingEntries.map(e => e.label).join("; ") || "this asset's swap permission"}. Nothing else changes.</small>}</div></div>)}

      {phase === "settling" && <div className="fv-confirm-hashes">{attempt?.hashes.map(h => <a key={h} href={explorer(h)} target="_blank" rel="noopener noreferrer">{h.slice(0, 8)}…{h.slice(-6)} <ExternalLink size={12} /></a>)}</div>}
      {phase === "done" && <div className="fv-confirm-success"><Check size={18} /> {attempt?.message}<div className="fv-confirm-hashes">{attempt?.hashes.map(h => <a key={h} href={explorer(h)} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={12} /></a>).slice(-1)}</div></div>}
      {error && phase === "review" && <p role="alert" className="fv-notice">{error}</p>}
      {senderMissing && phase === "review" && <p role="status" className="fv-notice">Open your Ethereum wallet and make {short(evmSender)} available to this site (it holds the {from.symbol}). FlowVault picks it up as soon as you come back.</p>}

      <div className="fv-confirm-actions">
        {phase === "review" && (left === 0 ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void prepare()}><RefreshCw size={15} /> Quote expired · refresh</button>
          : blocked ? (fixable ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void allow()}><ShieldCheck size={15} /> Allow and continue</button> : <button type="button" className="fv-button fv-wide-button" onClick={close}>Close</button>)
          : senderMissing ? <button type="button" className="fv-button fv-wide-button" disabled>Waiting for {short(evmSender)} in your wallet</button>
          : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void approve()}>{journey === "stake" ? `Pay ${amount} ${from.symbol} in wallet` : "Approve in wallet"} · {left}s</button>)}
        {(phase === "preparing" || phase === "allowing") && <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {phase === "allowing" ? "Saving a new policy revision…" : "Checking…"}</button>}
        {(phase === "done" || phase === "failed") && <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
        {phase === "error" && <div className="fv-actions"><button type="button" className="fv-button" onClick={close}>Close</button>{/still unresolved/.test(error)
          ? <button type="button" className="fv-button fv-primary" disabled={checking} onClick={() => void checkEarlier()}>{checking ? <><RefreshCw size={15} className="fv-spin" /> Checking…</> : "Check it now"}</button>
          : <button type="button" className="fv-button fv-primary" onClick={() => void prepare()}>Try again</button>}</div>}
      </div>
  </ReviewFrame>;
}
