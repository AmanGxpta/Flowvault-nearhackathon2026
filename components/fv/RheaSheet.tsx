"use client";
// In-app Rhea Lending for any market: supply / withdraw on Earn, borrow / repay / add or release collateral on
// Borrow. Prepared and checked by the server (prices from Rhea's own oracle, health, liquidity, storage, policy),
// then approved by the owner in their own NEAR wallet. FlowVault never signs.
import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewFrame } from "./ReviewFrame";
import { Check, ShieldCheck, ShieldAlert, X, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { TokenIcon } from "./AssetIdentity";
import { api } from "./live";
import { fmtAmount, fmtUsd } from "./swap-format";
import { signRhea } from "@/lib/flowvault/wallet";
import type { WalletAttempt } from "@/lib/flowvault/execution";
import type { RheaPreparation } from "@/lib/flowvault/rhea-markets-live";
import { units } from "@/lib/flowvault/money";
import { SupplyFundOffer } from "./earn/SupplyFundOffer";

type Action = "supply" | "withdraw" | "collateral_add" | "collateral_release" | "borrow" | "repay";
interface Position { symbol: string; decimals: number; priced: boolean; wallet: string; nativeNear: string; supplied: string; collateral: string; borrowed: string; available: string; canDeposit: boolean; canWithdraw: boolean; canCollateral: boolean; canBorrow: boolean; health: string; otherPositions: string[] }
interface Prepared {
  attempt: WalletAttempt;
  review: { action: Action; symbol: string; amount: string; usdValue: string; healthBefore: string; healthAfter: string; stressedAfter: string | null; gasNearBound: string; steps: { receiver: string; methods: string[] }[]; expiresAt: string; newDebt: boolean; warning?: string };
  policy: { allowed: boolean; violations: { code: string; message: string }[]; missingEntries: { label: string }[]; revision: number; version: number };
}
type Phase = "form" | "preparing" | "review" | "allowing" | "wallet" | "settling" | "done" | "failed" | "error";
const LABEL: Record<Action, string> = { supply: "Supply", withdraw: "Withdraw", collateral_add: "Add collateral", collateral_release: "Release collateral", borrow: "Borrow", repay: "Repay" };
const FIXABLE = new Set(["VENUE_NOT_ALLOWED", "METHOD_NOT_ALLOWED", "NESTED_RECEIVER_NOT_ALLOWED", "ASSET_USE_NOT_ALLOWED", "ASSET_SCOPE_UNVERIFIED"]);
const STEP: Record<string, string> = { storage_deposit: "Register storage", near_deposit: "Wrap NEAR", ft_transfer_call: "Send to Rhea", execute_with_pyth: "Rhea action (with oracle prices)", near_withdraw: "Unwrap to NEAR" };
const WRAP = "wrap.near";

const pct = (v?: number | null) => v === null || v === undefined ? "—" : v > 0 && v < 0.01 ? "<0.01%" : v.toFixed(2) + "%";
const TAB: Record<Action, string> = { supply: "Supply", withdraw: "Withdraw", collateral_add: "Add collateral", collateral_release: "Release collateral", borrow: "Borrow", repay: "Repay" };
const SOURCE: Record<Action, string> = { supply: "From your wallet", collateral_add: "From your wallet", repay: "From your wallet", withdraw: "From your Rhea supply", collateral_release: "From your Rhea collateral", borrow: "Paid to your wallet" };

export type RheaAction = Action;
export function RheaSheet({ tokenId, symbol, icon, mode, initial, rates, close, onSettled, inline, initialAmount, draftKey, onDraft, onAttempt, disabledReason, lockAction, fund }: { tokenId: string; symbol: string; icon?: string | null; mode: "earn" | "borrow"; initial?: Action; rates?: { supply: number | null; borrow: number | null }; close: () => void; onSettled?: () => void;
  /** Show only the initial action (a flow step), without the action tabs. */
  lockAction?: boolean;
  /** Earn: offer to swap something you hold into this token and supply it, as a resumable flow. */
  fund?: { owner: string; example: boolean; onFlow: (id: string) => void; connect?: () => void };
  /** Ask FlowVault: render inside a chat card, start from the card's draft, report the owner's edits and the prepared attempt. */
  inline?: boolean; initialAmount?: string | null; draftKey?: string; onDraft?: (d: { action: Action; amount: string }) => void; onAttempt?: (a: WalletAttempt) => void; disabledReason?: string | null }) {
  const actions: Action[] = mode === "earn" ? ["supply", "withdraw"] : ["borrow", "repay", "collateral_add", "collateral_release"];
  const [action, setAction] = useState<Action>(initial ?? actions[0]);
  const [pos, setPos] = useState<Position | null>(null), [posError, setPosError] = useState("");
  const [amount, setAmount] = useState(initialAmount ?? ""), [native, setNative] = useState(tokenId === WRAP), [debtOk, setDebtOk] = useState(false);
  const [phase, setPhase] = useState<Phase>("form"), [prep, setPrep] = useState<Prepared | null>(null), [attempt, setAttempt] = useState<WalletAttempt | null>(null);
  const [error, setError] = useState(""), [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A new version of the chat draft (the assistant changed it) replaces the form and drops any prepared review.
  const lastDraft = useRef(draftKey);
  useEffect(() => {
    if (!draftKey || draftKey === lastDraft.current) return;
    lastDraft.current = draftKey;
    if (["wallet", "settling"].includes(phase)) return;
    const t = setTimeout(() => { if (initial) setAction(initial); setAmount(initialAmount ?? ""); setPrep(null); setPhase("form"); }, 0);
    return () => clearTimeout(t);
  }, [draftKey, initial, initialAmount, phase]);
  const onDraftRef = useRef(onDraft), firstDraft = useRef(true);
  useEffect(() => { onDraftRef.current = onDraft; }, [onDraft]);
  useEffect(() => {
    if (firstDraft.current) { firstDraft.current = false; return; }
    const t = setTimeout(() => onDraftRef.current?.({ action, amount }), 700);
    return () => clearTimeout(t);
  }, [action, amount]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const load = useCallback(() => api("/api/lend?token=" + encodeURIComponent(tokenId), undefined, "GET").then(p => { if (alive.current) { setPos(p as Position); setPosError(""); } }).catch(e => { if (alive.current) setPosError((e as Error).message); }), [tokenId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (inline) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !["wallet", "settling"].includes(phase)) close(); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [phase, close, inline]);

  const shown = tokenId === WRAP ? (native ? "NEAR" : "wNEAR") : symbol;
  const unit = tokenId === WRAP ? "NEAR" : symbol; // Rhea's own balances, named as people know the asset
  // What the amount can be at most, by action (display help only; the server re-checks everything).
  const max = !pos ? null : action === "supply" || action === "collateral_add" ? (tokenId === WRAP && native ? pos.nativeNear : pos.wallet)
    : action === "withdraw" ? pos.supplied : action === "collateral_release" ? pos.collateral : action === "repay" ? pos.borrowed : null;
  const fraction = (n: bigint) => { if (!max || !pos) return; try { const raw = units(max, pos.decimals) * n / 100n; const s = raw.toString().padStart(pos.decimals + 1, "0"); const v = (s.slice(0, -pos.decimals) + "." + s.slice(-pos.decimals)).replace(/\.?0+$/, ""); setAmount(v || "0"); } catch { /* unreadable balance */ } };
  const hasMax = !!max && Number(max) > 0;
  // Supplying a token you don't hold: offer the swap instead of an amount you can't fund.
  const offerFund = !!fund && !inline && mode === "earn" && action === "supply" && tokenId !== WRAP;
  const emptyWallet = !!pos && (() => { try { return units(pos.wallet || "0", pos.decimals) === 0n; } catch { return !(Number(pos.wallet) > 0); } })();
  const valid = (() => { try { return !!pos && units(amount, pos.decimals) > 0n; } catch { return false; } })();

  async function prepare() {
    setPhase("preparing"); setError("");
    try {
      const r = await api("/api/lend", { op: "prepare", action, tokenId, amount, native: tokenId === WRAP && native, ...(action === "borrow" ? { approveNewDebt: debtOk } : {}) }) as Prepared;
      if (!alive.current) return;
      setPrep(r); setAttempt(r.attempt); setPhase("review"); onAttempt?.(r.attempt);
    } catch (e) { if (alive.current) { setError((e as Error).message); setPhase("error"); } }
  }
  async function allow() {
    if (!prep) return;
    setPhase("allowing"); setError("");
    try { await api("/api/lend", { op: "allow", id: prep.attempt.id, revision: prep.policy.revision }); await prepare(); }
    catch (e) { setError((e as Error).message); setPhase("review"); }
  }
  async function poll(id: string) {
    for (let i = 0; i < 24 && alive.current; i++) {
      const r = await api("/api/transactions", { id, action: "check" }).catch(() => null) as { attempt?: WalletAttempt } | null;
      if (r?.attempt) { setAttempt(r.attempt); if (["confirmed", "failed", "partial"].includes(r.attempt.state)) return r.attempt; }
      await new Promise(res => setTimeout(res, 2500));
    }
    return null;
  }
  async function approve() {
    if (!prep) return;
    const id = prep.attempt.id, url = new URL(window.location.href);
    setError(""); setPhase("wallet");
    let authorized = false, opened = false;
    try {
      await api("/api/transactions", { id, action: "authorize" });
      authorized = true;
      url.searchParams.set("fv_attempt", id); history.replaceState(null, "", url);
      opened = true;
      const outcomes = await signRhea(prep.attempt.preparation as unknown as RheaPreparation);
      const hashes = ((outcomes ?? []) as { transaction: { hash: string } }[]).map(o => o.transaction.hash);
      setPhase("settling");
      const attached = await api("/api/transactions", { id, action: hashes.length ? "attach" : "uncertain", hashes }) as { attempt: WalletAttempt };
      setAttempt(attached.attempt);
      const final = ["confirmed", "failed", "partial"].includes(attached.attempt.state) ? attached.attempt : await poll(id);
      if (!alive.current) return;
      setPhase(final?.state === "confirmed" || final?.state === "partial" ? "done" : final ? "failed" : "settling");
      onSettled?.(); void load();
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const refused = err?.code === 4001 || /reject|denied|declin|cancel/i.test(String(err?.message ?? e));
      if (authorized) await api("/api/transactions", { id, action: !opened || refused ? "declined" : "uncertain" }).catch(() => {});
      if (alive.current) { setError(refused && opened ? "You declined in your wallet. Nothing was sent." : (e as Error).message); setPhase("error"); }
    } finally { url.searchParams.delete("fv_attempt"); history.replaceState(null, "", url); }
  }

  const review = prep?.review, left = review ? Math.max(0, Math.floor((Date.parse(review.expiresAt) - now) / 1000)) : 0;
  const blocked = prep && !prep.policy.allowed, fixable = blocked && prep.policy.violations.every(v => FIXABLE.has(v.code));
  const busy = ["wallet", "settling"].includes(phase);
  const disabledAction = (a: Action) => !pos ? false : a === "supply" ? !pos.canDeposit : a === "collateral_add" ? !(pos.canDeposit && pos.canCollateral) : a === "borrow" ? !pos.canBorrow : a === "withdraw" || a === "collateral_release" ? !pos.canWithdraw : false;

  return <ReviewFrame inline={inline} busy={busy} close={close} className={"fv-dialog fv-swap-confirm fv-rhea-sheet is-" + phase} label={LABEL[action] + " " + symbol}>
      {!busy && !inline && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
      <div className="fv-confirm-pair"><TokenIcon symbol={symbol} image={icon ?? undefined} network="near" core={["USDC", "USDT", "USDt", "NEAR", "wNEAR"].includes(symbol)} size={52} /></div>
      <h2>{phase === "form" ? `${tokenId === WRAP ? "NEAR" : symbol} on Rhea` : phase === "preparing" ? "Checking" : phase === "allowing" ? "Updating your policy" : phase === "wallet" ? "Confirm in your wallet" : phase === "settling" ? "Settling on NEAR" : phase === "done" ? "Done" : phase === "failed" ? "Didn’t complete" : phase === "error" ? "Not sent" : `${LABEL[action]} ${fmtAmount(amount)} ${shown}`}</h2>
      <p className="fv-confirm-sub">{phase === "form" ? `Supply APY ${pct(rates?.supply)} · Borrow APY ${pct(rates?.borrow)} · variable` : phase === "preparing" ? "Fresh balances, prices, health, liquidity and your limits." : phase === "wallet" ? "Approve the transactions in your wallet. This card stays until NEAR finalizes them." : phase === "settling" ? "Waiting for final receipts." : phase === "done" || phase === "failed" ? attempt?.message : phase === "error" ? error : "Exact transactions, checked against your limits before your wallet opens."}</p>

      {phase === "form" && <>
        {!lockAction && <div className={"fv-rhea-tabs" + (actions.length > 2 ? " is-grid" : "")} role="tablist">{actions.map(a => <button type="button" role="tab" key={a} aria-selected={action === a} disabled={disabledAction(a)} onClick={() => { setAction(a); setAmount(""); }}>{TAB[a]}</button>)}</div>}
        {posError && <p role="alert" className="fv-notice">{posError}</p>}
        {offerFund && emptyWallet && <SupplyFundOffer tokenId={tokenId} symbol={symbol} apy={rates?.supply ?? null} owner={fund!.owner} example={fund!.example} held={pos?.wallet ?? null} onFlow={fund!.onFlow} connect={fund!.connect} />}
        {!(offerFund && emptyWallet) && <div className="fv-swap-amount fv-rhea-amount">
          <div className="fv-swap-box-head"><label htmlFor="rhea-amount">{SOURCE[action]}</label>
            {max !== null ? <span className="fv-swap-balance"><Wallet size={13} /> {fmtAmount(max)} {action === "repay" ? "owed" : shown}{hasMax && [25n, 50n, 100n].map(p => <button type="button" key={String(p)} onClick={() => fraction(p)}>{p === 100n ? "Max" : p + "%"}</button>)}</span>
              : action === "borrow" && pos ? <span className="fv-swap-balance">{fmtAmount(pos.available)} {unit} available</span> : null}</div>
          <div className="fv-swap-line"><input id="rhea-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" aria-label={"Amount in " + shown} /><span className="fv-rhea-unit"><TokenIcon symbol={symbol} image={icon ?? undefined} network="near" size={22} />{shown}</span></div>
        </div>}
        <div className="fv-confirm-table">
          {mode === "earn" ? <>
            <div><span>Supplied on Rhea</span><strong>{pos ? `${fmtAmount(pos.supplied)} ${unit}` : "…"}</strong></div>
            {pos && pos.collateral !== "0" && <div><span>As collateral</span><strong>{fmtAmount(pos.collateral)} {unit}</strong></div>}
          </> : <>
            <div><span>Collateral · borrowed</span><strong>{pos ? `${fmtAmount(pos.collateral)} · ${fmtAmount(pos.borrowed)} ${unit}` : "…"}</strong></div>
            <div><span>Health now</span><strong>{pos?.health ?? "…"}</strong></div>
          </>}
          <div><span>Rhea liquidity</span><strong>{pos ? `${fmtAmount(pos.available)} ${unit}` : "…"}</strong></div>
        </div>
        {pos && !pos.priced && <p className="fv-notice">Rhea’s oracle has no verified price for {symbol} right now, so FlowVault can’t check your limits. Try again shortly.</p>}
        {tokenId === WRAP && <label className="fv-rhea-check"><input type="checkbox" checked={native} onChange={e => setNative(e.target.checked)} /><span>{action === "repay" ? "Repay from native NEAR" : "Use native NEAR"}<small>{action === "supply" || action === "collateral_add" || action === "repay" ? "Wraps it to wNEAR in the same transaction." : "Unwraps the wNEAR Rhea pays out."}</small></span></label>}
        {action === "borrow" && <label className="fv-rhea-check is-warn"><input type="checkbox" checked={debtOk} onChange={e => setDebtOk(e.target.checked)} /><span>I’m taking on new debt<small>It accrues variable interest, and your collateral can be liquidated if prices fall.</small></span></label>}
        {disabledReason && <p role="status" className="fv-notice">{disabledReason}</p>}
        {!(offerFund && emptyWallet) && <div className="fv-confirm-actions"><button type="button" className="fv-button fv-primary fv-wide-button" disabled={!valid || (action === "borrow" && !debtOk) || (pos !== null && !pos.priced) || !!disabledReason} onClick={() => void prepare()}>{!valid ? "Enter an amount" : action === "borrow" && !debtOk ? "Confirm the new debt above" : `Review ${TAB[action].toLowerCase()}`}</button></div>}
        {offerFund && !emptyWallet && <details className="fv-fund-more"><summary>Need more {symbol}? Swap into it and supply</summary><SupplyFundOffer tokenId={tokenId} symbol={symbol} apy={rates?.supply ?? null} owner={fund!.owner} example={fund!.example} held={pos?.wallet ?? null} onFlow={fund!.onFlow} connect={fund!.connect} /></details>}
      </>}

      {review && !["form", "error"].includes(phase) && <div className="fv-confirm-table">
        <div><span>{LABEL[review.action]}</span><strong>{fmtAmount(review.amount)} {shown} <small>· {fmtUsd(review.usdValue)}</small></strong></div>
        {(mode === "borrow" || review.healthBefore !== "no debt") && <div><span>Health</span><strong>{review.healthBefore} → {review.healthAfter}{review.stressedAfter && review.stressedAfter !== "no debt" ? ` · ${review.stressedAfter} after a price drop` : ""}</strong></div>}
        <div><span>Network fees</span><strong>up to {fmtAmount(review.gasNearBound)} NEAR</strong></div>
      </div>}
      {review && phase === "review" && <ol className="fv-confirm-steps">{review.steps.map((s, i) => <li key={i}><span>{i + 1}</span>{s.methods.map(m => STEP[m] ?? m).join(" + ")}<small>{s.receiver}</small></li>)}</ol>}
      {review?.warning && phase === "review" && <p role="status" className="fv-notice">{review.warning}</p>}
      {prep && phase === "review" && (prep.policy.allowed
        ? <div className="fv-policy-check is-ok"><ShieldCheck size={17} /><div><strong>Within your limits</strong><small>Per-action cap, daily cap, gas and approved venues checked · policy v{prep.policy.version}</small></div></div>
        : <div className="fv-policy-check is-blocked"><ShieldAlert size={17} /><div><strong>{fixable ? `Rhea ${symbol} isn’t in your policy yet` : "Your policy blocks this"}</strong>
          <ul>{prep.policy.violations.slice(0, 4).map(v => <li key={v.code + v.message}>{v.message}</li>)}</ul>
          {fixable && <small>Allowing adds exactly: {prep.policy.missingEntries.map(e => e.label).join("; ") || `${symbol} for this use`}. Nothing else changes.</small>}</div></div>)}
      {phase === "settling" && <div className="fv-confirm-hashes">{attempt?.hashes.map(h => <a key={h} href={"https://nearblocks.io/txns/" + h} target="_blank" rel="noopener noreferrer">{h.slice(0, 8)}…{h.slice(-6)} <ExternalLink size={12} /></a>)}</div>}
      {phase === "done" && <div className="fv-confirm-success"><Check size={18} /> {attempt?.message}<div className="fv-confirm-hashes">{attempt?.hashes.slice(-1).map(h => <a key={h} href={"https://nearblocks.io/txns/" + h} target="_blank" rel="noopener noreferrer">View transaction <ExternalLink size={12} /></a>)}</div></div>}
      {error && phase === "review" && <p role="alert" className="fv-notice">{error}</p>}

      {phase !== "form" && <div className="fv-confirm-actions">
        {phase === "review" && (left === 0 ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void prepare()}><RefreshCw size={15} /> Expired · check again</button>
          : blocked ? (fixable ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void allow()}><ShieldCheck size={15} /> Allow and continue</button> : <button type="button" className="fv-button fv-wide-button" onClick={() => setPhase("form")}>Back</button>)
          : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={() => void approve()}>Approve in wallet · {left}s</button>)}
        {(phase === "preparing" || phase === "allowing") && <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {phase === "allowing" ? "Saving a new policy revision…" : "Checking…"}</button>}
        {(phase === "done" || phase === "failed") && <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
        {phase === "error" && <div className="fv-actions"><button type="button" className="fv-button" onClick={() => setPhase("form")}>Back</button><button type="button" className="fv-button fv-primary" onClick={() => void prepare()}>Try again</button></div>}
      </div>}
  </ReviewFrame>;
}
