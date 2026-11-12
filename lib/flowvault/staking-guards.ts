/** Every in-flight wallet movement for this account fences every other movement, including future journal kinds. */
export function stakingHandoffGuard(base: string) {
  const marker =
    " AND COALESCE(json_extract(a.payload,'$.kind'),'supply') IN ('pay','supply')";
  if (!base.includes(marker))
    throw new Error(
      "Outgoing handoff guard changed; inspect before authorizing staking.",
    );
  return base.replace(marker, "");
}
