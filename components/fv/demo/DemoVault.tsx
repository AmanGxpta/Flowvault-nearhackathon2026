"use client";
// Demo Mode vault actions for the example holder: deposit USDC (queued until settled), settle into shares at the
// vault's price per share, redeem (first in, first out, after a notice shortened here), claim the USDC, or cancel an
// open request. Each one plays the labelled example wallet and changes the example ledger; nothing is signed.
import { useEffect, useState } from "react";
import { demoLedger, saveDemoLedger, simulateApproval, useDemoLedger } from "./ledger-store";
import { applyVaultCancel, applyVaultClaim, applyVaultDeposit, applyVaultRedeem, applyVaultSettle, USDC_ID } from "@/lib/flowvault/demo-ledger";

const n2 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function DemoVaultActions({ contractId, pps, baseShares, running }: { contractId: string; pps: number; baseShares: number; running: boolean }) {
  const l = useDemoLedger();
  const [deposit, setDeposit] = useState(""), [redeem, setRedeem] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!l) return null;
  const v = l.vaults?.[contractId] ?? { shares: 0, requests: [] }, wallet = l.wallet[USDC_ID] ?? 0, shares = baseShares + v.shares;
  const open = v.requests.filter((r) => r.status === "queued");
  const run = (label: string, change: () => void, done: string) => simulateApproval(`demo-vault-${label}-${crypto.randomUUID()}`, {
    wallet: () => { setBusy(label); setMsg(""); }, submitted: () => {},
    landed: () => { try { change(); setMsg(done); } catch (e) { setMsg((e as Error).message); } setBusy(""); },
  }, { wallet: 1100, settle: 2200 });
  return <div className="fv-demo-vault">
    <div className="fv-demo-vault-head"><strong>Try it · example</strong><small>{n2(wallet)} USDC in your NEAR wallet · {n2(shares)} shares (≈ {n2(shares * pps)} USDC at {pps.toFixed(6)})</small></div>
    <div className="fv-demo-unstake">
      <input inputMode="decimal" placeholder="USDC to deposit" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^\d.]/g, ""))} aria-label="USDC to deposit" />
      <button type="button" className="fv-button" disabled={!!busy || !Number(deposit) || !running} onClick={() => { const x = Number(deposit); run("deposit", () => saveDemoLedger(applyVaultDeposit(demoLedger(), contractId, x)), `Example: ${n2(x)} USDC deposited. It waits in the queue, not invested yet, until it's settled into shares.`); setDeposit(""); }}>{busy === "deposit" ? "Example wallet approving…" : "Deposit"}</button>
      <input inputMode="decimal" placeholder="Shares to redeem" value={redeem} onChange={(e) => setRedeem(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Shares to redeem" />
      <button type="button" className="fv-text-button" onClick={() => setRedeem(String(Math.floor(shares * 1e4) / 1e4))}>All</button>
      <button type="button" className="fv-button" disabled={!!busy || !Number(redeem)} onClick={() => { const x = Number(redeem); run("redeem", () => saveDemoLedger(applyVaultRedeem(demoLedger(), contractId, x, baseShares)), `Example: redemption of ${n2(x)} shares queued, first in first out. Claim it when the notice ends.`); setRedeem(""); }}>{busy === "redeem" ? "Example wallet approving…" : "Redeem"}</button>
    </div>
    {open.length > 0 && <ul className="fv-demo-vault-reqs">{open.map((r) => {
      const ready = r.readyAt <= now;
      return <li key={r.id}>
        <span>#{r.id} {r.kind === "deposit" ? `deposit ${n2(r.amount)} USDC · waiting to be settled` : `redeem ${n2(r.amount)} shares · ${ready ? "ready to claim" : `notice ends in ${Math.ceil((r.readyAt - now) / 1000)}s (example; days for real)`}`}</span>
        {r.kind === "deposit" ? <button type="button" className="fv-text-button" disabled={!!busy} onClick={() => run("settle" + r.id, () => saveDemoLedger(applyVaultSettle(demoLedger(), contractId, r.id, pps)), `Example: settled into ≈ ${n2(r.amount / pps)} shares at ${pps.toFixed(6)} USDC each.`)}>Settle into shares</button>
          : <button type="button" className="fv-text-button" disabled={!!busy || !ready} onClick={() => run("claim" + r.id, () => saveDemoLedger(applyVaultClaim(demoLedger(), contractId, r.id, pps)), `Example: ≈ ${n2(r.amount * pps)} USDC claimed to your NEAR wallet.`)}>Claim USDC</button>}
        <button type="button" className="fv-text-button" disabled={!!busy} onClick={() => run("cancel" + r.id, () => saveDemoLedger(applyVaultCancel(demoLedger(), contractId, r.id)), `Example: request #${r.id} cancelled.`)}>Cancel</button>
      </li>;
    })}</ul>}
    {msg && <p className="fv-demo-note" role="status">{msg}</p>}
  </div>;
}
