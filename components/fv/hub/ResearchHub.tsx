"use client";
// Research & Strategies: the place to decide what to do next. It opens on a greeting, the Ask box and three quick
// actions; below, four live counts (strategies earning, approvals waiting, automations running, money ready to
// deploy), research and strategy ideas built from your holdings, your automations, and everything waiting for your
// approval with its hazard scan. Every action opens an existing flow; nothing executes from this page. Demo Mode
// shows the same page with the example workspace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Bell, Bookmark, CalendarClock, Check, ChevronRight, Layers, MoreHorizontal, Plus, Repeat, Scale, Sparkles, Target, TrendingUp, Wallet, Zap } from "lucide-react";
import { api } from "../live";
import { ago } from "../swap-format";
import { useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { TodayCards } from "../today/TodayCards";
import { Community } from "../growth/Community";
import { HazardScan } from "../approvals/HazardScan";
import { VaultsCard } from "../Vaults";
import { ResearchDesk } from "../WorkspaceViews";
import { describe, template, type Automation, type AutomationEvent, type AutomationKind } from "@/lib/flowvault/automations";
import { exampleChecks } from "@/lib/flowvault/demo-sim";
import { EXAMPLE_NEAR_ACCOUNT } from "@/lib/flowvault/example-wallets";

type Auto = Automation & { title: string; sub: string; chip: string };
interface Approval { id: string; title: string; sub: string; rows: [string, string][]; checks?: AutomationEvent["checks"]; open: () => void; decline?: () => void; source: string }
const STABLE = /^(USDC|USDT|USDT\.E|USDC\.E|DAI|USDE|FRAX|PYUSD)$/i;
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND_ICON: Record<AutomationKind, typeof Bell> = { brief: CalendarClock, sweep: Repeat, idle_alert: Bell, allocation_alert: Scale, price_alert: TrendingUp };
const tz = () => -new Date().getTimezoneOffset();
const demoAuto = (id: string, kind: AutomationKind, params?: Automation["params"], enabled = true): Auto => { const t = template(kind, tz()); const a: Automation = { id, ...t, params: { ...t.params, ...params }, enabled, createdAt: new Date().toISOString(), createdBy: "you", lastRunAt: null, nextRunAt: null }; return { ...a, ...describe(a) }; };
const DEMO_AUTOS: Auto[] = [demoAuto("d-brief", "brief"), demoAuto("d-sweep", "sweep"), demoAuto("d-idle", "idle_alert"), demoAuto("d-alloc", "allocation_alert")];

export function ResearchHub({ v }: { v: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const example = !!v.judge, owner: string = example ? EXAMPLE_NEAR_ACCOUNT : v.acc ?? "", signedIn = !!v.acc && !example;
  const go = useCallback((screen: string, params: Record<string, string> = {}) => {
    const url = new URL(window.location.href);
    for (const k of ["supply", "amount", "swap", "tab", "sflow", "flow", "buy"]) url.searchParams.delete(k);
    for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
    history.replaceState(null, "", url); v.navigate(screen);
    if (screen === "swap") window.dispatchEvent(new Event("fv-prefill"));
  }, [v]);

  // ── data ──
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, !!owner, example);
  const [rates, setRates] = useState<{ token: string; symbol: string; supplyApy: number | null }[]>([]), [stakeApy, setStakeApy] = useState<number | null>(null);
  const [positions, setPositions] = useState<{ kind: string; venue?: string; asset: string; amount: string }[]>([]);
  const [autos, setAutos] = useState<Auto[]>(example ? DEMO_AUTOS : []), [events, setEvents] = useState<AutomationEvent[]>([]);
  const [flows, setFlows] = useState<{ supply: { flow: { id: string; symbol: string; source: { amount: string; fromSymbol: string } }; status: string; done: number; total: number }[]; stake: { flow: { id: string; venue: string }; status: string; done: number; total: number }[] }>({ supply: [], stake: [] });
  const [note, setNote] = useState("");
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 6000); return () => clearTimeout(t); }, [note]);
  const loadAutos = useCallback(() => { if (!example) api("/api/automations", undefined, "GET").then((r: { automations?: Auto[]; events?: AutomationEvent[] }) => { setAutos(r.automations ?? []); setEvents(r.events ?? []); }).catch(() => {}); }, [example]);
  useEffect(() => { const r = () => loadAutos(); window.addEventListener("fv:automations-refresh", r); window.addEventListener("focus", r); return () => { window.removeEventListener("fv:automations-refresh", r); window.removeEventListener("focus", r); }; }, [loadAutos]);
  useEffect(() => {
    let live = true;
    fetch("/api/rates").then((r) => r.json() as Promise<{ rows?: { token: string; symbol: string; supplyApy: number | null; canSupply?: boolean }[] }>).then((b) => { if (live) setRates((b.rows ?? []).filter((r) => r.canSupply !== false)); }).catch(() => {});
    fetch("/api/staking/options").then((r) => r.json() as Promise<{ options?: { id: string; aprPercent?: string | null }[] }>).then((b) => { const a = b.options?.find((o) => o.id === "linear")?.aprPercent; if (live && a) setStakeApy(Number(a)); }).catch(() => {});
    api("/api/portfolio", undefined, "GET").then((r: { portfolio?: { positions?: typeof positions }; positions?: typeof positions }) => { if (live) setPositions((r.portfolio ?? r).positions ?? []); }).catch(() => {});
    const t = setTimeout(() => loadAutos(), 0);
    if (!example) Promise.all([api("/api/lend/flows", undefined, "GET").catch(() => ({})), api("/api/staking/flows", undefined, "GET").catch(() => ({}))]).then(([a, b]: { flows?: never[] }[]) => { if (live) setFlows({ supply: a.flows ?? [], stake: b.flows ?? [] }); });
    return () => { live = false; clearTimeout(t); };
  }, [example, owner, loadAutos]);

  const wallet = useMemo(() => Object.entries(holdings.balances).flatMap(([id, b]) => { const t = tokens.find((x) => x.id === id); return t ? [{ id, symbol: t.symbol, network: t.network, amount: Number(b.amount), usd: b.usd !== null ? Number(b.usd) : 0 }] : []; }), [holdings.balances, tokens]);
  const idle = wallet.filter((w) => STABLE.test(w.symbol)).reduce((n, w) => n + w.usd, 0);
  const near = wallet.find((w) => w.id === "near:native")?.amount ?? 0;
  const bestStable = [...rates].filter((r) => /^USD[CT]/i.test(r.symbol) && r.supplyApy !== null).sort((a, b) => b.supplyApy! - a.supplyApy!)[0];
  const earning = new Set(positions.filter((p) => ["supplied", "staking", "collateral"].includes(p.kind) && Number(p.amount) > 0).map((p) => (p.venue ?? "") + ":" + p.asset)).size;

  // ── approvals: automation proposals, and flows waiting for your next signature ──
  const decline = async (id: string) => { await api("/api/automations", { op: "event", id, status: "dismissed" }).catch(() => null); loadAutos(); };
  const approvals: Approval[] = example
    ? [{ id: "demo-sweep", source: "Weekly sweep", title: "Supply $2,690 surplus USDC to Rhea", sub: "USDC above your reserve and the payments in your planning window, from the example workspace.", rows: [["From", "USDC · NEAR account (surplus)"], ["To", "Rhea Lending · USDC"], ["Expected yield", bestStable ? `≈ ${bestStable.supplyApy!.toFixed(2)}% APY, variable` : "variable"]], checks: exampleChecks(2690, [{ id: "health", label: "No debt: nothing can be liquidated", ok: true }]), open: () => go("earn", { tab: "supply", supply: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "2690" }) }]
    : [
      ...events.filter((e) => e.kind === "approval" && (e.status === "new" || e.status === "seen")).map((e): Approval => ({ id: e.id, source: "Weekly sweep", title: e.title, sub: e.lines[0] ?? "", rows: [["From", "USDC · your NEAR account (surplus)"], ["To", "Rhea Lending · USDC"], ["Expected yield", bestStable && /USDC/i.test(bestStable.symbol) ? `≈ ${bestStable.supplyApy!.toFixed(2)}% APY, variable` : rates.find((r) => r.symbol === "USDC")?.supplyApy ? `≈ ${rates.find((r) => r.symbol === "USDC")!.supplyApy!.toFixed(2)}% APY, variable` : "variable"]], checks: e.checks, open: () => { void api("/api/automations", { op: "event", id: e.id, status: "seen" }).catch(() => null); go("earn", e.action?.kind === "supply" ? { tab: "supply", supply: e.action.tokenId, ...(e.action.amount ? { amount: e.action.amount } : {}) } : {}); }, decline: () => void decline(e.id) })),
      ...flows.supply.filter((f) => f.status === "your_turn").map((f): Approval => ({ id: f.flow.id, source: "Swap and supply", title: `Supply ${f.flow.symbol} from ${f.flow.source.amount} ${f.flow.source.fromSymbol}`, sub: `Step ${Math.min(f.done + 1, f.total)} of ${f.total} needs your signature.`, rows: [], open: () => go("earn", { tab: "supply", sflow: f.flow.id }) })),
      ...flows.stake.filter((f) => f.status === "your_turn").map((f): Approval => ({ id: f.flow.id, source: "Staking", title: `Stake into ${f.flow.venue === "rnear" ? "rNEAR" : "LiNEAR"}`, sub: `Step ${Math.min(f.done + 1, f.total)} of ${f.total} needs your signature.`, rows: [], open: () => go("earn", { tab: "stake", flow: f.flow.id }) })),
    ];
  const running = autos.filter((a) => a.enabled).length;

  // ── automations ──
  const autosRef = useRef<HTMLDivElement>(null), approvalsRef = useRef<HTMLDivElement>(null), researchRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"Research" | "Strategies" | "Vaults" | "Watchlist">("Research"), [adding, setAdding] = useState(false);
  async function create(kind: AutomationKind) {
    setNote("");
    if (example) { setAutos((xs) => [...xs, demoAuto("d-" + Date.now(), kind)]); setNote(`${describe(template(kind, tz())).title}: added to the example workspace.`); return; }
    if (!signedIn) { setNote("Sign in with your NEAR wallet to set up automations."); return; }
    if (autos.some((a) => a.kind === kind && kind !== "price_alert" && kind !== "allocation_alert")) { setNote(`${describe(template(kind, tz())).title} is already set up below.`); autosRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    try { await api("/api/automations", { op: "create", kind, tzOffsetMin: tz() }); setNote(`${describe(template(kind, tz())).title}: on.`); loadAutos(); autosRef.current?.scrollIntoView({ behavior: "smooth" }); }
    catch (e) { setNote((e as Error).message); }
  }
  async function toggle(a: Auto) {
    if (example) { setAutos((xs) => xs.map((x) => x.id === a.id ? { ...x, enabled: !x.enabled } : x)); return; }
    await api("/api/automations", { op: "update", id: a.id, enabled: !a.enabled }).catch((e) => setNote((e as Error).message)); loadAutos();
  }
  async function act(a: Auto, op: "run" | "delete") {
    if (example) { if (op === "delete") setAutos((xs) => xs.filter((x) => x.id !== a.id)); else setNote("Example workspace: runs are simulated. In your own workspace this writes a brief, alert or proposal below."); return; }
    await api("/api/automations", { op, id: a.id }).catch((e) => setNote((e as Error).message)); loadAutos();
  }

  const [ask, setAsk] = useState("");
  const hour = new Date().getHours(), greeting = hour < 5 ? "Good evening." : hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
  const latest = events.filter((e) => e.kind !== "approval" && e.status !== "dismissed").slice(0, 3);

  return <div className="fv-hub">
    <section className="fv-hub-hero">
      <div className="fv-hub-hello"><small>RESEARCH &amp; STRATEGIES</small><h1>{greeting}</h1><p>Discover opportunities, automate your capital, and review what&apos;s next.</p></div>
      <div className="fv-hub-ask">
        <form className="fv-hub-askbox" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) { v.askQuestion?.(ask.trim()); setAsk(""); } else v.openAssistant?.(); }}>
          <Sparkles size={17} /><input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask FlowVault anything about your capital, markets, automations, or next moves" aria-label="Ask FlowVault" />
          <button type="submit" aria-label="Ask"><ArrowRight size={16} /></button>
        </form>
        <div className="fv-hub-quick">
          <button type="button" onClick={() => void create("brief")}><CalendarClock size={16} /><span>Brief me at 8 AM</span><ChevronRight size={15} /></button>
          <button type="button" onClick={() => { setAdding(true); autosRef.current?.scrollIntoView({ behavior: "smooth" }); }}><Zap size={16} /><span>Create automation</span><ChevronRight size={15} /></button>
          <button type="button" onClick={() => { setTab("Strategies"); researchRef.current?.scrollIntoView({ behavior: "smooth" }); }}><Layers size={16} /><span>Find a strategy</span><ChevronRight size={15} /></button>
        </div>
      </div>
    </section>
    {note && <p className="fv-notice fv-hub-note" role="status">{note}</p>}

    <div className="fv-hub-stats">
      <Stat icon={<Layers size={16} />} label="Active strategies" value={String(earning)} sub={earning ? "earning now" : "nothing earning yet"} onClick={() => v.navigate("portfolio")} />
      <Stat icon={<Check size={16} />} label="Pending approvals" value={String(approvals.length)} sub={approvals.length ? "need your review" : "all clear"} onClick={() => approvalsRef.current?.scrollIntoView({ behavior: "smooth" })} />
      <Stat icon={<Zap size={16} />} label="Automations running" value={String(running)} sub={running ? "on schedule" : "none yet"} onClick={() => autosRef.current?.scrollIntoView({ behavior: "smooth" })} />
      <Stat icon={<Wallet size={16} />} label="Deployable capital" value={money(idle)} sub="idle stablecoins" badge={idle >= 1 ? "Ready to deploy" : undefined} onClick={() => { setTab("Strategies"); researchRef.current?.scrollIntoView({ behavior: "smooth" }); }} />
    </div>

    <section className="fv-hub-research" ref={researchRef}>
      <div className="fv-hub-section-head"><div><h2>Research &amp; Opportunities</h2><p>Ideas built from your holdings, today&apos;s rates and market moves. Rates are variable; nothing runs without your review.</p></div><button type="button" className="fv-text-button" onClick={() => v.navigate("research")}>Markets <ArrowUpRight size={13} /></button></div>
      <div className="fv-hub-tabs" role="tablist">{(["Research", "Strategies", "Vaults", "Watchlist"] as const).map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Research" && <><TodayCards key={String(example)} owner={v.acc ?? ""} example={example} navigate={v.navigate} /><Community key={"c" + String(example)} example={example} signedIn={signedIn} navigate={v.navigate} /></>}
      {tab === "Strategies" && <div className="fv-strategy-grid">
        <Strategy art="coins" title="Stablecoin income" body="Earn a steady, variable yield on stablecoins by lending them on Rhea, with no price exposure." yieldText={bestStable ? `≈ ${bestStable.supplyApy!.toFixed(1)}% APY` : "Reading rates…"} risk="Low"
          why={idle >= 1 ? `You hold ${money(idle)} in stablecoins earning nothing.` : "Useful whenever you hold USDC or USDT you won't spend soon."} cta="Review opportunity" onClick={() => bestStable && go("earn", { tab: "supply", supply: bestStable.token })} />
        <Strategy art="steps" title="Weekly surplus sweep" body="Every week FlowVault proposes supplying only the USDC above your reserve and upcoming payments, so cash stays ready." yieldText={rates.find((r) => r.symbol === "USDC")?.supplyApy ? `≈ ${rates.find((r) => r.symbol === "USDC")!.supplyApy!.toFixed(1)}% APY` : "Variable"} risk="Low"
          why="Your reserve and dated payments are never touched; each sweep waits for your approval." cta={autos.some((a) => a.kind === "sweep") ? "See your sweep" : "Build strategy"} onClick={() => autos.some((a) => a.kind === "sweep") ? autosRef.current?.scrollIntoView({ behavior: "smooth" }) : void create("sweep")} />
        <Strategy art="arc" title="Liquid staking" body="Stake NEAR as LiNEAR: it earns staking rewards and stays liquid, swappable when liquidity allows." yieldText={stakeApy ? `≈ ${stakeApy.toFixed(1)}% APY` : "Reading rate…"} risk="Low–Medium"
          why={near >= 1 ? `You hold ${near.toLocaleString("en-US", { maximumFractionDigits: 2 })} NEAR.` : "For NEAR you plan to hold; unstaking takes about 2–3 days."} cta="Review strategy" onClick={() => go("earn", { tab: "stake" })} />
      </div>}
      {tab === "Vaults" && <VaultsCard scope={v.lendingScope} />}
      {tab === "Watchlist" && <ResearchDesk v={v} />}
    </section>

    <div className="fv-hub-bottom">
      <section className="fv-panel fv-hub-autos" ref={autosRef}>
        <div className="fv-hub-section-head"><div><h2>Automations &amp; Mandates</h2><p>Briefs, alerts and sweeps on a schedule. They never sign or move funds.</p></div><button type="button" className="fv-button" onClick={() => setAdding(!adding)}><Plus size={14} /> New</button></div>
        {adding && <div className="fv-auto-picker">{(["brief", "sweep", "idle_alert", "allocation_alert", "price_alert"] as AutomationKind[]).map((k) => { const d = describe(template(k, tz())); const Icon = KIND_ICON[k]; return <button type="button" key={k} onClick={() => { setAdding(false); void create(k); }}><Icon size={15} /><span><strong>{d.title}</strong><small>{d.sub}</small></span></button>; })}<small className="fv-muted">Need a different time, amount or asset? Ask FlowVault, e.g. &quot;brief me at 7:30&quot; or &quot;alert me if NEAR moves 8%&quot;.</small></div>}
        <ul className="fv-auto-list">{autos.map((a) => { const Icon = KIND_ICON[a.kind]; return <li key={a.id} className={a.enabled ? "" : "is-off"}>
          <span className="fv-auto-icon"><Icon size={16} /></span>
          <div className="fv-auto-main"><strong>{a.title}</strong><small>{a.sub}{a.lastRunAt ? ` · last ran ${ago(a.lastRunAt)}` : ""}</small></div>
          <span className="fv-auto-chip">{a.chip}</span>
          <button type="button" role="switch" aria-checked={a.enabled} aria-label={(a.enabled ? "Pause " : "Turn on ") + a.title} className="fv-auto-switch" onClick={() => void toggle(a)}><i /></button>
          <AutoMenu run={() => void act(a, "run")} remove={() => void act(a, "delete")} />
        </li>; })}{!autos.length && <li className="fv-auto-empty">No automations yet. Start with a daily brief, or ask FlowVault for one.</li>}</ul>
        {latest.length > 0 && <div className="fv-auto-inbox"><h3>Latest from your automations</h3>{latest.map((e) => <details key={e.id}><summary><span className={"fv-auto-dot is-" + e.kind} />{e.title}<small>{ago(e.createdAt)}</small></summary><ul>{e.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></details>)}</div>}
        <div className="fv-auto-tip"><Sparkles size={15} /><span>Create automations by chatting with the agent, like &quot;Sweep surplus on Fridays&quot; or &quot;Alert me if ETH is over 40%&quot;.</span><button type="button" className="fv-button" onClick={() => v.askQuestion?.("Set up an automation for me")}>Ask FlowVault</button></div>
      </section>

      <section className="fv-panel fv-hub-approvals" ref={approvalsRef}>
        <div className="fv-hub-section-head"><div><h2>Approvals</h2><p>Proposals and next steps waiting for you, each with its hazard scan. Your wallet signs; FlowVault never does.</p></div>{approvals.length > 1 && <span className="fv-muted">{approvals.length} waiting</span>}</div>
        {!approvals.length && <div className="fv-approval-empty"><Target size={22} /><p>Nothing waiting for you. Sweeps, swap-and-supply steps and staking steps appear here when they need your signature.</p></div>}
        {approvals.map((ap, i) => <article key={ap.id} className={"fv-approval" + (i === 0 ? " is-open" : "")}>
          <div className="fv-approval-main">
            <span className="fv-approval-icon"><Layers size={18} /></span>
            <div><small>{ap.source}</small><h3>{ap.title}</h3><p>{ap.sub}</p>
              {i === 0 && ap.rows.length > 0 && <dl>{ap.rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>}</div>
          </div>
          {i === 0 && ap.checks && <HazardScan checks={ap.checks} compact />}
          <div className="fv-approval-actions">{ap.decline && <button type="button" className="fv-button" onClick={ap.decline}>Decline</button>}{example && i === 0 && <button type="button" className="fv-button" onClick={() => setNote("Example workspace: declining only hides it here.")}>Decline</button>}<button type="button" className="fv-button fv-primary" onClick={ap.open}>Review approval <ArrowRight size={14} /></button></div>
        </article>)}
      </section>
    </div>
  </div>;
}

function Stat({ icon, label, value, sub, badge, onClick }: { icon: React.ReactNode; label: string; value: string; sub: string; badge?: string; onClick: () => void }) {
  return <button type="button" className="fv-hub-stat" onClick={onClick}><span className="fv-hub-stat-icon">{icon}</span><span className="fv-hub-stat-body"><span>{label}</span><strong>{value}</strong><small>{badge ? <em>{badge}</em> : sub}</small></span><ChevronRight size={16} /></button>;
}
function Strategy({ art, title, body, yieldText, risk, why, cta, onClick }: { art: "coins" | "steps" | "arc"; title: string; body: string; yieldText: string; risk: string; why: string; cta: string; onClick: () => void }) {
  return <article className="fv-strategy">
    <div className="fv-strategy-top"><StrategyArt kind={art} /><div><div className="fv-strategy-title"><h3>{title}</h3><Bookmark size={15} aria-hidden /></div><p>{body}</p>
      <div className="fv-strategy-figures"><div><small>Expected yield</small><strong>{yieldText}</strong></div><div><small>Risk</small><em>{risk}</em></div></div></div></div>
    <div className="fv-strategy-why"><Target size={15} /><span><b>Why it matches you:</b> {why}</span></div>
    <button type="button" className="fv-button fv-primary" onClick={onClick}>{cta} <ArrowRight size={14} /></button>
  </article>;
}
function StrategyArt({ kind }: { kind: "coins" | "steps" | "arc" }) {
  return <svg className="fv-strategy-art" viewBox="0 0 120 120" aria-hidden>
    <rect width="120" height="120" rx="14" className="bg" />
    {kind === "coins" && [0, 1, 2].map((c) => [0, 1, 2, 3, 4].slice(0, 5 - c).map((i) => <ellipse key={c + ":" + i} cx={34 + c * 26} cy={96 - i * 11} rx="14" ry="5.5" className={i % 2 ? "a" : "b"} />))}
    {kind === "steps" && [0, 1, 2, 3].map((i) => <rect key={i} x={18 + i * 21} y={92 - i * 18} width="22" height={12 + i * 18} rx="2" className={i % 2 ? "a" : "b"} />)}
    {kind === "arc" && <><path d="M18 104 C 30 40, 80 20, 104 18" className="stroke" /><path d="M30 104 C 42 56, 82 36, 104 34" className="stroke thin" /><circle cx="104" cy="18" r="6" className="b" /></>}
  </svg>;
}
function AutoMenu({ run, remove }: { run: () => void; remove: () => void }) {
  const [open, setOpen] = useState(false);
  return <span className="fv-auto-menu"><button type="button" className="fv-icon-button" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={16} /></button>
    {open && <span className="fv-auto-menu-list" role="menu"><button type="button" role="menuitem" onClick={() => { setOpen(false); run(); }}>Run now</button><button type="button" role="menuitem" onClick={() => { setOpen(false); remove(); }}>Delete</button></span>}</span>;
}
