"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { RheaSheet } from "./RheaSheet";
import { DemoSupplyReview } from "./demo/DemoSupplyReview";
import { TokenIcon } from "./AssetIdentity";
import { fmtUsd, ago } from "./swap-format";

interface Rate { token: string; symbol: string; name: string; icon: string | null; supplyApy: number | null; borrowApy: number | null; supplied: number; borrowed: number; suppliedUsd: number | null; borrowedUsd: number | null; utilization: number; canSupply: boolean; canBorrow: boolean; collateral: boolean; ltv: number | null }
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const STABLE = /^(USDC|USDT|USDT\.E|USDC\.E|DAI|FRAX|USDt)$/i;

/** Live Rhea markets, shown first on Earn and Borrow. Every market is actionable in-app: USDC through FlowVault's
 * plan-aware supply/credit flow (`onUsdc`), every other market through the Rhea action sheet. */
export function RatesTable({ mode, onUsdc, usdcNote, fund }: { mode: "earn" | "borrow"; onUsdc?: () => void; usdcNote?: string;
  /** Earn: lets a market you don't hold offer "swap into it and supply" (see SupplyFundOffer). */
  fund?: { owner: string; example: boolean; onFlow: (id: string) => void; connect?: () => void } }) {
  const [rows, setRows] = useState<Rate[] | null>(null), [at, setAt] = useState<string | null>(null), [error, setError] = useState("");
  const [open, setOpen] = useState<Rate | null>(null), [prefill, setPrefill] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "stable" | "other">("all"), [query, setQuery] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/rates", { signal: abort.signal, cache: "no-store" }).then(async r => { const b = await r.json() as { rows?: Rate[]; capturedAt?: string; error?: string }; if (!r.ok || !b.rows) throw new Error(b.error); setRows(b.rows); setAt(b.capturedAt ?? null); })
      .catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    return () => abort.abort();
  }, []);
  // Deep link (e.g. from "What you can do today"): ?supply=<token> opens that market's sheet once the rates load.
  useEffect(() => {
    if (!rows || mode !== "earn") return;
    const url = new URL(window.location.href), want = url.searchParams.get("supply");
    const row = want ? rows.find((r) => r.token === want) : null;
    if (!row) return;
    const amount = url.searchParams.get("amount");
    url.searchParams.delete("supply"); url.searchParams.delete("amount"); history.replaceState(null, "", url);
    const t = setTimeout(() => { setPrefill(amount && /^\d+(\.\d+)?$/.test(amount) ? amount : null); setOpen(row); }, 0); return () => clearTimeout(t);
  }, [rows, mode]);
  const list = (rows ?? []).filter(r => (mode === "earn" ? r.canSupply : r.canBorrow || r.collateral) && (filter === "all" || (filter === "stable") === STABLE.test(r.symbol)) && (r.symbol + r.name).toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => mode === "earn" ? (b.supplyApy ?? 0) - (a.supplyApy ?? 0) : (b.borrowedUsd ?? 0) - (a.borrowedUsd ?? 0));
  const best = mode === "earn" ? Math.max(...list.map(r => r.supplyApy ?? 0)) : null;
  return <section className="fv-panel fv-rates">
    <div className="fv-screener-bar">
      <div><h2>{mode === "earn" ? "Supply markets" : "Borrow markets"}</h2><small className="fv-muted">Rhea Lending · variable rates{at ? " · read " + ago(at) : ""}</small></div>
      <div className="fv-screener-tools">
        <label className="fv-search-input fv-screener-search"><Search size={15} /><input aria-label="Filter markets" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search asset" /></label>
        <div className="fv-segment fv-segment-small">{(["all", "stable", "other"] as const).map(f => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "stable" ? "Stablecoins" : "Other"}</button>)}</div>
      </div>
    </div>
    <p className="fv-rates-explainer">{mode === "earn"
      ? <>Supplying lends your tokens into a shared pool on <strong>Rhea</strong>, the NEAR lending protocol formerly called Burrow. Borrowers pay interest into the pool, you earn the supply APY, and you can withdraw whenever the pool has free liquidity.</>
      : <>Borrowing on <strong>Rhea</strong>, the NEAR lending protocol formerly called Burrow: add tokens as collateral, borrow against them and pay the borrow APY. If your collateral falls in value too far, part of it can be sold to repay the loan.</>}</p>
    <div className="fv-screener-table">
      <div className="fv-rate-row fv-screener-head"><span>Asset</span><span>{mode === "earn" ? "Supply APY" : "Borrow APY"}</span><span>Total supplied</span><span>Total borrowed</span><span>Utilization</span><span>{mode === "earn" ? "Borrow APY" : "Max LTV"}</span><span /></div>
      {!rows && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="fv-rate-row fv-screener-skeleton"><span /><span /><span /><span /><span /><span /><span /></div>)}
      {error && !rows && <div className="fv-empty"><h3>Rates are unavailable</h3><p>{error}</p></div>}
      {list.map(r => {
        const usdc = r.token === USDC;
        return <div key={r.token} className={"fv-rate-row" + (usdc ? " is-featured" : "")}>
          <span className="fv-screener-token"><TokenIcon symbol={r.symbol} image={r.icon ?? undefined} network="near" core={["USDC", "USDT", "USDt", "wNEAR", "NEAR"].includes(r.symbol)} size={32} /><span><strong>{r.symbol}</strong><small>{usdc && usdcNote ? usdcNote : r.collateral ? "Collateral" + (r.ltv ? ` · LTV ${r.ltv}%` : "") : "Not collateral"}</small></span></span>
          <span className="fv-num"><strong className={mode === "earn" ? "fv-up" : ""}>{fmtRate(mode === "earn" ? r.supplyApy : r.borrowApy)}</strong>{mode === "earn" && best !== null && r.supplyApy === best && best > 0 && <em className="fv-best">Top</em>}</span>
          <span className="fv-num">{r.suppliedUsd !== null ? fmtUsd(r.suppliedUsd) : r.supplied.toLocaleString()}</span>
          <span className="fv-num">{r.borrowedUsd !== null ? fmtUsd(r.borrowedUsd) : r.borrowed.toLocaleString()}</span>
          <span className="fv-num fv-util"><i className="fv-util-bar"><em style={{ width: Math.min(100, r.utilization) + "%" }} className={r.utilization > 90 ? "is-hot" : ""} /></i>{r.utilization.toFixed(1)}%</span>
          <span className="fv-num">{mode === "earn" ? fmtRate(r.borrowApy) : r.ltv ? r.ltv + "%" : "—"}</span>
          <span className="fv-screener-action">{usdc && onUsdc ? <button type="button" className="fv-buy" onClick={onUsdc}>{mode === "earn" ? "Supply" : "Borrow"}</button> : <button type="button" className="fv-buy" onClick={() => setOpen(r)}>{mode === "earn" ? "Supply" : r.canBorrow ? "Borrow" : "Collateral"}</button>}</span>
        </div>;
      })}
    </div>
    <div className="fv-panel-foot">Finalized Rhea view · USD totals at Ref prices. Every market runs in-app: prices from Rhea’s own oracle, your reserve, health and limits checked, approved in your wallet.</div>
    {open && fund?.example && prefill && mode === "earn" && <DemoSupplyReview symbol={open.symbol} icon={open.icon} amount={prefill} apy={open.supplyApy} close={() => { setOpen(null); setPrefill(null); }} />}
    {open && !(fund?.example && prefill && mode === "earn") && <RheaSheet tokenId={open.token} symbol={open.symbol} icon={open.icon} mode={mode} rates={{ supply: open.supplyApy, borrow: open.borrowApy }} initial={mode === "borrow" && !open.canBorrow ? "collateral_add" : undefined} initialAmount={prefill} close={() => { setOpen(null); setPrefill(null); }} fund={fund && { ...fund, onFlow: (id) => { setOpen(null); fund.onFlow(id); } }} />}
  </section>;
}
function fmtRate(v: number | null) { return v === null ? "—" : v < 0.01 && v > 0 ? "<0.01%" : v.toFixed(2) + "%"; }
