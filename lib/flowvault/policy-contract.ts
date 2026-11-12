// Engines: backend for the optional FlowVault policy contract (contracts/policy). Server setting
// FLOWVAULT_POLICY_CONTRACT names a deployed mainnet instance; unset means NOT DEPLOYED and every caller says
// so. Reads are finalized public views. Owner calls are prepared unsigned (1 yoctoNEAR authentication
// deposit) for the owner's wallet; FlowVault never signs. The contract holds no funds, grants no wallet
// authority and cannot restrict a wallet with a full-access key: its proposals and approvals are records.
import { view, validAccount, rpc, USDC } from "./near.ts";
import { units } from "./money.ts";
import { reservationFor, dueInHorizon } from "./valuation.ts";
import type { Policy } from "./policy.ts";
import type { Workspace } from "./types.ts";
import type { ProposalView } from "./staking-native.ts";

export function policyContractId(read: (name: string) => unknown): string | null {
  const v = read("FLOWVAULT_POLICY_CONTRACT");
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const NOT_DEPLOYED_NOTE =
  "Not deployed: no FlowVault policy contract id is configured (FLOWVAULT_POLICY_CONTRACT). The contract in contracts/policy is built and tested but has not been deployed; nothing on-chain records or limits actions.";
export const AUTHORITY_NOTE =
  "The policy contract holds no funds and grants no transaction authority. It cannot restrict a wallet with a full-access key; its proposals, approvals and outcome records are records only. Funds move only when the owner's wallet signs.";

export interface ContractPlan {
  asset_id: string;
  version: string;
  reserve_floor: string;
  obligations: { id: string; net_amount: string; due_at_ms: string }[];
  per_action_cap: string;
  daily_cap: string;
  max_moving_cost: string;
  max_gas_yocto: string;
  venues: string[];
  recipients: string[];
  methods: { receiver: string; method: string }[];
  protected_assets: string[];
}

const TOKEN_IDS: Record<string, string> = {
  USDC,
  LiNEAR: "linear-protocol.near",
  rNEAR: "lst.rhealab.near",
  NEAR: "wrap.near",
  wNEAR: "wrap.near",
  USDT: "usdt.tether-token.near",
};

/** The contract plan that mirrors the saved FlowVault policy. Fails closed on anything it cannot express
 * exactly (an unvalued obligation, a protected asset without a NEAR token id, an invalid receiver). */
export function planFromPolicy(w: Workspace, policy: Policy, version: bigint, now = Date.now()): ContractPlan {
  if (w.mode !== "live" || !w.accountId) throw new Error("Open a live account to publish a policy plan.");
  const obligations = dueInHorizon(w.mandate, w.obligations, now).map((o) => {
    const r = reservationFor(w.mandate, o, now); // throws when the obligation cannot be valued
    const due = Date.parse(o.dueDate + "T23:59:59.999Z");
    if (!Number.isFinite(due)) throw new Error(`Obligation ${o.id} has no valid due date.`);
    return { id: o.id.slice(0, 64), net_amount: r.reserveUsdcRaw, due_at_ms: String(due) };
  });
  if (obligations.length > 50) throw new Error("The policy contract stores at most 50 obligations.");
  const protectedAssets = policy.protectedAssets.map((a) => {
    const id = TOKEN_IDS[a] ?? (validAccount(a) ? a : null);
    if (!id) throw new Error(`Protected asset ${a} has no NEAR token id the contract can store.`);
    return id;
  });
  const methods = policy.methods.map((m) => {
    if (!validAccount(m.receiver)) throw new Error(`Policy method receiver ${m.receiver} is not a NEAR account.`);
    return { receiver: m.receiver, method: m.method };
  });
  return {
    asset_id: USDC,
    version: version.toString(),
    reserve_floor: units(w.mandate.reserve).toString(),
    obligations,
    per_action_cap: units(policy.perActionCap).toString(),
    daily_cap: units(policy.dailyCap).toString(),
    max_moving_cost: units(policy.maxMoveCost).toString(),
    max_gas_yocto: units(policy.maxGasNear, 24).toString(),
    venues: policy.venues,
    // "$owner" is implicit on-chain: the owner is always an allowed recipient.
    recipients: policy.recipients.filter((r) => r !== "$owner"),
    methods,
    protected_assets: [...new Set(protectedAssets)],
  };
}

export interface ContractState {
  status: "not_deployed" | "configured" | "unreachable";
  contractId: string | null;
  note: string;
  authority: string;
  codeHash?: string;
  owner?: string | null;
  ownerIsAccount?: boolean;
  plan?: ContractPlan | null;
  agents?: string[];
  budget?: unknown;
  proposals?: ProposalView[];
  capturedAt: string;
}

export async function readPolicyContract(contractId: string | null, accountId: string | null): Promise<ContractState> {
  const capturedAt = new Date().toISOString();
  if (!contractId) return { status: "not_deployed", contractId: null, note: NOT_DEPLOYED_NOTE, authority: AUTHORITY_NOTE, capturedAt };
  if (!validAccount(contractId) || contractId.endsWith(".testnet"))
    return { status: "unreachable", contractId, note: "The configured id is not a mainnet account; mainnet actions cannot be governed by it.", authority: AUTHORITY_NOTE, capturedAt };
  try {
    const [acct, owner, plan, agents, budget, proposals] = await Promise.all([
      rpc({ request_type: "view_account", account_id: contractId }),
      view<string>(contractId, "get_owner"),
      view<ContractPlan | null>(contractId, "get_plan"),
      view<string[]>(contractId, "get_agents"),
      view<unknown>(contractId, "get_budget"),
      view<ProposalView[]>(contractId, "list_proposals", { from_id: "0", limit: 50 }),
    ]);
    return {
      status: "configured",
      contractId,
      note: "Deployed instance read from finalized state.",
      authority: AUTHORITY_NOTE,
      codeHash: String(acct.code_hash),
      owner: owner.data ?? null,
      ownerIsAccount: !!accountId && owner.data === accountId,
      plan: plan.data,
      agents: agents.data,
      budget: budget.data,
      proposals: proposals.data,
      capturedAt,
    };
  } catch (e) {
    return { status: "unreachable", contractId, note: "Configured, but its views could not be read: " + (e as Error).message, authority: AUTHORITY_NOTE, capturedAt };
  }
}

export const OWNER_METHODS = ["set_plan", "add_agent", "remove_agent", "approve", "reject"] as const;
export type OwnerMethod = (typeof OWNER_METHODS)[number];
const OWNER_GAS = "30000000000000"; // 30 Tgas

/** One unsigned owner call. The contract requires exactly 1 yoctoNEAR from the owner and schedules it back. */
export function ownerCall(state: ContractState, accountId: string, method: OwnerMethod, args: Record<string, unknown>) {
  if (state.status === "not_deployed") throw new Error(NOT_DEPLOYED_NOTE);
  if (state.status !== "configured" || !state.contractId) throw new Error(state.note);
  if (!state.ownerIsAccount) throw new Error(`Only the contract owner (${state.owner ?? "unknown"}) can call ${method}; this workspace is ${accountId}.`);
  return {
    kind: "policy_contract_owner_call" as const,
    accountId,
    contractId: state.contractId,
    method,
    transactions: [
      {
        receiverId: state.contractId,
        actions: [{ type: "FunctionCall" as const, params: { methodName: method, args, gas: OWNER_GAS, deposit: "1" } }],
      },
    ],
    expiresAt: new Date(Date.now() + 180_000).toISOString(),
    authority: AUTHORITY_NOTE,
    verification: "After signing, GET /api/policy-contract re-reads finalized contract state; the change is real only when it appears there.",
    warning: "Prepared transaction only. It moves 1 yoctoNEAR for owner authentication (returned by the contract) and no investment funds.",
  };
}
