"use client";
// Staking, as one connected experience: stake NEAR with what you already hold (NEAR, or USDC/ETH on Ethereum, Base or
// Arbitrum delivered as NEAR by NEAR Intents), see exactly what you get, then follow one resumable flow to a staked
// position. Below: your staking (staked, unstaking, ready to withdraw), today's rates and recent flows you can reopen.
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Coins, Download, PenLine, RefreshCw } from "lucide-react";
import { api } from "../live";
import { TokenIcon } from "../AssetIdentity";
import { TokenPicker } from "../TokenPicker";
import { useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { useSwapQuote, ownAddress } from "../useSwapQuote";
import { startPlan } from "../PlanDock";
import { fmtAmount, fmtUsd, ago } from "../swap-format";
import { units, decimal } from "@/lib/flowvault/money";
import { nearText, flowStage } from "@/lib/flowvault/stake-flow";
import { StakeFlowView, type FlowRead } from "./StakeFlowView";
import { availableToStake, estimatedLinearShares, estimatedYearlyNear } from "@/lib/flowvault/staking-ui";
import { useDemoLedger, useDemoMarkets } from "../demo/ledger-store";
import { DemoStakePositions, DemoStakeReview } from "../demo/DemoStake";
import { WNEAR_ID } from "@/lib/flowvault/demo-ledger";

const NEAR_ID = "near:native";
type Venue = "linear" | "validator" | "rnear";
interface Option { id: string; aprPercent?: string | null }
interface Validator { id: string; label: string; aprPercent: string | null; feePercent?: number | null }
interface Lifecycle { registered?: boolean; exchangeRateRaw?: string; underlying?: { quantityRaw: string }; positions?: { id: string; asset: string; amount: string; kind: string }[]; pendingExit?: { amountRaw: string; epochsRemaining: string; claimable: boolean } | null }

const flowParam = () => (typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("flow"));
function setFlowParam(id: string | null) { const u = new URL(window.location.href); if (id) { u.searchParams.set("flow", id); u.searchParams.set("tab", "stake"); } else u.searchParams.delete("flow"); history.replaceState(null, "", u); }

export function StakeHome({ v }: { v: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any -- design view model
  const owner: string = v.acc ?? "", example = !!v.judge;
  const [flowId, setFlowId] = useState<string | null>(flowParam);
  const open = (id: string | null) => { setFlowParam(id); setFlowId(id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [options, setOptions] = useState<Option[]>([]), [validators, setValidators] = useState<Validator[]>([]), [life, setLife] = useState<Lifecycle | null>(null), [rLife,setRLife]=useState<Lifecycle|null>(null), [portfolioVenue,setPortfolioVenue]=useState<"linear"|"rnear">("linear"), [flows, setFlows] = useState<FlowRead[]>([]);
  const [rReadError,setRReadError]=useState("");
  const [tick, setTick] = useState(0), [readError, setReadError] = useState("");
  // Demo Mode: today's public LiNEAR / rNEAR rates, and each share's NEAR value from today's Rhea prices.
  useEffect(() => { if (!example) return; fetch("/api/staking/rates").then((r) => r.json() as Promise<{ options?: Option[] }>).then((r) => setOptions(r.options ?? [])).catch(() => {}); }, [example]);
  const markets = useDemoMarkets(example);
  const demoPerShare = (venue: "linear" | "rnear") => { const m = markets?.m, near = m?.[WNEAR_ID]?.price, sh = m?.[venue === "linear" ? "linear-protocol.near" : "lst.rhealab.near"]?.price; return near && sh ? sh / near : null; };
  const demoRaw = (x: number | null) => (x ? (BigInt(Math.round(x * 1e6)) * 10n ** 18n).toString() : null);
  const [demoReview, setDemoReview] = useState<{ venue: "linear" | "rnear"; near: number } | null>(null);
  useEffect(() => {
    if (example || !owner) return;
    api("/api/staking/options", undefined, "GET").then((r: { options?: Option[] }) => setOptions(r.options ?? [])).catch(() => {});
    api("/api/staking/validators", undefined, "GET").then((r: { validators?: Validator[] }) => setValidators(r.validators ?? [])).catch(() => {});
  }, [owner, example, tick]);
  useEffect(() => {
    if (example || !owner) return;
    let active = true;
    api("/api/staking/lifecycle", undefined, "GET").then((r: Lifecycle) => { if(active){setLife(r);setReadError("");} }).catch(() => {if(active){setLife(null);setReadError("Your LiNEAR position could not be read. Balances are unknown until the read succeeds.");}});
    api("/api/staking/lifecycle?venue=rnear",undefined,"GET").then((r:Lifecycle)=>{if(active){setRLife(r);setRReadError("");}}).catch(()=>{if(active){setRLife(null);setRReadError("Your rNEAR position could not be read. Retry to refresh it.");}});
    api("/api/staking/flows", undefined, "GET").then((r: { flows?: FlowRead[] }) => {if(active)setFlows(r.flows ?? []);}).catch(() => {});
    return()=>{active=false;};
  }, [owner, example, tick, flowId]);
  useEffect(() => { const refresh = () => setTick(n=>n+1); window.addEventListener("focus", refresh); return()=>window.removeEventListener("focus",refresh); }, []);
  const apr = (id: string) => options.find((o) => o.id === id)?.aprPercent ?? null;
  const bestValidator = useMemo(() => [...validators].filter((x) => x.aprPercent).sort((a, b) => Number(b.aprPercent) - Number(a.aprPercent))[0] ?? null, [validators]);

  if (flowId) return <StakeFlowView id={flowId} owner={owner} linearApy={apr("linear")} rnearApy={apr("rnear")} connect={() => (v.openConnect ?? v.connectFirst)?.()} back={() => { open(null); setTick((n) => n + 1); }} />;
  return <div className="fv-stake-home">
    <StakeCard owner={owner} example={example} connect={() => (v.openConnect ?? v.connectFirst)?.()} rates={{ linear: apr("linear"), rnear: apr("rnear"), validator: bestValidator?.aprPercent ?? null }} validators={validators} exchangeRates={example ? { linear: demoRaw(demoPerShare("linear")), rnear: demoRaw(demoPerShare("rnear")) } : {linear:life?.exchangeRateRaw ?? null,rnear:rLife?.exchangeRateRaw ?? null}} demoReview={example ? (venue, near) => setDemoReview({ venue, near }) : undefined} rnearRegistered={rLife?.registered} onFlow={(id) => open(id)} />
    <ol className="fv-stake-strip">
      <li><span><Coins size={16} /></span><div><strong>1. Pay with what you hold</strong><small>NEAR, or USDC and ETH on Ethereum, Base and Arbitrum</small></div></li>
      <li><span><Download size={16} /></span><div><strong>2. Funds arrive as NEAR</strong><small>For cross-chain payments, NEAR Intents delivers to your account</small></div></li>
      <li><span><PenLine size={16} /></span><div><strong>3. Review and stake</strong><small>Your wallet approves the stake after fresh checks</small></div></li>
    </ol>
    {example && <div className="fv-stake-position-tabs" role="group" aria-label="Staking positions">{(["linear","rnear"] as const).map(id=><button type="button" className="fv-button" aria-pressed={portfolioVenue===id} key={id} onClick={()=>setPortfolioVenue(id)}>{id === "linear" ? "LiNEAR" : "rNEAR"} positions</button>)}</div>}
    {example && <DemoStakePositions venue={portfolioVenue} nearPerShare={demoPerShare(portfolioVenue)} apr={apr(portfolioVenue)} />}
    {demoReview && demoPerShare(demoReview.venue) && <DemoStakeReview venue={demoReview.venue} near={demoReview.near} nearPerShare={demoPerShare(demoReview.venue)!} apr={apr(demoReview.venue)} nearUsd={markets?.m[WNEAR_ID]?.price ?? null} close={() => setDemoReview(null)} />}
    {!example && owner && <div className="fv-stake-position-tabs" role="group" aria-label="Staking positions">{(["linear","rnear"] as const).map(id=><button type="button" className="fv-button" aria-pressed={portfolioVenue===id} key={id} onClick={()=>setPortfolioVenue(id)}>{id === "linear" ? "LiNEAR" : "rNEAR"} positions</button>)}</div>}
    {!example && owner && <StakePortfolio venue={portfolioVenue} life={portfolioVenue === "rnear" ? rLife : life} readError={portfolioVenue === "rnear" ? rReadError : readError} retry={()=>setTick(n=>n+1)} nativeStats={v.pfStake ?? []} nativeNote={v.pfStakeHead ?? ""} swap={() => {const url = new URL(window.location.href); url.searchParams.set("swap","near:native|base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"); url.searchParams.delete("flow"); history.replaceState(null,"",url); v.navigate("swap");}} owner={owner} flows={flows} openFlow={open} rates={{ linear: apr("linear"), rnear: apr("rnear"), validator: bestValidator }} />}
  </div>;
}

function StakeCard({ owner, example, connect, rates, validators, exchangeRates, rnearRegistered, onFlow, demoReview }: { owner: string; example: boolean; connect: () => void; rates: { linear: string | null; rnear: string | null; validator: string | null }; validators: Validator[]; exchangeRates:{linear:string|null;rnear:string|null}; rnearRegistered?:boolean; onFlow: (id: string) => void; demoReview?: (venue: "linear" | "rnear", near: number) => void }) {
  const { tokens } = useTokenCatalog();
  const live = useWalletBalances(owner, tokens, !example);
  // Demo Mode stakes the example account's NEAR from the shared ledger (so Borrow and Stake agree).
  const ledger = useDemoLedger(example);
  const holdings = example && ledger ? { ...live, balances: { [NEAR_ID]: { amount: String(ledger.wallet[WNEAR_ID] ?? 0), raw: (BigInt(Math.round((ledger.wallet[WNEAR_ID] ?? 0) * 1e6)) * 10n ** 18n).toString(), usd: null } } as unknown as typeof live.balances } : live;
  // Pay with: native NEAR, or anything NEAR Intents takes from Ethereum, Base or Arbitrum.
  const payable = useMemo(() => tokens.filter((t) => t.id === NEAR_ID || (!!t.assetId && ["eth", "base", "arb"].includes(t.network) && (t.contract === "native" && t.symbol === "ETH" || t.id.toLowerCase() === "eth:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" || t.id.toLowerCase() === "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || t.id.toLowerCase() === "arb:0xaf88d065e77c8cc2239327c5edb3a432268e5831"))), [tokens]);
  const [fromId, setFrom] = useState(NEAR_ID), [amount, setAmount] = useState(""), [venue, setVenue] = useState<Venue>("linear"), [pool, setPool] = useState("");
  const [details, setDetails] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const from = payable.find((t) => t.id === fromId);
  const bal = holdings.balances[fromId];
  const isNear = fromId === NEAR_ID;
  const sender = isNear ? owner : bal?.account ?? ownAddress(holdings, from?.network);
  const valid = (() => { try { return !!from && units(amount, from.decimals) > 0n; } catch { return false; } })();
  // Expected NEAR: the amount itself, or a live NEAR Intents quote delivering to your account.
  const q = useSwapQuote({ tokens, holdings, owner, example, fromId: isNear ? "" : fromId, toId: NEAR_ID, amount: isNear ? "" : amount, slippage: "100", sender, recipient: owner, paused: isNear });
  const intents = q.routes.find((r) => r.venue === "NEAR Intents");
  const expectedRaw = (() => { try { return isNear ? (valid ? units(amount, 24) : null) : intents ? units(intents.output, 24) : null; } catch { return null; } })();
  // NEAR you can stake from the wallet: balance minus the 0.5 NEAR gas reserve and the transaction fee.
  const stakeable = availableToStake(holdings.balances[NEAR_ID]?.raw);
  const over = isNear && valid && stakeable !== null && expectedRaw !== null && expectedRaw > stakeable;
  const symbol = venue === "rnear" ? "rNEAR" : "LiNEAR";
  const estimatedPrincipal = venue === "rnear" && rnearRegistered === false && expectedRaw !== null ? expectedRaw - 1250000000000000000000n : expectedRaw;
  const sharesRaw = estimatedLinearShares(estimatedPrincipal, venue === "rnear" ? exchangeRates.rnear : exchangeRates.linear);
  const rate = venue === "linear" ? rates.linear : venue === "rnear" ? rates.rnear : validators.find((x) => x.id === pool)?.aprPercent ?? rates.validator;
  const yearlyRaw = estimatedYearlyNear(expectedRaw, rate);
  const yearly = yearlyRaw !== null ? decimal(yearlyRaw,24) : null;
  const usdIn = valid && from?.price ? Number(amount) * Number(from.price) : null;

  function chip(x: string) {
    if (!from) return;
    if (isNear) {
      if (stakeable === null) return;
      const pct = BigInt(x);
      const raw = (stakeable * pct) / 100n;
      setAmount(raw > 0n ? decimal(x === "100" ? raw : (raw / 10n ** 20n) * 10n ** 20n, 24) : "");
    } else if (from.price) {
      const raw = (units(x, 6) * 10n ** BigInt(from.decimals)) / units(Number(from.price).toFixed(6), 6);
      const keep = from.decimals > 6 ? 10n ** BigInt(from.decimals - 6) : 1n;
      setAmount(decimal((raw / keep) * keep, from.decimals));
    }
  }
  async function go() {
    setBusy(true); setError("");
    try {
      if (venue === "validator") {
        if (!pool || !expectedRaw) throw new Error("Choose a validator.");
        await startPlan({ objective: "stake", venue: pool, amountRaw: expectedRaw.toString() });
        return;
      }
      const source = isNear ? { kind: "near", amountRaw: expectedRaw!.toString() } : { kind: "swap", from: fromId, amount, expectedNearRaw: expectedRaw?.toString() ?? null };
      const r = await api("/api/staking/flows", { op: "create", key: crypto.randomUUID(), venue, source }) as FlowRead;
      onFlow(r.flow.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const cta = example ? (venue === "validator" ? { label: "Validator staking needs your own account", disabled: true }
      : !isNear ? { label: "In the example, stake from NEAR", disabled: true }
      : !valid ? { label: "Enter an amount", disabled: true }
      : over ? { label: `You can stake up to ${nearText(stakeable?.toString())} NEAR`, disabled: true }
      : { label: `Review ${amount} NEAR stake · example`, onClick: () => demoReview?.(venue as "linear" | "rnear", Number(amount)) })
    : !owner ? { label: "Connect your NEAR wallet", onClick: connect }
    : venue === "validator" && !isNear ? { label: "Validators take NEAR: pay with NEAR", disabled: true }
    : !valid ? { label: "Enter an amount", disabled: true }
    : over ? { label: `You can stake up to ${nearText(stakeable?.toString())} NEAR`, disabled: true }
    : !isNear && !sender ? { label: `Connect your ${from?.network === "eth" ? "Ethereum" : from?.network === "base" ? "Base" : "Arbitrum"} wallet`, onClick: connect }
    : !isNear && !intents ? { label: q.busy ? "Getting a quote…" : "No route for this amount", disabled: true, spin: q.busy }
    : venue === "validator" && !pool ? { label: "Choose a validator", disabled: true }
    : { label: venue === "validator" ? `Review stake with ${validators.find((x) => x.id === pool)?.label ?? "validator"}` : isNear ? `Review ${amount} NEAR stake` : `Review ${amount} ${from?.symbol} and stake`, onClick: () => void go() };

  return <section className="fv-panel fv-stake-card">
    <header><h2>Stake NEAR with what you already hold</h2><p>Pay with NEAR, USDC or ETH. NEAR reaches your own account, then one signature stakes it.</p></header>
    <div className="fv-stake-grid">
      <div className="fv-stake-left">
        <div className="fv-swap-amount fv-trade-box">
          <div className="fv-swap-box-head"><label htmlFor="stake-pay">You pay{!isNear && sender ? <small> · from {sender.slice(0, 6)}…{sender.slice(-4)}</small> : null}</label>
            {bal ? <span className="fv-swap-balance">{fmtAmount(bal.amount)} {from?.symbol}</span> : null}</div>
          <div className="fv-swap-line"><input id="stake-pay" inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className={amount.length > 9 ? "is-long" : undefined} />
            <TokenPicker label="Pay with" tokens={payable} balances={holdings.balances} covered={holdings.covered} value={from} onChange={(t) => { setFrom(t.id); setAmount(""); if (t.id !== NEAR_ID && venue === "validator") setVenue("linear"); }} /></div>
          <div className="fv-stake-chips"><small>{usdIn !== null ? fmtUsd(usdIn) : " "}</small><span>{isNear ? ["25", "50", "100"].map((x) => <button type="button" key={x} disabled={!stakeable} onClick={() => chip(x)}>{x === "100" ? "Max" : x + "%"}</button>) : ["5", "20", "50", "100"].map((x) => <button type="button" key={x} disabled={!from?.price} onClick={() => chip(x)}>${x}</button>)}</span></div>
        </div>
        <div className="fv-stake-into">
          <div className="fv-stake-into-head"><span>You stake into</span></div>
          <div className="fv-stake-venues" role="tablist">
            {([["validator", "Validator", rates.validator], ["rnear", "rNEAR", rates.rnear], ["linear", "LiNEAR", rates.linear]] as const).map(([id, label, r]) => <button type="button" role="tab" key={id} aria-selected={venue === id} onClick={() => setVenue(id)}><span>{label}</span>{r ? <em>{Number(r).toFixed(2)}%</em> : null}</button>)}
          </div>
          <div className="fv-stake-venue-note">
            {venue === "linear" && <><span className="fv-flow-dot is-linear">Li</span><div><strong>LiNEAR <i className="fv-verified">Liquid staking</i></strong><small>Liquid staking: you get LiNEAR, which you can swap when liquidity is available, or request an unstake (about 2–3 days). Contract code checked before staking.</small></div></>}
            {venue === "rnear" && <><span className="fv-flow-dot">r</span><div><strong>rNEAR by Rhea</strong><small>Liquid staking with Rhea. Your first stake includes a small registration fee, shown in the review. Swap subject to liquidity, or unstake over about 4 epochs.</small></div></>}
            {venue === "validator" && <div className="fv-stake-validator"><small>Native staking with a validator: rewards each epoch; unstaking takes 4 epochs (about 2–3 days), then you claim.</small>
              <select value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Validator"><option value="">Choose a validator</option>{validators.map((x) => <option key={x.id} value={x.id}>{x.label} · {x.aprPercent ? Number(x.aprPercent).toFixed(2) + "%" : "rate unknown"}{x.feePercent != null ? ` · fee ${x.feePercent}%` : ""}</option>)}</select></div>}
          </div>
        </div>
      </div>
      <div className="fv-stake-right">
        <div className="fv-stake-get">
          <div className="fv-swap-box-head"><span>You get</span><small>{venue !== "validator" ? `${symbol} on your account` : venue === "validator" ? "Staked NEAR with the validator" : "—"}</small></div>
          <strong className={q.busy && !isNear ? "fv-loading-text" : ""}>{venue !== "validator" ? (sharesRaw ? `≈ ${nearText(sharesRaw)} ${symbol}` : expectedRaw ? "Reading conversion rate…" : "—") : expectedRaw ? `≈ ${nearText(expectedRaw.toString())} NEAR` : "—"}</strong>
          <small>{yearly ? `≈ ${fmtAmount(yearly, 4)} NEAR a year at ${Number(rate).toFixed(2)}% (variable)` : "Rates are variable"}{venue !== "validator" ? " · swap subject to liquidity, or unstake in ~2–3 days" : venue === "validator" ? " · unstake takes ~2–3 days" : ""}</small>
        </div>
        {"onClick" in cta && cta.onClick ? <button type="button" className="fv-button fv-primary fv-wide-button fv-stake-cta" disabled={busy} onClick={cta.onClick}>{busy ? <RefreshCw size={15} className="fv-spin" /> : null}{cta.label} {!busy && <ArrowRight size={16} />}</button>
          : <button type="button" className="fv-button fv-primary fv-wide-button fv-stake-cta" disabled>{"spin" in cta && cta.spin ? <RefreshCw size={15} className="fv-spin" /> : null}{cta.label}</button>}
        {error && <p className="fv-notice" role="alert">{error}</p>}
        <p className="fv-stake-sign">{isNear ? "One signature in your NEAR wallet" : "One payment in your wallet, then one signature in your NEAR wallet"}</p>
        <div className="fv-stake-details">
          <button type="button" aria-expanded={details} onClick={() => setDetails(!details)}>Details <ChevronDown size={14} /></button>
          {details && <div className="fv-confirm-table">
            <div><span>NEAR goes to</span><strong>{owner || "your NEAR account"}{expectedRaw ? ` · ≈ ${nearText(expectedRaw.toString())} NEAR` : ""}</strong></div>
            <div><span>Kept on your account</span><strong>0.5 NEAR for gas and a later unstake</strong></div>
            {!isNear && <div><span>If anything fails</span><strong>Refunds go back to {sender ? sender.slice(0, 6) + "…" + sender.slice(-4) : "your sending wallet"} on {from?.network === "eth" ? "Ethereum" : from?.network === "base" ? "Base" : "Arbitrum"}</strong></div>}
            {!isNear && intents && <div><span>Swap</span><strong>NEAR Intents · ~{intents.eta ?? 60}s · min {fmtAmount(intents.minimum)} NEAR</strong></div>}
            <div><span>Protocol fee</span><strong>{venue !== "validator" ? "Taken from rewards, already in the rate" : venue === "validator" ? "Validator fee, already in the rate" : "—"}</strong></div>
          </div>}
        </div>
      </div>
    </div>
  </section>;
}

function StakePortfolio({ life, owner, flows, openFlow, rates, readError, retry, nativeStats, nativeNote, swap, venue }: { venue:"linear"|"rnear"; life: Lifecycle | null; readError: string; retry:()=>void; nativeStats:{label:string;v:string;sub:string}[]; nativeNote:string; swap:()=>void; owner: string; flows: FlowRead[]; openFlow: (id: string) => void; rates: { linear: string | null; rnear: string | null; validator: Validator | null } }) {
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, true);
  const availableRaw = availableToStake(holdings.balances[NEAR_ID]?.raw);
  const available = availableRaw !== null ? decimal(availableRaw,24) : null;
  const symbol = venue === "rnear" ? "rNEAR" : "LiNEAR";
  const shares = life?.positions?.find((p) => p.id === venue + "-shares");
  const staked = life?.underlying?.quantityRaw ?? null;
  const exit = life?.pendingExit ?? null;
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const plan = async (positionId: string) => { setBusy(positionId); setErr(""); try { await startPlan({ objective: "unstake", positionId }); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } };
  const open = flows.filter((f) => !["done", "cancelled"].includes(f.status));
  const recent = flows.slice(0, 6);
  return <div className="fv-stake-portfolio">
    <section className="fv-panel fv-stake-summary">
      <div className="fv-stake-total"><small>{symbol} staked · NEAR equivalent</small><strong>{staked !== null ? nearText(staked) : "Unavailable"} <span>NEAR</span></strong><p>{shares && shares.amount !== "0" ? `${fmtAmount(shares.amount, 4)} ${symbol} in your account` : life ? `No ${symbol} staked yet.` : "Waiting for a successful position read."}</p></div>
      <div className="fv-stake-stats">
        <div><small>Unstaking</small><strong>{exit && !exit.claimable ? nearText(exit.amountRaw) + " NEAR" : life ? "None" : "Unknown"}</strong><p>{exit && !exit.claimable ? Number(exit.epochsRemaining) > 0 ? `${exit.epochsRemaining} epoch${exit.epochsRemaining === "1" ? "" : "s"} left (~${Number(exit.epochsRemaining) * 7}h)` : "Waiting for protocol liquidity or availability" : "Takes about 2–3 days once you start"}</p></div>
        <div><small>Ready to withdraw</small><strong>{exit?.claimable ? nearText(exit.amountRaw) + " NEAR" : life ? "None" : "Unknown"}</strong><p>{exit?.claimable ? <button type="button" className="fv-text-button" disabled={!!busy} onClick={() => void plan(venue + "-unstaking")}>Withdraw to your account</button> : "Unlocked NEAR shows up here"}</p></div>
        <div><small>Available to stake</small><strong>{available ? fmtAmount(available, 4) + " NEAR" : "—"}</strong><p>After 0.5 NEAR reserve + 0.05 NEAR fee allowance</p><button type="button" className="fv-text-button" onClick={swap}>Send to another network <ArrowRight size={12}/></button></div>
      </div>
      {shares && shares.amount !== "0" && <div className="fv-actions"><button type="button" className="fv-button" disabled={!!busy} onClick={() => void plan(venue + "-shares")}>{busy === venue + "-shares" ? "Checking…" : `Unstake ${symbol}`}</button></div>}
      {readError && <div className="fv-notice" role="status"><p>{readError}</p><button type="button" className="fv-button" onClick={retry}>Retry position read</button></div>}{err && <p className="fv-notice" role="alert">{err}</p>}
      {!!nativeStats.length && <details className="fv-stake-native"><summary>Validator positions</summary><p className="fv-muted">{nativeNote}</p><div className="fv-stake-stats">{nativeStats.map(s=><div key={s.label}><small>{s.label}</small><strong>{s.v}</strong><p>{s.sub}</p></div>)}</div></details>}
    </section>
    <div className="fv-stake-lower">
      <section className="fv-panel fv-stake-activity">
        <div className="fv-section-head"><h2>Recent activity</h2>{open.length ? <span className="fv-flow-badge is-turn">{open.length} open</span> : null}</div>
        {!recent.length && <p className="fv-muted">No staking activity yet. Your LiNEAR flows will appear here, ready to continue if you leave.</p>}
        {recent.map((f) => <article key={f.flow.id} className={"fv-flow-row is-" + f.status}>
          <TokenIcon symbol={f.flow.source.kind === "swap" ? f.flow.source.fromSymbol : "NEAR"} core size={30} />
          <div><strong>Stake into {f.flow.venue === "rnear" ? "rNEAR" : "LiNEAR"}</strong><small>{f.flow.source.kind === "swap" ? `${f.flow.source.amount} ${f.flow.source.fromSymbol} on ${f.flow.source.fromNetwork} → ≈ ${nearText(f.stakeRaw ?? f.flow.source.expectedNearRaw)} NEAR` : `${nearText(f.flow.source.amountRaw)} NEAR`}</small>
            <small>{f.steps.find((s) => s.id === f.current)?.detail ?? (f.status === "done" ? "Staked." : "")}</small></div>
          <div className="fv-flow-row-end"><span className={"fv-flow-badge is-" + ({ your_turn: "turn", working: "busy", done: "ok", attention: "bad", cancelled: "muted" } as const)[f.status]}>{flowStage(f)}</span><small>{ago(f.flow.updatedAt)} · {f.done}/{f.total}</small>
            <button type="button" className="fv-text-button" onClick={() => openFlow(f.flow.id)}>{["your_turn", "attention"].includes(f.status) ? "Continue" : "Open status"} <ArrowRight size={13} /></button></div>
        </article>)}
      </section>
      <section className="fv-panel fv-stake-ways">
        <h2>Ways to earn</h2><p className="fv-muted">Today’s rates. Pick one when you stake.</p>
        {[["Validator pools", rates.validator?.aprPercent ?? null, rates.validator ? `Native · best: ${rates.validator.label}` : "Native · ~2–3 days to unlock"], ["LiNEAR", rates.linear, "Liquid · swaps depend on liquidity"], ["rNEAR by Rhea", rates.rnear, "Liquid · storage on first stake"]].map(([n, r, d]) => <div key={n as string} className="fv-list-row"><div><strong>{n}</strong><small>{d}</small></div><strong>{r ? Number(r).toFixed(2) + "%" : "—"}</strong></div>)}
        <p className="fv-muted fv-chat-small">Rates are variable and come from each protocol’s recent history.</p>
      </section>
    </div>
  </div>;
}
