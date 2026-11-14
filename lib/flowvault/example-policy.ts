// The example workspace's limits, in one place: the seeded policy (Risk & permissions), its fictional prior usage
// and the hazard scan every Demo Mode approval shows all read these, so a demo card can never quote a different cap
// than the policy page. Whole US dollars, as the policy stores them. Fictional.
export const EXAMPLE_LIMITS = {
  perActionCap: 5_000,
  dailyCap: 8_000,
  /** Fictional usage already counted against today's daily cap. */
  usedToday: 1_250,
  reserve: 2_000,
} as const;
