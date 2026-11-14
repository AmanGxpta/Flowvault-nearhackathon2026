"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- presentation adapters consume the existing view model */
import { StakeHome } from "./stake/StakeHome";
import { OpenStakeFlows } from "./stake/OpenStakeFlows";
import { PairPicker, type Pair } from "./PairPicker";
import { SpotDesk } from "./SpotDesk";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { ArrowDownUp, ArrowUpRight, BarChart3, Wallet, Search, SlidersHorizontal, Plus, X, ChevronDown, ChevronRight, Send, Sprout, Activity, Share2, Download, Landmark, TrendingUp } from "lucide-react";
import { MarketPanel } from "./MarketPanel";
import { TokenIcon, tokenLogo } from "./AssetIdentity";
import { Skel } from "./Skel";
import { Allocation, NftGrid, ProtocolList, SearchBox, TokenList, WalletBar, WalletCards, WalletHeader, money, toHolding, type Nft } from "./portfolio/Holdings";
import { summarizeWallets, totals, walletNameMap, type HoldingRow } from "@/lib/flowvault/portfolio-view";
import { PerpsCard } from "./Perps";
import { VaultsCard } from "./Vaults";
import { LendingVenues } from "./LendingVenues";
import { PolicyView } from "./screens/PolicyView";
import { MandatesCard } from "./Mandates";
import { PolicyContractCard } from "./PolicyContract";
import { ActivityView } from "./screens/ActivityView";
import { PlanHistory } from "./PlanDock";
import { StatementPanel } from "./Statement";
import { CreditView } from "./screens/CreditView";
import { PayOnADateView } from "./screens/PayOnADateView";
import { ApprovedAssetSales } from "./ApprovedAssetSales";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { SwapExplorer } from "./SwapExplorer";
import { useTokenCatalog, coreIdentity } from "./useTokenCatalog";
import { WalletHistory } from "./WalletHistory";
import { RatesTable } from "./RatesTable";
import { OrderTicket, type OrderDraft } from "./OrderTicket";

export const destinations = [
  { id: "portfolio", label: "Portfolio", Icon: Wallet }, { id: "research", label: "Markets", Icon: BarChart3 }, { id: "swap", label: "Swap", Icon: ArrowDownUp },
  { id: "strategies", label: "Earn", Icon: Sprout }, { id: "credit", label: "Borrow", Icon: Landmark },
  { id: "trade", label: "Trade", Icon: TrendingUp }, { id: "activity", label: "Activity", Icon: Activity },
];
export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="fv-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function Button({ children, onClick, primary = false, disabled = false }: { children: ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean }) {
  return <button type="button" className={"fv-button" + (primary ? " fv-primary" : "")} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Tabs({ values, value, set }: { values: string[]; value: string; set: (v: string) => void }) {
  return <div className="fv-tabs" role="tablist">{values.map(x => <button type="button" key={x} role="tab" aria-selected={value === x} onClick={() => set(x)}>{x}</button>)}</div>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onEscape = useEffectEvent(() => close());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onEscape(); }
      if (e.key === "Tab") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea,select,a[href]') ?? []);
        const first = items[0], last = items.at(-1);
        if (!first) return;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []); // Modal lifetime owns focus; close is the current mounted dialog's callback.
  return <div className="fv-dialog-backdrop" onClick={close}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="fv-dialog" onClick={e => e.stopPropagation()}><div className="fv-section-head"><h2>{title}</h2><button className="fv-icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>{children}</div></div>;
}

/** Share-card lines: allocation by symbol as percentages only (no balances, addresses or account names). */
function allocation(rows: any[]): string[] {
  const by = new Map<string, number>();
  for (const r of rows) { const n = Number(String(r.value ?? "").replace(/[^0-9.]/g, "")); if (r.symbol && Number.isFinite(n) && n > 0) by.set(r.symbol, (by.get(r.symbol) ?? 0) + n); }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  if (!total) return ["Guardrails on", "Limits checked before every move"];
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([sym, n]) => `${sym} ${Math.round(n / total * 100)}%`);
}
export function PortfolioHome({ v }: { v: any }) {
  const [tab, setTab] = useState("Tokens");
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState("");
  const [wallet, setWallet] = useState("");
  const [accounts, setAccounts] = useState(false), [snapshot, setSnapshot] = useState(false), [gapsOpen, setGapsOpen] = useState(false);
  const raw = (v.pfRows ?? []).filter((r: any) => r.ownership !== "watched");
  const all = raw.filter((r: any) => !r.status);
  const gaps = raw.filter((r: any) => r.status);
  // Empty balances (0, or dust worth $0.00 with no quantity) are noise once many wallets are connected.
  const holdings: HoldingRow[] = all.map(toHolding).filter((h: HoldingRow) => !(h.usd === 0 && Math.abs(h.quantity ?? 0) < 1e-9));
  const walletNames = walletNameMap(holdings);
  const summaries = summarizeWallets(holdings, v.pfNfts ?? [], walletNames);
  const wallets = summaries.map((w) => ({ account: w.account, label: w.label, usd: w.usd }));
  const openWallet = summaries.find((w) => w.account === wallet);
  const pickWallet = (a: string) => { setWallet(a); setNetwork(""); setTab("Tokens"); };
  const scoped = holdings.filter((h) => !wallet || h.account === wallet);
  const q = query.trim().toLowerCase();
  const visible = scoped.filter((h) => (!network || h.network === network) && (!q || (h.symbol + " " + h.name + " " + (h.venue ?? "") + " " + h.network).toLowerCase().includes(q)));
  const nfts: Nft[] = (v.pfNfts ?? []).filter((n: Nft) => (!wallet || n.accountId === wallet) && (!network || n.network === network) && (!q || (n.name + " " + (n.collection ?? "")).toLowerCase().includes(q)));
  const t = totals(scoped);
  const nftFloor = (v.pfNfts ?? []).filter((n: Nft) => !wallet || n.accountId === wallet).reduce((s: number, n: Nft) => s + (n.floorUsd ?? 0) * (Number(n.amount) || 1), 0);
  const tokenCount = new Set(visible.filter((h) => h.kind === "wallet").map((h) => h.symbol.toUpperCase())).size;
  const defiCount = new Set(visible.filter((h) => h.kind !== "wallet").map((h) => h.venue ?? "")).size;
  const act = (h: HoldingRow) => h.kind === "wallet" ? v.navigate(h.symbol === "USDC" ? "pay" : "swap") : h.kind === "debt" || h.kind === "collateral" ? v.navigate("credit") : v.goStrategies();
  const summary = [v.pfBalances?.[0], v.pfBalances?.[1], v.pfBalances?.[4]].filter(Boolean);
  const networks = [...new Set(scoped.map((h) => h.network))].sort();
  const tabs = ["Tokens" + (tokenCount ? " " + tokenCount : ""), "DeFi" + (defiCount ? " " + defiCount : ""), "NFTs" + (nfts.length ? " " + nfts.length : "")];
  const current = tabs.find((x) => x.startsWith(tab)) ?? tabs[0];
  const empty = <div className="fv-empty"><Wallet size={28} /><h3>{v.portfolioLoading ? "Reading your portfolio" : v.portfolioReadError ? "Portfolio unavailable" : !v.pfHas ? "Connect a wallet to see your portfolio" : query || network || wallet ? "Nothing matches" : tab === "DeFi" ? "No DeFi positions" : tab === "NFTs" ? "No NFTs" : "No token balances to show"}</h3><p>{v.portfolioLoading ? "Fetching balances and positions from your connected wallets…" : v.portfolioReadError ? "Your balances could not be read. Nothing is assumed to be zero." : !v.pfHas ? "Connect your wallets to see everything you hold, on every chain." : query || network || wallet ? "Try another search, network or wallet." : "Nothing here in the wallets FlowVault reads."}</p>{!v.portfolioLoading && (v.portfolioReadError || !v.pfHas) && <Button onClick={v.portfolioReadError ? v.refreshPortfolio : v.openConnect ?? v.connectFirst}>{v.portfolioReadError ? "Try again" : "Connect wallet"}</Button>}</div>;
  return <>
    <PageHeading title="Portfolio" description="Everything you hold, across every wallet, chain and protocol." action={<button type="button" className="fv-button" onClick={() => setAccounts(true)}><Wallet size={15} /> Wallets ({v.pfAccounts?.length ?? 0})</button>} />
    <div className="fv-summary-grid">{summary.map((b: any, i: number) => <section key={b.label} className={"fv-summary" + (!i ? " fv-summary-main" : "")}><span>{i === 0 ? (wallet ? "Wallet value" : "Portfolio value") : b.label}</span><strong>{i === 0 && wallet ? money(t.tokens + t.defi - t.debt) : <Skel v={b.value} />}</strong>
      {i === 0 && (t.tokens > 0 || t.defi > 0) ? <div className="fv-summary-split"><span>Tokens <b>{money(t.tokens)}</b></span>{t.defi > 0 && <span>DeFi <b>{money(t.defi)}</b></span>}{t.debt > 0 && <span>Debt <b>−{money(t.debt)}</b></span>}{nftFloor > 0 && <span title="Floor estimate, not counted">NFTs <b>≈{money(nftFloor)}</b></span>}</div> : <small>{b.sub}</small>}</section>)}</div>
    <div className="fv-quick-actions"><Button primary onClick={() => v.navigate("swap")}><ArrowDownUp size={17} /> Swap</Button><Button onClick={v.goPay}><Send size={17} /> Send</Button><Button onClick={v.goStrategies}><Sprout size={17} /> Earn</Button><Button onClick={() => v.navigate("research")}><BarChart3 size={17} /> Markets</Button><Button disabled={!all.length} onClick={() => setSnapshot(true)}><Share2 size={16} /> Share snapshot</Button><Button onClick={v.goCalendar}>Scheduled payments <ChevronRight size={15} /></Button></div>
    {snapshot && <ShareCard title="My treasury, with a plan" subtitle={(v.upcoming?.length ? v.upcoming.length + " scheduled payment" + (v.upcoming.length === 1 ? "" : "s") + " planned" : "Every move checked against my limits") + " · FlowVault"} lines={allocation(all)} amount={summary[0]?.value} example={v.judge} close={() => setSnapshot(false)} />}
    {v.rec && !["READING", "IDLE", "LIQUID"].includes(v.rec.tag) && <details className="fv-attention"><summary><span><span className="fv-status-dot" />{v.rec.title}</span><span>Review <ChevronRight size={15} /></span></summary><p>{v.rec.body}</p><Button onClick={v.rec.onClick}>{v.rec.cta}</Button></details>}
    {gaps.length > 0 && <section className="fv-coverage" role="status"><button type="button" aria-expanded={gapsOpen} onClick={() => setGapsOpen(!gapsOpen)}><span className="fv-status-dot" /><span>{gaps.length === 1 ? gaps[0].name : gaps.length + " parts of your portfolio aren’t fully read"}</span><small>{gaps.every((g: any) => g.tag === "PARTIAL") ? "The total shows what’s read so far" : "Not counted until they read"}</small>{gapsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
      {gapsOpen && <ul>{gaps.map((g: any, i: number) => <li key={i}><strong>{g.name}</strong><small>{g.sub}</small></li>)}</ul>}</section>}
    {openWallet && <WalletBar wallets={wallets} value={wallet} set={pickWallet} />}
    {openWallet ? <WalletHeader w={openWallet} back={() => pickWallet("")} copy={(a) => { try { void navigator.clipboard.writeText(a); } catch { /* clipboard blocked */ } }} /> : <WalletCards wallets={summaries} open={pickWallet} />}
    <Allocation rows={scoped} network={network} setNetwork={setNetwork} multiWallet={!wallet && wallets.length > 1} wallets={walletNames} setWallet={pickWallet} />
    <section className="fv-panel fv-holdings-panel">
      <div className="fv-section-head"><Tabs values={tabs} value={current} set={(x) => setTab(x.split(" ")[0])} /></div>
      <div className="fv-table-tools"><SearchBox value={query} set={setQuery} /><select aria-label="Filter by network" value={network} onChange={e => setNetwork(e.target.value)}><option value="">All networks</option>{networks.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
      {tab === "Tokens" ? (visible.some((h) => h.kind === "wallet") ? <TokenList rows={visible} act={act} /> : empty)
        : tab === "DeFi" ? (visible.some((h) => h.kind !== "wallet") ? <ProtocolList rows={visible} act={act} /> : empty)
        : nfts.length ? <NftGrid nfts={nfts} wallets={walletNames} /> : empty}
      <div className="fv-panel-foot">{v.footLabel}. Spam tokens are hidden; unpriced holdings aren’t counted.</div>
    </section>
    {!!v.upcoming?.length && <section className="fv-panel fv-upcoming"><div className="fv-section-head"><h2>Upcoming payments</h2><Button onClick={v.goCalendar}>View all</Button></div>{v.upcoming.slice(0, 3).map((o: any, i: number) => <div className="fv-list-row" key={o.id ?? i}><div><strong>{o.name ?? o.title}</strong><small>{o.dueLabel ?? o.due} · {o.amountF ?? o.amount} {o.asset ?? "USDC"}</small></div><Button onClick={o.onPay ?? v.goCalendar}>{o.btnLabel ?? "Review"}</Button></div>)}</section>}
    {accounts && <Modal title="Your wallets" close={() => setAccounts(false)}><p className="fv-muted">Only verified owned wallets contribute to your portfolio. Public addresses belong in Research.</p>{(v.pfAccounts ?? []).map((a: any, i: number) => <div className="fv-wallet-card" key={i}><strong>{a.name}</strong><span className="fv-chip">{a.tag}</span><p>{a.sub}</p><div className="fv-actions">{a.actions?.map((x: any) => <Button key={x.label} onClick={x.onClick}>{x.label}</Button>)}</div></div>)}<Button primary onClick={() => { setAccounts(false); (v.openConnect ?? v.connectFirst)(); }}>Connect another wallet</Button></Modal>}
  </>;
}


export function ResearchDesk({ v }: { v: any }) {
  const [shared,setShared] = useState<{title:string;subtitle:string;lines:string[]} | null>(null);
  return <><ResearchWorkspace owner={v.acc ?? ""} example={!!v.judge} shareCard={setShared} buy={id => {const url=new URL(window.location.href);url.searchParams.set("buy",id);history.replaceState(null,"",url);v.navigate("swap");}}/>{shared && <ShareCard {...shared} example={v.judge} close={() => setShared(null)} />}</>;
}

export function EarnDesk({ v }: { v: any }) {
  const [tab, setTab] = useState(() => { const q = typeof window === "undefined" ? null : new URL(window.location.href).searchParams; return q && (q.get("flow") || q.get("tab") === "stake") ? "Stake" : q?.get("tab") === "vaults" ? "Vaults" : "Supply"; });
  return <><PageHeading title="Earn" description="Put available funds to work, with an exit plan you understand." /><Tabs values={["Supply", "Stake", "Vaults"]} value={tab} set={next => { setTab(next); const url = new URL(window.location.href); url.searchParams.set("tab", next.toLowerCase()); if(next !== "Stake") url.searchParams.delete("flow"); history.replaceState(null,"",url); }} />{tab === "Vaults" ? <VaultsCard scope={v.lendingScope} /> : tab === "Stake" ? <StakeDesk v={v}/> : <>
    <RatesTable mode="earn" usdcNote={v.walletSurplusF ? "Available after your plan: " + v.walletSurplusF : undefined} onUsdc={() => document.getElementById("fv-earn-plan")?.scrollIntoView({ behavior: "smooth" })} />
    <h2 className="fv-subhead" id="fv-earn-plan">For your plan</h2>
    <div className="fv-earn-context"><div><small>Available after your plan</small><strong>{v.walletSurplusF}</strong><p>USDC in your NEAR funding account above the reserve and scheduled payments.</p></div><label>Compare amount (USDC)<input inputMode="decimal" value={v.cmpAmount ?? ""} onChange={v.onCmpAmount} placeholder="0.00" /></label></div>
    {(v.strategies ?? []).filter((s:any) => !s.disabled).map((s: any) => <article className="fv-panel fv-opportunity" key={s.key}><div className="fv-section-head"><div className="fv-asset-cell"><TokenIcon symbol={s.key?.includes("linear") ? "NEAR" : "USDC"} core /><div><h2>{s.name}</h2><small>{s.kind}</small></div></div><span className="fv-chip">{s.disabled ? "Needs review" : "Available"}</span></div><div className="fv-opportunity-body"><div><small>Estimated net by {v.cmpDue}</small><strong>{s.net}</strong><p>{s.netSub?.split(" · ")[0]}</p></div><Button primary={!s.disabled} disabled={s.disabled} onClick={s.onClick}>{s.disabled ? "Unavailable for this plan" : "Review supply"}</Button></div><details><summary>Rates, exit timing and availability</summary>{s.rows?.map((r: any, i: number) => <div key={i} className="fv-list-row"><span>{r.k}</span><strong>{r.v}</strong></div>)}<p>{s.netSub}</p>{s.notes?.map((n: any, i: number) => <p key={i}>{n.text}</p>)}</details></article>)}
    {v.stratHas && !(v.strategies ?? []).some((s:any) => !s.disabled) && <section className="fv-panel fv-earn-empty"><TokenIcon symbol="USDC" core size={42}/><div><h2>No supply option is ready for this plan</h2><p>Availability depends on your available USDC, current rates, exit timing and permissions. Review your reserve or compare an amount above.</p></div><Button onClick={v.goCalendar}>Review funding plan</Button></section>}
    {(v.strategies ?? []).some((s:any) => s.disabled) && <details className="fv-panel fv-settings-disclosure"><summary>Other options & availability <span>{(v.strategies ?? []).filter((s:any) => s.disabled).length} options</span></summary>{(v.strategies ?? []).filter((s:any) => s.disabled).map((s:any) => <details className="fv-unavailable-option" key={s.key}><summary><strong>{s.name}</strong><span>{s.netSub?.split(' · ')[0]}</span></summary><p>{s.netSub}</p>{s.rows?.map((r:any,i:number)=><div className="fv-list-row" key={i}><span>{r.k}</span><span>{r.v}</span></div>)}</details>)}</details>}
    {!v.stratHas && <div className="fv-empty"><Sprout size={28} /><h3>{v.stratEmptyTitle}</h3><p>{v.stratEmptyBody}</p><Button onClick={v.stratEmptyAction}>{v.stratEmptyCta}</Button></div>}
  </>}</>;
}
export function BorrowDesk({ v }: { v: any }) {
  const [tab, setTab] = useState("Overview");
  return <><PageHeading title="Borrow" description="Understand your collateral, manage debt and review the cost of borrowing." /><Tabs values={["Overview", "Simulate"]} value={tab} set={setTab} />{tab === "Overview" ? <><LendingVenues key={v.lendingScope + ":" + v.acc} scope={v.lendingScope} accounts={v.lendingAccounts} hideSales expanded permissions={v.goPolicy} simulate={()=>setTab("Simulate")} connect={v.openConnect ?? v.connectFirst} /><div className="fv-borrow-markets-heading"><h2>Borrowing markets</h2><p>Explore rates and collateral across supported Rhea markets.</p></div><RatesTable mode="borrow" usdcNote="Borrow against your collateral · simulate first" onUsdc={() => setTab("Simulate")} /></> : <div className="fv-legacy-content"><CreditView v={v} /></div>}</>;
}
/** ?pair=perp:ETH or ?pair=spot:<chain>:<address>:<symbol> keeps the chosen market across reloads and links. */
function readPair(): Pair {
  const raw = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("pair");
  const [kind, a, b, c] = (raw ?? "").split(":");
  if (kind === "spot" && a && b) return { kind: "spot", chain: a, address: b, symbol: c || "Token" };
  return { kind: "perp", coin: kind === "perp" && /^[A-Za-z0-9]{1,20}$/.test(a ?? "") ? a : "ETH" };
}
export function TradeDesk({ v }: { v: any }) {
  const [pair, setPairState] = useState<Pair>(readPair);
  const setPair = (p: Pair) => { setPairState(p); const u = new URL(window.location.href); u.searchParams.set("pair", p.kind === "perp" ? "perp:" + p.coin : `spot:${p.chain}:${p.address}:${p.symbol}`); history.replaceState(null, "", u); };
  const market = pair.kind === "perp" ? pair.coin : "ETH";
  const setMarket = (coin: string) => setPair({ kind: "perp", coin });
  const picker = <PairPicker key={pair.kind === "perp" ? pair.coin : pair.address} value={pair} onChange={setPair} />;
  const [shared,setShared] = useState<{title:string;subtitle:string;lines:string[];amount?:string} | null>(null);
  const [draft,setDraft] = useState<OrderDraft | null>(null);
  if (pair.kind === "spot") return <><PageHeading title="Trade" description="Spot tokens on any supported chain and Hyperliquid perps, checked against your limits." action={<Button onClick={v.goPolicy}><SlidersHorizontal size={16} /> Trading permissions</Button>} /><SpotDesk token={pair} picker={picker} buy={id => { const url = new URL(window.location.href); url.searchParams.set("buy", id); history.replaceState(null, "", url); v.navigate("swap"); }} /></>;
  return <><PageHeading title="Trade" description="Manage your Hyperliquid positions and orders." action={<Button onClick={v.goPolicy}><SlidersHorizontal size={16} /> Trading permissions</Button>} />{v.judge && <p className="fv-notice">The chart shows public mainnet market data. Example mode cannot place orders.</p>}<div className="fv-trade-layout"><MarketPanel initialCoin={market} onCoin={setMarket} picker={picker}/><OrderTicket coin={market} scope={v.lendingScope} example={!!v.judge} onDraft={setDraft}/></div><div id="fv-perps-review"><PerpsCard key={v.lendingScope} scope={v.lendingScope} onNavigate={v.navigate} onShare={setShared} selectedMarket={market} onMarket={setMarket} draft={draft} /></div>{shared && <ShareCard {...shared} example={v.judge} close={() => setShared(null)} />}</>;
}
export function SwapDesk({ v }: { v: any }) {
  const [tab, setTab] = useState("Swap tokens");
  return <><PageHeading title="Swap" description="Best route across Rhea / Ref and NEAR Intents, checked against your limits."/><Tabs values={["Swap tokens","Managed funding"]} value={tab} set={setTab}/>{tab === "Swap tokens" ? <SwapExplorer owner={v.acc ?? ""} example={!!v.judge} onManaged={()=>setTab("Managed funding")} onConnect={v.openConnect ?? v.connectFirst} onSettled={v.refreshPortfolio}/> : <><section className="fv-panel fv-managed-swap-callout"><div className="fv-section-head"><div><h2>USDC → NEAR</h2><p>Fund your NEAR account from a supported connected wallet.</p></div><Button primary onClick={v.openConvert ?? v.openConnect ?? v.connectFirst}>Choose wallet and amount <ChevronRight size={16}/></Button></div></section><div className="fv-managed-sales"><ApprovedAssetSales scope={v.lendingScope} accounts={v.lendingAccounts}/></div></>}</>;
}
export function SendDesk({ v }: { v: any }) {
  const [tab, setTab] = useState(v.isCalendar ? "Scheduled" : "Send now");
  return <><PageHeading title="Send" description="Choose what the recipient gets. Review where it comes from." /><Tabs values={["Send now", "Scheduled"]} value={tab} set={setTab} />{tab === "Scheduled" ? <ScheduledDesk v={v}/> : <><section className="fv-send-intro fv-panel"><div><Send size={25} /><h2>Send an exact amount</h2><p>Choose a recipient, token and network. FlowVault compares the funding sources your permissions allow.</p><small>A one-off payment is saved for tracking. Nothing moves until you review and sign.</small></div><Button primary onClick={v.openSendNow}>New payment <ArrowUpRight size={16} /></Button></section>{v.hasPy && <div className="fv-legacy-content"><PayOnADateView v={{ ...v, why: { ...v.why, pay: false } }} /></div>}{!v.hasPy && <p className="fv-muted">No payments to review. Create your first payment above, or schedule one for later.</p>}</>}</>;
}

export function CommandSearch({ v }: { v: any }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(x => !x); } }; document.addEventListener("keydown", handler); return () => document.removeEventListener("keydown", handler); }, []);
  const close = () => { setOpen(false); setQuery(""); };
  return <><button type="button" className="fv-search-trigger" aria-label="Find a page or action" onClick={() => setOpen(true)}><Search size={16} /><span>Search or type a command</span><kbd>⌘ K</kbd></button>{open && <Modal title="Go or do" close={close}><CommandBody v={v} query={query} setQuery={setQuery} done={close} /></Modal>}</>;
}
/** Commands are resolved against the live token catalog and only prefill screens; every action still goes
 * through its own review, limits and wallet approval. */
function CommandBody({ v, query, setQuery, done }: { v: any; query: string; setQuery: (q: string) => void; done: () => void }) {
  const { tokens } = useTokenCatalog();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 30); return () => clearTimeout(t); }, []);
  const find = (sym: string) => { const s = sym.toLowerCase(); const near = tokens.filter(t => t.network === "near" && t.symbol.toLowerCase() === s); return near.find(t => t.contract === "native") ?? near.find(t => coreIdentity(t)) ?? near.find(t => t.assetId) ?? near[0]; };
  const go = (view: string, params: Record<string, string> = {}) => { const u = new URL(window.location.href); for (const k of ["buy", "swap", "token"]) u.searchParams.delete(k); for (const [k, x] of Object.entries(params)) u.searchParams.set(k, x); history.replaceState(null, "", u); v.navigate(view); window.dispatchEvent(new Event("fv-prefill")); done(); };
  const q = query.trim();
  const actions: { label: string; hint: string; Icon: typeof Search; run: () => void }[] = [];
  const m = /^(?:swap|sell|convert|trade)\s+([\d.]+)\s+([a-z0-9.$-]+)\s+(?:to|for|into|->|→)\s+([a-z0-9.$-]+)$/i.exec(q);
  if (m) { const a = find(m[2]), b = find(m[3]); if (a && b) actions.push({ label: `Swap ${m[1]} ${a.symbol} → ${b.symbol}`, hint: "Best route, checked against your limits", Icon: ArrowDownUp, run: () => go("swap", { swap: `${a.id}|${b.id}|${m[1]}` }) }); }
  const b = /^(?:buy|get)\s+(?:([\d.]+)\s+(?:usdc|\$)\s+(?:of\s+)?)?([a-z0-9.$-]+)$/i.exec(q);
  if (b) { const t = find(b[2]), usdc = find("USDC"); if (t && usdc) actions.push({ label: `Buy ${t.symbol}${b[1] ? " with " + b[1] + " USDC" : ""}`, hint: "Opens a swap from USDC", Icon: ArrowDownUp, run: () => go("swap", { swap: `${usdc.id}|${t.id}|${b[1] ?? ""}` }) }); }
  const one = /^[a-z0-9.$-]{2,12}$/i.test(q) ? find(q) : undefined;
  if (one) { actions.push({ label: `${one.symbol} market`, hint: "Price, liquidity, flow and risk signals", Icon: BarChart3, run: () => go("research", { token: "near:" + (one.contract === "native" ? "wrap.near" : one.contract) }) }); if (!b) actions.push({ label: `Buy ${one.symbol}`, hint: "Opens a swap from USDC", Icon: ArrowDownUp, run: () => { const usdc = find("USDC"); if (usdc) go("swap", { swap: `${usdc.id}|${one.id}|` }); } }); }
  const pages = [...destinations, { id: "pay", label: "Send a payment", Icon: Send }, { id: "calendar", label: "Scheduled payments", Icon: Activity }, { id: "policy", label: "Risk & permissions", Icon: SlidersHorizontal }].filter(x => !q || x.label.toLowerCase().includes(q.toLowerCase()));
  const examples = ["swap 1 NEAR to USDC", "buy RHEA", "ZEC"];
  return <><label className="fv-search-input"><Search size={17} /><input ref={input} aria-label="Search pages or type a command" placeholder="Try “swap 1 NEAR to USDC”, “buy RHEA” or a page" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") (actions[0]?.run ?? (() => { if (pages[0]) { v.navigate(pages[0].id); done(); } }))(); }} /></label>
    <div className="fv-command-results">
      {actions.map(a => <button key={a.label} className="fv-command-action" onClick={a.run}><a.Icon size={18} /><span>{a.label}<small>{a.hint}</small></span><kbd>↵</kbd></button>)}
      {!q && <div className="fv-command-examples">{examples.map(x => <button key={x} type="button" onClick={() => setQuery(x)}>{x}</button>)}</div>}
      {pages.map(({ id, label, Icon }) => <button key={id} onClick={() => { v.navigate(id); done(); }}><Icon size={18} />{label}<ChevronRight size={15} /></button>)}
      {!pages.length && !actions.length && <p>No match. Try “swap 1 NEAR to USDC” or a token symbol.</p>}
    </div></>;
}

export function ShareCard({ title, subtitle, lines, amount, example, link, close }: { title: string; subtitle: string; lines: string[]; amount?: string; example?: boolean; link?: string; close: () => void }) {
  const [showAmount, setShowAmount] = useState(false), [status, setStatus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const linesKey = JSON.stringify(lines);
  // Paint only selected public fields. Hidden amounts never enter the exported pixels or file name.
  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d"); if (!c || !ctx) return;
    c.width = 1080; c.height = 1080;
    ctx.fillStyle = "#11271f"; ctx.fillRect(0, 0, 1080, 1080);
    const g = ctx.createRadialGradient(900, 100, 0, 900, 100, 1000); g.addColorStop(0, "#426b46"); g.addColorStop(1, "#11271f"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1080);
    let cancelled = false;
    ctx.strokeStyle = '#c9e86b18'; ctx.lineWidth = 52; [210,340,470].forEach(radius => {ctx.beginPath();ctx.arc(1030,40,radius,0,Math.PI*2);ctx.stroke();});
    ctx.fillStyle = "#c9e86b"; ctx.font = "600 38px system-ui"; ctx.fillText("flowvault /", 80, 100);
    ctx.fillStyle = "#f5f8ee"; ctx.font = "600 60px system-ui"; ctx.fillText(title.slice(0, 29), 80, 245);
    ctx.fillStyle = "#adbfaf"; ctx.font = "24px system-ui"; ctx.fillText(subtitle.slice(0, 65), 80, 310);
    ctx.font = "500 40px system-ui"; ctx.fillStyle = "#f5f8ee"; (JSON.parse(linesKey) as string[]).slice(0, 6).forEach((line, i) => ctx.fillText(line.slice(0, 42), 80, 430 + i * 65));
    if (showAmount && amount) { ctx.fillStyle = "#c9e86b"; ctx.font = "600 52px system-ui"; ctx.fillText(amount.slice(0, 30), 80, 920); }
    ctx.fillStyle = "#adbfaf"; ctx.font = "25px system-ui"; ctx.fillText(example ? "EXAMPLE · FICTIONAL DATA" : "Snapshot · " + new Date().toISOString().slice(0, 10), 80, 1010);
    (JSON.parse(linesKey) as string[]).slice(0,6).forEach((line,i)=>{
      const mark=tokenLogo(line.split(' ')[0]);if(!mark)return;
      const img=new Image(); img.onload=()=>{if(cancelled)return;ctx.save();ctx.beginPath();ctx.arc(936,416+i*65,22,0,Math.PI*2);ctx.clip();ctx.drawImage(img,914,394+i*65,44,44);ctx.restore();};img.src=mark;
    });
    return ()=>{cancelled=true;};
  }, [title, subtitle, linesKey, amount, showAmount, example]);
  function download() { const c = canvas.current; if (!c) return; const a = document.createElement("a"); a.download = "flowvault-card.png"; a.href = c.toDataURL("image/png"); a.click(); setStatus("Image downloaded. Only the fields in this preview are included."); }
  return <Modal title="Share your moment" close={close}><canvas ref={canvas} className="fv-share-canvas" aria-label="Share card preview" />{amount && <label className="fv-share-option"><input type="checkbox" checked={showAmount} onChange={e => setShowAmount(e.target.checked)} /> Show amount</label>}<p className="fv-muted">Wallet addresses and private notes are never included. Downloading does not publish this card.</p><div className="fv-actions"><Button primary onClick={download}><Download size={16} /> Download image</Button>{link && <Button onClick={() => { void navigator.clipboard.writeText(link).then(() => setStatus("Public token watchlist link copied. No private notes or balances are included."), () => setStatus("Could not copy the link in this browser.")); }}><Share2 size={16}/> Copy watchlist link</Button>}</div>{status && <p role="status">{status}</p>}</Modal>;
}

export function ScheduledDesk({ v }: { v: any }) {
  return <>
    <div className="fv-section-head fv-scheduled-head"><p className="fv-muted">Scheduled payments need your review and signature. A date does not enable automatic sending.</p><Button primary onClick={v.openAdd}><Plus size={16}/> Schedule payment</Button></div>
    {(v.obGroups ?? []).map((g: any, i: number) => <section className="fv-panel" key={i}><div className="fv-section-head"><h2>{g.title}</h2><small className="fv-muted">{g.sub}</small></div>{g.items.map((o: any) => <div className="fv-scheduled-row" key={o.id}><div className="fv-date-tile"><small>{o.mon}</small><strong>{o.day}</strong></div><div className="fv-scheduled-description"><strong>{o.name}</strong><small>{o.chain} · {o.recipientShort} · {o.inDays}</small><span className="fv-chip">{o.stLabel}</span></div><div className="fv-scheduled-value"><strong>{o.amountF}</strong><small>Recipient receives</small></div><Button onClick={o.onPay}>{o.btnLabel}</Button><details><summary aria-label={'Manage ' + o.name}>•••</summary><div className="fv-actions">{o.onEdit && <Button onClick={o.onEdit}>Edit</Button>}{o.onRemove && <Button onClick={o.onRemove}>Remove</Button>}</div>{o.note && <p>{o.note}</p>}</details></div>)}</section>)}
    {v.noObs && <section className="fv-panel"><div className="fv-empty"><Activity size={28}/><h3>{v.calEmptyTitle || 'No scheduled payments'}</h3><p>{v.calEmptyText || 'Add rent, payroll or your next payment. See what needs funding before it is due.'}</p><Button onClick={v.openAdd}>Schedule your first payment</Button></div></section>}
    <details open={v.planningOpen || undefined} className="fv-panel fv-settings-disclosure"><summary><SlidersHorizontal size={16}/> Reserve & planning settings <span>{v.holdbackDraftF} reserved in this draft</span></summary><div className="fv-form"><p className="fv-muted">Keep a cash reserve in your NEAR funding account, plus payments within your planning window. Changing these settings invalidates earlier plans where required.</p><div className="fv-form-columns"><label>Cash reserve (USDC)<input inputMode="decimal" value={v.planDraft.reserve ?? ''} onChange={v.onPlanReserve}/></label><label>Planning window (days)<input type="number" min="1" value={v.planDraft.horizon ?? ''} onChange={v.onPlanHorizon}/></label><label>Withdrawal lead time (days)<input type="number" min="0" value={v.planDraft.lead ?? ''} onChange={v.onPlanLead}/></label></div><p className="fv-muted">Reserve plus {v.holdbackCountDraft} unpaid payments in this draft’s window. This number updates as you edit; save to apply.</p><Button primary disabled={v.planClean} onClick={v.savePlan}>Save planning settings</Button></div></details>
  </>;
}
export function StakeDesk({ v }: { v: any }) {
  return <StakeHome key={(v.judge ? "example" : "personal")+":"+(v.acc ?? "visitor")} v={v} />;
}
export function RiskDesk({ v }: { v: any }) {
  const [tab,setTab] = useState('Limits');
  return <><PageHeading title="Risk & permissions" description="Set boundaries for your funds. Review every change before it applies."/><Tabs values={['Limits','Asset rules','Automations','Contract']} value={tab} set={setTab}/>{tab === 'Limits' ? <section className="fv-panel fv-risk-limits"><h2>Your spending limits</h2><p className="fv-muted">These limits apply to supported operations. They do not authorize an agent or approve a transaction.</p><div className="fv-form"><div className="fv-form-columns"><label>Maximum per action (USDC)<input inputMode="decimal" value={v.polD.perAction ?? ''} onChange={v.onPerAction}/></label><label>Maximum per day (USDC)<input inputMode="decimal" value={v.polD.daily ?? ''} onChange={v.onDaily}/></label><label>Maximum moving cost (USDC)<input inputMode="decimal" value={v.polD.maxMove ?? ''} onChange={v.onMaxMove}/></label></div></div><p className="fv-muted">Daily usage: {v.polUsedLabel}</p><div className="fv-policy-change"><strong>{v.polSave.title}</strong><p>{v.polSave.sub}</p></div><Button primary disabled={v.polClean && !v.polConnect} onClick={v.polConnect ?? v.savePolicy}>{v.polConnect ? 'Connect wallet' : 'Save permission changes'}</Button><div className="fv-list-row"><div><strong>Reserve & payments</strong><small>{v.polHoldLabel}</small></div><Button onClick={v.goCalendar}>Manage reserve</Button></div><div className="fv-list-row"><div><strong>Asset permissions</strong><small>Choose which assets may be supplied, sold, pledged or staked.</small></div><Button onClick={() => setTab('Asset rules')}>Review rules</Button></div></section> : tab === 'Asset rules' ? <div className="fv-legacy-content fv-policy-rules"><PolicyView v={{...v,hideAuthorityPanels:true}}/></div> : tab === 'Automations' ? <MandatesCard key={v.lendingScope} scope={v.lendingScope}/> : <PolicyContractCard scope={v.lendingScope} policyVersion={v.policyVersion ?? null} live={!!v.policyLive}/>}</>;
}
export function ActivityDesk({ v }: { v: any }) {
  const [tab,setTab] = useState('Transactions');
  const [filter,setFilter] = useState('All');
  const ops = [...(v.ops ?? [])].filter((o: any) => filter === 'All' || (filter === 'Needs attention' ? ['stuck','failed','failedtx','unknown','partial'].includes(o.status) : ['progress','paying','awaiting','submitted','prepared'].includes(o.status)));
  return <><PageHeading title="Activity" description="Track what is happening and see what actually changed."/>{!v.judge && <OpenStakeFlows key={v.lendingScope + ":" + v.acc} navigate={v.navigate}/>}<Tabs values={['Transactions','Plans','Statements']} value={tab} set={setTab}/>{tab === 'Plans' ? <section className="fv-panel fv-history-panel"><PlanHistory scope={v.lendingScope}/></section> : tab === 'Statements' ? <StatementPanel key={v.lendingScope} scope={v.lendingScope}/> : <><div className="fv-activity-filters">{['All','In progress','Needs attention'].map(x => <button key={x} className="fv-button" aria-pressed={filter === x} onClick={() => setFilter(x)}>{x}</button>)}</div><ActivityView v={{...v,embedded:true,ops,noOps:!ops.length,actTimeline:true,actStatement:false,legend:[]}}/>{!v.judge && v.acc && <WalletHistory account={v.acc}/>}</>}</>;
}
