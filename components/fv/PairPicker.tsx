"use client";
// Pair selection for the Trade screen: one searchable dropdown with every Hyperliquid perp (live mark, 24h change,
// volume) and spot tokens across the chains FlowVault can trade (DexScreener search, ranked by 24h volume).
// Display data only: choosing a pair never prepares anything.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { TokenIcon, networkInfo } from "./AssetIdentity";
import { chainNetwork, type ScreenRow } from "./MarketScreener";
import { fmtUsd, fmtPct } from "./swap-format";

export type Pair = { kind: "perp"; coin: string } | { kind: "spot"; chain: string; address: string; symbol: string; icon?: string | null; quote?: string };
interface PerpListing { coin: string; price: string | null; change24h: number | null; volume24h: number | null; maxLeverage: number }
const compact = (n: number | null | undefined) => n === null || n === undefined ? "—" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const px = (v: string | number | null | undefined) => { const n = Number(v); return !v || !Number.isFinite(n) ? "—" : n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : 4 }) : n.toPrecision(4); };
const CORE = ["BTC", "ETH", "NEAR", "SOL", "USDC", "USDT"];

let perpCache: { at: number; rows: PerpListing[] } | null = null;
export function pairLabel(p: Pair) { return p.kind === "perp" ? p.coin + "-PERP" : `${p.symbol}/${p.quote ?? "USD"}`; }

export function PairPicker({ value, onChange }: { value: Pair; onChange: (p: Pair) => void }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState<"perp" | "spot">(value.kind), [query, setQuery] = useState("");
  const [perps, setPerps] = useState<PerpListing[]>(perpCache?.rows ?? []), [spot, setSpot] = useState<ScreenRow[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => { document.removeEventListener("mousedown", away); clearTimeout(t); };
  }, [open]);
  // Perps: every listed market, refreshed at most every 20 seconds while the list is open.
  useEffect(() => {
    if (!open || tab !== "perp" || (perpCache && Date.now() - perpCache.at < 20_000)) return;
    const abort = new AbortController();
    fetch("/api/markets?list=perps", { signal: abort.signal, cache: "no-store" }).then(async r => { const b = await r.json() as { markets?: PerpListing[]; error?: string }; if (!r.ok || !b.markets) throw new Error(b.error); perpCache = { at: Date.now(), rows: b.markets }; setPerps(b.markets); setError(""); })
      .catch(e => { if (!abort.signal.aborted) setError((e as Error).message); });
    return () => abort.abort();
  }, [open, tab]);
  // Spot: trending tokens until the owner types, then a debounced search.
  useEffect(() => {
    if (!open || tab !== "spot") return;
    const abort = new AbortController(), term = query.trim();
    const t = setTimeout(() => {
      setBusy(true);
      fetch(term.length >= 2 ? "/api/discover?feed=search&q=" + encodeURIComponent(term) : "/api/discover?feed=trending&chain=all", { signal: abort.signal, cache: "no-store" })
        .then(async r => { const b = await r.json() as { rows?: ScreenRow[]; error?: string }; if (!r.ok || !b.rows) throw new Error(b.error); setSpot([...b.rows].sort((x, y) => (y.volume.h24 ?? 0) - (x.volume.h24 ?? 0)).slice(0, 40)); setError(""); })
        .catch(e => { if (!abort.signal.aborted) setError((e as Error).message); })
        .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    }, term ? 300 : 0);
    return () => { clearTimeout(t); abort.abort(); };
  }, [open, tab, query]);

  const perpRows = useMemo(() => { const q = query.trim().toUpperCase(); return (q ? perps.filter(p => p.coin.toUpperCase().includes(q)) : perps).slice(0, 60); }, [perps, query]);
  const count = tab === "perp" ? perpRows.length : spot.length;
  const pick = (i: number) => {
    if (tab === "perp") { const p = perpRows[i]; if (p) onChange({ kind: "perp", coin: p.coin }); }
    else { const r = spot[i]; if (r) onChange({ kind: "spot", chain: r.chain, address: r.address, symbol: r.symbol, icon: r.icon, quote: r.quoteSymbol }); }
    setOpen(false); setQuery("");
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(count - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") setOpen(false);
  };

  return <div className="fv-pair-picker" ref={box}>
    <button type="button" className="fv-pair-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      {value.kind === "perp" ? <TokenIcon symbol={value.coin} core={CORE.includes(value.coin)} size={30} /> : <TokenIcon symbol={value.symbol} image={value.icon ?? undefined} network={chainNetwork(value.chain)} size={30} />}
      <span><strong>{pairLabel(value)}</strong><small>{value.kind === "perp" ? "Perpetual · Hyperliquid" : "Spot · " + (networkInfo(chainNetwork(value.chain))?.name ?? value.chain)}</small></span>
      <ChevronDown size={16} />
    </button>
    {open && <div className="fv-pair-menu" role="dialog" aria-label="Choose a market">
      <div className="fv-pair-tabs" role="tablist">{(["perp", "spot"] as const).map(t => <button type="button" role="tab" key={t} aria-selected={tab === t} onClick={() => { setTab(t); setActive(0); }}>{t === "perp" ? "Perps" : "Spot"}</button>)}</div>
      <label className="fv-pair-search"><Search size={15} /><input ref={input} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={key} placeholder={tab === "perp" ? "Search perps (BTC, HYPE…)" : "Search any token, name or contract"} aria-label="Search markets" /></label>
      <div className="fv-pair-head"><span>{tab === "perp" ? "Market" : "Token"}</span><span>Price</span><span>24h</span></div>
      <div className="fv-pair-list" role="listbox">
        {tab === "perp" && perpRows.map((p, i) => <button type="button" role="option" aria-selected={i === active} key={p.coin} className={value.kind === "perp" && value.coin === p.coin ? "is-current" : ""} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
          <TokenIcon symbol={p.coin} core={CORE.includes(p.coin)} size={24} />
          <span><strong>{p.coin}<em>PERP</em></strong><small>Up to {p.maxLeverage}× · vol {compact(p.volume24h)}</small></span>
          <span className="fv-pair-num">{px(p.price)}</span>
          <span className={"fv-pair-num " + ((p.change24h ?? 0) >= 0 ? "fv-up" : "fv-down")}>{fmtPct(p.change24h)}</span>
        </button>)}
        {tab === "spot" && spot.map((r, i) => <button type="button" role="option" aria-selected={i === active} key={r.chain + r.address} className={value.kind === "spot" && value.address === r.address ? "is-current" : ""} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
          <TokenIcon symbol={r.symbol} image={r.icon ?? undefined} network={chainNetwork(r.chain)} size={24} />
          <span><strong>{r.symbol}<em>SPOT</em></strong><small>{networkInfo(chainNetwork(r.chain))?.name ?? r.chain} · liq {compact(r.liquidityUsd)} · {r.address.slice(0, 6)}…{r.address.slice(-4)}</small></span>
          <span className="fv-pair-num">{r.priceUsd ? "$" + px(r.priceUsd) : "—"}</span>
          <span className={"fv-pair-num " + ((r.change.h24 ?? 0) >= 0 ? "fv-up" : "fv-down")}>{fmtPct(r.change.h24 ?? null)}</span>
        </button>)}
        {!count && <p className="fv-muted fv-pair-empty">{error || (busy || (tab === "perp" && !perps.length) ? "Loading markets…" : "No markets match.")}</p>}
      </div>
      {tab === "spot" && <p className="fv-pair-note">Public DexScreener pairs, ranked by 24h volume. Look-alike tokens exist: check the chain and contract.</p>}
    </div>}
  </div>;
}
export { fmtUsd };
