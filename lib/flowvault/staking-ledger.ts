import type { ActionPlan, PlanStep, LedgerEntry } from "./contracts.ts";
import type { WalletAttempt } from "./execution.ts";
import type { StakingPreparation } from "./staking-execution.ts";
import type { ActionValuation } from "./valuation.ts";
/** Count the latest verified fee per transaction once, even after repeated status polls. */
export function stakingFeeRaw(a: WalletAttempt): bigint | null {
  const latest = new Map<
    string,
    NonNullable<WalletAttempt["timeline"]>[number]
  >();
  for (const row of a.timeline ?? [])
    if (
      row.phase.startsWith("receipt:") &&
      a.hashes.includes(row.phase.slice(8))
    )
      latest.set(row.phase, row);
  if (latest.size !== a.hashes.length || !latest.size) return null;
  let total = 0n;
  for (const row of latest.values())
    for (const f of row.fees) {
      if (
        !f.verified ||
        f.unit !== "yoctoNEAR" ||
        typeof f.amount !== "string" ||
        !/^\d+$/.test(f.amount)
      )
        return null;
      total += BigInt(f.amount);
    }
  if ([...latest.values()].some((row) => !row.fees.length)) return null;
  return total;
}
/** Principal is internal, never yield. Only journal-verified economic effects produce principal entries. */
export function stakingJournalLedger(
  a: WalletAttempt,
  feeValue?: ActionValuation,
): LedgerEntry[] {
  const p = a.preparation as StakingPreparation;
  const entries: LedgerEntry[] = [],
    at = a.updatedAt;
  const base = {
    at,
    chain: "near" as const,
    liabilityEffectUsdcRaw: "0",
    attemptId: a.id,
    txHashes: a.hashes,
    source: "live" as const,
    status: "confirmed" as const,
  };
  if (a.state === "confirmed") {
    const effects = (a.verificationEvidence ?? [])
      .filter(
        (e: any) =>
          a.hashes.includes(e.hash) &&
          e.verifiedState === "confirmed" &&
          e.stakingEffect?.state === "confirmed",
      )
      .map((e: any) => e.stakingEffect);
    if (effects.length !== 1)
      throw new Error("Confirmed LiNEAR journal has no unique economic proof.");
    const e: any = effects[0],
      asset = p.asset,
      amountRaw =
        p.kind === "stake"
          ? p.amountRaw
          : p.kind === "unstake"
            ? e.amountRaw
            : e.nearAmountRaw;
    if (typeof amountRaw !== "string" || !/^[1-9]\d*$/.test(amountRaw))
      throw new Error("LiNEAR ledger quantity is unverified.");
    if (amountRaw !== p.amountRaw)
      throw new Error(
        "Staking source principal differs from the reviewed quantity.",
      );
    entries.push({
      ...base,
      id: a.id + ":principal",
      kind:
        p.kind === "stake"
          ? "position_entry"
          : p.kind === "unstake"
            ? "internal_transfer"
            : "position_exit",
      asset,
      amountRaw,
      decimals: 24,
      usdcRaw: p.usdcValueRaw,
      netWorthEffectUsdcRaw: "0",
      realized: false,
      positionId: p.kind === "stake" ? "native" : (p.quote?.protocol ?? "linear"),
      basis:
        "Finalized " + (p.quote?.protocol ?? "linear") + " " +
        p.kind +
        "; source principal movement, not profit. Minted/exit quantities are in receipt evidence. USDC field is review-time Engines cap valuation: " +
        p.valuationBasis,
    });
  }
  const fee = stakingFeeRaw(a);
  if (["confirmed", "failed"].includes(a.state) && fee !== null && fee > 0n) {
    const usd = feeValue?.usdcRaw ?? null;
    entries.push({
      ...base,
      id: a.id + ":network-fee",
      kind: "fee",
      asset: "NEAR",
      amountRaw: fee.toString(),
      decimals: 24,
      usdcRaw: usd,
      netWorthEffectUsdcRaw: usd === null ? null : "-" + usd,
      realized: true,
      positionId: (p.quote?.protocol ?? "linear") + (p.kind === "stake" ? "-shares" : "-unstaking"),
      basis:
        "Actual finalized tokens_burnt, once per source hash. USDC is Engines upper-bound equivalence at reconciliation, not historical spot: " +
        (feeValue?.basis ?? "unavailable"),
    });
  }
  return entries;
}

/** Plan wrapper over the same canonical journal effects; Engines can consume the mapper directly. */
export function stakingLedger(
  plan: ActionPlan,
  step: PlanStep,
  a: WalletAttempt,
  feeValue?: ActionValuation,
): LedgerEntry[] {
  if (
    plan.source !== "live" ||
    a.accountId !== plan.accountId ||
    a.kind !== step.kind
  )
    throw new Error("Staking ledger identity mismatch.");
  return stakingJournalLedger(a, feeValue).map((e) => ({
    ...e,
    planId: plan.id,
    stepId: step.id,
  }));
}
