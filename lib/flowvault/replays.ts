// 1Click status response shapes with synthetic values (replay-fixtures/).
import success from "./replay-fixtures/success.json" with { type: "json" };
import refunded from "./replay-fixtures/refunded.json" with { type: "json" };
import partial from "./replay-fixtures/incomplete.json" with { type: "json" };
import failed from "./replay-fixtures/failed.json" with { type: "json" };
import expired from "./replay-fixtures/pending-expired.json" with { type: "json" };
export const REPLAY_KINDS = ["supply", "withdraw", "pay"] as const;
export const REPLAY_OUTCOMES = [
  "success",
  "refunded",
  "partial",
  "failed",
  "deadline-passed",
] as const;
export type ReplayKind = (typeof REPLAY_KINDS)[number];
export type ReplayOutcome = (typeof REPLAY_OUTCOMES)[number];
const statuses = {
  success,
  refunded,
  partial,
  failed,
  "deadline-passed": expired,
};
const at = "2026-11-12T12:00:00.000Z";
/** Read-only disconnected recordings: no session writes, live attempt IDs, usable payloads or explorer links. */
export function replay(kind: ReplayKind, outcome: ReplayOutcome) {
  const id = `simulated:${kind}:${outcome}`;
  const isSuccess = outcome === "success";
  const provider = structuredClone(statuses[outcome]);
  const message =
    outcome === "success"
      ? kind === "pay"
        ? "SIMULATED: finalized exact recipient transfer would prove payment."
        : "SIMULATED: exact finalized receipt evidence would confirm this operation."
      : outcome === "refunded"
        ? "SIMULATED: refund reported; returned cash requires separate proof."
        : outcome === "partial"
          ? "SIMULATED: incomplete funding/receipts; do not treat this as completed."
          : outcome === "deadline-passed"
            ? "SIMULATED: deposit deadline passed; no automatic resend or refund claim."
            : "SIMULATED: failed receipt/provider outcome. Inspect evidence before recovery.";
  const state =
    kind === "pay" && isSuccess ? "paid" : isSuccess ? "confirmed" : outcome;
  const receipt = {
    final_execution_status: outcome === "partial" ? "EXECUTED" : "FINAL",
    transaction: {
      hash: "SIMULATED_HASH_NOT_ONCHAIN",
      signer_id: "SIMULATED_OWNER_NOT_USABLE",
      receiver_id: "SIMULATED_CONTRACT_NOT_USABLE",
      actions: [],
    },
    status:
      outcome === "failed"
        ? { Failure: { ActionError: { kind: "SIMULATED_FAILURE" } } }
        : {
            SuccessValue:
              kind === "supply"
                ? btoa(JSON.stringify(outcome === "refunded" ? "0" : "1000000"))
                : "",
          },
    receipts_outcome: [
      {
        id: "SIMULATED_RECEIPT",
        outcome: {
          executor_id: "SIMULATED_USDC_NOT_USABLE",
          tokens_burnt: "100000000000000000000",
          status:
            outcome === "failed"
              ? { Failure: { ActionError: { kind: "SIMULATED_FAILURE" } } }
              : { SuccessValue: "" },
          logs: [
            "EVENT_JSON:" +
              JSON.stringify({
                standard: "nep141",
                version: "1.0.0",
                event: "ft_transfer",
                data: [
                  {
                    old_owner_id:
                      kind === "withdraw"
                        ? "SIMULATED_RHEA_NOT_USABLE"
                        : "SIMULATED_OWNER_NOT_USABLE",
                    new_owner_id:
                      kind === "withdraw"
                        ? "SIMULATED_OWNER_NOT_USABLE"
                        : "SIMULATED_DESTINATION_NOT_USABLE",
                    amount: "1000000",
                  },
                ],
              }),
          ],
        },
      },
    ],
  };
  const phases =
    kind === "pay"
      ? [
          "plan",
          "withdrawal",
          "quote",
          "source-deposit",
          "provider",
          "destination",
        ]
      : ["prepare", "wallet-handoff", "source-transaction", "receipt"];
  return {
    source: "simulated" as const,
    simulation: true as const,
    label: "SIMULATED — no funds moved",
    id,
    kind,
    outcome,
    state,
    readOnly: true as const,
    signable: false as const,
    accountId: null,
    amount: "1",
    unit: "USDC",
    message,
    recording: {
      providerSchema:
        "1Click status response shapes; every identifier and amount is synthetic.",
      receiptSchema:
        "Synthetic NEAR RPC/NEP-141 receipts following existing verified-outcome fixture shapes. No funded FlowVault recording is claimed.",
    },
    timeline: phases.map((phase, i) => ({
      id: id + ":" + i,
      sequence: i + 1,
      at: new Date(Date.parse(at) + i * 60000).toISOString(),
      phase,
      status: i === phases.length - 1 ? state : "simulated",
      source: "simulated",
      label: "SIMULATED",
      message: i === phases.length - 1 ? message : "SIMULATED " + phase,
      explorerLinks: [],
      fees: [
        { unit: "NEAR", amount: "0.0001", verified: false, simulation: true },
      ],
      refund:
        outcome === "refunded"
          ? {
              reportedAmount: "1000000",
              sourceProofVerified: false,
              simulation: true,
            }
          : null,
      evidence: { simulation: true },
    })),
    evidence: {
      source: "simulated",
      provider: kind === "pay" ? provider : null,
      sourceReceipt: receipt,
      destinationProof:
        kind === "pay" && isSuccess
          ? {
              source: "simulated",
              chain: "base",
              transactionHash: "SIMULATED_HASH_NOT_ONCHAIN",
              amountRaw: "1000000",
              finalized: false,
              wouldPassWithActualEvidence: true,
            }
          : null,
    },
    retainedSignedQuote:
      kind === "pay" ? provider.response.quoteResponse : null,
  };
}
export function replays(
  filter: { kind?: ReplayKind; outcome?: ReplayOutcome; id?: string } = {},
) {
  return REPLAY_KINDS.flatMap((kind) =>
    REPLAY_OUTCOMES.map((outcome) => replay(kind, outcome)),
  ).filter(
    (x) =>
      (!filter.kind || x.kind === filter.kind) &&
      (!filter.outcome || x.outcome === filter.outcome) &&
      (!filter.id || x.id === filter.id),
  );
}
