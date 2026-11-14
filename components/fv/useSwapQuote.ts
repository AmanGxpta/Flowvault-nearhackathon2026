"use client";
// Live swap quoting shared by the Swap screen and Ask FlowVault's swap cards: debounced dry quotes as inputs change,
// stale answers ignored, a fresh quote when the old one expires (unless a review is open), and routes ranked by
// exact output in the output token's units.
import { useEffect, useRef, useState } from "react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import { units } from "@/lib/flowvault/money";
import type { useWalletBalances } from "./useWalletBalances";

export interface SwapRoute { venue: string; output: string; minimum: string; eta: number | null; execution: string; url: string; feeNote: string }
export interface SwapPreview { routes: SwapRoute[]; warnings: string[]; expiresAt: string; capturedAt: string }
/** Networks where one Ethereum-style address receives (an EVM wallet serves all of them). */
export const EVM_NETWORKS = ["eth", "base", "arb", "bsc", "op", "pol", "avax", "gnosis", "hypercore", "hood", "abs", "bera", "monad", "scroll", "xlayer", "plasma"];
const rawOf = (v: string, decimals: number) => { try { return units(v, decimals); } catch { return 0n; } };

/** The owner's address on a network: the wallet that holds the token, else their address for that network family. */
export function ownAddress(holdings: ReturnType<typeof useWalletBalances>, n?: string) {
  return !n ? "" : holdings.addresses[n] ?? (EVM_NETWORKS.includes(n) ? holdings.addresses.eth ?? holdings.addresses.base ?? holdings.addresses.arb ?? "" : "");
}
/** Rhea / Ref swaps NEAR tokens; NEAR Intents deposits from NEAR, Ethereum, Base or Arbitrum. Both run in FlowVault. */
export function runsInApp(r: SwapRoute | undefined, from?: SwapToken, to?: SwapToken, sender?: string, recipient?: string) {
  if (!r || !from || !to) return false;
  if (r.venue === "Rhea / Ref") return from.network === "near" && to.network === "near";
  return r.venue === "NEAR Intents" && (["near", "eth", "base", "arb", "bsc", "pol"].includes(from.network) || from.network === "sol" && from.contract === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") && !!sender && !!recipient;
}

export function useSwapQuote(o: { tokens: SwapToken[]; holdings: ReturnType<typeof useWalletBalances>; owner: string; example: boolean; fromId: string; toId: string; amount: string; slippage: string; sender: string; recipient: string; paused: boolean }) {
  const { tokens, holdings, owner, example, fromId, toId, amount, slippage, sender, recipient, paused } = o;
  const [preview, setPreview] = useState<SwapPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [now, setNow] = useState(() => Date.now());
  const request = useRef<AbortController | null>(null), revision = useRef(0);
  const from = tokens.find(t => t.id === fromId), to = tokens.find(t => t.id === toId);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); request.current?.abort(); }; }, []);
  const validAmount = (() => { if (!from || !amount) return false; try { return units(amount, from.decimals) > 0n; } catch { return false; } })();
  // Paying from another network needs the sending wallet's address; wait for the wallet read instead of quoting without it.
  const waitingForWallet = !!from && from.network !== "near" && !sender && !!owner && !example && !holdings.covered.has(from.network);

  async function quote() {
    revision.current++; request.current?.abort();
    const version = revision.current, abort = new AbortController(); request.current = abort;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: fromId, to: toId, amount, slippage: Number(slippage), sender, recipient }), signal: abort.signal });
      const b = await r.json() as SwapPreview & { error?: string };
      if (!r.ok) throw new Error(b.error);
      if (version === revision.current) { setPreview(b); setNow(Date.now()); }
    } catch (e) { if (!abort.signal.aborted && version === revision.current) { setPreview(null); setError((e as Error).message); } }
    finally { if (version === revision.current) setBusy(false); }
  }
  useEffect(() => {
    revision.current++; request.current?.abort();
    const t = setTimeout(() => { setPreview(null); setSelected(null); setError(""); if (validAmount && from && to && fromId !== toId && !waitingForWallet) void quote(); else setBusy(false); }, validAmount ? 550 : 0);
    return () => clearTimeout(t);
  }, [fromId, toId, amount, slippage, sender, recipient, validAmount, !!from, !!to]); // eslint-disable-line react-hooks/exhaustive-deps -- quote reads the same inputs
  const expires = preview ? Math.max(0, Math.floor((Date.parse(preview.expiresAt) - now) / 1000)) : 0;
  useEffect(() => {
    if (!(preview && expires === 0 && !busy && !paused && validAmount)) return;
    const t = setTimeout(() => void quote(), 0); return () => clearTimeout(t);
  }, [expires, preview, busy, paused, validAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  const toDecimals = to?.decimals;
  const routes = !preview || toDecimals === undefined ? [] : [...preview.routes].sort((a, b) => { const x = rawOf(a.output, toDecimals), y = rawOf(b.output, toDecimals); return x === y ? 0 : x > y ? -1 : 1; });
  const best = routes[0];
  const chosen = routes.find(r => r.venue === selected) ?? best;
  return { from, to, preview, busy, error, routes, best, chosen, selected, setSelected, expires, validAmount, waitingForWallet, quote, rawOf };
}
