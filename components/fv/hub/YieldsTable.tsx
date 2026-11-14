"use client";
/* eslint-disable @next/next/no-img-element -- token icons from the rates and market feeds, fixed 24-26px, from hosts not known in advance */
// Live yields in one table: every Rhea supply market FlowVault can open and LiNEAR staking, ranked by APY, with what
// you already hold of each and the one action that applies (supply, swap then supply, or stake). Rates are variable
// and read live; nothing here moves funds: each action opens the existing review flow.
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { isStableAsset } from "@/lib/flowvault/brief";

export type YieldRate = { token: string; symbol: string; supplyApy: number | null; icon?: string | null; suppliedUsd?: number | null; utilization?: number | null };
type Row = { id: string; symbol: string; icon: string | null; where: string; apy: number; depth: number | null; util: number | null; held: number; heldUsd: number; act: () => void; cta: string };
// Thin markets (under $10k supplied) are left out: their rate moves on a single deposit.
type Filter = "All" | "Stablecoins" | "I hold";

const compact = (n: number) => "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 });

export function YieldsTable({ rates, stakeApy, holdings, supply, stake, loading }: {
  rates: YieldRate[];
  stakeApy: number | null;
  /** What you hold, by symbol (all chains) and by NEAR token id. */
  holdings: { bySymbol: Map<string, { amount: number; usd: number }>; nearIds: Set<string> };
  supply: (token: string) => void;
  stake: () => void;
  loading: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const held = (sym: string) => holdings.bySymbol.get(sym.toUpperCase()) ?? { amount: 0, usd: 0 };
  const rows: Row[] = [
    ...rates.filter((r) => (r.supplyApy ?? 0) >= 0.01 && (r.suppliedUsd ?? 0) >= 10_000).map((r) => {
      const h = held(r.symbol), onNear = holdings.nearIds.has("near:" + r.token);
      return { id: r.token, symbol: r.symbol, icon: r.icon ?? null, where: "Rhea lending", apy: r.supplyApy!, depth: r.suppliedUsd ?? null, util: r.utilization ?? null, held: h.amount, heldUsd: h.usd, act: () => supply(r.token), cta: h.amount > 0 && !onNear ? "Swap and supply" : "Supply" };
    }),
    ...(stakeApy ? [{ id: "linear", symbol: "NEAR", icon: null, where: "LiNEAR liquid staking", apy: stakeApy, depth: null, util: null, held: held("NEAR").amount, heldUsd: held("NEAR").usd, act: stake, cta: "Stake" }] : []),
  ].sort((a, b) => b.apy - a.apy);
  const shown = rows.filter((r) => filter === "All" || (filter === "Stablecoins" ? isStableAsset(r.symbol) : r.held > 0)).slice(0, 12);
  const top = Math.max(...rows.map((r) => r.apy), 1);

  return <div className="fv-yields">
    <div className="fv-yields-head">
      <div className="fv-segment" role="tablist" aria-label="Filter yields">{(["All", "Stablecoins", "I hold"] as Filter[]).map((f) => <button type="button" role="tab" key={f} aria-selected={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
      <small className="fv-muted">Live from Rhea and LiNEAR · variable rates · each action opens a review first</small>
    </div>
    <div className="fv-yields-table" role="table" aria-label="Live yields">
      <div className="fv-yields-row is-head" role="row"><span role="columnheader">Asset</span><span role="columnheader">APY</span><span role="columnheader" className="fv-yields-depth">Supplied</span><span role="columnheader">You hold</span><span role="columnheader" aria-label="Action" /></div>
      {loading && !rows.length && [0, 1, 2, 3, 4].map((i) => <div key={i} className="fv-yields-row" role="row"><div className="fv-skel fv-skel-line" style={{ width: 120 }} /><div className="fv-skel fv-skel-line" style={{ width: 90 }} /><div className="fv-skel fv-skel-line fv-yields-depth" style={{ width: 60 }} /><div className="fv-skel fv-skel-line" style={{ width: 60 }} /><span /></div>)}
      {shown.map((r, i) => <div key={r.id} className="fv-yields-row fv-rise" role="row" style={{ ["--i" as string]: Math.min(i, 8) }}>
        <span className="fv-yields-asset" role="cell">{r.icon ? <img src={r.icon} alt="" width={26} height={26} /> : <i aria-hidden>{r.symbol.slice(0, 1)}</i>}<span><strong>{r.symbol}</strong><small>{r.where}</small></span></span>
        <span className="fv-yields-apy" role="cell"><b>{r.apy.toFixed(2)}%</b><span className="fv-yields-bar" aria-hidden><i style={{ ["--w" as string]: Math.max(4, (r.apy / top) * 100) + "%", ["--i" as string]: Math.min(i, 8) }} /></span></span>
        <span className="fv-yields-depth" role="cell">{r.depth ? compact(r.depth) : "—"}{r.util !== null && r.util > 0 ? <small>{Math.round(r.util)}% used</small> : null}</span>
        <span className="fv-yields-held" role="cell">{r.held > 0 ? <><strong>{qty(r.held)}</strong><small>{r.heldUsd >= 0.01 ? compact(r.heldUsd) : ""}</small></> : <small>—</small>}</span>
        <span role="cell"><button type="button" className={"fv-button" + (r.held > 0 ? " fv-primary" : "")} onClick={r.act}>{r.cta} <ArrowRight size={13} /></button></span>
      </div>)}
      {!loading && !shown.length && <p className="fv-muted fv-yields-empty">{filter === "I hold" ? "None of these markets matches what you hold yet." : "No live yields right now."}</p>}
    </div>
  </div>;
}
