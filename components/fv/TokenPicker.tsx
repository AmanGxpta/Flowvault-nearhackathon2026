"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronDown, ChevronRight } from "lucide-react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { TokenIcon, NetworkLabel, networkInfo } from "./AssetIdentity";
import { coreIdentity } from "./useTokenCatalog";
import { fmtUsd } from "./swap-format";

export interface Holding { amount: string; usd: string | null; raw: string; account?: string; largestRaw?: string }
/** Networks shown as chips first; the rest open under "More". */
const LEAD_NETWORKS = ["near", "eth", "sol", "base", "arb"];

export function TokenPicker({ tokens, value, onChange, label, balances = {}, covered }: { tokens: SwapToken[]; value?: SwapToken; onChange: (t: SwapToken) => void; label: string; balances?: Record<string, Holding>; covered?: Set<string> }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="fv-token-select" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      {value ? <><TokenIcon key={value.id} symbol={value.symbol} network={value.network} core={coreIdentity(value)} image={value.icon} size={32} /><span><strong>{value.symbol}</strong><small>{netName(value.network)}</small></span></> : "Select token"}
      <ChevronDown size={17} />
    </button>
    {open && createPortal(<PickerDialog tokens={tokens} label={label} balances={balances} covered={covered ?? new Set()} current={value} choose={t => { onChange(t); setOpen(false); }} close={() => setOpen(false)} />, document.body)}
  </>;
}

const netName = (n: string) => networkInfo(n)?.name ?? n.toUpperCase();
const fmtBal = (v: string) => { const n = Number(v); return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: n >= 1 ? 4 : 6 }); };

function PickerDialog({ tokens, label, balances, covered, current, choose, close }: { tokens: SwapToken[]; label: string; balances: Record<string, Holding>; covered: Set<string>; current?: SwapToken; choose: (t: SwapToken) => void; close: () => void }) {
  const [query, setQuery] = useState(""), [network, setNetwork] = useState("all"), [more, setMore] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Focus the search box once, when the picker opens. The swap screen re-renders every second (route
  // countdown); re-running this on each render would steal focus mid-interaction.
  const onEscape = useEffectEvent(() => close());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector("input")?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onEscape();
      if (e.key === "Tab") {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input") ?? []), first = els[0], last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); previous?.focus(); };
  }, []);

  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t.network, (counts.get(t.network) ?? 0) + 1);
  const lead = LEAD_NETWORKS.filter(n => counts.has(n));
  const rest = [...counts.keys()].filter(n => !lead.includes(n)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
  const chips = ["all", ...lead, ...(more || rest.includes(network) ? rest : [])];

  const q = query.toLowerCase().trim();
  const inNet = tokens.filter(t => (network === "all" || t.network === network) && (!q || (t.name + " " + t.symbol + " " + t.contract).toLowerCase().includes(q)));
  const held = inNet.filter(t => balances[t.id]).sort((a, b) => Number(balances[b.id]?.usd ?? 0) - Number(balances[a.id]?.usd ?? 0));
  const popular = inNet.filter(t => !balances[t.id] && coreIdentity(t));
  const others = inNet.filter(t => !balances[t.id] && !coreIdentity(t)).sort((a, b) => (a.assetId ? 0 : 1) - (b.assetId ? 0 : 1) || a.symbol.localeCompare(b.symbol));
  const where = network === "all" ? "" : " on " + netName(network);
  const sections: [string, SwapToken[], number][] = q
    ? [["Results" + where, [...held, ...popular, ...others], 120]]
    : [["Your tokens" + where, held, 40], ["Popular" + where, popular, 40], ["All tokens" + where, others, 120]];
  const popularChips = tokens.filter(t => coreIdentity(t) && t.network === "near").slice(0, 5);

  return <div className="fv-dialog-backdrop" onClick={close}>
    <div className="fv-dialog fv-token-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}>
      <div className="fv-section-head"><h2>{label}</h2><button type="button" className="fv-icon-button" aria-label="Close token picker" onClick={close}><X size={19} /></button></div>
      <label className="fv-search-input fv-picker-search"><Search size={16} /><input aria-label="Search token name or contract" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, symbol, or paste a contract" /></label>
      <div className="fv-picker-filter"><span>Popular</span><div>{popularChips.map(t => <button type="button" key={t.id} onClick={() => choose(t)}><TokenIcon symbol={t.symbol} network={t.network} core image={t.icon} size={22} />{t.symbol}</button>)}</div></div>
      <div className="fv-picker-filter"><span>Network</span><div role="radiogroup" aria-label="Network">
        {chips.map(n => <button type="button" role="radio" key={n} aria-checked={network === n} className={n === "all" ? "is-all" : ""} onClick={() => setNetwork(n)}>{n !== "all" && <NetworkLabel network={n} iconOnly />}{n === "all" ? "All" : netName(n)}</button>)}
        {!more && !rest.includes(network) && rest.length > 0 && <button type="button" className="fv-picker-more" onClick={() => setMore(true)}>+{rest.length} more</button>}
      </div></div>
      <div className="fv-token-options">
        {sections.filter(([, list]) => list.length).map(([title, list, cap]) => <section key={title}>
          <div className="fv-picker-group"><strong>{title}</strong><small>{list.length.toLocaleString()} token{list.length === 1 ? "" : "s"}</small></div>
          {list.slice(0, cap).map(t => {
            const h = balances[t.id], read = covered.has(t.network);
            return <button type="button" key={t.id} className={current?.id === t.id ? "is-current" : ""} onClick={() => choose(t)}>
              <TokenIcon symbol={t.symbol} image={t.icon} network={t.network} core={coreIdentity(t)} size={40} />
              <span className="fv-picker-id"><strong>{t.symbol}<em>{netName(t.network)}</em></strong><small>{t.contract === "native" ? t.name.replace(" · native", "") + " · Native token" : t.contract}</small></span>
              <span className="fv-picker-balance">{h ? <><strong>{fmtBal(h.amount)}</strong><small>{h.usd ? fmtUsd(h.usd) : "Unpriced"}</small></> : read ? <><strong>0.0000</strong><small>$0.00</small></> : <><strong>{t.price ? fmtUsd(t.price) : "—"}</strong><small>price</small></>}</span>
              <ChevronRight size={17} className="fv-picker-chevron" />
            </button>;
          })}
          {list.length > cap && <p className="fv-muted fv-picker-cap">Search to narrow {list.length.toLocaleString()} tokens.</p>}
        </section>)}
        {!inNet.length && <p className="fv-empty">No matching listed token. Check the contract address.</p>}
      </div>
    </div>
  </div>;
}
