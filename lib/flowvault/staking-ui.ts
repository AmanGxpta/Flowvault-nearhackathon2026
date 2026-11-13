import { units } from "./money.ts";
export const STAKING_GAS_RESERVE = 5n * 10n ** 23n;
export const STAKING_FEE_ROOM = 5n * 10n ** 22n;
/** Display allowance only. Preparation always requotes and checks the actual account's reserve and fees. */
export function availableToStake(raw?: string | null): bigint | null {
  if (typeof raw !== "string" || !/^\d{1,80}$/.test(raw)) return null;
  const remaining = BigInt(raw) - STAKING_GAS_RESERVE - STAKING_FEE_ROOM;
  return remaining > 0n ? remaining : 0n;
}
export function estimatedLinearShares(amount: bigint | null, price?: string | null): string | null {
  if (amount === null || amount <= 0n || typeof price !== "string" || !/^[1-9]\d{0,79}$/.test(price)) return null;
  return (amount * 10n ** 24n / BigInt(price)).toString();
}
export function estimatedYearlyNear(amount: bigint | null, apr?: string | null): bigint | null {
  if (amount === null || amount <= 0n || !apr) return null;
  try { return amount * units(apr, 6) / 100_000000n; } catch { return null; }
}
export function stakeAttemptMode(attempt?: {state:string;hashes:number} | null): "new" | "resume" | "track" | "done" | "attention" {
  if (!attempt) return "new";
  if (attempt.state === "confirmed") return "done";
  if (["awaiting_wallet", "submitted", "unknown", "partial"].includes(attempt.state)) return "track";
  if (attempt.state === "prepared") return "resume";
  return attempt.hashes > 0 ? "attention" : "new";
}
