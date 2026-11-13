// Live implementation of Ask FlowVault's read tools, scoped to one verified session. Every read goes through the
// same services the screens use; nothing here writes, prepares or authorizes.
import type { SessionInfo } from "./store";
import type { ChatReads, Holdings, HoldingRow, Limits, Market } from "./chat-tools";
import type { SwapToken } from "./swap-explorer";
import { swapTokenCatalog } from "./swap-catalog";
import { swapPreview } from "./swap-preview";
import { workspacePortfolio } from "./portfolio-service";
import { readValuationEvidence } from "./valuation-evidence";
import { capitalView } from "./valuation";
import { readWatchedNear } from "./research-service";
import { readEvmUsdc } from "./evm";
import { researchAddress } from "./research";
import { readLedger } from "./policy-store";
import { workspaceLedger } from "./policy-context";
import { defaultPolicy, evaluatePolicy } from "./policy";
import { listAttempts } from "./attempts";
import { rheaPositions } from "./rhea-markets-live";
import { stakingOptions } from "./staking-options";
import { proven } from "./account-registry";
import { units, decimal } from "./money";
import { GET as ratesGET } from "@/app/api/rates/route";
import { GET as perpsGET } from "@/app/api/perps/route";

/** USD figures from indexers can carry many decimals; keep six (truncated) so totals stay exact bigint sums. */
const usd6 = (v: string | null | undefined) => { if (!v || !/^\d+(\.\d+)?$/.test(v)) return null; const [w, f = ""] = v.split("."); return f ? w + "." + f.slice(0, 6) : w; };
const usdc = (raw: string | null | undefined) => (raw === null || raw === undefined ? null : decimal(BigInt(raw), 6));
const CHAIN_NET: Record<string, string> = { near: "near", eth: "eth", base: "base", arb: "arb", solana: "sol" };
/** Hypothetical checks test amounts and protected assets; venue, method and gas permissions are checked at review. */
const HYPOTHETICAL = new Set(["PER_ACTION_CAP", "DAILY_CAP", "PROTECTED_ASSET", "ASSET_USE_NOT_ALLOWED", "LEDGER_UNVERIFIED", "INVALID_AMOUNT_OR_POLICY"]);

export function liveReads(s: SessionInfo, request: Request): ChatReads {
  const w = s.workspace;
  const mode = w.mode === "demo" ? "demo" : "live";
  const account = w.accountId ?? null;
  const evm = (w.accounts ?? []).filter((a) => a.chain === "evm" && proven(a)).map((a) => a.address.toLowerCase());
  const sol = (w.accounts ?? []).filter((a) => a.chain === "solana" && proven(a)).map((a) => a.address);
  const addresses: Record<string, string> = { ...(account && mode === "live" ? { near: account } : {}), ...(evm[0] ? { eth: evm[0], base: evm[0], arb: evm[0] } : {}), ...(sol[0] ? { sol: sol[0] } : {}) };
  let catalog: Promise<SwapToken[]> | null = null;
  let holdings: Promise<Holdings> | null = null;
  const cat = () => (catalog ??= swapTokenCatalog());

  async function readHoldings(): Promise<Holdings> {
    const tokens = await cat().catch(() => [] as SwapToken[]);
    const [{ portfolio }, evidence] = await Promise.all([workspacePortfolio(w), readValuationEvidence(w).catch(() => null)]);
    let capital: ReturnType<typeof capitalView> | null = null;
    try { capital = capitalView(w, portfolio, evidence ?? undefined); } catch { capital = null; }
    const value = new Map((capital?.valuations ?? []).filter((v) => v.kind !== "stress" && v.usdcRaw !== null).map((v) => [v.positionId, usdc(v.usdcRaw)]));
    const rows: HoldingRow[] = [], covered = new Set<string>(), coverage: string[] = [];
    // The NEAR account's whole token inventory (the same public read the swap form uses).
    const nearInventory = mode === "live" && account ? await readWatchedNear(account).catch(() => null) : null;
    if (nearInventory?.holdings) {
      covered.add("near");
      coverage.push("NEAR account: indexed token inventory (FastNEAR) with Ref prices");
      for (const h of nearInventory.holdings) if (h.amount && h.amount !== "0") rows.push({ asset: h.symbol, network: "near", kind: "wallet", amount: h.amount, usd: usd6(h.usd), account, catalogId: "near:" + h.contract });
    }
    for (const p of portfolio.positions) {
      if (p.ownership === "watched" || p.amount === "0") continue;
      const network = CHAIN_NET[String(p.chain ?? "near")] ?? String(p.chain);
      if (p.kind === "wallet" && network === "near" && nearInventory?.holdings) continue;
      if (p.kind === "wallet") covered.add(network);
      const native = p.asset === "ETH" || p.asset === "SOL" || (p.asset === "NEAR" && network === "near");
      const t = tokens.find((x) => x.network === network && x.symbol.toUpperCase() === p.asset.toUpperCase() && (native ? x.contract === "native" : x.contract !== "native"));
      rows.push({ asset: p.asset, network, kind: p.kind, amount: p.amount, usd: value.get(p.id) ?? (mode === "demo" ? usd6(p.valuation?.amount) : null), account: p.accountId ?? portfolio.accountId, catalogId: p.kind === "wallet" ? t?.id ?? null : null });
    }
    if (evm.length) coverage.push("EVM wallets: ETH and USDC on Ethereum, Base and Arbitrum (finalized blocks)");
    if (portfolio.errors.length) coverage.push(...portfolio.errors.slice(0, 3).map((e) => "Not read: " + String(e).slice(0, 120)));
    if (mode === "demo") { covered.add("near"); coverage.push("Fictional example workspace"); }
    rows.sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
    const unvalued = rows.filter((r) => r.usd === null).length;
    const total = rows.reduce((n, r) => (r.usd === null ? n : r.kind === "debt" ? n - units(r.usd) : n + units(r.usd)), 0n);
    return { capturedAt: portfolio.capturedAt, rows: rows.slice(0, 60), totalUsd: rows.length ? decimal(total < 0n ? 0n : total) : "0", unvalued, coverage, covered: [...covered] };
  }

  async function limits(): Promise<Limits> {
    const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
    const ledger = workspaceLedger(w, mode === "live" ? await readLedger(s.id) : []);
    const acct = account ?? "fictional-example", day = new Date().toISOString().slice(0, 10);
    let used: bigint | null = 0n;
    try { for (const r of ledger) if (r.accountId === acct && r.source === mode && r.createdAt.slice(0, 10) === day && r.state !== "cancelled-before-wallet") used! += units(r.amount); } catch { used = null; }
    let cap: ReturnType<typeof capitalView> | null = null;
    try { const [{ portfolio }, ev] = await Promise.all([workspacePortfolio(w), readValuationEvidence(w).catch(() => null)]); cap = capitalView(w, portfolio, ev ?? undefined); } catch { cap = null; }
    const upcoming = w.obligations.filter((o) => !["paid", "cancelled"].includes(o.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6)
      .map((o) => ({ id: o.id, label: o.label, amount: o.amount, token: o.token, chain: o.destination, due: o.dueDate }));
    return {
      perAction: policy.perActionCap, daily: policy.dailyCap, remainingToday: used === null ? null : decimal(units(policy.dailyCap) > used ? units(policy.dailyCap) - used : 0n),
      maxMoveCost: policy.maxMoveCost, protectedAssets: policy.protectedAssets, venues: policy.venues.slice(0, 12),
      reserve: cap ? usdc(cap.reserveUsdcRaw) : null, holdback: cap ? usdc(cap.holdbackUsdcRaw) : null, spendableNow: cap ? usdc(cap.spendableNowUsdcRaw) : null, surplus: cap ? usdc(cap.surplusUsdcRaw) : null,
      borrowingAllowed: !!(policy as { borrow?: boolean }).borrow || (policy.creditRows?.length ?? 0) > 0, upcoming, version: policy.version ?? null,
    };
  }

  return {
    mode, accountId: mode === "live" ? account : null, addresses,
    catalog: cat,
    holdings: () => (holdings ??= readHoldings()),
    limits,
    async quote(p) {
      const r = await swapPreview({ from: p.from, to: p.to, amount: p.amount, slippage: p.slippage, sender: p.sender, recipient: p.recipient });
      return { routes: r.routes.map((x) => ({ venue: x.venue, output: x.output, minimum: x.minimum, eta: x.eta })), warnings: r.warnings, expiresAt: r.expiresAt };
    },
    async markets() {
      const r = await ratesGET();
      const b = await r.json() as { rows?: { token: string; symbol: string; icon: string | null; supplyApy: number | null; borrowApy: number | null; utilization: number; canSupply: boolean; canBorrow: boolean; collateral: boolean; suppliedUsd: number | null }[]; capturedAt?: string; error?: string };
      if (!r.ok || !b.rows) throw new Error(b.error ?? "Rhea markets unavailable.");
      return { capturedAt: b.capturedAt ?? new Date().toISOString(), rows: b.rows.map((x): Market => ({ tokenId: x.token, symbol: x.symbol, icon: x.icon, supplyApy: x.supplyApy, borrowApy: x.borrowApy, utilization: x.utilization, canSupply: x.canSupply, canBorrow: x.canBorrow, collateral: x.collateral, suppliedUsd: x.suppliedUsd })) };
    },
    async lendPosition(tokenId) {
      if (mode !== "live" || !account) return null;
      const p = await rheaPositions(request, tokenId) as unknown as { wallet: string; supplied: string; collateral: string; borrowed: string; available: string; health: string; priced: boolean };
      return { wallet: p.wallet, supplied: p.supplied, collateral: p.collateral, borrowed: p.borrowed, available: p.available, health: p.health, priced: p.priced };
    },
    async staking() {
      const o = await stakingOptions(w) as { options: { id: string; aprPercent?: string | null; executionSupported?: boolean; preparationSupported?: string; exit?: { estimatedUnlockAt: string | null; fits: boolean | null } }[]; note: string };
      const names: Record<string, string> = { linear: "LiNEAR (liquid staking)", native: "Native validator", rnear: "rNEAR (liquid staking)" };
      const options = o.options.filter((x) => x.id === "linear" || x.id === "native").map((x) => ({
        venue: x.id, name: names[x.id] ?? x.id, apy: x.aprPercent ?? null,
        exit: x.id === "linear" ? "Instant swap out at the pool price, or unstake in about 2–3 days" : "Unstake takes 4 epochs (about 2–3 days), then claim",
      }));
      const { portfolio } = await workspacePortfolio(w);
      const positions = portfolio.positions.filter((p) => p.kind === "staking" && p.ownership !== "watched" && p.amount !== "0").map((p) => ({ id: p.id, venue: p.venue ?? p.label, staked: p.amount, unstaking: "see position", withdrawable: p.availableAt && Date.parse(p.availableAt) <= Date.now() ? p.amount : "0" }));
      return { options, positions, note: o.note };
    },
    async research(network, address) {
      const a = researchAddress(network, address);
      if (network !== "near") {
        const p = await readEvmUsdc(network, a);
        return { address: a, network, capturedAt: p.capturedAt, holdings: [{ symbol: p.asset, amount: p.amount }], coverage: "Native USDC only on this network. Other tokens and gas balances are not included." };
      }
      const v = await readWatchedNear(a);
      return {
        address: a, network, capturedAt: v.capturedAt, pricedTotalUsd: v.pricedTotal ?? null, unpriced: v.unpriced ?? 0, transactionCount: v.transactionCount,
        holdings: (v.holdings ?? []).filter((h) => h.usd === null || Number(h.usd) >= 1).slice(0, 12).map((h) => ({ symbol: String(h.symbol).slice(0, 20), contract: h.contract, catalogId: "near:" + h.contract, amount: h.amount, usd: h.usd, sharePct: h.share })),
        positions: v.positions.slice(0, 8), staking: v.staking.slice(0, 5),
        recent: v.transactions.slice(0, 5).map((t) => ({ at: t.at ? new Date(t.at).toISOString() : null, actions: t.actions.slice(0, 3), status: t.status })),
        coverage: v.coverage, warnings: v.warnings.slice(0, 4),
      };
    },
    async operations(limit) {
      if (mode !== "live") return [];
      const list = await listAttempts(s.id);
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit)
        .map((a) => ({ id: a.id, kind: a.kind, state: a.state, amount: a.amount, message: a.message, updatedAt: a.updatedAt, transactions: a.hashes.length }));
    },
    async perps() {
      if (mode !== "live") return { available: false, reason: "Perps run on your own Hyperliquid account in the Personal workspace." };
      const r = await perpsGET(request);
      const b = await r.json() as { agentsAvailable?: boolean; accounts?: { master: string; funded?: boolean; snapshot?: { accountValueUsdcRaw?: string; positions?: unknown[] } | null; link?: { verifiedAt?: string | null; state?: string } | null; error?: string | null }[]; error?: string };
      if (!r.ok) throw new Error(b.error ?? "Hyperliquid unavailable.");
      return {
        agentsAvailable: !!b.agentsAvailable,
        wallets: (b.accounts ?? []).map((a) => ({
          wallet: a.master.slice(0, 6) + "…" + a.master.slice(-4), funded: !!a.funded, accountValueUsd: a.snapshot?.accountValueUsdcRaw ? usdc(a.snapshot.accountValueUsdcRaw) : null,
          openPositions: a.snapshot?.positions?.length ?? 0, agentApproved: !!a.link && a.link.state !== "revoked", error: a.error ?? null,
          missing: [!a.funded && "trading funds on Hyperliquid", !a.link && "FlowVault agent approval"].filter(Boolean),
        })),
        ...(!(b.accounts ?? []).length ? { missing: ["a proven EVM wallet (connect one in the wallet menu)"] } : {}),
      };
    },
    async checkPolicy(kind, asset, amountUsd) {
      const policy = w.policy ?? defaultPolicy(w.mandate.maxMoveCost);
      const ledger = workspaceLedger(w, mode === "live" ? await readLedger(s.id) : []);
      const acct = account ?? "fictional-example";
      const r = evaluatePolicy({ kind, asset: asset.toUpperCase().replace(/^\$/, ""), amount: amountUsd, recipient: acct, venue: policy.venues[0] ?? "contract.main.burrow.near", movingCost: "0", gasNear: "0", source: mode, accountId: acct, methods: [{ receiver: "hypothetical", method: "hypothetical" }] }, policy, ledger);
      const violations = r.violations.filter((v) => HYPOTHETICAL.has(v.code));
      return { allowed: violations.length === 0, violations, remainingToday: r.remainingDaily };
    },
  };
}
