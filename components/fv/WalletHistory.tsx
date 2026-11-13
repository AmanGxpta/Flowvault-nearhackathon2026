"use client";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Repeat, ExternalLink, RefreshCw, Zap } from "lucide-react";
import { TokenIcon } from "./AssetIdentity";
import { fmtAmount, ago } from "./swap-format";
import type { WatchedTransaction } from "@/lib/flowvault/wallet-research";

/** The connected NEAR account's own on-chain history (NearBlocks via the public research read), so Activity is
 * never empty for a wallet that has history. Read-only and separate from FlowVault's journal. */
export function WalletHistory({ account, limit = 25 }: { account: string; limit?: number }) {
  const [rows, setRows] = useState<WatchedTransaction[] | null>(null), [error, setError] = useState(""), [tick, setTick] = useState(0), [count, setCount] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    const abort = new AbortController();
    fetch("/api/research?network=near&address=" + encodeURIComponent(account), { signal: abort.signal, cache: "no-store" })
      .then(async r => { const b = await r.json() as { transactions?: WatchedTransaction[]; transactionCount?: string | null; error?: string }; if (!r.ok) throw new Error(b.error); setRows(b.transactions ?? []); setCount(b.transactionCount ?? null); setError(""); })
      .catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    return () => abort.abort();
  }, [account, tick]);
  if (!account) return null;
  return <section className="fv-panel fv-wallet-history">
    <div className="fv-section-head"><div><h2>On-chain history</h2><small className="fv-muted">{account}{count ? ` · ${Number(count).toLocaleString()} transactions` : ""} · NearBlocks</small></div><button type="button" className="fv-icon-button" aria-label="Refresh history" onClick={() => setTick(x => x + 1)}><RefreshCw size={15} className={!rows && !error ? "fv-spin" : ""} /></button></div>
    {!rows && !error && <div className="fv-route-skeletons">{[0, 1, 2].map(i => <div key={i} className="fv-route-skeleton" />)}</div>}
    {error && !rows && <p className="fv-muted">History is unavailable right now. {error}</p>}
    {rows && !rows.length && <p className="fv-muted">No transactions yet for this account.</p>}
    {rows?.slice(0, limit).map(t => {
      const ins = t.tokens.filter(x => x.direction === "In"), outs = t.tokens.filter(x => x.direction === "Out");
      const swap = ins.length && outs.length, kind = swap ? "Swap" : ins.length ? "Received" : outs.length ? "Sent" : t.actions[0] ?? "Transaction";
      const Icon = swap ? Repeat : ins.length ? ArrowDownLeft : outs.length ? ArrowUpRight : Zap;
      const lead = (swap ? outs[0] : ins[0] ?? outs[0]);
      return <a key={t.hash} className="fv-history-row" href={"https://nearblocks.io/txns/" + t.hash} target="_blank" rel="noopener noreferrer">
        <span className={"fv-history-icon is-" + (swap ? "swap" : ins.length ? "in" : outs.length ? "out" : "call")}>{lead ? <TokenIcon symbol={lead.symbol} network="near" core size={30} /> : <Icon size={16} />}</span>
        <span className="fv-history-main"><strong>{kind}{swap ? ` ${outs[0].symbol} → ${ins[0].symbol}` : lead ? ` ${lead.symbol}` : ""}</strong><small>{t.status !== "Succeeded" ? t.status + " · " : ""}{t.to === account ? "from " + t.from : "to " + t.to} · {t.at ? ago(t.at) : ""}</small></span>
        <span className="fv-history-amounts">{outs.slice(0, 1).map((x, i) => <span key={"o" + i} className="fv-down">−{fmtAmount(x.amount)} {x.symbol}</span>)}{ins.slice(0, 1).map((x, i) => <span key={"i" + i} className="fv-up">+{fmtAmount(x.amount)} {x.symbol}</span>)}</span>
        <ExternalLink size={13} className="fv-muted" />
      </a>;
    })}
  </section>;
}
