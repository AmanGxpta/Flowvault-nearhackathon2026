import type { Policy } from "./policy";
export type Source = "demo" | "live";
export type Chain = "arb" | "base" | "near" | "bnb" | "eth";
export interface Obligation {
  note?: string;
  recurrence?: "none" | "monthly" | "weekly" | "yearly";
  id: string;
  label: string;
  recipient: string;
  destination: Chain;
  token: "USDC" | "USDT" | "NEAR";
  amount: string;
  dueDate: string;
  status: "pending" | "processing" | "paid" | "cancelled";
  legacyProtected?: boolean;
}
export interface Mandate {
  source?: Source;
  leadDays?: number;
  obligations?: Obligation[];
  reserve: string;
  cashAmount: string;
  cashDate: string;
  destination: Chain;
  horizon: number;
  maxMoveCost: string;
  approved: string[];
  borrowing: boolean;
  version: number;
  /** Engines: evidence-backed reservations attached per request by valuation.attachReservations(); never persisted. */
  evidenceReservations?: import("./contracts").Reservation[];
}
export interface Market {
  id: string;
  name: string;
  token: string;
  asset: "USDC" | "NEAR";
  family: "lending" | "vault" | "staking";
  apr: string | null;
  borrowApr: string | null;
  exitDays: number | null;
  exitLabel: string;
  available: boolean;
  note: string;
}
export interface MarketSnapshot {
  source: Source;
  capturedAt: string;
  blockHeight?: number;
  markets: Market[];
  warnings: string[];
}
export interface Position {
  ownership?: "owner" | "watched";
  assetKey?: string;
  fictional?: boolean;
  valuation?: {
    amount: string;
    unit: "USD";
    source: Source;
    capturedAt: string;
    basis: string;
  } | null;
  /** Interface (A2): "solana" for connected Solana wallets; payouts and obligations stay on `Chain`. */
  chain?: Chain | "solana";
  venue?: string;
  accountId?: string;
  rawAmount?: string;
  decimals?: number;
  source?: Source;
  capturedAt?: string;
  availableAt?: string | null;
  availabilityIsEstimate?: boolean;
  id: string;
  label: string;
  asset: string;
  amount: string;
  kind: "wallet" | "supplied" | "collateral" | "debt" | "staking";
}
export interface PortfolioSection {
  id: string;
  status: "observed" | "partial" | "unavailable" | "not-configured";
  capturedAt: string;
  reasons: string[];
  positionIds: string[];
  affects: (
    | "netWorth"
    | "cashNow"
    | "withdrawableByDate"
    | "committedCapital"
    | "borrowingHeadroom"
  )[];
}
export interface Portfolio {
  sections?: PortfolioSection[];
  accountId: string | null;
  source: Source;
  positions: Position[];
  errors: string[];
  capturedAt: string;
}
export interface Operation {
  id: string;
  title: string;
  kind: string;
  source: Source;
  state: "draft" | "reviewed" | "cancelled" | "superseded";
  createdAt: string;
  expiresAt: string;
  mandateVersion: number;
  payloadHash: string;
  payload: unknown;
}
export interface Workspace {
  exampleSeed?: "design-v1";
  exampleCreditVersion?: number;
  exampleAnchorDate?: string;
  fictional?: boolean;
  evmAddresses?: { base?: string; arb?: string };
  watchedAccounts?: {
    id: string;
    chain: "near" | "base" | "arb";
    address: string;
    label: string;
  }[];
  policyHistory?: { version: number; savedAt: string; summary: string }[];
  policy?: Policy;
  schemaVersion?: number;
  obligations: Obligation[];
  mode: Source;
  accountId: string | null;
  mandate: Mandate;
  operations: Operation[];
  /** Interface (recurrence.ts): generated recurring instance id -> due date, so a deleted instance is never re-created. */
  recurrenceLog?: Record<string, string>;
  /**
   * Interface (account-registry.ts): the accounts you have proven are yours, on any chain. An account enters only
   * through its own wallet (a connection or a signed message); FlowVault never tracks an address you can't prove.
   * `evmAddresses` is derived from it for readers that predate it, and `watchedAccounts` is always empty.
   * "Connected" is never stored: it is whether a wallet can sign for the account right now, known only in the browser.
   */
  accounts?: LinkedAccount[];
}
export type AccountChain = "near" | "evm" | "solana";
export interface LinkedAccount {
  /** `${chain}:${address in canonical form}` */
  id: string;
  chain: AccountChain;
  address: string;
  label: string;
  /**
   * How ownership was proven: nep413 / siwe / siws = the wallet signed a one-time challenge and the server verified
   * it. null = carried over unproven: listed so you can prove it, never read or counted. ("wallet-session" was a
   * browser-reported connection in A1; it is migrated to null and never counts.)
   */
  proof: { method: "wallet-session" | "nep413" | "siwe" | "siws"; at: string } | null;
  /** Networks read for this account: near | ethereum | base | arbitrum | solana. */
  networks: string[];
  /** The NEAR account plans run from (always equals Workspace.accountId). */
  primary?: boolean;
  addedAt: string;
}
export interface CashQuote {
  outputValueUsdc?: string;
  valuation?: import("./payout-valuation").PayoutValuation;
  destinationToken?: "USDC" | "USDT";
  source: Source;
  capturedAt: string;
  validUntil: string;
  amountOut: string;
  minInput: string;
  maxInput: string;
  buffer: string;
  destination: Chain;
  seconds: number;
  raw?: unknown;
}
