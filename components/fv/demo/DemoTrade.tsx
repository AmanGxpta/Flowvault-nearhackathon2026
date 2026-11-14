"use client";
// Demo Mode token trades (any DexScreener token through LI.FI): the example's EVM and Solana wallets pay, the quote is
// an estimate from the token's live price and the pay token's example price (the live LI.FI quote needs your own
// wallets), and the review plays the labelled example wallet. Nothing is signed; the trade lands in the session log.
import { useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { ReviewFrame } from "../ReviewFrame";
import { HazardScan } from "../approvals/HazardScan";
import { fmtAmount, fmtUsd } from "../swap-format";
import { demoLedger, saveDemoLedger, simulateApproval } from "./ledger-store";
import { examplePasses, exampleChecks } from "@/lib/flowvault/demo-sim";
import { exampleWalletHoldings } from "@/lib/flowvault/example-wallets";
import { SOLANA_ID } from "@/lib/flowvault/trade-lifi";

const CHAIN_ID: Record<string, number> = { eth: 1, base: 8453, arb: 42161, bsc: 56, op: 10, pol: 137, avax: 43114, sol: SOLANA_ID };
const CHAIN_LABEL: Record<string, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum", bsc: "BNB Chain", op: "Optimism", pol: "Polygon", avax: "Avalanche", sol: "Solana" };
const PAY = ["ETH", "USDC", "USDT", "SOL", "BNB", "POL"];
export const LIFI_FEE = 0.0025;

/** What the example wallets can pay with for a token on this chain family, with balances and example unit prices. */
export function demoTradeOptions(solana: boolean) {
  return exampleWalletHoldings()
    .filter((h) => (solana ? h.network === "sol" : h.network !== "sol" && h.network !== "near") && PAY.includes(h.symbol.toUpperCase()) && CHAIN_ID[h.network] && Number(h.amount) > 0)
    .map((h) => ({ chainId: CHAIN_ID[h.network], chain: CHAIN_LABEL[h.network] ?? h.network, token: h.network + ":" + h.symbol, symbol: h.symbol, decimals: /USD/.test(h.symbol) ? 6 : 18, logo: null, balances: [{ address: h.account, amount: h.amount }], unit: Number(h.usd) / Number(h.amount) }))
    .sort((a, b) => Number(b.balances[0].amount) * b.unit - Number(a.balances[0].amount) * a.unit);
}
/** An example quote: the value in, less the routing fee, at the token's live price; the minimum applies slippage. */
export function demoTradeQuote(o: { side: "buy" | "sell"; amount: number; payUnit: number; tokenPrice: number; slippageBps: number; payBalance: number; heldToken: number }) {
  const inUsd = o.side === "buy" ? o.amount * o.payUnit : o.amount * o.tokenPrice;
  const outUsd = inUsd * (1 - LIFI_FEE);
  const output = o.side === "buy" ? outUsd / o.tokenPrice : outUsd / o.payUnit;
  return { output, minimum: output * (1 - o.slippageBps / 10_000), fromUsd: inUsd, toUsd: outUsd, feeUsd: inUsd * LIFI_FEE, enough: o.side === "buy" ? o.amount <= o.payBalance + 1e-12 : o.amount <= o.heldToken + 1e-12 };
}

export function DemoTradeReview({ side, symbol, paySymbol, chain, amount, q, slippageBps, close }: { side: "buy" | "sell"; symbol: string; paySymbol: string; chain: string; amount: number; q: ReturnType<typeof demoTradeQuote>; slippageBps: number; close: () => void }) {
  const [phase, setPhase] = useState<"review" | "wallet" | "settling" | "done">("review"), [hash, setHash] = useState("");
  const busy = phase === "wallet" || phase === "settling";
  const [inSym, outSym] = side === "buy" ? [paySymbol, symbol] : [symbol, paySymbol];
  function approve() {
    simulateApproval("demo-trade-" + crypto.randomUUID(), {
      wallet: () => setPhase("wallet"), submitted: (h) => { setHash(h); setPhase("settling"); },
      landed: () => { const l = demoLedger(); saveDemoLedger({ ...l, activity: [{ at: Date.now(), text: `${side === "buy" ? "Bought" : "Sold"} ${fmtAmount(String(side === "buy" ? q.output : amount))} ${symbol} for ${fmtAmount(String(side === "buy" ? amount : q.output))} ${paySymbol} on ${chain} via LI.FI` }, ...l.activity].slice(0, 50) }); setPhase("done"); },
    }, { wallet: 1500, settle: 3500 });
  }
  const checks = exampleChecks(q.fromUsd, [{ id: "slippage", label: `Minimum received within ${slippageBps / 100}% slippage`, ok: true }, { id: "approval", label: "Exact-amount token approval, not unlimited", ok: true }, { id: "fresh", label: "Price from the live pool", ok: true }]), allowed = examplePasses(checks);
  return <ReviewFrame busy={busy} close={close} className="fv-dialog fv-swap-confirm" label={`Example ${side} ${symbol}`}>
    {!busy && <button type="button" className="fv-icon-button fv-confirm-close" aria-label="Close" onClick={close}><X size={18} /></button>}
    <h2>{phase === "review" ? `${side === "buy" ? "Buy" : "Sell"} ${symbol}` : phase === "wallet" ? "Example wallet approving…" : phase === "settling" ? "Settling" : side === "buy" ? "Bought" : "Sold"}</h2>
    <p className="fv-confirm-sub">Example workspace: an estimate at the token’s live price with the example wallets. The live LI.FI route needs your own wallets; nothing is signed here.</p>
    <div className="fv-confirm-table">
      <div><span>You pay</span><strong>{fmtAmount(String(amount))} {inSym} <small>· {fmtUsd(q.fromUsd)}</small></strong></div>
      <div><span>You receive</span><strong>≈ {fmtAmount(String(q.output))} {outSym} <small>· {fmtUsd(q.toUsd)}</small></strong></div>
      <div><span>Minimum</span><strong>{fmtAmount(String(q.minimum))} {outSym} <small>· {slippageBps / 100}% slippage</small></strong></div>
      <div><span>Route</span><strong>LI.FI · {chain} · fee {fmtUsd(q.feeUsd)} included</strong></div>
      {hash && <div><span>Transaction</span><strong className="fv-demo-hash">{hash} <small>(example, not on chain)</small></strong></div>}
    </div>
    {phase === "review" && <HazardScan checks={checks} />}
    {phase === "done" && <div className="fv-confirm-success"><Check size={18} /> Example: {side === "buy" ? "bought" : "sold"} ≈ {fmtAmount(String(side === "buy" ? q.output : amount))} {symbol}. It’s in this session’s activity.</div>}
    <div className="fv-confirm-actions">
      {phase === "review" ? (allowed ? <button type="button" className="fv-button fv-primary fv-wide-button" onClick={approve}>Approve in wallet · example</button> : <button type="button" className="fv-button fv-wide-button" disabled>Refused by your policy · example</button>)
        : busy ? <button type="button" className="fv-button fv-primary fv-wide-button" disabled><RefreshCw size={15} className="fv-spin" /> {phase === "wallet" ? "Waiting for the example wallet…" : "Settling…"}</button>
        : <button type="button" className="fv-button fv-primary fv-wide-button" onClick={close}>Done</button>}
    </div>
  </ReviewFrame>;
}
