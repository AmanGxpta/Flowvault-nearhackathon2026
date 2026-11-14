"use client";
// Research & Strategies: the place to decide what to do next. It opens on a greeting, the Ask box and three quick
// actions; below, four live counts, your brief, research and strategy ideas, your automations (with their next run,
// last result and Run now) and everything waiting for your approval with its hazard scan. Data loads together, revisits
// open on the last known state, and changes animate in place. Every action opens an existing flow; nothing executes
// from this page. Demo Mode runs the same page on the example workspace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Bookmark, CalendarClock, Check, ChevronRight, Layers, MoreHorizontal, Play, Plus, RefreshCw, Sparkles, Target, Wallet, Zap } from "lucide-react";
import { api } from "../live";
import { ago } from "../swap-format";
import { useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { TodayCards } from "../today/TodayCards";
import { Community } from "../growth/Community";
import { HazardScan } from "../approvals/HazardScan";
import { YieldsTable, type YieldRate } from "./YieldsTable";
import { WatchlistCompact } from "./WatchlistCompact";
import { Sparkline } from "./Sparkline";
import { LockedResearch, PublicResearch } from "./PublicResearch";
import { AutomationBuilder, KIND_ICON } from "./AutomationBuilder";
import { BriefCard, EventFeed, type Go } from "./AutomationFeed";
import { cacheGet, cacheSet, until, useCountUp, useTrend } from "./motion";
import { DEMO_EVENT, demoAutomations, demoBriefNow, demoCreate, demoDelete, demoEvents, demoEventStatus, demoRun, demoUpdate } from "./demo-automations";
import { describe, template, type Automation, type AutomationEvent } from "@/lib/flowvault/automations";
import { isStableAsset } from "@/lib/flowvault/brief";
import { EXAMPLE_NEAR_ACCOUNT } from "@/lib/flowvault/example-wallets";

type Auto = Automation & { title: string; sub: string; chip: string };
type Rate = YieldRate;
type Flow = { flow: { id: string; symbol?: string; venue?: string; source?: { amount: string; fromSymbol: string } }; status: string; done: number; total: number };
interface Cached { rates: Rate[]; stakeApy: number | null; earning: number | null; idle: number | null; near: number | null; autos: Auto[]; events: AutomationEvent[]; flows: { supply: Flow[]; stake: Flow[] } }
interface Approval { id: string; source: string; title: string; sub: string; rows: [string, string][]; checks?: AutomationEvent["checks"]; open: () => void; decline?: () => void }
const tz = () => -new Date().getTimezoneOffset();
const rateList = (rates: Rate[]) => rates.map((r) => ({ tokenId: r.token, symbol: r.symbol, supplyApy: r.supplyApy }));
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ResearchHub({ v }: { v: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const example = !!v.judge, owner: string = example ? EXAMPLE_NEAR_ACCOUNT : v.acc ?? "", signedIn = !!v.acc && !example;
  const key = "hub:" + (example ? "example" : owner || "guest");
  // Every read and write names this view's workspace: on a switch the Shell sets the global scope after this mounts,
  // so relying on it would read the other workspace and cache it under this one.
  const call = useCallback((path: string, body?: unknown, method = "POST") => api(path, body, method, example ? "example" : "personal"), [example]);
  const [c, setC] = useState<Cached>(() => cacheGet<Cached>(key) ?? { rates: [], stakeApy: null, earning: null, idle: null, near: null, autos: [], events: [], flows: { supply: [], stake: [] } });
  const patch = useCallback((p: Partial<Cached>) => setC((x) => { const n = { ...x, ...p }; cacheSet(key, n); return n; }), [key]);
  const [loaded, setLoaded] = useState({ core: false, autos: false });
  const [note, setNote] = useState("");
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(""), 6000); return () => clearTimeout(t); }, [note]);

  const go = useCallback((screen: string, params: Record<string, string> = {}) => {
    const url = new URL(window.location.href);
    for (const k of ["supply", "amount", "swap", "tab", "sflow", "flow", "buy"]) url.searchParams.delete(k);
    for (const [k, val] of Object.entries(params)) url.searchParams.set(k, val);
    history.replaceState(null, "", url); v.navigate(screen);
    if (screen === "swap") window.dispatchEvent(new Event("fv-prefill"));
  }, [v]);
  const goAction: Go = useCallback((a) => {
    if (a.kind === "supply") go("earn", { tab: "supply", supply: a.tokenId, ...(a.amount ? { amount: a.amount } : {}) });
    else if (a.kind === "swap") go("swap", { swap: [a.from, a.to, a.amount ?? ""].join("|") });
    else go(a.screen === "markets" ? "research" : a.screen, a.tab ? { tab: a.tab } : {});
  }, [go]);

  // ── reads: everything in parallel; the cache keeps the last state on screen meanwhile ──
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, !!owner, example);
  const loadAutos = useCallback(async () => {
    if (example) { patch({ autos: demoAutomations(), events: demoEvents() }); setLoaded((l) => ({ ...l, autos: true })); return; }
    if (!signedIn) { setLoaded((l) => ({ ...l, autos: true })); return; }
    const r = await call("/api/automations", undefined, "GET").catch(() => null) as { automations?: Auto[]; events?: AutomationEvent[]; ran?: string[] } | null;
    if (r) { patch({ autos: r.automations ?? [], events: r.events ?? [] }); if (r.ran?.length) setNote(`${r.ran.length} automation${r.ran.length === 1 ? "" : "s"} that came due while you were away just ran.`); }
    setLoaded((l) => ({ ...l, autos: true }));
  }, [example, signedIn, patch, call]);
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/rates").then((r) => r.json() as Promise<{ rows?: (Rate & { canSupply?: boolean })[] }>).then((b) => (b.rows ?? []).filter((r) => r.canSupply !== false)).catch(() => null),
      fetch("/api/staking/rates").then((r) => r.json() as Promise<{ options?: { id: string; aprPercent?: string | null }[] }>).then((b) => { const a = b.options?.find((o) => o.id === "linear")?.aprPercent; return a ? Number(a) : null; }).catch(() => null),
      call("/api/portfolio", undefined, "GET").then((r: { portfolio?: { positions?: { kind: string; venue?: string; asset: string; amount: string }[] }; positions?: { kind: string; venue?: string; asset: string; amount: string }[] }) => (r.portfolio ?? r).positions ?? []).catch(() => null),
      example ? Promise.resolve(null) : Promise.all([call("/api/lend/flows", undefined, "GET").catch(() => ({})), call("/api/staking/flows", undefined, "GET").catch(() => ({}))]).then(([a, b]: { flows?: Flow[] }[]) => ({ supply: a.flows ?? [], stake: b.flows ?? [] })),
    ]).then(([rates, stakeApy, positions, flows]) => {
      if (!live) return;
      patch({ ...(rates ? { rates } : {}), ...(stakeApy !== null ? { stakeApy } : {}), ...(positions ? { earning: new Set(positions.filter((p) => ["supplied", "staking", "collateral"].includes(p.kind) && Number(p.amount) > 0).map((p) => (p.venue ?? "") + ":" + p.asset)).size } : {}), ...(flows ? { flows } : {}) });
      setLoaded((l) => ({ ...l, core: true }));
    });
    const t = setTimeout(() => void loadAutos(), 0);
    return () => { live = false; clearTimeout(t); };
  }, [example, owner, loadAutos, patch, call]);
  useEffect(() => { const r = () => void loadAutos(); window.addEventListener(DEMO_EVENT, r); window.addEventListener("focus", r); return () => { window.removeEventListener(DEMO_EVENT, r); window.removeEventListener("focus", r); }; }, [loadAutos]);
  // Wallet figures, once every balance read has answered (no half-read totals).
  useEffect(() => {
    if (!holdings.loaded) return;
    let idle = 0, near = 0;
    for (const [id, b] of Object.entries(holdings.balances)) { const t = tokens.find((x) => x.id === id); if (!t) continue; if (isStableAsset(t.symbol)) idle += Number(b.usd ?? 0); if (id === "near:native") near = Number(b.amount); }
    const t = setTimeout(() => patch({ idle, near }), 0); return () => clearTimeout(t);
  }, [holdings.loaded, holdings.balances, tokens, patch]);
  // Demo Mode: the example sweep has proposed something, as it would have on a Friday.

  // ── automations ──
  const [builder, setBuilder] = useState<{ editing: Auto | null } | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set()), [flash, setFlash] = useState<string | null>(null), [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [briefBusy, setBriefBusy] = useState(false), [briefDone, setBriefDone] = useState<"idle" | "done" | "exists">("idle");
  const autosRef = useRef<HTMLDivElement>(null), approvalsRef = useRef<HTMLDivElement>(null), researchRef = useRef<HTMLDivElement>(null), briefRef = useRef<HTMLDivElement>(null);
  const focus = (el: HTMLElement | null) => { if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.remove("fv-pulse"); void el.offsetWidth; el.classList.add("fv-pulse"); };
  async function save(draft: Pick<Automation, "kind" | "schedule" | "params">, id?: string) {
    if (!example && !signedIn) throw new Error("Sign in with your NEAR wallet to set up automations.");
    if (example) { if (id) demoUpdate(id, draft); else demoCreate(draft.kind, draft.schedule, draft.params); }
    else if (id) await call("/api/automations", { op: "update", id, schedule: draft.schedule, params: draft.params });
    else await call("/api/automations", { op: "create", kind: draft.kind, tzOffsetMin: tz(), schedule: draft.schedule, params: draft.params });
    await loadAutos();
    setNote(`${describe(draft).title}: ${id ? "saved" : "on"}.`);
    setTimeout(() => focus(autosRef.current), 50);
  }
  async function run(a: Auto) {
    setRunning((s) => new Set(s).add(a.id));
    try {
      let ev: AutomationEvent | null;
      if (example) { await new Promise((r) => setTimeout(r, 900)); ev = demoRun(a, rateList(c.rates)); }
      else ev = (await call("/api/automations", { op: "run", id: a.id }) as { event: AutomationEvent | null }).event;
      await loadAutos();
      setFlash(a.id); setTimeout(() => setFlash(null), 1600);
      if (!ev) setNote(`${a.title}: nothing to report right now.`);
      else if (ev.kind === "brief") focus(briefRef.current);
      else if (ev.kind === "approval") focus(approvalsRef.current);
    } catch (e) { setNote((e as Error).message); }
    finally { setRunning((s) => { const n = new Set(s); n.delete(a.id); return n; }); }
  }
  async function toggle(a: Auto) {
    patch({ autos: c.autos.map((x) => x.id === a.id ? { ...x, enabled: !x.enabled } : x) });
    if (example) demoUpdate(a.id, { enabled: !a.enabled }); else await call("/api/automations", { op: "update", id: a.id, enabled: !a.enabled }).catch((e) => setNote((e as Error).message));
    void loadAutos();
  }
  async function remove(a: Auto) {
    setLeaving((s) => new Set(s).add(a.id));
    await new Promise((r) => setTimeout(r, 320));
    if (example) demoDelete(a.id); else await call("/api/automations", { op: "delete", id: a.id }).catch((e) => setNote((e as Error).message));
    await loadAutos();
  }
  async function briefNow() {
    if (!example && !signedIn) { setNote("Sign in with your NEAR wallet to get your brief."); return; }
    setBriefBusy(true); focus(briefRef.current);
    try { if (example) { await new Promise((r) => setTimeout(r, 900)); demoBriefNow(rateList(c.rates)); } else await call("/api/automations", { op: "brief_now", tzOffsetMin: tz() }); await loadAutos(); }
    catch (e) { setNote((e as Error).message); } finally { setBriefBusy(false); }
  }
  async function scheduleBrief() {
    if (c.autos.some((a) => a.kind === "brief")) { setBriefDone("exists"); focus(autosRef.current); setTimeout(() => setBriefDone("idle"), 3000); return; }
    try { await save(template("brief", tz())); setBriefDone("done"); setTimeout(() => setBriefDone("idle"), 3500); } catch (e) { setNote((e as Error).message); }
  }
  const dismiss = async (id: string) => { if (example) demoEventStatus(id, "dismissed"); else await call("/api/automations", { op: "event", id, status: "dismissed" }).catch(() => null); await loadAutos(); };

  // ── approvals and a preview of this week's sweep ──
  const sweep = c.autos.find((a) => a.kind === "sweep" && a.enabled);
  const [preview, setPreview] = useState<{ title: string; lines: string[] } | null>(null);
  const usdcApy = c.rates.find((r) => r.symbol === "USDC")?.supplyApy ?? null;
  const approvals: Approval[] = [
    ...c.events.filter((e) => e.kind === "approval" && (e.status === "new" || e.status === "seen")).map((e): Approval => ({ id: e.id, source: "Weekly sweep", title: e.title, sub: e.lines[0] ?? "", rows: [["From", "USDC · your NEAR account (surplus)"], ["To", "Rhea Lending · USDC"], ["Expected yield", usdcApy ? `≈ ${usdcApy.toFixed(2)}% APY, variable` : "variable"]], checks: e.checks, open: () => { if (e.action) goAction(e.action); }, decline: () => void dismiss(e.id) })),
    ...c.flows.supply.filter((f) => f.status === "your_turn").map((f): Approval => ({ id: f.flow.id, source: "Swap and supply", title: `Supply ${f.flow.symbol} from ${f.flow.source?.amount} ${f.flow.source?.fromSymbol}`, sub: `Step ${Math.min(f.done + 1, f.total)} of ${f.total} needs your signature.`, rows: [], open: () => go("earn", { tab: "supply", sflow: f.flow.id }) })),
    ...c.flows.stake.filter((f) => f.status === "your_turn").map((f): Approval => ({ id: f.flow.id, source: "Staking", title: `Stake into ${f.flow.venue === "rnear" ? "rNEAR" : "LiNEAR"}`, sub: `Step ${Math.min(f.done + 1, f.total)} of ${f.total} needs your signature.`, rows: [], open: () => go("earn", { tab: "stake", flow: f.flow.id }) })),
  ];
  useEffect(() => {
    if (example || !signedIn || !sweep || approvals.length) return;
    let live = true;
    call("/api/automations", { op: "preview", kind: "sweep", tzOffsetMin: tz() }).then((r: { preview?: { title: string; lines: string[] } | null }) => { if (live && r.preview) setPreview(r.preview); }).catch(() => {});
    return () => { live = false; };
  }, [example, signedIn, sweep?.id, approvals.length]); // eslint-disable-line react-hooks/exhaustive-deps -- re-preview when the sweep or queue changes

  // ── figures ──
  const brief = c.events.find((e) => e.kind === "brief" && e.status !== "dismissed") ?? null;
  const feed = c.events.filter((e) => e.kind !== "approval" && e.kind !== "brief" && e.status !== "dismissed").slice(0, 5);
  const runningCount = c.autos.filter((a) => a.enabled).length;
  const autosKnown = loaded.autos || c.autos.length > 0;
  const nEarning = useCountUp(c.earning), nApprovals = useCountUp(autosKnown ? approvals.length : null), nRunning = useCountUp(autosKnown ? runningCount : null), nIdle = useCountUp(c.idle);
  const trend = useTrend(key, { earning: c.earning, approvals: approvals.length, running: runningCount, idle: c.idle === null ? null : Math.round(c.idle) }, loaded.core && loaded.autos && holdings.loaded && c.idle !== null && c.earning !== null, example);
  const held = useMemo(() => {
    const bySymbol = new Map<string, { amount: number; usd: number }>(), nearIds = new Set<string>();
    for (const [id, b] of Object.entries(holdings.balances)) {
      const t = tokens.find((x) => x.id === id), amount = Number(b.amount); if (!t || !(amount > 0)) continue;
      const sym = t.symbol.toUpperCase(), was = bySymbol.get(sym) ?? { amount: 0, usd: 0 };
      bySymbol.set(sym, { amount: was.amount + amount, usd: was.usd + Number(b.usd ?? 0) }); if (id.startsWith("near:")) nearIds.add(id);
    }
    return { bySymbol, nearIds };
  }, [holdings.balances, tokens]);
  const lastFor = useMemo(() => { const m = new Map<string, AutomationEvent>(); for (const e of c.events) if (!m.has(e.automationId)) m.set(e.automationId, e); return m; }, [c.events]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  const [tab, setTab] = useState<"Research" | "Strategies" | "Yields" | "Watchlist">("Research");
  const [ask, setAsk] = useState("");
  const hour = new Date().getHours(), greeting = hour < 5 ? "Good evening." : hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
  const bestStable = [...c.rates].filter((r) => /^USD[CT]/i.test(r.symbol) && r.supplyApy !== null).sort((a, b) => b.supplyApy! - a.supplyApy!)[0];

  // No wallet in the personal workspace: public research up top, the personal half blurred under a lock.
  const locked = !example && !!v.notConnected;
  const connect = () => (v.openConnect ?? v.connectFirst)?.();
  const hero = <section className="fv-hub-hero">
      <div className="fv-hub-hello"><small>RESEARCH &amp; STRATEGIES</small><h1>{greeting}</h1><p>Discover opportunities, automate your capital, and review what&apos;s next.</p></div>
      <div className="fv-hub-ask">
        <form className="fv-hub-askbox" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) { v.askQuestion?.(ask.trim()); setAsk(""); } else v.openAssistant?.(); }}>
          <Sparkles size={17} /><input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask FlowVault anything about your capital, markets, automations, or next moves" aria-label="Ask FlowVault" />
          <button type="submit" aria-label="Ask"><ArrowRight size={16} /></button>
        </form>
        <div className="fv-hub-quick">
          <button type="button" className={briefDone !== "idle" ? "is-done" : ""} onClick={() => (locked ? connect() : void scheduleBrief())}>{briefDone === "idle" ? <CalendarClock size={16} /> : <Check size={16} />}<span key={briefDone} className="fv-fadein">{briefDone === "done" ? "Brief scheduled · 8:00 AM" : briefDone === "exists" ? "Already scheduled" : "Brief me at 8 AM"}</span><ChevronRight size={15} /></button>
          <button type="button" onClick={() => (locked ? connect() : setBuilder({ editing: null }))}><Zap size={16} /><span>Create automation</span><ChevronRight size={15} /></button>
          <button type="button" onClick={() => (locked ? connect() : (setTab("Strategies"), focus(researchRef.current)))}><Layers size={16} /><span>Find a strategy</span><ChevronRight size={15} /></button>
        </div>
      </div>
    </section>;
  if (locked) return <div className="fv-hub fv-fadein">
    {hero}
    <PublicResearch rates={c.rates} stakeApy={c.stakeApy} loading={!loaded.core} />
    <LockedResearch connect={connect} demo={() => v.toggleJudge?.()} />
  </div>;

  return <div className="fv-hub fv-fadein">
    {hero}
    {note && <p className="fv-notice fv-hub-note fv-rise" role="status">{note}</p>}

    <div className="fv-hub-stats">
      <Stat i={0} icon={<Layers size={16} />} trend={trend("earning")} label="Active strategies" value={nEarning === null ? null : String(Math.round(nEarning))} sub={c.earning ? "earning now" : "nothing earning yet"} onClick={() => v.navigate("portfolio")} />
      <Stat i={1} icon={<Check size={16} />} trend={trend("approvals")} label="Pending approvals" value={nApprovals === null ? null : String(Math.round(nApprovals))} sub={approvals.length ? "need your review" : "all clear"} onClick={() => focus(approvalsRef.current)} />
      <Stat i={2} icon={<Zap size={16} />} trend={trend("running")} label="Automations running" value={nRunning === null ? null : String(Math.round(nRunning))} sub={runningCount ? "on schedule" : "none yet"} live={runningCount > 0} onClick={() => focus(autosRef.current)} />
      <Stat i={3} icon={<Wallet size={16} />} trend={trend("idle")} label="Deployable capital" value={nIdle === null ? null : money(nIdle)} sub="idle stablecoins" badge={(c.idle ?? 0) >= 1 ? "Ready to deploy" : undefined} onClick={() => { setTab("Strategies"); focus(researchRef.current); }} />
    </div>

    <div ref={briefRef} className="fv-brief-wrap"><BriefCard event={brief} go={goAction} refresh={() => void briefNow()} busy={briefBusy} example={example} /></div>

    <section className="fv-hub-research" ref={researchRef}>
      <div className="fv-hub-section-head"><div><h2>Research &amp; Opportunities</h2><p>Ideas built from your holdings, today&apos;s rates and market moves. Rates are variable; nothing runs without your review.</p></div><button type="button" className="fv-text-button" onClick={() => v.navigate("research")}>Markets <ArrowUpRight size={13} /></button></div>
      <div className="fv-hub-tabs" role="tablist">{(["Research", "Strategies", "Yields", "Watchlist"] as const).map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="fv-tabpanel fv-hub-tabpanel" key={tab}>
        {tab === "Research" && <><TodayCards key={String(example)} owner={v.acc ?? ""} example={example} navigate={v.navigate} /><Community key={"c" + String(example)} example={example} signedIn={signedIn} navigate={v.navigate} compact /></>}
        {tab === "Strategies" && <div className="fv-strategy-grid">
          <Strategy i={0} art="coins" title="Stablecoin income" body="Earn a steady, variable yield on stablecoins by lending them on Rhea, with no price exposure." yieldText={bestStable ? `≈ ${bestStable.supplyApy!.toFixed(1)}% APY` : "Reading rates…"} risk="Low"
            why={(c.idle ?? 0) >= 1 ? `You hold ${money(c.idle!)} in stablecoins earning nothing.` : "Useful whenever you hold USDC or USDT you won't spend soon."} cta="Review opportunity" onClick={() => bestStable && go("earn", { tab: "supply", supply: bestStable.token })} />
          <Strategy i={1} art="steps" title="Weekly surplus sweep" body="Every week FlowVault proposes supplying only the USDC above your reserve and upcoming payments, so cash stays ready." yieldText={usdcApy ? `≈ ${usdcApy.toFixed(1)}% APY` : "Variable"} risk="Low"
            why="Your reserve and dated payments are never touched; each sweep waits for your approval." cta={sweep ? "See your sweep" : "Build strategy"} onClick={() => sweep ? focus(autosRef.current) : void save(template("sweep", tz())).catch((e) => setNote((e as Error).message))} />
          <Strategy i={2} art="arc" title="Liquid staking" body="Stake NEAR as LiNEAR: it earns staking rewards and stays liquid, swappable when liquidity allows." yieldText={c.stakeApy ? `≈ ${c.stakeApy.toFixed(1)}% APY` : "Reading rate…"} risk="Low–Medium"
            why={(c.near ?? 0) >= 1 ? `You hold ${c.near!.toLocaleString("en-US", { maximumFractionDigits: 2 })} NEAR.` : "For NEAR you plan to hold; unstaking takes about 2–3 days."} cta="Review strategy" onClick={() => go("earn", { tab: "stake" })} />
        </div>}
        {tab === "Yields" && <YieldsTable rates={c.rates} stakeApy={c.stakeApy} holdings={held} loading={!loaded.core} supply={(token) => go("earn", { tab: "supply", supply: token })} stake={() => go("earn", { tab: "stake" })} />}
        {tab === "Watchlist" && <WatchlistCompact owner={v.acc ?? ""} example={example} buy={(id) => go("swap", { buy: id })} open={(token) => go("research", token ? { token } : {})} />}
      </div>
    </section>

    <div className="fv-hub-bottom">
      <section className="fv-panel fv-hub-autos" ref={autosRef}>
        <div className="fv-hub-section-head"><div><h2>Automations &amp; Mandates</h2><p>Briefs, alerts and sweeps on a schedule. They never sign or move funds.</p></div><button type="button" className="fv-button fv-primary" onClick={() => setBuilder({ editing: null })}><Plus size={14} /> New</button></div>
        <ul className="fv-auto-list">
          {!autosKnown && [0, 1].map((i) => <li key={i}><div className="fv-skel" style={{ width: 34, height: 34 }} /><div style={{ flex: 1 }}><div className="fv-skel fv-skel-line" style={{ width: "55%", height: 12 }} /><div className="fv-skel fv-skel-line" style={{ width: "80%" }} /></div></li>)}
          {c.autos.map((a, i) => { const Icon = KIND_ICON[a.kind]; const last = lastFor.get(a.id), busy = running.has(a.id); return <li key={a.id} className={"fv-rise" + (a.enabled ? "" : " is-off") + (flash === a.id ? " fv-pulse" : "") + (leaving.has(a.id) ? " fv-leave" : "")} style={{ ["--i" as string]: i, maxHeight: 160 }}>
            <span className="fv-auto-icon"><Icon size={16} /></span>
            <div className="fv-auto-main"><strong>{a.title}</strong>
              <small>{!a.enabled ? "Paused" : a.schedule.every === "always" ? <><span className="fv-live-dot" /> Watching · checked every 30 min</> : <>Next run {until(a.nextRunAt) ?? "soon"}</>}{last ? <> · last: {last.title.toLowerCase()} {ago(last.createdAt)}</> : a.lastRunAt ? ` · last ran ${ago(a.lastRunAt)}` : ""}</small></div>
            <span className="fv-auto-chip">{a.chip}</span>
            <button type="button" className="fv-button fv-auto-run" disabled={busy || !a.enabled} onClick={() => void run(a)} aria-label={"Run " + a.title + " now"}>{busy ? <RefreshCw size={13} className="fv-spin" /> : <Play size={13} />} {busy ? "Running" : "Run"}</button>
            <button type="button" role="switch" aria-checked={a.enabled} aria-label={(a.enabled ? "Pause " : "Turn on ") + a.title} className="fv-auto-switch" onClick={() => void toggle(a)}><i /></button>
            <AutoMenu edit={() => setBuilder({ editing: a })} remove={() => void remove(a)} />
          </li>; })}
          {loaded.autos && !c.autos.length && <li className="fv-auto-empty fv-rise"><span>{signedIn || example ? "No automations yet." : "Sign in to set up automations."}</span><button type="button" className="fv-button" onClick={() => setBuilder({ editing: null })}><Plus size={14} /> Create your first</button></li>}
        </ul>
        <EventFeed events={feed} go={goAction} dismiss={(id) => void dismiss(id)} />
        <div className="fv-auto-tip"><Sparkles size={15} /><span>Or just say it: &quot;Sweep surplus on Fridays&quot;, &quot;Alert me if ETH is over 40%&quot;, &quot;Brief me at 7:30&quot;.</span><button type="button" className="fv-button" onClick={() => v.askQuestion?.("Set up an automation for me")}>Ask FlowVault</button></div>
      </section>

      <section className="fv-panel fv-hub-approvals" ref={approvalsRef}>
        <div className="fv-hub-section-head"><div><h2>Approvals</h2><p>Proposals and next steps waiting for you, each with its hazard scan. Your wallet signs; FlowVault never does.</p></div>{approvals.length > 1 && <span className="fv-muted">{approvals.length} waiting</span>}</div>
        {!approvals.length && <div className="fv-approval-empty fv-rise"><Target size={22} /><div><p>Nothing waiting for you.</p>
          {sweep ? <small>Your sweep runs {until(sweep.nextRunAt) ?? "soon"}.{preview ? <> If it ran now: <b>{preview.title}</b>.</> : null}</small>
            : <small>Turn on a weekly sweep and its proposals appear here. <button type="button" className="fv-link" onClick={() => void save(template("sweep", tz())).catch((e) => setNote((e as Error).message))}>Set one up</button></small>}</div></div>}
        {approvals.map((ap, i) => <article key={ap.id} className={"fv-approval fv-rise" + (i === 0 ? " is-open" : "")} style={{ ["--i" as string]: i }}>
          <div className="fv-approval-main">
            <span className="fv-approval-icon"><Layers size={18} /></span>
            <div><small>{ap.source}</small><h3>{ap.title}</h3><p>{ap.sub}</p>
              {i === 0 && ap.rows.length > 0 && <dl>{ap.rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>}</div>
          </div>
          {i === 0 && ap.checks && <HazardScan checks={ap.checks} compact />}
          <div className="fv-approval-actions">{ap.decline && <button type="button" className="fv-button" onClick={ap.decline}>Decline</button>}<button type="button" className="fv-button fv-primary" onClick={ap.open}>Review approval <ArrowRight size={14} /></button></div>
        </article>)}
      </section>
    </div>
    {builder && <AutomationBuilder editing={builder.editing} assets={Object.keys(holdings.balances).map((id) => tokens.find((t) => t.id === id)?.symbol ?? "").filter(Boolean)} close={() => setBuilder(null)} save={save} />}
  </div>;
}

function Stat({ i, icon, label, value, sub, badge, live, trend, onClick }: { i: number; icon: React.ReactNode; label: string; value: string | null; sub: string; badge?: string; live?: boolean; trend?: number[]; onClick: () => void }) {
  return <button type="button" className="fv-hub-stat fv-rise" style={{ ["--i" as string]: i }} onClick={onClick}><span className="fv-hub-stat-icon">{icon}</span><span className="fv-hub-stat-body"><span>{label}</span>{value === null ? <span className="fv-skel" style={{ width: 70, height: 26, margin: "3px 0" }} /> : <strong>{value}</strong>}<small>{badge ? <em>{badge}</em> : <>{live && <span className="fv-live-dot" />} {sub}</>}</small></span>{value !== null && trend && <Sparkline values={trend} label={label} />}<ChevronRight size={16} /></button>;
}
function AutoMenu({ edit, remove }: { edit: () => void; remove: () => void }) {
  const [open, setOpen] = useState(false);
  return <span className="fv-auto-menu"><button type="button" className="fv-icon-button" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={16} /></button>
    {open && <span className="fv-auto-menu-list fv-pop" role="menu"><button type="button" role="menuitem" onClick={() => { setOpen(false); edit(); }}>Edit</button><button type="button" role="menuitem" onClick={() => { setOpen(false); remove(); }}>Delete</button></span>}</span>;
}
function Strategy({ i, art, title, body, yieldText, risk, why, cta, onClick }: { i: number; art: "coins" | "steps" | "arc"; title: string; body: string; yieldText: string; risk: string; why: string; cta: string; onClick: () => void }) {
  return <article className="fv-strategy fv-rise" style={{ ["--i" as string]: i }}>
    <div className="fv-strategy-top"><StrategyArt kind={art} /><div><div className="fv-strategy-title"><h3>{title}</h3><Bookmark size={15} aria-hidden /></div><p>{body}</p>
      <div className="fv-strategy-figures"><div><small>Expected yield</small><strong>{yieldText}</strong></div><div><small>Risk</small><em>{risk}</em></div></div></div></div>
    <div className="fv-strategy-why"><Target size={22} strokeWidth={1.75} /><span><b>Why it matches you:</b> {why}</span></div>
    <button type="button" className="fv-button fv-primary" onClick={onClick}>{cta} <ArrowRight size={14} /></button>
  </article>;
}
function StrategyArt({ kind }: { kind: "coins" | "steps" | "arc" }) {
  return <svg className="fv-strategy-art" viewBox="0 0 120 120" aria-hidden>
    <defs><linearGradient id="fv-strategy-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" className="bg-stop1" /><stop offset="1" className="bg-stop2" /></linearGradient></defs>
    <rect width="120" height="120" rx="14" className="bg" />
    {kind === "coins" && [0, 1, 2].map((col) => [0, 1, 2, 3, 4].slice(0, 5 - col).map((i) => <ellipse key={col + ":" + i} cx={34 + col * 26} cy={96 - i * 11} rx="14" ry="5.5" className={i % 2 ? "a" : "b"} />))}
    {kind === "steps" && [0, 1, 2, 3].map((i) => <rect key={i} x={18 + i * 21} y={92 - i * 18} width="22" height={12 + i * 18} rx="2" className={i % 2 ? "a" : "b"} />)}
    {kind === "arc" && <><path d="M18 104 C 30 40, 80 20, 104 18" className="stroke" /><path d="M30 104 C 42 56, 82 36, 104 34" className="stroke thin" /><circle cx="104" cy="18" r="6" className="b" /></>}
  </svg>;
}
