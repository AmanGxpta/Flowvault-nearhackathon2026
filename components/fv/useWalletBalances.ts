"use client";
import { useCallback, useEffect, useState } from "react";
import type { SwapToken } from "@/lib/flowvault/swap-explorer";
import type { Holding } from "./TokenPicker";
import { useNearHoldings } from "./useNearHoldings";
import { api } from "./live";
import { units, decimal } from "@/lib/flowvault/money";

const CHAIN_TO_NETWORK: Record<string, string> = { eth: "eth", base: "base", arb: "arb", solana: "sol" };

/** Balances of every connected wallet, keyed by swap-catalog id: the NEAR account's full token inventory (public
 * research read) plus the ETH/SOL and USDC that the portfolio reads for proven Ethereum, Base, Arbitrum and Solana
 * wallets. Each holding remembers which address holds it, so a swap can send from that wallet. `covered` lists
 * the networks that were actually read; elsewhere a missing balance means "not read", never zero. */
export function useWalletBalances(nearAccount: string, tokens: SwapToken[], enabled = true) {
  const near = useNearHoldings(enabled ? nearAccount : "");
  const [evm, setEvm] = useState<{ balances: Record<string, Holding>; addresses: Record<string, string>; covered: string[] }>({ balances: {}, addresses: {}, covered: [] });
  const [tick, setTick] = useState(0);
  const read = useCallback(async () => {
    if (!enabled || !tokens.length) return;
    try {
      const r = await api("/api/portfolio", undefined, "GET");
      const p = r.portfolio ?? r;
      const values = new Map<string, string>((p.capital?.valuations ?? []).filter((v: any) => /^\d+$/.test(String(v.usdcRaw ?? ""))).map((v: any) => [v.positionId, v.usdcRaw])); // eslint-disable-line @typescript-eslint/no-explicit-any
      const balances: Record<string, Holding> = {}, addresses: Record<string, string> = {}, covered = new Set<string>();
      for (const pos of (p.positions ?? []) as { id: string; asset: string; chain?: string; amount: string; accountId?: string; ownership?: string; kind?: string }[]) {
        const network = CHAIN_TO_NETWORK[pos.chain ?? ""];
        if (!network || pos.ownership === "watched" || (pos.kind && pos.kind !== "wallet") || !pos.accountId) continue;
        covered.add(network);
        addresses[network] ??= pos.accountId;
        const native = pos.asset === "ETH" || pos.asset === "SOL";
        const t = tokens.find(x => x.network === network && x.symbol.toUpperCase() === pos.asset.toUpperCase() && (native ? x.contract === "native" : x.contract !== "native"));
        if (!t || !/^\d+(\.\d+)?$/.test(pos.amount)) continue;
        const [w, f = ""] = pos.amount.split(".");
        const raw = units(w + (f ? "." + f.slice(0, t.decimals) : ""), t.decimals);
        if (raw <= 0n) continue;
        const usdRaw = values.get(pos.id);
        const prev = balances[t.id];
        // Several wallets can hold the same token; show the total and send from the largest holder.
        const total = (prev ? BigInt(prev.raw) : 0n) + raw;
        const usd = (prev?.usd ? Number(prev.usd) : 0) + (usdRaw ? Number(usdRaw) / 1e6 : 0);
        const account = !prev || raw > BigInt(prev.largestRaw ?? prev.raw) ? pos.accountId : prev.account;
        balances[t.id] = { raw: total.toString(), amount: decimal(total, t.decimals), usd: usd ? usd.toFixed(2) : prev?.usd ?? null, account, largestRaw: (!prev || raw > BigInt(prev.largestRaw ?? prev.raw) ? raw : BigInt(prev.largestRaw ?? prev.raw)).toString() };
      }
      // The portfolio reads finalized blocks (planning-safe, ~15 min behind on Ethereum). For swapping, replace the
      // ETH and USDC figures with latest-block reads of each proven EVM wallet, so a just-made swap shows at once.
      const wallets = new Map<string, string>();
      for (const pos of (p.positions ?? []) as { chain?: string; accountId?: string; ownership?: string }[])
        if (["eth", "base", "arb"].includes(pos.chain ?? "") && pos.accountId && pos.ownership !== "watched") wallets.set(pos.chain + "|" + pos.accountId.toLowerCase(), pos.accountId);
      const fresh = await Promise.all([...wallets].map(async ([key, address]) => {
        const chain = key.split("|")[0];
        try { return { chain, address, ...(await api("/api/swap/balances?chain=" + chain + "&address=" + address, undefined, "GET")) as { nativeRaw: string; usdcRaw: string; usdc: string } }; } catch { return null; }
      }));
      const ratio = (id: string) => { const b = balances[id]; return b?.usd && Number(b.amount) > 0 ? Number(b.usd) / Number(b.amount) : null; };
      const perToken = new Map<string, { raw: bigint; largest: bigint; account: string }>();
      for (const f of fresh) {
        if (!f) continue;
        for (const [contract, raw] of [["native", f.nativeRaw], [f.usdc.toLowerCase(), f.usdcRaw]] as const) {
          const t = tokens.find(x => x.network === f.chain && (contract === "native" ? x.contract === "native" : x.contract.toLowerCase() === contract));
          if (!t || !/^\d+$/.test(raw)) continue;
          const v = BigInt(raw), prev = perToken.get(t.id);
          perToken.set(t.id, { raw: (prev?.raw ?? 0n) + v, largest: prev && prev.largest >= v ? prev.largest : v, account: prev && prev.largest >= v ? prev.account : f.address });
        }
      }
      for (const [id, v] of perToken) {
        const t = tokens.find(x => x.id === id)!;
        const unit = ratio(id) ?? (t.price ? Number(t.price) : null);
        if (v.raw <= 0n) { delete balances[id]; continue; }
        const amount = decimal(v.raw, t.decimals);
        balances[id] = { raw: v.raw.toString(), amount, usd: unit !== null ? (Number(amount) * unit).toFixed(2) : null, account: v.account, largestRaw: v.largest.toString() };
      }
      setEvm({ balances, addresses, covered: [...covered] });
    } catch { /* portfolio unavailable: EVM/Solana balances stay "not read" */ }
  }, [enabled, tokens]);
  useEffect(() => { const t = setTimeout(() => void read(), 0); return () => clearTimeout(t); }, [read, tick]);
  // Keep the form current after a swap: re-read when the tab regains focus and every 30 seconds while open.
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick(x => x + 1);
    const timer = setInterval(bump, 30_000);
    window.addEventListener("focus", bump);
    return () => { clearInterval(timer); window.removeEventListener("focus", bump); };
  }, [enabled]);
  const nearBalances: Record<string, Holding> = {};
  for (const [id, h] of Object.entries(near.balances)) nearBalances[id] = { ...h, account: nearAccount };
  const covered = new Set<string>([...evm.covered, ...(near.state === "ready" && nearAccount ? ["near"] : [])]);
  return {
    balances: { ...evm.balances, ...nearBalances },
    addresses: { ...evm.addresses, ...(nearAccount ? { near: nearAccount } : {}) } as Record<string, string>,
    covered, state: near.state,
    refresh: async () => { await near.refresh(); setTick(x => x + 1); },
  };
}
