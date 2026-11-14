"use client";
// Portfolio building blocks for many wallets and many assets: a wallet switcher, the split by network and by
// wallet, tokens grouped by asset (expand to see each network and wallet), DeFi grouped by protocol, and NFTs
// at floor. Rows come from the live view model; values are the server's, never re-priced here.
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, Copy, Image as ImageIcon, Layers, Search, Wallet } from "lucide-react";
import { TokenIcon } from "../AssetIdentity";
import { distribution, groupProtocols, groupTokens, splitSmall, type AssetGroup, type HoldingRow, type ProtocolGroup, type Slice, type WalletSummary } from "@/lib/flowvault/portfolio-view";

/* eslint-disable @typescript-eslint/no-explicit-any -- view-model rows */
const NET_KEY: Record<string, string> = {
  Ethereum: "eth", Base: "base", Arbitrum: "arb", "BNB Chain": "bnb", Polygon: "pol", Avalanche: "avax", Optimism: "op", Gnosis: "gnosis",
  Solana: "solana", NEAR: "near", Scroll: "scroll", Abstract: "abstract", Berachain: "bera", Hyperliquid: "hyperliquid",
};
export const netKey = (name: string) => NET_KEY[name] ?? name.toLowerCase();
const ACTIONABLE = new Set(["Ethereum", "Base", "Arbitrum", "NEAR", "Solana", "BNB Chain"]);
const PALETTE = ["var(--fv-chart-1)", "var(--fv-chart-2)", "var(--fv-chart-3)", "var(--fv-chart-4)", "var(--fv-chart-5)", "var(--fv-chart-6)", "var(--fv-chart-7)"];

export const money = (n: number | null | undefined, signed = false) =>
  n === null || n === undefined ? "Unvalued" : (signed && n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number | null, sym: string) => (n === null || !Number.isFinite(n) ? "quantity unknown" : (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6 })) + " " + sym);
const price = (n: number | null) => (n === null ? "—" : n >= 1 ? money(n) : n >= 0.0001 ? "$" + n.toPrecision(3) : "<$0.0001");
const pct = (x: number) => (x >= 0.995 ? "100%" : x < 0.001 ? "<0.1%" : (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%");

/** Normalises a view-model row (live or example) into a HoldingRow. */
export function toHolding(r: any): HoldingRow {
  const parsed = Number(String(r.value ?? "").replace(/[^0-9.]/g, ""));
  return {
    id: String(r.id ?? r.name),
    symbol: r.symbol ?? r.name ?? "?",
    name: r.name ?? r.symbol ?? "",
    kind: r.kind ?? "wallet",
    usd: typeof r.usd === "number" ? r.usd : r.usd === null ? null : /^\$/.test(String(r.value ?? "")) && Number.isFinite(parsed) ? parsed : null,
    quantity: typeof r.qty === "number" && Number.isFinite(r.qty) ? r.qty : null,
    network: r.chain ?? "NEAR",
    account: r.account ?? r.accountLabel ?? "this account",
    walletLabel: r.walletLabel ?? r.accountLabel ?? "",
    venue: r.venue ?? null,
    groupId: r.groupId,
    icon: r.icon,
  };
}

export function WalletBar({ wallets, value, set }: { wallets: { account: string; label: string; usd: number }[]; value: string; set: (a: string) => void }) {
  if (wallets.length < 2) return null;
  const all = wallets.reduce((s, w) => s + w.usd, 0);
  return <div className="fv-walletbar" role="tablist" aria-label="Filter by wallet">
    {[{ account: "", label: "All wallets", usd: all }, ...wallets].map((w) => <button key={w.account || "all"} type="button" role="tab" aria-selected={value === w.account} onClick={() => set(w.account)}>
      {w.account ? <Wallet size={14} /> : <Layers size={14} />}<span>{w.label}</span><strong>{money(w.usd)}</strong>
    </button>)}
  </div>;
}

function Bar({ title, slices, active, pick }: { title: string; slices: Slice[]; active?: string; pick?: (s: Slice) => void }) {
  if (!slices.length) return null;
  return <div className="fv-alloc">
    <div className="fv-alloc-head"><span>{title}</span><small>{slices.length} {slices.length === 1 ? "item" : "items"}</small></div>
    <div className="fv-alloc-bar" role="img" aria-label={title + ": " + slices.map((s) => `${s.label} ${pct(s.share)}`).join(", ")}>
      {slices.map((s, i) => <i key={s.label} style={{ width: Math.max(s.share * 100, 0.8) + "%", background: PALETTE[i % PALETTE.length] }} />)}
    </div>
    <ul className="fv-alloc-legend">{slices.map((s, i) => <li key={s.label}>
      <button type="button" disabled={!pick} aria-pressed={active === s.label} onClick={() => pick?.(s)}>
        <span className="fv-alloc-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
        <span className="fv-alloc-name">{s.label}</span><span className="fv-alloc-pct">{pct(s.share)}</span><strong>{money(s.usd)}</strong>
      </button>
    </li>)}</ul>
  </div>;
}

export function Allocation({ rows, network, setNetwork, multiWallet, wallets, setWallet }: { rows: HoldingRow[]; network: string; setNetwork: (n: string) => void; multiWallet: boolean; wallets: Map<string, string>; setWallet: (account: string) => void }) {
  const byNet = useMemo(() => distribution(rows, (r) => r.network), [rows]);
  const byWallet = useMemo(() => distribution(rows, (r) => wallets.get(r.account) ?? r.walletLabel), [rows, wallets]);
  if (!byNet.length) return null;
  return <section className="fv-panel fv-alloc-panel">
    <Bar title="By network" slices={byNet} active={network} pick={(s) => setNetwork(s.members.length === 1 && network !== s.label ? s.label : "")} />
    {multiWallet && <Bar title="By wallet" slices={byWallet} pick={(s) => { const hit = [...wallets].find(([, label]) => label === s.label); if (hit) setWallet(hit[0]); }} />}
  </section>;
}

function AssetRow({ g, total, open, toggle, act }: { g: AssetGroup; total: number; open: boolean; toggle: () => void; act: (r: HoldingRow) => void }) {
  const many = g.rows.length > 1;
  const one = g.rows[0];
  return <div className={"fv-asset-group" + (open ? " is-open" : "")}>
    <button type="button" className="fv-asset-main" aria-expanded={many ? open : undefined} onClick={many ? toggle : () => act(one)}>
      <span className="fv-asset-cell"><TokenIcon symbol={g.symbol} image={g.icon} network={many ? undefined : netKey(one.network)} />
        <span><strong>{g.symbol}</strong><small>{many ? `${g.networks.length > 1 ? g.networks.length + " networks" : g.networks[0]}${g.wallets.length > 1 ? " · " + g.wallets.length + " wallets" : ""}` : `${one.network} · ${one.walletLabel}`}</small></span></span>
      <span className="fv-asset-price">{price(g.price)}</span>
      <span className="fv-asset-bal">{qty(g.quantity, g.symbol)}</span>
      <span className="fv-asset-val"><strong>{money(g.usd)}</strong>{g.usd !== null && total > 0 && <small>{pct(g.usd / total)}</small>}</span>
      <span className="fv-asset-more" aria-hidden>{many ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : ACTIONABLE.has(one.network) ? <ArrowUpRight size={15} /> : null}</span>
    </button>
    {many && open && <div className="fv-asset-legs">{g.rows.map((r) => <div key={r.id} className="fv-asset-leg">
      <span className="fv-asset-cell"><TokenIcon symbol={r.symbol} image={r.icon} network={netKey(r.network)} size={26} /><span><strong>{r.network}</strong><small>{r.walletLabel}</small></span></span>
      <span className="fv-asset-bal">{qty(r.quantity, r.symbol)}</span>
      <span className="fv-asset-val"><strong>{money(r.usd)}</strong></span>
      {ACTIONABLE.has(r.network) ? <button type="button" className="fv-row-action" onClick={() => act(r)}>Use <ArrowUpRight size={13} /></button> : <span className="fv-muted fv-leg-note">View only</span>}
    </div>)}</div>}
  </div>;
}

export function TokenList({ rows, act }: { rows: HoldingRow[]; act: (r: HoldingRow) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set()), [showSmall, setShowSmall] = useState(false);
  const groups = useMemo(() => groupTokens(rows), [rows]);
  const total = groups.reduce((s, g) => s + (g.usd ?? 0), 0);
  const { shown, hidden } = splitSmall(groups, 1);
  const list = showSmall ? groups : shown;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  if (!groups.length) return null;
  return <div className="fv-asset-table">
    <div className="fv-asset-header"><span>Asset</span><span>Price</span><span>Balance</span><span>Value</span><span /></div>
    {list.map((g) => <AssetRow key={g.key} g={g} total={total} open={open.has(g.key)} toggle={() => toggle(g.key)} act={act} />)}
    {hidden.length > 0 && <button type="button" className="fv-small-toggle" onClick={() => setShowSmall(!showSmall)}>
      {showSmall ? "Hide balances under $1" : `Show ${hidden.length} balance${hidden.length === 1 ? "" : "s"} under $1 · ${money(hidden.reduce((s, g) => s + (g.usd ?? 0), 0))}`}
    </button>}
  </div>;
}

function ProtocolCard({ g, act }: { g: ProtocolGroup; act: (r: HoldingRow) => void }) {
  return <article className="fv-protocol">
    <header><span className="fv-protocol-mark" aria-hidden>{g.venue.slice(0, 2)}</span><div><strong>{g.venue}</strong><small>{g.networks.join(", ")}</small></div><strong className="fv-protocol-total">{money(g.usd, true)}</strong></header>
    <div className="fv-protocol-rows">{g.rows.map((r) => <button type="button" key={r.id} className={"fv-protocol-row" + (r.kind === "debt" ? " is-debt" : "")} onClick={() => act(r)}>
      <span className="fv-asset-cell"><TokenIcon symbol={r.symbol} image={r.icon} network={netKey(r.network)} size={26} /><span><strong>{r.symbol}</strong><small>{TYPE[r.kind]} · {r.walletLabel}</small></span></span>
      <span className="fv-asset-bal">{qty(r.quantity, r.symbol)}</span>
      <strong>{r.kind === "debt" && r.usd !== null ? money(-r.usd, true) : money(r.usd)}</strong>
    </button>)}</div>
    {g.unvalued > 0 && <small className="fv-muted">{g.unvalued} position{g.unvalued === 1 ? " isn't" : "s aren't"} valued and {g.unvalued === 1 ? "isn't" : "aren't"} counted.</small>}
  </article>;
}
const TYPE: Record<HoldingRow["kind"], string> = { wallet: "Wallet", supplied: "Deposited", collateral: "Collateral", debt: "Borrowed", staking: "Staked" };

export function ProtocolList({ rows, act }: { rows: HoldingRow[]; act: (r: HoldingRow) => void }) {
  const groups = useMemo(() => groupProtocols(rows), [rows]);
  if (!groups.length) return null;
  return <div className="fv-protocols">{groups.map((g) => <ProtocolCard key={g.venue} g={g} act={act} />)}</div>;
}

export interface Nft { id: string; name: string; collection: string | null; network: string; amount: string; floorUsd: number | null; image: string | null; accountId: string }
export function NftGrid({ nfts, wallets }: { nfts: Nft[]; wallets: Map<string, string> }) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...nfts].sort((a, b) => (b.floorUsd ?? -1) - (a.floorUsd ?? -1)), [nfts]);
  const floor = nfts.reduce((s, n) => s + (n.floorUsd ?? 0) * (Number(n.amount) || 1), 0);
  if (!nfts.length) return null;
  const list = all ? sorted : sorted.slice(0, 24);
  return <div className="fv-nfts">
    <p className="fv-muted fv-nft-note">{nfts.length} NFT{nfts.length === 1 ? "" : "s"} · about {money(floor)} at collection floor. Floor prices are estimates, so NFTs aren&rsquo;t added to your portfolio value.</p>
    <div className="fv-nft-grid">{list.map((n) => <figure key={n.id} className="fv-nft">
      <div className="fv-nft-media">{/* eslint-disable-next-line @next/next/no-img-element -- remote NFT previews of unknown hosts */}
      {n.image ? <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <ImageIcon size={26} aria-hidden />}</div>
      <figcaption><strong title={n.name}>{n.name}</strong><small>{n.collection ?? n.network}{Number(n.amount) > 1 ? " · ×" + n.amount : ""}</small>
        <span>{n.floorUsd !== null ? "Floor " + money(n.floorUsd) : "No floor price"}</span>{wallets.size > 1 && <small>{wallets.get(n.accountId) ?? n.accountId.slice(0, 6) + "…"}</small>}</figcaption>
    </figure>)}</div>
    {sorted.length > 24 && <button type="button" className="fv-small-toggle" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${sorted.length} NFTs`}</button>}
  </div>;
}

export function SearchBox({ value, set }: { value: string; set: (s: string) => void }) {
  return <label className="fv-search-input"><Search size={16} /><input aria-label="Search your assets" placeholder="Search assets or protocols" value={value} onChange={(e) => set(e.target.value)} /></label>;
}

const kindOf = (account: string) => (/^0x[0-9a-f]{40}$/i.test(account) ? "EVM" : /\.near$|\.tg$|^[0-9a-f]{64}$/i.test(account) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(account) ? "NEAR" : "Solana");
const shortAcct = (a: string) => (a.length > 22 ? a.slice(0, 6) + "…" + a.slice(-4) : a);
function NetworkStack({ networks, max = 5 }: { networks: string[]; max?: number }) {
  return <span className="fv-netstack" title={networks.join(", ")}>
    {networks.slice(0, max).map((n) => { const k = netKey(n); return <TokenIcon key={n} symbol={n.slice(0, 2)} network={undefined} core={false} image={NET_IMG[k]} size={20} />; })}
    {networks.length > max && <span className="fv-netstack-more">+{networks.length - max}</span>}
  </span>;
}
const NET_IMG: Record<string, string> = {
  eth: "/assets/tokens/eth.png", base: "/assets/chains/base.png", arb: "/assets/chains/arbitrum.png", bnb: "/assets/chains/bnb.png", pol: "/assets/chains/polygon.png",
  avax: "/assets/chains/avalanche.png", op: "/assets/chains/optimism.png", gnosis: "/assets/chains/gnosis.png", solana: "/assets/chains/solana.png", near: "/assets/tokens/near.jpg",
  scroll: "/assets/chains/scroll.png", abstract: "/assets/chains/abstract.png", bera: "/assets/chains/bera.png", hyperliquid: "/assets/chains/hyperliquid.png",
};

/** Every connected wallet as a card: value and share, where it holds, counts, and its largest assets. */
export function WalletCards({ wallets, open }: { wallets: WalletSummary[]; open: (account: string) => void }) {
  if (wallets.length < 2) return null;
  return <section className="fv-wallet-cards" aria-label="Your wallets">
    <div className="fv-wallet-cards-head"><h2>Your wallets</h2><small>{wallets.length} connected · open one to see only what it holds</small></div>
    <div className="fv-wallet-grid">{wallets.map((w) => <button key={w.account} type="button" className="fv-wallet-tile" onClick={() => open(w.account)}>
      <span className="fv-wallet-tile-top"><span className="fv-wallet-avatar" data-kind={kindOf(w.account)}>{kindOf(w.account) === "EVM" ? "Ξ" : kindOf(w.account) === "NEAR" ? "N" : "◎"}</span>
        <span className="fv-wallet-id"><strong>{w.label}</strong><small>{kindOf(w.account)} · {shortAcct(w.account)}</small></span><ChevronRight size={16} /></span>
      <span className="fv-wallet-tile-value"><strong>{money(w.usd, true)}</strong><small>{pct(w.share)} of total</small></span>
      <span className="fv-wallet-share"><i style={{ width: Math.max(w.share * 100, 1) + "%" }} /></span>
      <span className="fv-wallet-tile-meta"><NetworkStack networks={w.networks} /><small>{w.tokens} token{w.tokens === 1 ? "" : "s"}{w.defi ? ` · ${w.defi} DeFi` : ""}{w.nfts ? ` · ${w.nfts} NFT${w.nfts === 1 ? "" : "s"}` : ""}</small></span>
      {w.top.length > 0 && <span className="fv-wallet-top">{w.top.map((t) => <span key={t.symbol}><TokenIcon symbol={t.symbol} image={t.icon} size={18} />{t.symbol}<b>{money(t.usd)}</b></span>)}</span>}
    </button>)}</div>
  </section>;
}

/** The open wallet: who it is, what it's worth, its share of everything, and the way back. */
export function WalletHeader({ w, back, copy }: { w: WalletSummary; back: () => void; copy: (a: string) => void }) {
  const kind = kindOf(w.account);
  return <section className="fv-wallet-header">
    <button type="button" className="fv-text-button" onClick={back}><ArrowLeft size={14} /> All wallets</button>
    <div className="fv-wallet-header-main">
      <span className="fv-wallet-avatar is-large" data-kind={kind}>{kind === "EVM" ? "Ξ" : kind === "NEAR" ? "N" : "◎"}</span>
      <div className="fv-wallet-id"><strong>{w.label}</strong><small>{kind} wallet · <code>{shortAcct(w.account)}</code> {/[0-9a-z]{20,}/i.test(w.account) && <button type="button" className="fv-icon-button fv-copy" aria-label="Copy address" onClick={() => copy(w.account)}><Copy size={13} /></button>}</small></div>
      <div className="fv-wallet-header-value"><strong>{money(w.usd, true)}</strong><small>{pct(w.share)} of your portfolio</small></div>
    </div>
    <div className="fv-wallet-stats">
      <span><small>Networks</small><b>{w.networks.length}</b><NetworkStack networks={w.networks} max={8} /></span>
      <span><small>Tokens</small><b>{w.tokens}</b></span>
      <span><small>DeFi protocols</small><b>{w.defi}</b></span>
      <span><small>NFTs</small><b>{w.nfts}</b>{w.nftFloor > 0 && <em>≈ {money(w.nftFloor)} floor</em>}</span>
    </div>
  </section>;
}
