"use client";
import { ApprovedAssetSales } from "./ApprovedAssetSales";
import { useState } from "react";
import type { LendingVenueSnapshot } from "@/lib/flowvault/contracts";
import type { LinkedAccount } from "@/lib/flowvault/types";
import { decimal } from "@/lib/flowvault/money";
import { AAVE_MARKETS, type AaveChain } from "@/lib/flowvault/aave-markets";
import { api, type Scope } from "./live";
import { openPlan } from "./PlanDock";

/** Existing PlanDock and wallet journals own review, signing and recovery. */
export function LendingVenues({ scope, accounts = [] }: { scope: Scope; accounts?: LinkedAccount[] }) {
  const [snapshot, setSnapshot] = useState<LendingVenueSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [venue, setVenue] = useState("rhea");
  const [account, setAccount] = useState("");
  const [kind, setKind] = useState("borrow");
  const [asset, setAsset] = useState("USDC");
  const [amount, setAmount] = useState("");
  const evm = accounts.filter(a => a.chain === "evm" && a.proof?.method === "siwe");
  async function load() {
    setBusy(true); setSnapshot(null); setMessage("");
    try {
      const path = venue === "rhea" ? "/api/lending" : `/api/lending/venues?chain=${venue}&account=${encodeURIComponent(account)}`;
      const r = await api(path, undefined, "GET", scope);
      setSnapshot(r.venueSnapshot ?? r.snapshot ?? null);
      setMessage(r.reasons?.join(" · ") ?? "");
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function plan() {
    setBusy(true); setMessage("");
    try {
      const r=await api("/api/lending/venues",{action:"plan",chain:venue,account,kind,asset,amount,key:crypto.randomUUID()},"POST",scope);
      openPlan({plan:r.plan});
    } catch(e) {setMessage((e as Error).message);}
    finally{setBusy(false);}
  }
  const chain = venue as AaveChain;
  const assets = AAVE_MARKETS[chain] ? [...AAVE_MARKETS[chain].collateral, AAVE_MARKETS[chain].debt] : [];
  return <details style={{ position: "fixed", right: 24, top: 12, zIndex: 35, background: "#fafbf6", border: "1px solid #d9ddce", padding: 10, borderRadius: 12, maxWidth: 400, maxHeight: "70vh", overflow: "auto" }}>
    <summary>Lending venues</summary>
    <p>Health and capacity belong to each account and market. Posted collateral is not spendable cash.</p>
    <label>Market <select value={venue} onChange={e=>{setVenue(e.target.value);setSnapshot(null);setMessage("");}}><option value="rhea">Rhea · NEAR</option><option value="eth">Aave v3 · Ethereum Core</option><option value="base">Aave v3 · Base</option><option value="arb">Aave v3 · Arbitrum</option></select></label>
    {venue!=="rhea" && <label>Proven EVM account <select value={account} onChange={e=>{setAccount(e.target.value);setSnapshot(null);}}><option value="">Choose account</option>{evm.map(a=><option key={a.id} value={a.address}>{a.label} · {a.address}</option>)}</select></label>}
    <button onClick={load} disabled={busy}>{busy ? "Reading…" : "Refresh venue risk"}</button>
    {message && <p role="status">{message}</p>}
    {snapshot && <section aria-label="Venue risk">
      <strong>{snapshot.venueId} · {snapshot.accountId}</strong>
      <p>Stressed capacity: {snapshot.stressedCapacityUsdcRaw === null ? "Unavailable" : decimal(BigInt(snapshot.stressedCapacityUsdcRaw)) + " USDC"}</p>
      <p>Debt: {snapshot.debtUsdcRaw===null?"Unknown":decimal(BigInt(snapshot.debtUsdcRaw))+" USDC"}</p>
      <p>Health: {snapshot.health ?? "Unknown"} · stressed: {snapshot.stressedHealth ?? "Unknown"} · minimum: {snapshot.minHealth}</p>
      <p>Variable APR: {snapshot.borrowApr ?? "Unknown"}. {snapshot.interest.basis}</p>
      <p>{snapshot.exit.reasons.join(" ")}</p>
      {snapshot.reasons.length > 0 && <p>{snapshot.reasons.join(" · ")}</p>}
    </section>}
    {venue!=="rhea" && scope==="personal" && <fieldset disabled={busy || !account}>
      <legend>Review an owner-signed operation</legend>
      <label>Operation <select value={kind} onChange={e=>setKind(e.target.value)}><option value="borrow">Borrow USDC</option><option value="repay">Repay USDC</option><option value="collateral_add">Pledge token</option><option value="collateral_release">Release token</option></select></label>
      <label>Asset <select value={asset} onChange={e=>setAsset(e.target.value)}>{assets.map(x=><option key={x.id} value={x.symbol}>{x.symbol}</option>)}</select></label>
      <label>Quantity <input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" /></label>
      <p>WETH is wrapped ETH. Native ETH needs wrapping outside this flow. Saved credit policy and exact pool/method allowlists are required. Borrowing needs an additional explicit new-debt approval in the plan.</p>
      <button onClick={plan}>Create review plan</button>
    </fieldset>}
    <ApprovedAssetSales scope={scope} accounts={accounts} />
    <p>Activity retains submitted and uncertain attempts. Recover wallet hashes and check the existing attempt before retrying. Cross-chain settlement is a separate dependent operation.</p>
  </details>;
}
