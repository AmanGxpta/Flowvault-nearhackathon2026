/** Research records confer no ownership or transaction authority. Never pass them to the account registry. */
import type { Portfolio } from "./types.ts";
export type ResearchNetwork = "near" | "base" | "arb" | "eth";
export interface WatchedAddress { id: string; network: ResearchNetwork; address: string; label: string; notes: string; }
export function researchAddress(network: string, input: string): string {
  const address = input.trim();
  if (!["near", "base", "arb", "eth"].includes(network)) throw new Error("Choose a supported network.");
  if (network === "near") {
    if (!/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(address)) throw new Error("Enter a valid NEAR account.");
    return address;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Enter a valid Ethereum address.");
  return address.toLowerCase();
}
export function parseResearch(raw: string | null): { wallets: WatchedAddress[]; saved: string[] } {
  try {
    const value = JSON.parse(raw ?? "{}");
    const wallets: WatchedAddress[] = (Array.isArray(value.wallets) ? value.wallets : []).slice(0, 100).flatMap((input: unknown) => {
      if (!input || typeof input !== "object") return [];
      const w = input as Record<string, unknown>;
      try {
        const address = researchAddress(typeof w.network === "string" ? w.network : "", typeof w.address === "string" ? w.address : "");
        return [{ id: w.network + ":" + address, network: w.network as ResearchNetwork, address, label: String(w.label ?? "Watched wallet").slice(0, 80), notes: String(w.notes ?? "").slice(0, 1000) }];
      } catch { return []; }
    });
    return { wallets: [...new Map(wallets.map((w: WatchedAddress) => [w.id, w])).values()], saved: (Array.isArray(value.saved) ? value.saved : []).filter((x: unknown) => typeof x === "string").slice(0, 100) };
  } catch { return { wallets: [], saved: [] }; }
}
export function displayQuantity(amount: string, symbol: string): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) return "Quantity unavailable";
  const nonzero = /[1-9]/.test(amount);
  const n = Number(amount); // Display only; executable amounts retain bigint units.
  if (nonzero && n < 0.0001) return "<0.0001 " + symbol;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 4 }) + " " + symbol;
}

export const RESEARCH_ASSETS = [
  { id: "near:native", symbol: "NEAR", name: "NEAR Protocol", network: "near", description: "Native gas token · staking", action: "Explore staking", screen: "strategies" },
  { id: "near:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", name: "USD Coin", network: "near", description: "Stablecoin · supply and payments", action: "Explore earning", screen: "strategies" },
  { id: "eth:native", symbol: "ETH", name: "Ethereum", network: "eth", description: "Native gas token · market research", action: "View trading", screen: "trade" },
  { id: "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", network: "base", description: "Stablecoin · cross-chain funding", action: "Explore swaps", screen: "swap" },
  { id: "arb:0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", name: "USD Coin", network: "arb", description: "Stablecoin · cross-chain funding", action: "Explore swaps", screen: "swap" },
];
export function publicWatchlistUrl(currentUrl: string, selected: string[]): string {
  const source = new URL(currentUrl);
  const url = new URL(source.pathname, source.origin);
  const ids = RESEARCH_ASSETS.filter(asset => selected.includes(asset.id)).map(asset => asset.id);
  url.searchParams.set('view', 'research');
  url.searchParams.set('list', ids.join(','));
  return url.toString();
}

/** Keep partial public reads explicit; this projection deliberately carries no ownership or credit fields. */
export function researchPortfolioView(portfolio: Portfolio) {
  const warnings = [...new Set([...portfolio.errors, ...(portfolio.sections ?? []).filter(section => section.status === "partial" || section.status === "unavailable").flatMap(section => section.reasons)])];
  return { capturedAt: portfolio.capturedAt, incomplete: warnings.length > 0, warnings, positions: portfolio.positions.map(position => ({ label: position.label, asset: position.asset, amount: position.amount, kind: position.kind })) };
}
