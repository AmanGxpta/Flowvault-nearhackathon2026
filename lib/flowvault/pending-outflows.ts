// Verified outgoing deposits that the finalized portfolio read can't see yet. The portfolio reads EVM chains at
// the finalized block (planning-safe; Ethereum finalizes ~13–15 minutes behind), so for a while after a swap the
// sent tokens still look held. Once FlowVault has verified a swap's deposit receipt on the origin chain, the sent
// amount is subtracted from that wallet's position until the finalized block includes it. Read-only.
import { units, decimal } from "./money.ts";
import type { IntentsPreparation } from "./swap-intents.ts";

type Pos = { id: string; asset: string; chain?: string; amount: string; accountId?: string; kind?: string; ownership?: string; pendingOutflow?: string; label?: string };
const WINDOW_MS = 60 * 60_000;

/** Pure: subtract the pending amounts from matching wallet positions (never below zero). */
export function applyPendingOutflows<T extends Pos>(positions: T[], outflows: { chain: string; accountId: string; asset: string; amountRaw: string; decimals: number }[]): T[] {
  return positions.map(pos => {
    const hits = outflows.filter(o => o.chain === pos.chain && o.asset === pos.asset && pos.accountId?.toLowerCase() === o.accountId.toLowerCase() && (!pos.kind || pos.kind === "wallet") && pos.ownership !== "watched");
    if (!hits.length || !/^\d+(\.\d+)?$/.test(pos.amount)) return pos;
    const d = hits[0].decimals;
    const [w, f = ""] = pos.amount.split(".");
    const held = units(w + (f ? "." + f.slice(0, d) : ""), d);
    const out = hits.reduce((n, o) => n + BigInt(o.amountRaw), 0n);
    const left = held > out ? held - out : 0n;
    return { ...pos, amount: decimal(left, d), pendingOutflow: decimal(held - left, d) };
  });
}

/** Swaps from the last hour whose EVM deposit FlowVault verified but the chain hasn't finalized yet. */
export async function pendingOutflows(sessionId: string) {
  const [{ listAttempts }, { evmRpc, hexQuantity, rpcChain }] = await Promise.all([import("./attempts.ts"), import("./evm.ts")]);
  const out: { chain: string; accountId: string; asset: string; amountRaw: string; decimals: number }[] = [];
  const recent = (await listAttempts(sessionId)).filter(a => a.kind === "swap" && Date.now() - Date.parse(a.createdAt) < WINDOW_MS);
  const finalized = new Map<string, bigint | null>();
  for (const a of recent) {
    const p = a.preparation as unknown as IntentsPreparation;
    if (p.route !== "intents" || !p.evmTx || !p.result || !a.hashes[0] || !["submitted", "confirmed", "partial"].includes(a.state)) continue;
    const chain = rpcChain(p.from.network);
    try {
      if (!finalized.has(chain)) finalized.set(chain, hexQuantity((await evmRpc(chain, "eth_getBlockByNumber", ["finalized", false]))?.number));
      const receipt = await evmRpc(chain, "eth_getTransactionReceipt", [a.hashes[0]]);
      const block = receipt?.blockNumber ? hexQuantity(receipt.blockNumber) : null;
      const fin = finalized.get(chain);
      if (block === null || fin === null || fin === undefined || block <= fin) continue; // already in the finalized read
      out.push({ chain, accountId: p.accountId, asset: p.from.contract === "native" ? "ETH" : p.from.symbol, amountRaw: p.amountRaw, decimals: p.from.decimals });
    } catch { /* RPC unavailable: leave the finalized figure as is */ }
  }
  return out;
}
