/** Extend the existing account/session handoff lock, atomically in both directions. */
export function stakingHandoffGuard(base: string) {
  const marker = "IN ('pay','supply')";
  if (!base.includes(marker))
    throw new Error(
      "Outgoing handoff guard changed; inspect before authorizing staking.",
    );
  return base.replace(
    marker,
    "IN ('pay','supply','withdraw','stake','unstake','withdraw_unstaked','collateral_add','borrow','repay','collateral_release')",
  );
}
