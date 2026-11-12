"use client";
import { useState } from "react";
import type { LendingVenueSnapshot } from "@/lib/flowvault/contracts";
import { decimal } from "@/lib/flowvault/money";
import { api, type Scope } from "./live";

/** Venue-local risk evidence; existing Credit/PlanDock owns Rhea review, signing and recovery. */
export function LendingVenues({ scope }: { scope: Scope }) {
  const [snapshot, setSnapshot] = useState<LendingVenueSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setSnapshot(null); setMessage("");
    try {
      const r = await api("/api/lending", undefined, "GET", scope);
      setSnapshot(r.venueSnapshot ?? null);
      setMessage(r.reasons?.join(" · ") ?? "");
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <details style={{ position: "fixed", right: 24, top: 12, zIndex: 35, background: "#fafbf6", border: "1px solid #d9ddce", padding: 10, borderRadius: 12, maxWidth: 380, maxHeight: "70vh", overflow: "auto" }}>
    <summary>Lending venues</summary>
    <p>Health and capacity belong to each account and market. Posted collateral is not spendable cash.</p>
    <button onClick={load} disabled={busy}>{busy ? "Reading…" : "Refresh Rhea risk"}</button>
    {message && <p role="status">{message}</p>}
    {snapshot && <section aria-label="Rhea market risk">
      <strong>{snapshot.venueId} · {snapshot.accountId}</strong>
      <p>Stressed capacity: {snapshot.stressedCapacityUsdcRaw === null ? "Unavailable" : decimal(BigInt(snapshot.stressedCapacityUsdcRaw)) + " USDC"}</p>
      <p>Health: {snapshot.health ?? "Unknown"} · stressed: {snapshot.stressedHealth ?? "Unknown"} · minimum: {snapshot.minHealth}</p>
      <p>Variable APR: {snapshot.borrowApr ?? "Unknown"}. {snapshot.interest.basis}</p>
      <p>{snapshot.exit.reasons.join(" ")}</p>
      {snapshot.reasons.length > 0 && <p>{snapshot.reasons.join(" · ")}</p>}
      <p>Use Credit to review an operation. Activity retains submitted and uncertain attempts; check the existing attempt before retrying.</p>
    </section>}
  </details>;
}
