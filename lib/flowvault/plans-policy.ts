// Policy entries a plan step needs (owner: Interface). Policy stays default-deny: these entries are only
// ever added by the owner's explicit "Allow in Policy" confirmation, as a new policy revision that adds
// EXACTLY the listed entries and changes nothing else (same pattern as the 1Click payout entries).
// The lists mirror what the journals check at prepare time: lending.ts (Rhea credit) and
// staking-options.ts (LST deposit_and_stake). A step kind not listed here needs nothing new.
import type { Policy } from "./policy.ts";
import { SUPPLY_RHEA as RHEA, SUPPLY_USDC as USDC } from "./supply.ts";

export const LST_CONTRACT: Record<string, string> = { LiNEAR: "linear-protocol.near", rNEAR: "lst.rhealab.near" };
const STAKE_VENUE: Record<string, string> = { linear: "linear-protocol.near", rnear: "lst.rhealab.near" };

export type PolicyEntry =
  | { type: "venue"; venue: string; label: string }
  | { type: "method"; receiver: string; method: string; label: string };

const venue = (v: string, what: string): PolicyEntry => ({ type: "venue", venue: v, label: `Venue ${v} (${what})` });
const method = (receiver: string, m: string, what: string): PolicyEntry => ({ type: "method", receiver, method: m, label: `${m} on ${receiver} (${what})` });

/** Entries one step needs. `asset` is the collateral asset; `strategy` the staking venue id (linear | rnear). */
export function stepEntries(kind: string, opts: { asset?: string; strategy?: string } = {}): PolicyEntry[] {
  switch (kind) {
    case "borrow":
      return [venue(RHEA, "Rhea lending"), method(RHEA, "execute_with_pyth", "borrow USDC at Pyth prices")];
    case "collateral_release":
      return [venue(RHEA, "Rhea lending"), method(RHEA, "execute_with_pyth", "release collateral at Pyth prices")];
    case "collateral_add": {
      const token = opts.asset ? LST_CONTRACT[opts.asset] : undefined;
      return token ? [venue(RHEA, "Rhea lending"), method(token, "ft_transfer_call", `pledge ${opts.asset} to Rhea`)] : [];
    }
    case "repay":
      return [venue(RHEA, "Rhea lending"), method(USDC, "ft_transfer_call", "repay USDC to Rhea")];
    case "stake": {
      const v = opts.strategy ? STAKE_VENUE[opts.strategy] : undefined;
      return v ? [venue(v, "liquid staking"), method(v, "deposit_and_stake", "stake NEAR")] : [];
    }
    default:
      return [];
  }
}

const key = (e: PolicyEntry) => (e.type === "venue" ? "v:" + e.venue : "m:" + e.receiver + ":" + e.method);
function has(policy: Pick<Policy, "venues" | "methods">, e: PolicyEntry) {
  return e.type === "venue" ? policy.venues.includes(e.venue) : policy.methods.some((m) => m.receiver === e.receiver && m.method === e.method);
}

/** Entries the policy is missing for these steps, deduplicated, in step order. */
export function missingEntries(policy: Pick<Policy, "venues" | "methods">, steps: { kind: string; asset?: string; strategy?: string }[]) {
  const seen = new Set<string>();
  const out: PolicyEntry[] = [];
  for (const s of steps)
    for (const e of stepEntries(s.kind, s))
      if (!seen.has(key(e)) && !has(policy, e)) {
        seen.add(key(e));
        out.push(e);
      }
  return out;
}

/** The next revision's content: the current policy plus exactly these entries. Nothing is removed or changed. */
export function withEntries<P extends Pick<Policy, "venues" | "methods">>(policy: P, entries: PolicyEntry[]): P {
  const next = { ...policy, venues: [...policy.venues], methods: [...policy.methods] };
  for (const e of entries) {
    if (has(next, e)) continue;
    if (e.type === "venue") next.venues.push(e.venue);
    else next.methods.push({ receiver: e.receiver, method: e.method });
  }
  return next;
}

/** Steps of a plan's chosen (or recommended) alternative, with the collateral asset or staking venue each needs. */
export function planPolicySteps(plan: {
  selectedChoiceId?: string;
  recommendedChoiceId?: string;
  alternatives: { id: string; steps: string[] }[];
  collateral?: { asset: string }[];
}) {
  const choice = plan.alternatives.find((a) => a.id === (plan.selectedChoiceId ?? plan.recommendedChoiceId));
  if (!choice) return [];
  let c = 0;
  return choice.steps.map((kind) =>
    kind === "collateral_add" || kind === "collateral_release"
      ? { kind, asset: plan.collateral?.[c++]?.asset }
      : kind === "stake"
        ? { kind, strategy: choice.id }
        : { kind },
  );
}
