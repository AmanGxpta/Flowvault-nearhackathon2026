import type { AssistantContext } from "./assistant.ts";
import { evaluateAssistant, proposalSchema } from "./assistant.ts";
/** Exact obligation identity avoids ambiguous free-text matching. Never prepares a payment. */
export function compareObligation(
  id: string,
  context: AssistantContext,
  now = Date.now(),
) {
  const obligation = context.workspace.obligations.find((o) => o.id === id);
  if (!obligation) throw new Error("Obligation not found.");
  if (["paid", "cancelled"].includes(obligation.status))
    throw new Error("Obligation is not payable.");
  const result = evaluateAssistant(
    proposalSchema.parse({
      kind: "pay",
      amount: obligation.amount,
      asset: obligation.token,
      chain: obligation.destination,
      dueDate: obligation.dueDate,
      recipientLabel: obligation.recipient || obligation.label,
      drawdownBps: null,
      action: null,
      sources: ["wallet-usdc", "rhea-usdc"],
      reasons: ["USER_CASH_REQUEST"],
    }),
    { ...context, obligationId: id },
    now,
  );
  return {
    ...result.evaluation,
    fictional: context.workspace.mode === "demo",
    source: context.workspace.mode,
    signable: false,
    preparesWalletAttempt: false,
  };
}
