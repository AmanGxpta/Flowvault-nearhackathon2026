"use client";
// Collect and send: send an exact amount when your money is spread over many chains. Pick the recipient and what they
// get, and FlowVault proposes which holdings to draw from (cheap chains first). Every holding is a checkbox you can
// untick, re-order or resize; a running total turns green once the target is met, and the gas each chain costs is
// right there so you can trade a little convenience for less gas. Review opens the live run (see CollectRun).
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, CircleAlert, Send, Sparkles } from "lucide-react";
import { TokenIcon } from "../AssetIdentity";
import { coreIdentity, useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { fmtAmount, fmtUsd } from "../swap-format";
import { decimal, units } from "@/lib/flowvault/money";
import { autoPick, amountForUsd, floor6, GAS_USD, spendableRaw, summarize, usdOf, type CollectPick, type CollectSource } from "@/lib/flowvault/collect";
import { EXAMPLE_NEAR_ACCOUNT } from "@/lib/flowvault/example-wallets";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { CollectRun, type RunLeg } from "./CollectRun";

export const NET_NAME: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", sol: "Solana", bsc: "BNB Chain", pol: "Polygon", op: "Optimism", avax: "Avalanche", gnosis: "Gnosis" };
/** Chains whose deposits FlowVault can hand to your wallet today. Holdings elsewhere are shown but can't be drawn yet. */
export const LIVE_ORIGINS = ["near", "eth", "base", "arb", "bsc", "pol", "sol"];
/** From Solana, FlowVault can pay with USDC (SPL) for now. */
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DESTINATIONS: { network: string; symbol: string }[] = [
  { network: "base", symbol: "USDC" }, { network: "arb", symbol: "USDC" }, { network: "near", symbol: "USDC" }, { network: "eth", symbol: "USDC" },
  { network: "pol", symbol: "USDC" }, { network: "bsc", symbol: "USDT" }, { network: "sol", symbol: "USDC" },
];
const EVM = ["eth", "base", "arb", "bsc", "pol", "op", "avax", "gnosis"];
export function validRecipient(network: string, a: string) {
  if (EVM.includes(network)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (network === "near") return /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(a) || /^[0-9a-f]{64}$/.test(a);
  if (network === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return a.length > 3;
}
const NATIVE: Record<string, string> = { eth: "ETH", base: "ETH", arb: "ETH", op: "ETH", bsc: "BNB", pol: "POL", avax: "AVAX", sol: "SOL", near: "NEAR" };
const short = (a: string) => (a.length > 16 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

export function CollectSend({ owner: liveOwner, example, connect }: { owner: string; example: boolean; connect?: () => void }) {
  const owner = example ? EXAMPLE_NEAR_ACCOUNT : liveOwner;
  const { tokens } = useTokenCatalog();
  const holdings = useWalletBalances(owner, tokens, !!owner, example);
  const [dest, setDest] = useState(0), [recipient, setRecipient] = useState(""), [amount, setAmount] = useState("3");
  const destToken = useMemo(() => { const d = DESTINATIONS[dest]; return tokens.find((t) => t.network === d.network && t.symbol.toUpperCase() === d.symbol && t.contract !== "native" && !!t.assetId); }, [tokens, dest]);
  const targetUsd = destToken?.price && Number(amount) > 0 ? Number(amount) * Number(destToken.price) : 0;

  // Every holding NEAR Intents can take, one row per token (from the wallet that holds the most of it).
  const sources = useMemo<CollectSource[]>(() => Object.entries(holdings.balances).flatMap(([id, b]) => {
    const t = tokens.find((x) => x.id === id);
    if (!t?.assetId || !t.price || !b.account) return [];
    return [{ key: id, tokenId: id, symbol: t.symbol, network: t.network, account: b.account, decimals: t.decimals, balanceRaw: b.largestRaw ?? b.raw, price: Number(t.price), gasUsd: GAS_USD[t.network] ?? 0.05, native: t.contract === "native" && NATIVE[t.network] === t.symbol.toUpperCase() }];
  }).filter((s) => usdOf(s, s.balanceRaw) >= 0.01).sort((a, b) => usdOf(b, b.balanceRaw) - usdOf(a, a.balanceRaw)), [holdings.balances, tokens]);
  const drawable = (s: CollectSource) => example || (LIVE_ORIGINS.includes(s.network) && (s.network !== "sol" || s.tokenId === "sol:" + SOLANA_USDC));

  const [picks, setPicks] = useState<CollectPick[]>([]), [touched, setTouched] = useState(false), [run, setRun] = useState<RunLeg[] | null>(null);
  const auto = () => setPicks(autoPick(sources.filter(drawable), targetUsd));
  // Propose a plan as soon as there's a target, until the owner starts editing it.
  useEffect(() => { if (touched || !targetUsd || !sources.length) return; const t = setTimeout(() => setPicks(autoPick(sources.filter(drawable), targetUsd)), 0); return () => clearTimeout(t); }, [targetUsd, sources.length, touched]); // eslint-disable-line react-hooks/exhaustive-deps -- re-plan on target/holdings only
  const sum = summarize(sources, picks, targetUsd);
  const chains = new Set(sum.legs.map((l) => sources.find((s) => s.key === l.key)?.network)).size;
  const edit = (next: CollectPick[]) => { setTouched(true); setPicks(next); };
  const toggle = (s: CollectSource) => {
    if (picks.some((p) => p.key === s.key)) return edit(picks.filter((p) => p.key !== s.key));
    const need = Math.max(sum.shortUsd, 0.5);
    edit([...picks, { key: s.key, amountRaw: amountForUsd(s, need) }]);
  };
  const move = (key: string, d: -1 | 1) => { const i = picks.findIndex((p) => p.key === key), j = i + d; if (i < 0 || j < 0 || j >= picks.length) return; const next = [...picks]; [next[i], next[j]] = [next[j], next[i]]; edit(next); };
  const setAmountFor = (s: CollectSource, v: string) => { let raw = "0"; try { raw = units(v || "0", s.decimals).toString(); } catch { return; } const cap = spendableRaw(s), v6 = floor6(BigInt(raw), s.decimals); edit(picks.map((p) => p.key === s.key ? { ...p, amountRaw: (v6 > cap ? cap : v6).toString() } : p)); };

  const recipientOk = destToken ? validRecipient(destToken.network, recipient.trim()) : false;
  const destName = DESTINATIONS[dest].symbol + " on " + NET_NAME[DESTINATIONS[dest].network];
  const deliverAmt = destToken?.price ? sum.deliveredUsd / Number(destToken.price) : null;
  const cta = !owner ? { label: "Connect your wallets", onClick: connect } : !targetUsd ? { label: "Enter an amount" } : !recipientOk ? { label: `Enter a ${NET_NAME[DESTINATIONS[dest].network]} address to send to` } : !sum.complete ? { label: `Short by ${fmtUsd(sum.shortUsd)}: add a source` } : { label: `Review ${sum.legs.length} transfer${sum.legs.length === 1 ? "" : "s"} and send${example ? " · example" : ""}`, onClick: () => setRun(sum.legs.map((l) => ({ ...l, source: sources.find((s) => s.key === l.key)! }))) };

  if (run && destToken) return <CollectRun legs={run} dest={destToken} recipient={recipient.trim()} target={amount} owner={owner} example={example} back={() => setRun(null)} />;
  return <div className="fv-collect">
    <section className="fv-panel fv-collect-target">
      <div className="fv-section-head"><h2>Collect from many chains, send once</h2>{example && <span className="fv-flow-badge is-turn">Example</span>}</div>
      <p className="fv-muted">Pick what the recipient should get. FlowVault draws it from the holdings you choose across your wallets; each one goes straight to the recipient through NEAR Intents.</p>
      <div className="fv-collect-form">
        <label>Send<span className="fv-collect-amount"><input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setTouched(false); }} aria-label="Amount the recipient gets" /><select value={dest} onChange={(e) => { setDest(Number(e.target.value)); setTouched(false); }} aria-label="Token and network the recipient gets">{DESTINATIONS.map((d, i) => <option key={i} value={i}>{d.symbol} on {NET_NAME[d.network]}</option>)}</select></span></label>
        <label>To<input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={DESTINATIONS[dest].network === "near" ? "their-account.near" : DESTINATIONS[dest].network === "sol" ? "Solana address" : "0x… address"} spellCheck={false} autoComplete="off" />{recipient && !recipientOk && <small className="fv-field-warn">That isn&apos;t a {NET_NAME[DESTINATIONS[dest].network]} address.</small>}</label>
      </div>
    </section>

    <section className="fv-panel fv-collect-sources">
      <div className="fv-section-head"><div><h2>From your wallets</h2><small className="fv-muted">{sources.length} holdings on {new Set(sources.map((s) => s.network)).size} chains{holdings.state !== "ready" && !example ? " · reading…" : ""}</small></div>
        <button type="button" className="fv-button" disabled={!targetUsd} onClick={() => { setTouched(false); auto(); }}><Sparkles size={14} /> Cheapest mix</button></div>
      <div className="fv-collect-table" role="table" aria-label="Holdings to draw from">
        <div className="fv-collect-row fv-collect-head" role="row"><span /><span>Holding</span><span>Balance</span><span>Take</span><span>Gas</span><span>Arrives</span></div>
        {sources.map((s) => {
          const pick = picks.find((p) => p.key === s.key), i = picks.findIndex((p) => p.key === s.key), can = drawable(s);
          const t = tokens.find((x) => x.id === s.tokenId) as SwapToken | undefined;
          const leg = sum.legs.find((l) => l.key === s.key);
          return <div key={s.key} className={"fv-collect-row" + (pick ? " is-on" : "") + (!can ? " is-off" : "")} role="row">
            <span><input type="checkbox" checked={!!pick} disabled={!can} onChange={() => toggle(s)} aria-label={`Use ${s.symbol} on ${NET_NAME[s.network] ?? s.network}`} /></span>
            <span className="fv-collect-holding">{t ? <TokenIcon symbol={t.symbol} network={t.network} core={coreIdentity(t)} image={t.icon} size={28} /> : null}<span><strong>{s.symbol}</strong><small>{NET_NAME[s.network] ?? s.network} · {short(s.account)}{!can ? " · not drawable yet" : ""}</small></span>
              {pick && <span className="fv-collect-order"><button type="button" aria-label="Use earlier" disabled={i === 0} onClick={() => move(s.key, -1)}><ArrowUp size={12} /></button><em>{i + 1}</em><button type="button" aria-label="Use later" disabled={i === picks.length - 1} onClick={() => move(s.key, 1)}><ArrowDown size={12} /></button></span>}</span>
            <span className="fv-num"><strong>{fmtAmount(decimal(BigInt(s.balanceRaw), s.decimals), 4)}</strong><small>{fmtUsd(usdOf(s, s.balanceRaw))}</small></span>
            <span>{pick ? <input className="fv-collect-take" inputMode="decimal" value={trimZeros(decimal(BigInt(pick.amountRaw), s.decimals).replace(/(\.\d{6})\d+$/, "$1"))} onChange={(e) => setAmountFor(s, e.target.value.replace(/[^\d.]/g, ""))} aria-label={`Amount of ${s.symbol} to take`} /> : <small className="fv-muted">—</small>}</span>
            <span className="fv-num"><small>{pick ? "~" + fmtUsd(s.gasUsd) : "~" + fmtUsd(s.gasUsd)}</small></span>
            <span className="fv-num">{leg ? <strong>{fmtUsd(leg.outUsd)}</strong> : <small className="fv-muted">—</small>}</span>
          </div>;
        })}
        {!sources.length && <p className="fv-muted fv-collect-empty">{owner ? "Reading your wallets…" : "Connect your wallets to see what you can draw from."}</p>}
      </div>
    </section>

    <section className={"fv-panel fv-collect-total" + (sum.complete ? " is-complete" : "")} aria-live="polite">
      <div className="fv-collect-sum">
        <span className={"fv-collect-tick" + (sum.complete ? " is-on" : "")}>{sum.complete ? <Check size={18} /> : <CircleAlert size={16} />}</span>
        <div><strong>{targetUsd ? <>Collected ≈ {fmtUsd(sum.deliveredUsd)} of {fmtUsd(targetUsd)}</> : "Enter what the recipient gets"}</strong>
          <small>{sum.complete ? `Target met. The recipient gets ≈ ${fmtAmount(String(deliverAmt ?? 0), 4)} ${destName}${sum.overUsd > 0.02 ? ` (${fmtUsd(sum.overUsd)} over)` : ""}.` : targetUsd ? `Short by ${fmtUsd(sum.shortUsd)}. Tick another holding or raise an amount.` : " "}</small></div>
      </div>
      <div className="fv-collect-facts"><div><span>Transfers</span><strong>{sum.legs.length}</strong></div><div><span>Chains</span><strong>{chains}</strong></div><div><span>Gas, all chains</span><strong>~{fmtUsd(sum.gasUsd)}</strong></div></div>
      <button type="button" className="fv-button fv-primary fv-wide-button" disabled={!cta.onClick} onClick={cta.onClick}><Send size={15} /> {cta.label}</button>
      <small className="fv-muted">{example ? "Example workspace: fictional balances and estimated rates. Sending plays a simulation; nothing is signed." : "Estimates for choosing. Each transfer gets a live quote with a guaranteed minimum before your wallet opens."}</small>
    </section>
  </div>;
}
const trimZeros = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
