"use client";
/* eslint-disable @next/next/no-img-element -- token icons from the rates and market feeds, fixed 24-26px, from hosts not known in advance */
// The watchlist in one compact list: the tokens you starred in Markets (the same list, saved with your account), with
// live price and 24h move refreshed every minute; a price that changes flashes. With nothing starred it suggests
// the most traded liquid NEAR tokens (swappable here) to star. Buy opens the swap with the token filled in; nothing executes from here.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Star } from "lucide-react";
import { useWatchlist } from "../useWatchlist";
import { isStableAsset } from "@/lib/flowvault/brief";

type Row = { chain: string; address: string; symbol: string; name?: string; icon: string | null; priceUsd: string | null; change: { h24?: number }; liquidityUsd: number | null; volume?: { h24?: number }; swapId?: string | null };
const CHAIN: Record<string, string> = { eth: "ethereum", arb: "arbitrum", sol: "solana", bnb: "bsc" };
const toMarket = (id: string) => { const i = id.indexOf(":"), n = id.slice(0, i); return CHAIN[n] ? CHAIN[n] + id.slice(i) : id; };
const key = (r: { chain: string; address: string }) => (r.chain + ":" + r.address).toLowerCase();
const price = (p: string | null) => { if (!p) return "—"; const n = Number(p); return n >= 1 ? "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "$" + n.toPrecision(3); };
const chainName = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

export function WatchlistCompact({ owner, example, buy, open }: { owner: string; example: boolean; buy: (swapId: string) => void; open: (token: string | null) => void }) {
  const list = useWatchlist({ owner, example, locked: false });
  const saved = list.loaded ? list.data.saved.map(toMarket) : null;
  const [rows, setRows] = useState<Row[]>([]), [suggest, setSuggest] = useState<Row[]>([]), [loading, setLoading] = useState(true), [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const last = useRef<Record<string, string | null>>({});

  const toggle = (r: Row) => {
    const id = r.chain + ":" + r.address, raw = list.data.saved.find((x) => toMarket(x).toLowerCase() === id.toLowerCase());
    void list.apply(raw ? { op: "unstar", id: raw } : { op: "star", id }).catch(() => {});
    if (!raw) setRows((x) => x.some((y) => key(y) === key(r)) ? x : [...x, r]); else setRows((x) => x.filter((y) => key(y) !== key(r)));
  };

  const read = useCallback(async (ids: string[]) => {
    const [watch, trend] = await Promise.all([
      ids.length ? fetch("/api/discover?feed=watch&ids=" + encodeURIComponent(ids.slice(0, 60).join(",")), { cache: "no-store" }).then((r) => r.json() as Promise<{ rows?: Row[] }>).then((b) => b.rows ?? []).catch(() => null) : Promise.resolve([] as Row[]),
      fetch("/api/discover?feed=top&chain=near", { cache: "no-store" }).then((r) => r.json() as Promise<{ rows?: Row[] }>).then((b) => (b.rows ?? []).filter((r) => r.swapId && !isStableAsset(r.symbol) && (r.liquidityUsd ?? 0) >= 250_000 && (r.volume?.h24 ?? 0) >= 50_000).sort((a, z) => (z.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0)).slice(0, 6)).catch(() => null),
    ]);
    if (watch) {
      const f: Record<string, "up" | "down"> = {};
      for (const r of watch) { const k = key(r), was = last.current[k]; if (was && r.priceUsd && was !== r.priceUsd) f[k] = Number(r.priceUsd) > Number(was) ? "up" : "down"; last.current[k] = r.priceUsd; }
      setRows(watch); setFlash(f);
      if (Object.keys(f).length) setTimeout(() => setFlash({}), 1200);
    }
    if (trend) setSuggest(trend);
    setLoading(false);
  }, []);
  const ids = saved?.join(",") ?? null;
  useEffect(() => {
    if (ids === null) return;
    const list = ids.split(",").filter(Boolean);
    const first = setTimeout(() => void read(list), 0), t = setInterval(() => void read(list), 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [ids, read]);

  const starred = new Set((saved ?? []).map((x) => x.toLowerCase()));
  const line = (r: Row, i: number, isSaved: boolean) => { const ch = r.change?.h24, k = key(r); return <li key={k} className={"fv-watch-row fv-rise" + (flash[k] ? " is-" + flash[k] : "")} style={{ ["--i" as string]: Math.min(i, 8) }}>
    <button type="button" className={"fv-icon-button fv-watch-star" + (isSaved ? " is-on" : "")} aria-pressed={isSaved} aria-label={(isSaved ? "Remove " : "Add ") + r.symbol + (isSaved ? " from" : " to") + " watchlist"} onClick={() => toggle(r)}><Star size={15} /></button>
    <button type="button" className="fv-watch-name" onClick={() => open(r.chain + ":" + r.address)}>{r.icon ? <img src={r.icon} alt="" width={24} height={24} /> : <i aria-hidden>{r.symbol.slice(0, 1)}</i>}<span><strong>{r.symbol}</strong><small>{chainName(r.chain)}</small></span></button>
    <span className="fv-watch-price">{price(r.priceUsd)}</span>
    <span className={"fv-watch-move" + (typeof ch === "number" ? (ch >= 0 ? " is-up" : " is-down") : "")}>{typeof ch === "number" ? (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%" : "—"}</span>
    {r.swapId ? <button type="button" className="fv-text-button" onClick={() => buy(r.swapId!)}>Buy <ArrowUpRight size={13} /></button> : <span />}
  </li>; };

  return <div className="fv-watch-compact">
    <div className="fv-yields-head"><h3>Your watchlist{rows.length ? ` · ${rows.length}` : ""} <span className="fv-live-dot" aria-label="Live" /></h3><button type="button" className="fv-text-button" onClick={() => open(null)}>Open Markets <ArrowUpRight size={13} /></button></div>
    {loading && <ul className="fv-watch-list">{[0, 1, 2].map((i) => <li key={i} className="fv-watch-row"><div className="fv-skel" style={{ width: 28, height: 28 }} /><div className="fv-skel fv-skel-line" style={{ width: 110 }} /><div className="fv-skel fv-skel-line" style={{ width: 60 }} /><div className="fv-skel fv-skel-line" style={{ width: 50 }} /><span /></li>)}</ul>}
    {!loading && rows.length > 0 && <ul className="fv-watch-list">{rows.map((r, i) => line(r, i, true))}</ul>}
    {!loading && !rows.length && <p className="fv-muted fv-watch-empty">Nothing starred yet. Star a token here or in Markets and it shows up with its live price.</p>}
    {!loading && suggest.filter((r) => !starred.has(key(r))).length > 0 && <>
      <h4 className="fv-watch-sub">Most traded on NEAR · swappable in FlowVault</h4>
      <ul className="fv-watch-list">{suggest.filter((r) => !starred.has(key(r))).slice(0, rows.length ? 3 : 6).map((r, i) => line(r, i, false))}</ul>
    </>}
    <p className="fv-muted fv-fineprint">Prices from DexScreener, refreshed every minute. Listings aren&apos;t endorsements.</p>
  </div>;
}
