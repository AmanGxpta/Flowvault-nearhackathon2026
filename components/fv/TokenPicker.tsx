"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronDown, Check } from "lucide-react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { TokenIcon, NetworkLabel, networkInfo } from "./AssetIdentity";
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
  // Focus the search box once, when the picker opens. The swap screen re-renders every second (route
  // countdown); re-running this on each render stole focus and closed the network menu mid-selection.
  const onEscape = useEffectEvent(() => close());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector("input")?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onEscape();
      if (e.key === "Tab") {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input,select") ?? []), first = els[0], last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); previous?.focus(); };
  }, []);
  // Networks with the most listed tokens first (NEAR always first), then "All networks".
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t.network, (counts.get(t.network) ?? 0) + 1);
  const networks = ["near", ...[...counts.keys()].filter(n => n !== "near").sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)), "all"];
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
      <div className="fv-picker-network"><span>Network</span><NetworkDropdown networks={networks} counts={counts} total={tokens.length} value={network} onChange={setNetwork} /></div>
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

/** Network dropdown with logo rows. A custom listbox (a native select can't show logos), keyboard operable:
 * arrows move, Enter picks, Escape closes the list without closing the token picker, typing filters. */
function NetworkDropdown({ networks, counts, total, value, onChange }: { networks: string[]; counts: Map<string, number>; total: number; value: string; onChange: (n: string) => void }) {
  const [open, setOpen] = useState(false), [filter, setFilter] = useState(""), [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const label = (n: string) => n === "all" ? "All networks" : networkInfo(n)?.name ?? n.toUpperCase();
  const shown = networks.filter(n => !filter || (label(n) + " " + n).toLowerCase().includes(filter.toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  function toggle() { setFilter(""); setActive(Math.max(0, networks.indexOf(value))); setOpen(o => !o); }
  function pick(n: string) { onChange(n); setOpen(false); }
  function key(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) pick(shown[active]); }
  }
  return <div className="fv-net-dd" ref={box} onKeyDown={key}>
    <button type="button" className="fv-net-dd-button" aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
      {value !== "all" && <NetworkLabel network={value} iconOnly />}<span>{label(value)}</span><ChevronDown size={15} />
    </button>
    {open && <div className="fv-net-dd-menu">
      <label className="fv-net-dd-filter"><Search size={13} /><input autoFocus aria-label="Filter networks" value={filter} onChange={e => { setFilter(e.target.value); setActive(0); }} placeholder="Find a network" /></label>
      <div className="fv-net-dd-list" role="listbox" aria-label="Network" ref={list}>
        {shown.map((n, i) => <div key={n} data-i={i} role="option" aria-selected={n === value} className={"fv-net-dd-row" + (i === active ? " is-active" : "")} onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(n)}>
          {n === "all" ? <span className="fv-net-dd-all">∗</span> : <NetworkLabel network={n} iconOnly />}<span>{label(n)}</span><small>{n === "all" ? total : counts.get(n) ?? 0}</small>{n === value ? <Check size={14} /> : <i />}
        </div>)}
        {!shown.length && <p className="fv-muted">No matching network.</p>}
      </div>
    </div>}
  </div>;
}
