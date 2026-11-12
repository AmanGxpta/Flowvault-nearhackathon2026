// Engines: evaluates the orchestrator's StrategySpecs against the live StepAdapter registry. Read-only.
// A spec is eligible to run only when validateStrategySpec finds nothing AND every entry, exit and shutdown
// step has a registered adapter. A pooled vault is never eligible.
import { STRATEGY_SPECS, validateStrategySpec } from "./strategy-spec.ts";
import type { StrategySpec } from "./strategy-spec.ts";
import type { StepKind } from "./contracts.ts";

export interface StrategyEligibility {
  spec: StrategySpec;
  eligible: boolean;
  problems: string[];
  missingAdapters: StepKind[];
  registeredSteps: StepKind[];
}

export function strategyEligibility(registered: StepKind[], specs: StrategySpec[] = STRATEGY_SPECS): StrategyEligibility[] {
  return specs.map((spec) => {
    const steps = [...new Set([...spec.entry, ...spec.exit, ...spec.shutdown.steps])];
    const missingAdapters = steps.filter((k) => k !== "wait_until" && !registered.includes(k));
    const problems = validateStrategySpec(spec, registered);
    if (["paused", "retired"].includes(spec.status)) problems.push(`Strategy is ${spec.status}.`);
    return {
      spec,
      eligible: problems.length === 0 && missingAdapters.length === 0 && spec.kind === "account_strategy",
      problems,
      missingAdapters,
      registeredSteps: steps.filter((k) => !missingAdapters.includes(k)),
    };
  });
}
