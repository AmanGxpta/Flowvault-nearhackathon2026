"use client";
// The collect-and-send run: every transfer drawn as a line from its chain to the recipient, moving while money moves,
// one row per transfer with its status and, opened, everything that matters about it (transaction ids, confirmations,
// gas, expected time, finality, the wallet's balance before and after, what arrived). At the bottom, the target with
// a green tick once the recipient has it, and the gas paid across all chains.
// Live: transfers are approved one after another in the wallet that holds each one (FlowVault never signs).
// Demo Mode: the same run plays as a labelled simulation.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronDown, CircleAlert, RefreshCw } from "lucide-react";
import { TokenIcon } from "../AssetIdentity";
import { coreIdentity, useTokenCatalog } from "../useTokenCatalog";
import { SwapReview } from "../SwapReview";
import { api } from "../live";
import { fmtAmount, fmtUsd } from "../swap-format";
import { decimal } from "@/lib/flowvault/money";
import { exampleHash } from "@/lib/flowvault/demo-sim";
import type { CollectSource } from "@/lib/flowvault/collect";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { NET_NAME } from "./CollectSend";

export interface RunLeg { key: string; amountRaw: string; inUsd: number; outUsd: number; gasUsd: number; source: CollectSource }
type LegState = "waiting" | "signing" | "moving" | "done" | "failed";
interface LegView { state: LegState; originHash: string | null; destHash: string | null; confirmations: number; needed: number; etaS: number; leftS: number; final: boolean; deliveredUsd: number | null; deliveredRaw: string | null; note: string }

/** Typical settle times and confirmations by chain, for the example run and for ETA hints. */
const PROFILE: Record<string, { s: number; conf: number }> = { near: { s: 4, conf: 1 }, sol: { s: 6, conf: 32 }, base: { s: 8, conf: 10 }, arb: { s: 8, conf: 10 }, pol: { s: 10, conf: 30 }, bsc: { s: 10, conf: 15 }, op: { s: 8, conf: 10 }, eth: { s: 16, conf: 12 } };
const prof = (n: string) => PROFILE[n] ?? { s: 10, conf: 12 };
const EXPLORER: Record<string, string> = { eth: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", arb: "https://arbiscan.io/tx/", bsc: "https://bscscan.com/tx/", pol: "https://polygonscan.com/tx/", sol: "https://solscan.io/tx/", near: "https://nearblocks.io/txns/" };

export function CollectRun({ legs, dest, recipient, target, owner, example, back }: { legs: RunLeg[]; dest: SwapToken; recipient: string; target: string; owner: string; example: boolean; back: () => void }) {
  const { tokens } = useTokenCatalog();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const [open, setOpen] = useState<string | null>(null);
  // Example run: approvals happen one after another, as a person would click through each wallet prompt.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Live run: the journal attempt behind each transfer, and its latest reading.
  const [attempts, setAttempts] = useState<Record<string, string>>({}), [reads, setReads] = useState<Record<string, LiveRead>>({}), [active, setActive] = useState(0);

  const views: LegView[] = useMemo(() => legs.map((l, i) => example ? demoLeg(l, i, startedAt, now) : liveLeg(l, reads[l.key], attempts[l.key], i === active)), [legs, example, startedAt, now, reads, attempts, active]);
  useEffect(() => {
    if (example) return;
    const ids = Object.entries(attempts).filter(([k]) => !["done", "failed"].includes(views[legs.findIndex((l) => l.key === k)]?.state ?? ""));
    if (!ids.length) return;
    const t = setInterval(async () => {
      for (const [k, id] of ids) {
        const r = await api("/api/transactions", { id, action: "check" }).catch(() => null) as { attempt?: LiveRead } | null;
        if (r?.attempt) setReads((m) => ({ ...m, [k]: r.attempt! }));
      }
    }, 6000);
    return () => clearInterval(t);
  }, [attempts, example, views, legs]);

  const deliveredUsd = views.reduce((n, v) => n + (v.deliveredUsd ?? 0), 0);
  const targetUsd = Number(target) * Number(dest.price ?? 1);
  const complete = deliveredUsd >= targetUsd - 0.01;
  const done = views.filter((v) => v.state === "done").length, moving = views.filter((v) => v.state === "moving" || v.state === "signing").length;
  const gasPaid = legs.reduce((n, l, i) => n + (views[i].originHash ? l.gasUsd : 0), 0);
  const tok = (l: RunLeg) => tokens.find((t) => t.id === l.source.tokenId);

  return <section className="fv-panel fv-collect-run">
    <div className="fv-stake-flow-top"><button type="button" className="fv-text-button" onClick={back} disabled={!!moving && !example}><ArrowLeft size={14} /> Change sources</button><span className={"fv-flow-badge " + (complete ? "is-ok" : moving ? "is-busy" : "is-turn")}>{example ? "Example · " : ""}{complete ? "Delivered" : moving ? `${moving} moving` : done ? `${done} of ${legs.length} done` : "Ready"}</span></div>
    {example && <p className="fv-demo-note">Example workspace: this run is a simulation with fictional balances. Nothing is signed and nothing moves.</p>}
    <h2>Sending {target} {dest.symbol} on {NET_NAME[dest.network]} to {recipient.length > 22 ? recipient.slice(0, 10) + "…" + recipient.slice(-6) : recipient}</h2>

    <FlowMap legs={legs} views={views} tokens={tokens} dest={dest} recipient={recipient} />

    <ol className="fv-collect-legs">{legs.map((l, i) => { const v = views[i], t = tok(l), isOpen = open === l.key; return <li key={l.key} className={"is-" + v.state}>
      <button type="button" className="fv-collect-leg" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.key)}>
        {t ? <TokenIcon symbol={t.symbol} network={t.network} core={coreIdentity(t)} image={t.icon} size={28} /> : null}
        <span className="fv-collect-leg-main"><strong>{fmtAmount(decimal(BigInt(l.amountRaw), l.source.decimals), 6)} {l.source.symbol} on {NET_NAME[l.source.network] ?? l.source.network}</strong><small>{v.note}</small></span>
        <span className={"fv-collect-chip is-" + v.state}>{v.state === "moving" || v.state === "signing" ? <RefreshCw size={11} className="fv-spin" /> : v.state === "done" ? <Check size={11} /> : v.state === "failed" ? <CircleAlert size={11} /> : null}{LABEL[v.state]}</span>
        <ChevronDown size={15} className="fv-collect-caret" />
      </button>
      {isOpen && <div className="fv-collect-detail">
        <div><span>Origin transaction</span><strong>{v.originHash ? <HashText h={v.originHash} network={l.source.network} example={example} /> : "—"}</strong></div>
        <div><span>Confirmations</span><strong>{v.originHash ? `${Math.min(v.confirmations, v.needed)} of ${v.needed}` : "—"}</strong></div>
        <div><span>Network fee</span><strong>{v.originHash ? "" : "~"}{fmtUsd(l.gasUsd)} in {nativeOf(l.source.network)}</strong></div>
        <div><span>Expected time</span><strong>{v.state === "done" ? "arrived" : v.state === "moving" ? `~${v.leftS}s left` : `~${v.etaS}s once sent`}</strong></div>
        <div><span>Finality</span><strong>{v.final ? "Final" : v.originHash ? "Not final yet" : "—"}</strong></div>
        <div><span>Wallet balance</span><strong>{fmtAmount(decimal(BigInt(l.source.balanceRaw), l.source.decimals), 6)} → {fmtAmount(decimal(BigInt(l.source.balanceRaw) - (v.originHash ? BigInt(l.amountRaw) : 0n), l.source.decimals), 6)} {l.source.symbol}{v.originHash ? "" : " after"}</strong></div>
        <div><span>Arrives as</span><strong>{v.deliveredUsd !== null ? fmtAmount(String(v.deliveredUsd / Number(dest.price ?? 1)), 4) : "≈ " + fmtAmount(String(l.outUsd / Number(dest.price ?? 1)), 4)} {dest.symbol}{v.destHash ? <> · <HashText h={v.destHash} network={dest.network} example={example} /></> : null}</strong></div>
      </div>}
      {!example && i === active && v.state === "signing" && t && <div className="fv-collect-sign">
        <SwapReview inline from={t} to={dest} amount={decimal(BigInt(l.amountRaw), l.source.decimals)} slippage={100} route="intents" sender={l.source.account} recipient={recipient}
          close={() => undefined} onSettled={() => setActive((n) => n + 1)} onAttempt={(a) => { setAttempts((m) => ({ ...m, [l.key]: a.id })); }} />
      </div>}
    </li>; })}</ol>

    <div className={"fv-collect-total-run" + (complete ? " is-complete" : "")}>
      <span className={"fv-collect-tick" + (complete ? " is-on" : "")}>{complete ? <Check size={18} /> : <RefreshCw size={15} className={moving ? "fv-spin" : ""} />}</span>
      <div><strong>{fmtAmount(String(deliveredUsd / Number(dest.price ?? 1)), 4)} of {target} {dest.symbol} delivered</strong><small>Gas paid across {new Set(legs.filter((_, i) => views[i].originHash).map((l) => l.source.network)).size} chains: {fmtUsd(gasPaid)} · {done} of {legs.length} transfers done</small></div>
      {example && startedAt === null && <button type="button" className="fv-button fv-primary" onClick={() => setStartedAt(Date.now())}>Approve {legs.length} transfers · example</button>}
      {!example && active >= legs.length && complete && <button type="button" className="fv-button" onClick={back}>Done</button>}
    </div>
    {!example && <small className="fv-muted">Each transfer opens in the wallet that holds it, one after another. Every one is checked against your limits and the recipient against your permissions first.{owner ? "" : ""}</small>}
  </section>;
}

const LABEL: Record<LegState, string> = { waiting: "Waiting", signing: "In your wallet", moving: "Moving", done: "Arrived", failed: "Needs attention" };
const nativeOf = (n: string) => ({ eth: "ETH", base: "ETH", arb: "ETH", op: "ETH", bsc: "BNB", pol: "POL", sol: "SOL", near: "NEAR" } as Record<string, string>)[n] ?? "gas";
function HashText({ h, network, example }: { h: string; network: string; example: boolean }) {
  const s = h.length > 18 ? h.slice(0, 10) + "…" + h.slice(-6) : h;
  return example || !EXPLORER[network] ? <span className="fv-demo-hash">{s}{example ? " (example)" : ""}</span> : <a href={EXPLORER[network] + h} target="_blank" rel="noopener noreferrer">{s}</a>;
}

/** Example run: leg i is approved 1.4s after the one before; it then settles at its chain's typical pace. */
function demoLeg(l: RunLeg, i: number, startedAt: number | null, now: number): LegView {
  const p = prof(l.source.network), etaS = p.s * 3;
  const base: LegView = { state: "waiting", originHash: null, destHash: null, confirmations: 0, needed: p.conf, etaS, leftS: etaS, final: false, deliveredUsd: null, deliveredRaw: null, note: "Waiting to be approved" };
  if (startedAt === null) return base;
  const approved = startedAt + i * 1400, signed = approved + 1200, landed = signed + p.s * 1000;
  if (now < approved) return { ...base, note: "Next in line for your wallet" };
  if (now < signed) return { ...base, state: "signing", note: "Example: approving in the wallet…" };
  const originHash = exampleHash(l.key + ":origin"), frac = Math.min(1, (now - signed) / (landed - signed));
  if (now < landed) return { ...base, state: "moving", originHash, confirmations: Math.max(1, Math.round(frac * p.conf)), leftS: Math.max(1, Math.ceil((landed - now) / 1000) * 3), note: `Sent · NEAR Intents is delivering to the recipient` };
  const deliveredUsd = l.outUsd * (1 - 0.0008);
  return { ...base, state: "done", originHash, destHash: exampleHash(l.key + ":dest"), confirmations: p.conf, leftS: 0, final: true, deliveredUsd, note: `Arrived · ${fmtUsd(deliveredUsd)} delivered` };
}

interface LiveRead { state: string; message: string; hashes: string[]; preparation?: { result?: { deliveredRaw?: string | null; destinationHashes?: string[] } | null; to?: { decimals: number }; eta?: number | null } }
function liveLeg(l: RunLeg, r: LiveRead | undefined, attemptId: string | undefined, isActive: boolean): LegView {
  const p = prof(l.source.network);
  const base: LegView = { state: "waiting", originHash: null, destHash: null, confirmations: 0, needed: p.conf, etaS: p.s * 3, leftS: p.s * 3, final: false, deliveredUsd: null, deliveredRaw: null, note: isActive ? "Your turn: review and approve" : "Waiting for the transfer before it" };
  if (!r) return attemptId || isActive ? { ...base, state: "signing", note: "Review and approve in your wallet" } : base;
  const res = r.preparation?.result, delivered = res?.deliveredRaw ?? null, dec = r.preparation?.to?.decimals ?? 6;
  const deliveredUsd = delivered ? Number(decimal(BigInt(delivered), dec)) : null;
  if (r.state === "confirmed" || r.state === "partial") return { ...base, state: "done", originHash: r.hashes[0] ?? null, destHash: res?.destinationHashes?.[0] ?? null, confirmations: p.conf, final: true, deliveredUsd, deliveredRaw: delivered, leftS: 0, note: r.message };
  if (r.state === "failed") return { ...base, state: "failed", originHash: r.hashes[0] ?? null, note: r.message };
  if (r.hashes.length) return { ...base, state: "moving", originHash: r.hashes[0], confirmations: 1, note: r.message || "Sent · delivering" };
  return { ...base, state: "signing", note: r.message || "In your wallet" };
}

function FlowMap({ legs, views, tokens, dest, recipient }: { legs: RunLeg[]; views: LegView[]; tokens: SwapToken[]; dest: SwapToken; recipient: string }) {
  const rowH = 46, h = Math.max(legs.length * rowH, 120), cy = h / 2;
  return <div className="fv-collect-map" style={{ height: h }} aria-hidden>
    <svg viewBox={`0 0 600 ${h}`} preserveAspectRatio="none">
      {legs.map((l, i) => { const y = i * rowH + rowH / 2, v = views[i]; return <path key={l.key} d={`M 118 ${y} C 320 ${y}, 330 ${cy}, 520 ${cy}`} className={"fv-collect-path is-" + v.state} vectorEffect="non-scaling-stroke" />; })}
    </svg>
    <div className="fv-collect-map-sources">{legs.map((l, i) => { const t = tokens.find((x) => x.id === l.source.tokenId); return <div key={l.key} className={"fv-collect-node is-" + views[i].state} style={{ top: i * rowH + rowH / 2 }}>{t ? <TokenIcon symbol={t.symbol} network={t.network} core={coreIdentity(t)} image={t.icon} size={24} /> : null}<span>{NET_NAME[l.source.network] ?? l.source.network}</span></div>; })}</div>
    <div className="fv-collect-node is-recipient" style={{ top: cy }}><TokenIcon symbol={dest.symbol} network={dest.network} core={coreIdentity(dest)} image={dest.icon} size={30} /><span>{recipient.length > 14 ? recipient.slice(0, 6) + "…" + recipient.slice(-4) : recipient}</span></div>
  </div>;
}
