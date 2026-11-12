// Execution capabilities (owner: Stream A, funding mesh). Pure: one ExecutionCapability per proven account ×
// network, built from the shared portfolio read (account-reads.ts / portfolio-service.ts) and the reservations
// other active plans hold on each account. No network, D1 or wallet access here, so every rule is unit-tested.
//
// "Connected" is a browser fact and is never decided here (null); the client overlays its live wallet sessions.
// An account whose read failed has no assets and no operations: it is listed with the reason, never zero-filled.
import type { AccountReservation, ActionPlan, CapabilityAsset, ExecutionCapability, ExecutionNetwork, FundingLeg, FundingOperation, StepState } from "./contracts.ts";
import type { LinkedAccount, Position, PortfolioSection, Source } from "./types.ts";

const PROVEN = new Set(["nep413", "siwe", "siws"]);
export const EVM_NETWORK_CODE: Record<"ethereum" | "base" | "arbitrum", "eth" | "base" | "arb"> = { ethereum: "eth", base: "base", arbitrum: "arb" };
export const NETWORK_NAME: Record<ExecutionNetwork, string> = { near: "NEAR", ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", solana: "Solana" };
const GAS_ASSET = { near: "NEAR", ethereum: "ETH", base: "ETH", arbitrum: "ETH", solana: "SOL" } as const;
const GAS_DECIMALS = { NEAR: 24, ETH: 18, SOL: 9 } as const;

/** Networks whose USDC FlowVault can move to the plan's NEAR account as a signed funding leg. */
export const LEG_NETWORKS: ExecutionNetwork[] = ["ethereum", "base", "arbitrum", "solana"];
/** USDC gas (Circle Paymaster, gas-abstraction.ts) is wallet-dependent: the browser decides per wallet via EIP-5792, so the
 * server never marks an account payable-in-USDC. A gas need is still a hard requirement for legs here. */
export const USDC_GAS_NETWORKS: ExecutionNetwork[] = [];

/** Fixed native-gas bounds when no live figure is supplied (one transfer, generous). Live reads replace these. */
export const DEFAULT_GAS_NEED: Partial<Record<ExecutionNetwork, string>> = {
  // 0.05 NEAR covers a Rhea withdraw plus the payment's own transactions.
  near: "50000000000000000000000",
  // Base fee + priority fee + rent for the deposit address's USDC token account if it has none (0.00203928 SOL).
  solana: "2100000",
};

export interface GasObservation {
  /** Native gas one funding transfer needs on this network (base units), from a live fee read. */
  needRaw: string | null;
  basis: string;
}

export interface CapabilityInput {
  accounts: LinkedAccount[];
  positions: Position[];
  sections?: PortfolioSection[];
  reservations: AccountReservation[];
  gas?: Partial<Record<ExecutionNetwork, GasObservation>>;
  source: Source;
  now?: number;
}

const big = (v: string | undefined | null) => (v && /^\d+$/.test(v) ? BigInt(v) : 0n);
const rawOf = (p: Position) => (p.rawAmount && /^\d+$/.test(p.rawAmount) ? p.rawAmount : null);

/** Positions held by one account on one network. NEAR primary positions are the unprefixed main-account rows. */
export function accountPositions(a: LinkedAccount, network: ExecutionNetwork, positions: Position[]): Position[] {
  if (a.chain === "evm") {
    const code = EVM_NETWORK_CODE[network as keyof typeof EVM_NETWORK_CODE];
    return positions.filter((p) => p.chain === code && (p.accountId ?? "").toLowerCase() === a.address.toLowerCase());
  }
  if (a.chain === "solana") return positions.filter((p) => p.chain === "solana" && p.accountId === a.address);
  if (a.primary) return positions.filter((p) => (!p.chain || p.chain === "near") && !p.id.startsWith("acct:") && (!p.accountId || p.accountId === a.address));
  return positions.filter((p) => p.id.startsWith(`acct:${a.address}:`));
}

/** The section that reports this account × network (account-reads ids, or the legacy main/EVM sections). */
function failedSection(a: LinkedAccount, network: ExecutionNetwork, sections: PortfolioSection[]) {
  const code = EVM_NETWORK_CODE[network as keyof typeof EVM_NETWORK_CODE];
  const ids =
    a.chain === "evm"
      ? [`acct:${a.id}:${code}`, `${code}-usdc`, "connected-accounts"]
      : a.chain === "solana" || !a.primary
        ? [`acct:${a.id}`, "connected-accounts"]
        : ["near", "near-usdc", "near-native"];
  return sections.find((s) => ids.includes(s.id) && (s.status === "unavailable" || s.status === "partial")) ?? null;
}

export function executionCapabilities(i: CapabilityInput): ExecutionCapability[] {
  const at = new Date(i.now ?? Date.now()).toISOString();
  const out: ExecutionCapability[] = [];
  for (const a of i.accounts) {
    if (!a.proof || !PROVEN.has(a.proof.method)) continue;
    for (const net of a.networks as ExecutionNetwork[]) {
      const network = net;
      const reasons: string[] = [];
      const failed = failedSection(a, network, i.sections ?? []);
      if (failed) reasons.push("READ_UNAVAILABLE: " + (failed.reasons[0] ?? failed.status));
      const rows = failed ? [] : accountPositions(a, network, i.positions).filter((p) => p.kind === "wallet" || p.kind === "supplied");
      const held = (asset: string) => i.reservations.filter((r) => r.accountId === a.id && r.network === network && r.asset === asset).reduce((n, r) => n + BigInt(r.amountRaw), 0n);
      const assets: CapabilityAsset[] = [];
      for (const p of rows) {
        const q = rawOf(p);
        if (q === null || p.decimals == null) {
          reasons.push(`QUANTITY_UNKNOWN: ${p.id}`);
          continue;
        }
        // A reservation applies to the wallet balance it will move, never to supplied positions.
        const reserved = p.kind === "wallet" ? held(p.asset) : 0n;
        const avail = BigInt(q) > reserved ? BigInt(q) - reserved : 0n;
        assets.push({ asset: p.kind === "supplied" ? p.asset + " (supplied)" : p.asset, positionId: p.id, decimals: p.decimals, quantityRaw: q, reservedRaw: reserved.toString(), availableRaw: avail.toString() });
      }
      const gasAsset = GAS_ASSET[network];
      const gasRow = assets.find((x) => x.asset === gasAsset);
      const need = i.gas?.[network]?.needRaw ?? DEFAULT_GAS_NEED[network] ?? null;
      const balance = gasRow ? gasRow.quantityRaw : failed ? null : "0";
      const sufficient = need === null || balance === null ? null : BigInt(balance) >= BigInt(need);
      const usdc = assets.find((x) => x.asset === "USDC");
      const operations: FundingOperation[] = [];
      if (a.chain === "near" && a.primary) {
        operations.push("hold");
        if (assets.some((x) => x.asset === "USDC (supplied)" && big(x.availableRaw) > 0n)) operations.push("rhea_withdraw");
      } else if (a.chain === "near") {
        reasons.push("SECONDARY_NEAR_SIGNER: only the signed-in NEAR account signs in this browser; sign in with this account to move its funds");
      } else if (!LEG_NETWORKS.includes(network)) {
        reasons.push(`LEG_NOT_SUPPORTED: FlowVault can't move USDC from ${NETWORK_NAME[network]} yet`);
      } else if (!failed) {
        if (!usdc || big(usdc.availableRaw) === 0n) reasons.push(usdc && big(usdc.reservedRaw) > 0n ? "USDC_HELD_BY_OTHER_PLANS" : "NO_USDC");
        if (need === null) reasons.push("GAS_UNKNOWN: no live fee read for " + NETWORK_NAME[network]);
        else if (sufficient === false && !USDC_GAS_NETWORKS.includes(network)) reasons.push(`NO_GAS: needs ${gasAsset} for the network fee`);
        if (usdc && big(usdc.availableRaw) > 0n && need !== null && (sufficient || USDC_GAS_NETWORKS.includes(network))) operations.push("oneclick_deposit");
      }
      out.push({
        accountId: a.id,
        chain: a.chain,
        network,
        address: a.address,
        label: a.label,
        primary: !!a.primary,
        signing: a.chain === "near" ? "near_wallet" : a.chain === "evm" ? "eip1193" : "wallet_standard",
        connected: null,
        assets,
        gas: { asset: gasAsset, decimals: GAS_DECIMALS[gasAsset], balanceRaw: balance, needRaw: need, sufficient, payableInUsdc: USDC_GAS_NETWORKS.includes(network) },
        operations,
        reasons: [...new Set(reasons)],
        source: i.source,
        capturedAt: at,
      });
    }
  }
  return out;
}

/** The client's overlay: an account is connected when a live wallet session can sign for it in this browser. */
export function withConnections(caps: ExecutionCapability[], connected: Set<string>, nearAccount: string | null): ExecutionCapability[] {
  return caps.map((c) => ({ ...c, connected: c.chain === "near" ? c.address === nearAccount : connected.has(c.accountId) }));
}

/* ───────────── reservations across competing plans, keyed by account ───────────── */

type PlanWithFunding = Pick<ActionPlan, "id" | "state" | "steps"> & { funding?: { legs: FundingLeg[] } };
const ENDED_PLAN = ["completed", "failed", "superseded", "expired", "cancelled", "blocked"];
const HELD: StepState[] = ["pending", "ready", "prepared"];
const MOVING: StepState[] = ["awaiting_wallet", "submitted", "unknown", "partial"];

/**
 * Every unfinished external leg of every plan holds its amount on its source account. A leg stops holding when
 * its step confirms (the money arrived), fails or is skipped; a leg already in a wallet keeps holding even if
 * its plan was superseded, because that money is in motion. Derived from the stored plans on every read, so a
 * reservation can never outlive its plan.
 */
export function accountReservations(plans: PlanWithFunding[], exceptPlanId?: string): AccountReservation[] {
  const out: AccountReservation[] = [];
  for (const p of plans) {
    if (p.id === exceptPlanId || !p.funding) continue;
    for (const leg of p.funding.legs) {
      if (leg.operation !== "oneclick_deposit") continue;
      const step = p.steps.find((s) => s.expected.legId === leg.id);
      // Reviewed plans hold through their steps; evaluated plans hold nothing (they are only proposals).
      if (!step) continue;
      const moving = MOVING.includes(step.state);
      if (!moving && (ENDED_PLAN.includes(p.state) || !HELD.includes(step.state))) continue;
      out.push({ accountId: leg.accountId, network: leg.network, asset: leg.asset, amountRaw: leg.amountRaw, planId: p.id, legId: leg.id, state: moving ? "in_flight" : "held" });
    }
  }
  return out;
}
