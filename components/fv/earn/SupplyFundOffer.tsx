"use client";
// "Do you want me to swap it into this and supply?" When you open a Rhea market you don't hold (or hold too little of),
// FlowVault proposes the swap itself: your most valuable holding NEAR Intents can pay from, a live quote for what
// arrives, the APY and a yearly estimate, and one Yes that starts a resumable swap-then-supply flow. Nothing moves
// until you approve each step in your wallet.
import { useMemo, useState } from "react";
import { ArrowRight, RefreshCw, Repeat } from "lucide-react";
import { api } from "../live";
import { TokenPicker } from "../TokenPicker";
import { useTokenCatalog } from "../useTokenCatalog";
import { useWalletBalances } from "../useWalletBalances";
import { useSwapQuote, ownAddress } from "../useSwapQuote";
import { fmtAmount, fmtUsd } from "../swap-format";
import { decimal, units } from "@/lib/flowvault/money";
import { defaultSource } from "@/lib/flowvault/supply-flow";
import { EXAMPLE_NEAR_ACCOUNT } from "@/lib/flowvault/example-wallets";
import { demoId, demoPut } from "../demo/demo-store";
import type { DemoSupplyRow } from "./SupplyFlowView";

const PAY_NETWORKS = ["near", "eth", "base", "arb", "bsc", "pol", "sol"];
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NET: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", bsc: "BNB Chain", pol: "Polygon", sol: "Solana" };

export function SupplyFundOffer({ tokenId, symbol, apy, owner: liveOwner, example, held, onFlow, connect }: {
  tokenId: string; symbol: string; apy: number | null; owner: string; example: boolean;
  /** What you already hold of this token on NEAR (display units), or null when unread. */
  held: string | null;
  onFlow: (id: string) => void; connect?: () => void;
}) {
  const { tokens } = useTokenCatalog();
  // Demo Mode: the example workspace's fictional wallets stand in for yours.
  const owner = example ? EXAMPLE_NEAR_ACCOUNT : liveOwner;
  const holdings = useWalletBalances(owner, tokens, !!owner, example);
  const target = tokens.find((t) => t.network === "near" && t.contract === tokenId && !!t.assetId);
  // Pay with anything you hold that NEAR Intents can take, except the token itself.
  const payable = useMemo(() => tokens.filter((t) => !!t.assetId && PAY_NETWORKS.includes(t.network) && (example || t.network !== "sol" || t.contract === SOLANA_USDC) && t.id !== target?.id && BigInt(holdings.balances[t.id]?.raw ?? "0") > 0n), [tokens, holdings.balances, target?.id]);
  // Rank by value: the wallet's own valuation, else the catalog price, so the pick doesn't depend on which read lands first.
  const suggestion = useMemo(() => defaultSource(payable.map((t) => { const b = holdings.balances[t.id]; return { token: t, raw: b?.largestRaw ?? b?.raw ?? "0", usd: b?.usd ?? (t.price && b ? String(Number(b.amount) * Number(t.price)) : null) }; })), [payable, holdings.balances]);
  const [picked, setPicked] = useState<string | null>(null), [typed, setTyped] = useState<string | null>(null);
  const fromId = picked ?? suggestion?.token.id ?? "";
  const from = payable.find((t) => t.id === fromId);
  const amount = typed ?? (picked ? "" : suggestion?.amount ?? "");
  const bal = from ? holdings.balances[from.id] : undefined;
  // A payment leaves one wallet: the one holding the most of this token. Size everything against that wallet.
  const walletRaw = bal ? bal.largestRaw ?? bal.raw : "0";
  const walletAmount = from && bal ? decimal(BigInt(walletRaw), from.decimals) : null;
  const sender = from ? (from.network === "near" ? owner : bal?.account ?? ownAddress(holdings, from.network)) : "";
  const q = useSwapQuote({ tokens, holdings, owner, example, fromId, toId: target?.id ?? "", amount, slippage: "100", sender, recipient: owner, paused: !target || !from });
  const live = q.routes.find((r) => r.venue === "NEAR Intents");
  // Demo Mode can't always get a live quote for fictional wallets: estimate from catalog prices, labelled as such.
  const estimate = example && !live && from && target?.price && from.price && Number(amount) > 0 ? (Number(amount) * Number(from.price) / Number(target.price) * 0.997).toFixed(Math.min(6, target.decimals)) : null;
  const intents = live ?? (estimate ? { venue: "NEAR Intents", output: estimate } : undefined);
  const expectedRaw = (() => { try { return intents && target ? units(intents.output, target.decimals) : null; } catch { return null; } })();
  const yearly = intents && target?.price && apy !== null ? Number(intents.output) * Number(target.price) * apy / 100 : null;
  const over = (() => { try { return !!from && !!bal && units(amount, from.decimals) > BigInt(walletRaw); } catch { return false; } })();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  async function start() {
    if (!from || !target) return;
    setBusy(true); setError("");
    if (example) {
      const at = new Date().toISOString(), id = demoId();
      const row: DemoSupplyRow = { id, kind: "supply", updatedAt: 0, payAt: null, supplyAt: null, flow: { id, accountId: owner, tokenId, symbol, decimals: target.decimals, apy, source: { from: from.id, fromSymbol: from.symbol, fromNetwork: NET[from.network] ?? from.network, amount, expectedRaw: expectedRaw?.toString() ?? null }, createdAt: at, updatedAt: at, cancelledAt: null, links: {} } };
      demoPut(row); setBusy(false); onFlow(id); return;
    }
    try {
      const r = await api("/api/lend/flows", { op: "create", key: crypto.randomUUID(), tokenId, symbol, apy, from: from.id, amount, expectedRaw: expectedRaw?.toString() ?? null }) as { flow: { id: string } };
      onFlow(r.flow.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const none = held === null || Number(held) === 0;
  const head = none ? `You don't hold any ${symbol} on NEAR yet` : `You have ${fmtAmount(held)} ${symbol} on NEAR`;
  if (!owner) return <div className="fv-fund-offer"><strong>{head}</strong><p>Connect your wallet and FlowVault can swap something you hold into {symbol}, then supply it.</p>{connect && <button type="button" className="fv-button fv-primary" onClick={connect}>Connect wallet</button>}</div>;
  if (tokens.length && !target) return <div className="fv-fund-offer"><strong>{head}</strong><p>NEAR Intents can&apos;t deliver {symbol}, so FlowVault can&apos;t swap into it here. Swap into it on the Swap page, then supply.</p></div>;
  if (holdings.state !== "ready" && !payable.length) return <div className="fv-fund-offer"><strong>{head}</strong><p className="fv-muted"><RefreshCw size={13} className="fv-spin" /> Looking at what you hold…</p></div>;
  if (!payable.length) return <div className="fv-fund-offer"><strong>{head}</strong><p>Nothing in your connected wallets on NEAR, Ethereum, Base or Arbitrum can pay for a swap into {symbol} right now.</p></div>;

  const cta = example && from && intents ? `Yes, swap and supply ${symbol} · example` : !from ? "Choose what to pay with" : over ? `That wallet holds ${fmtAmount(walletAmount)} ${from.symbol}` : !sender ? `Connect your ${NET[from.network]} wallet` : q.busy && !intents ? "Getting a quote…" : !intents ? (q.error || "No route for this amount") : `Yes, swap and supply ${symbol}`;
  return <div className="fv-fund-offer is-open">
    <strong>{head}</strong>
    <p className="fv-fund-ask">{from && intents
      ? <>Swap {fmtAmount(amount)} {from.symbol}{from.network === "near" ? "" : " on " + NET[from.network]} into <b>≈ {fmtAmount(intents.output, 4)} {symbol}</b> and supply it{apy !== null ? <> at <b>{apy.toFixed(2)}% APY</b></> : null}{yearly !== null ? <> (≈ {fmtUsd(yearly)} a year, variable)</> : null}?</>
      : <>FlowVault can swap something you hold into {symbol} and supply it in one flow.</>}</p>
    <div className="fv-swap-amount fv-trade-box fv-fund-box">
      <div className="fv-swap-box-head"><label htmlFor="fund-amount">Pay with</label>{bal && walletAmount ? <span className="fv-swap-balance">{fmtAmount(walletAmount)} {from?.symbol}{from && from.network !== "near" && sender ? <small> in {sender.slice(0, 6)}…{sender.slice(-4)}</small> : null}{from && <button type="button" onClick={() => setTyped(from.contract === "native" ? defaultSource([{ token: from, raw: walletRaw, usd: bal.usd }])?.amount ?? "" : walletAmount)}>Max</button>}</span> : null}</div>
      <div className="fv-swap-line"><input id="fund-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={(e) => setTyped(e.target.value.replace(/[^\d.]/g, ""))} />
        <TokenPicker label="Pay with" tokens={payable} balances={holdings.balances} covered={holdings.covered} value={from} onChange={(t) => { const b = holdings.balances[t.id]; setPicked(t.id); setTyped(b ? defaultSource([{ token: t, raw: b.largestRaw ?? b.raw, usd: b.usd }])?.amount ?? "" : ""); }} /></div>
    </div>
    <ol className="fv-fund-steps"><li><Repeat size={13} /> NEAR Intents delivers {symbol} to {owner.length > 22 ? owner.slice(0, 19) + "…" : owner}</li><li><ArrowRight size={13} /> You sign once to supply exactly what arrived</li></ol>
    {error && <p className="fv-notice" role="alert">{error}</p>}
    <button type="button" className="fv-button fv-primary fv-wide-button" disabled={busy || !from || over || (!!sender && !intents)} onClick={() => (!sender ? connect?.() : void start())}>{busy ? <><RefreshCw size={15} className="fv-spin" /> Starting…</> : cta}</button>
    <small className="fv-muted">{example ? "Example workspace: fictional balances and an estimated rate. The flow is a simulation; nothing is signed." : "Two approvals in your wallet: the payment, then the supply. Nothing moves until you approve."}</small>
  </div>;
}
