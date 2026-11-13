// Delegation architectures for mandates (owner: Stream C). Each option states what its on-chain authority REALLY
// bounds and what only FlowVault's checker enforces. The policy contract (contracts/policy) is a record, not
// execution control: it cannot stop a full-access key, so it is not listed as an authority.
import type { DelegationKind, MandateAuthority } from "./contracts.ts";
import { ownerSignsAuthority } from "./mandate.ts";

export interface DelegationOption {
  kind: DelegationKind;
  title: string;
  /** build now | needs credentials | needs owner approval | protocol does not support */
  classification: "build_now" | "needs_owner_approval" | "needs_credentials" | "protocol_does_not_support";
  usedFor: string;
  bounds: string[];
  unbounded: string[];
  custody: string;
  upgradeAuthority: string;
  verdict: string;
}

export const DELEGATION_OPTIONS: DelegationOption[] = [
  {
    kind: "owner_signs_each",
    title: "Owner signs each action",
    classification: "build_now",
    usedFor: "Default for every NEAR strategy until a custody contract is deployed.",
    bounds: ownerSignsAuthority().bounds,
    unbounded: ownerSignsAuthority().unbounded,
    custody: ownerSignsAuthority().custody,
    upgradeAuthority: ownerSignsAuthority().upgradeAuthority,
    verdict: "Chosen now. The mandate runs on schedule, decides and prepares; nothing moves until your wallet signs.",
  },
  {
    kind: "hyperliquid_agent",
    title: "Hyperliquid API (agent) wallet",
    classification: "needs_owner_approval",
    usedFor: "Perpetuals: the master EVM wallet signs approveAgent once; FlowVault's agent key places and cancels orders.",
    bounds: [
      "The agent key can place, modify and cancel orders on the master account, and nothing else.",
      "It cannot withdraw, transfer USDC between accounts or approve other agents; those need the master wallet's signature.",
      "It expires at its validUntil, and approving another agent with the same name replaces it.",
    ],
    unbounded: [
      "Order size, leverage, asset and daily loss are NOT limited by Hyperliquid for an agent; FlowVault's checker enforces them before signing.",
      "Losses up to the margin deposited on Hyperliquid are possible within that authority.",
    ],
    custody: "Hyperliquid's bridge on Arbitrum holds deposited USDC for your master address; only the master can withdraw.",
    upgradeAuthority: "Hyperliquid's validators and its bridge contract; FlowVault has no upgrade power.",
    verdict: "Chosen for perpetuals: the withdrawal bound is real and protocol-enforced.",
  },
  {
    kind: "near_custody_contract",
    title: "FlowVault custody contract (contracts/vault)",
    classification: "needs_owner_approval",
    usedFor: "NEAR strategies that should run without a signature per action.",
    bounds: [
      "Funds sit in a contract whose curator method accepts only allowlisted receiver+method pairs and per-action/daily caps checked on-chain.",
      "Withdrawal pays only the depositor; the curator cannot name another recipient.",
      "The agent's NEAR key is a function-call key on the contract for the curator method only, with zero attached deposit.",
    ],
    unbounded: [
      "Quote quality, freshness and strategy choice are checked off-chain by FlowVault before the curator call.",
      "Reserve and dated payments in your wallet are outside the contract; only what you deposit is at risk.",
    ],
    custody: "The contract account. You deposit what the mandate may use; everything else stays in your wallet.",
    upgradeAuthority: "Whoever holds the contract account's full-access key (you, if you deploy it and delete other keys).",
    verdict: "Bind a verified single-depositor vault and operator policy, then re-sign the mandate. A separately provisioned scoped runtime key is required; there is no unbounded fallback.",
  },
  {
    kind: "near_function_call_key",
    title: "NEAR function-call access key on your account",
    classification: "protocol_does_not_support",
    usedFor: "Considered for Rhea supply/withdraw directly from your account.",
    bounds: ["Scoped to one receiver and a list of methods, with a gas allowance."],
    unbounded: ["Cannot attach any deposit, so it cannot call ft_transfer_call (1 yoctoNEAR) or Rhea execute (1 yoctoNEAR)."],
    custody: "Your account.",
    upgradeAuthority: "None.",
    verdict: "Rejected: every Rhea and token-transfer method needs a 1 yoctoNEAR deposit that a function-call key can't attach.",
  },
  {
    kind: "evm_session_key",
    title: "EIP-7702 / ERC-7710 session permissions",
    classification: "needs_credentials",
    usedFor: "EVM-side automation (e.g. funding Hyperliquid from Arbitrum).",
    bounds: ["Call targets, selectors and spend caps enforced by the delegated smart-account code, when the wallet supports it."],
    unbounded: ["Support depends on the wallet; injected wallets that can't sign a 7702 authorization have no bounded path."],
    custody: "Your EOA (code delegated to a smart-account implementation).",
    upgradeAuthority: "The delegated implementation's deployer; re-delegation by the EOA owner.",
    verdict: "Deferred: wallet capability detection belongs to Stream A's gas work; no unbounded fallback is offered.",
  },
];

/** Methods that require an attached deposit (so a NEAR function-call key can never call them). */
const DEPOSIT_METHODS = new Set(["ft_transfer_call", "ft_transfer", "execute", "execute_with_pyth", "deposit_and_stake", "storage_deposit", "near_deposit"]);
export function functionCallKeyCanCall(methods: { method: string }[]) {
  const blocked = methods.filter((m) => DEPOSIT_METHODS.has(m.method));
  return { ok: blocked.length === 0, blocked: blocked.map((m) => m.method) };
}

/** The authority record a mandate stores for a chosen kind (status starts not_provisioned unless owner-signed). */
export function authorityFor(kind: DelegationKind): MandateAuthority {
  if (kind === "owner_signs_each") return ownerSignsAuthority();
  const o = DELEGATION_OPTIONS.find((x) => x.kind === kind)!;
  return {
    kind,
    status: o.classification === "protocol_does_not_support" ? "unsupported" : "not_provisioned",
    bounds: o.bounds,
    unbounded: o.unbounded,
    custody: o.custody,
    upgradeAuthority: o.upgradeAuthority,
  };
}

// Runtime custody checks live in a separate module so protocol limits stay testable without RPC.
export {checkCustodyKey,custodyProblems,boundCustodyAuthority,custodyCall} from "./custody-authority.ts";
