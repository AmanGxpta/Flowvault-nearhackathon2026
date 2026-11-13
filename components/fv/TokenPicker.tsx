"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronDown } from "lucide-react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { TokenIcon, NetworkLabel } from "./AssetIdentity";
import { coreIdentity } from "./useTokenCatalog";
import { fmtAmount, fmtUsd } from "./swap-format";

export interface Holding { amount: string; usd: string | null; raw: string }

export function TokenPicker({ tokens, value, onChange, label, balances = {} }: { tokens: SwapToken[]; value?: SwapToken; onChange: (t: SwapToken) => void; label: string; balances?: Record<string, Holding> }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="fv-token-select" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {value ? <><TokenIcon key={value.id} symbol={value.symbol} network={value.network} core={coreIdentity(value)} image={value.icon} size={32} /><span><strong>{value.symbol}</strong><small><NetworkLabel network={value.network} /></small></span></> : "Select token"}
      <ChevronDown size={17} />
    </button>
    {open && createPortal(<PickerDialog tokens={tokens} label={label} balances={balances} choose={t => { onChange(t); setOpen(false); }} close={() => setOpen(false)} />, document.body)}
  </>;
}

function PickerDialog({ tokens, label, balances, choose, close }: { tokens: SwapToken[]; label: string; balances: Record<string, Holding>; choose: (t: SwapToken) => void; close: () => void }) {
  const [query, setQuery] = useState(""), [network, setNetwork] = useState("near");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector("input")?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input,select") ?? []), first = els[0], last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); previous?.focus(); };
  }, [close]);
  const q = query.toLowerCase().trim();
  const usdOf = (t: SwapToken) => Number(balances[t.id]?.usd ?? 0);
  const rows = tokens
    .filter(t => (network === "all" || t.network === network) && (t.name + " " + t.symbol + " " + t.contract).toLowerCase().includes(q))
    .sort((a, b) => (balances[b.id] ? 1 : 0) - (balances[a.id] ? 1 : 0) || usdOf(b) - usdOf(a) || (coreIdentity(b) ? 1 : 0) - (coreIdentity(a) ? 1 : 0) || (a.assetId ? 0 : 1) - (b.assetId ? 0 : 1) || a.symbol.localeCompare(b.symbol));
  const owned = rows.filter(t => balances[t.id]).length;
  const popular = tokens.filter(t => coreIdentity(t) && t.network === "near").slice(0, 6);
  return <div className="fv-dialog-backdrop" onClick={close}>
    <div className="fv-dialog fv-token-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}>
      <div className="fv-section-head"><h2>{label}</h2><button type="button" className="fv-icon-button" aria-label="Close token picker" onClick={close}><X size={19} /></button></div>
      <label className="fv-search-input fv-picker-search"><Search size={16} /><input aria-label="Search token name or contract" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, symbol or paste a contract" /></label>
      <div className="fv-picker-quick">{popular.map(t => <button type="button" key={t.id} onClick={() => choose(t)}><TokenIcon symbol={t.symbol} network={t.network} core image={t.icon} size={20} />{t.symbol}</button>)}</div>
      <label className="fv-picker-network">Network<select value={network} onChange={e => setNetwork(e.target.value)}><option value="all">All networks</option>{[...new Set(tokens.map(t => t.network))].sort().map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <div className="fv-token-options">
        {owned > 0 && !q && <p className="fv-picker-group">Your tokens</p>}
        {rows.slice(0, 120).map((t, i) => {
          const h = balances[t.id];
          return <div key={t.id}>
            {owned > 0 && !q && i === owned && <p className="fv-picker-group">All tokens</p>}
            <button type="button" onClick={() => choose(t)}>
              <TokenIcon symbol={t.symbol} image={t.icon} network={t.network} core={coreIdentity(t)} size={35} />
              <span><strong>{t.symbol} <small>{t.name}</small></strong><small className="fv-address">{t.contract === "native" ? "Native token" : t.contract}</small></span>
              <span className="fv-picker-balance">{h ? <><strong>{fmtAmount(h.amount)}</strong><small>{h.usd ? fmtUsd(h.usd) : "Unpriced"}</small></> : t.price ? <small>{fmtUsd(t.price)}</small> : <NetworkLabel network={t.network} iconOnly />}</span>
            </button>
          </div>;
        })}
        {rows.length > 120 && <p className="fv-muted">Showing the first 120. Search to narrow the list.</p>}
        {!rows.length && <p className="fv-empty">No matching listed token. Check the contract address.</p>}
      </div>
    </div>
  </div>;
}
