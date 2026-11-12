import { isStakingKind } from "./staking-execution.ts";
import type { StakingPreparation } from "./staking-execution.ts";
import { verifyLinearReceipts } from "./staking-receipts.ts";
import type { PayPreparation } from "./payments.ts";
import type { ExecutionStep } from "./timeline.ts";
import { holdback } from "./obligations.ts";
import { prepareSupply, SUPPLY_RHEA, SUPPLY_USDC } from "./supply.ts";
import type { WithdrawPreparation } from "./withdraw.ts";
import { units, decimal } from "./money.ts";
import type { Mandate } from "./types.ts";
import { isLendingKind, verifyLendingOutcome } from "./lending.ts";
import type { LendingPreparation } from "./lending.ts";
export function supplyHoldback(mandate: Mandate) {
  if (!mandate.approved.includes("rhea-usdc"))
    throw new Error("Approve Rhea Lending in your cash plan before supplying.");
  return decimal(holdback(mandate));
}
export type SupplyPreparation = ReturnType<typeof prepareSupply>;
export type PreparationKind =
  | "supply"
  | "withdraw"
  | "pay"
  | "stake"
  | "unstake"
  | "withdraw_unstaked"
  // Engines E2: Rhea credit (lending.ts owns their preparation and verification).
  | "collateral_add"
  | "borrow"
  | "repay"
  | "collateral_release";
export type WalletPreparation =
  | SupplyPreparation
  | WithdrawPreparation
  | PayPreparation
  | LendingPreparation
  | StakingPreparation;
export interface WalletAttempt {
  timeline?: ExecutionStep[];
  retainedSignedQuote?: unknown;
  verificationEvidence?: unknown[];
  id: string;
  accountId: string;
  kind: PreparationKind;
  amount: string;
  mandateVersion: number;
  createdAt: string;
  expiresAt: string;
  state:
    | "prepared"
    | "awaiting_wallet"
    | "submitted"
    | "confirmed"
    | "failed"
    | "partial"
    | "unknown";
  preparation: WalletPreparation;
  hashes: string[];
  message: string;
  updatedAt: string;
}
export function assertSignable(
  attempt: WalletAttempt,
  accountId: string | null,
  mode: string,
  version: number,
  now = Date.now(),
) {
  if (mode !== "live" || accountId !== attempt.accountId)
    throw new Error(
      "Open the prepared account in the live workspace before signing.",
    );
  if (version !== attempt.mandateVersion)
    throw new Error("Your cash plan changed. Prepare and review again.");
  if (
    !Number.isFinite(Date.parse(attempt.expiresAt)) ||
    Date.parse(attempt.expiresAt) <= now
  )
    throw new Error("Preparation expired. Prepare and review again.");
  if (attempt.state !== "prepared")
    throw new Error(
      "This request already reached the wallet. Check its status before making another request.",
    );
}
export function sameTransactions(a: WalletPreparation, b: WalletPreparation) {
  return (
    ("kind" in a ? a.kind : "supply") === ("kind" in b ? b.kind : "supply") &&
    a.accountId === b.accountId &&
    a.amount === b.amount &&
    JSON.stringify(a.transactions) === JSON.stringify(b.transactions)
  );
}
function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function verifyOutcome(
  result: any,
  attempt: WalletAttempt,
): {
  index: number;
  state: "pending" | "confirmed" | "failed";
  message: string;
} {
  const tx = result.transaction;
  if (!tx || tx.signer_id !== attempt.accountId)
    throw new Error("Transaction signer does not match this request.");
  const index = attempt.preparation.transactions.findIndex((expected) => {
    if (
      expected.receiverId !== tx.receiver_id ||
      expected.actions.length !== tx.actions?.length
    )
      return false;
    return expected.actions.every((action, i) => {
      const actual = tx.actions[i]?.FunctionCall;
      if (!actual) return false;
      try {
        const args = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(actual.args), (c) => c.charCodeAt(0)),
          ),
        );
        return (
          actual.method_name === action.params.methodName &&
          String(actual.deposit) === action.params.deposit &&
          String(actual.gas) === action.params.gas &&
          stable(args) === stable(action.params.args)
        );
      } catch {
        return false;
      }
    });
  });
  if (index < 0)
    throw new Error(
      `Transaction payload does not match the reviewed ${attempt.kind}.`,
    );
  if (result.final_execution_status !== "FINAL")
    return {
      index,
      state: "pending",
      message: "Waiting for finalized receipts.",
    };
  if (
    !Array.isArray(result.receipts_outcome) ||
    result.receipts_outcome.length === 0
  )
    return {
      index,
      state: "pending",
      message: "Receipt details are unavailable; success is not verified.",
    };
  const status = result.status;
  const failed =
    status?.Failure ||
    result.receipts_outcome?.some((r: any) => r.outcome?.status?.Failure);
  if (failed)
    return {
      index,
      state: "failed",
      message:
        "A finalized transaction or receipt failed. Inspect the explorer; do not blindly retry.",
    };
  if (!status || typeof status.SuccessValue !== "string")
    return {
      index,
      state: "pending",
      message: "Final outcome is unavailable.",
    };
  if (isStakingKind(attempt.kind)) {
    const p = attempt.preparation as StakingPreparation;
    const proof = verifyLinearReceipts(
      result,
      p.quote,
      attempt.accountId,
      result.stakingTransferReceipts ?? [],
    );
    return {
      index,
      state: proof.state === "pending" ? "pending" : proof.state,
      message:
        proof.state === "confirmed"
          ? "LiNEAR economic effect verified from finalized receipts."
          : proof.reason,
    };
  }
  if (attempt.kind === "withdraw")
    return verifyWithdrawReceipts(result, attempt, index);
  if (attempt.kind === "pay") return verifyPayDeposit(result, attempt, index);
  if (isLendingKind(attempt.kind))
    return verifyLendingOutcome(
      result,
      attempt.preparation as LendingPreparation,
      index,
    );
  // NEP-141 ft_transfer_call resolves to the amount actually used, not merely transaction inclusion.
  if (tx.receiver_id === attempt.preparation.transactions.at(-1)?.receiverId) {
    try {
      const used = JSON.parse(atob(status.SuccessValue));
      const amount = attempt.preparation.transactions.at(-1)!.actions[0].params
        .args as { amount: string };
      if (used !== amount.amount)
        return {
          index,
          state: "failed",
          message:
            "Supply was partially or fully refunded. Refresh balances and inspect the transaction.",
        };
    } catch {
      return {
        index,
        state: "failed",
        message: "Could not verify the resolved token supply amount.",
      };
    }
  }
  return {
    index,
    state: "confirmed",
    message: "Finalized onchain outcome verified.",
  };
}
export function summarizeOutcomes(
  attempt: WalletAttempt,
  outcomes: ReturnType<typeof verifyOutcome>[],
): Pick<WalletAttempt, "state" | "message"> {
  if (outcomes.some((o) => o.state === "failed"))
    return {
      state: "failed",
      message: outcomes.find((o) => o.state === "failed")!.message,
    };
  if (
    (attempt.kind === "withdraw" || attempt.kind === "pay") &&
    (attempt.preparation.transactions.length !== 1 ||
      outcomes.length > 1 ||
      outcomes.some((o) => o.index !== 0))
  )
    return {
      state: "failed",
      message:
        "Withdrawal verification contains an invalid or duplicate transaction step.",
    };
  const confirmed = new Set(
    outcomes.filter((o) => o.state === "confirmed").map((o) => o.index),
  );
  if (confirmed.size === attempt.preparation.transactions.length)
    return {
      state: "confirmed",
      message:
        attempt.kind === "withdraw"
          ? "USDC withdrawal finalized. Exact wallet payout verified."
          : attempt.kind === "pay"
            ? "Source deposit finalized; destination payment remains unverified."
            : isLendingKind(attempt.kind)
              ? (outcomes.find(
                  (o) =>
                    o.index === attempt.preparation.transactions.length - 1,
                )?.message ?? "Lending step finalized and verified.")
              : "USDC supply finalized. Refresh balances to see your position.",
    };
  if (outcomes.length && outcomes.every((o) => o.state === "confirmed"))
    return {
      state: "partial",
      message:
        "Only part of this request is confirmed. Registration alone does not supply USDC. Check the remaining hashes.",
    };
  return {
    state: "submitted",
    message:
      "Waiting for all transaction receipts. Check again; do not submit a duplicate.",
  };
}

/** Only logs emitted by the actual token/Rhea executor count as payout/failure evidence. */
function verifyWithdrawReceipts(
  result: any,
  attempt: WalletAttempt,
  index: number,
): ReturnType<typeof verifyOutcome> {
  const failed = (message: string): ReturnType<typeof verifyOutcome> => ({
    index,
    state: "failed",
    message,
  });
  const expected = units(attempt.amount).toString();
  let exactTransfers = 0;
  let incomplete = false;
  for (const receipt of result.receipts_outcome) {
    const outcome = receipt.outcome;
    if (
      !outcome?.status ||
      !(
        typeof outcome.status.SuccessValue === "string" ||
        typeof outcome.status.SuccessReceiptId === "string"
      )
    )
      incomplete = true;
    const executor = outcome?.executor_id;
    if (typeof executor !== "string") incomplete = true;
    if (executor !== SUPPLY_USDC && executor !== SUPPLY_RHEA) continue;
    if (!Array.isArray(outcome.logs))
      return failed(
        "Withdrawal receipt logs are unavailable; exact USDC payout is unverified.",
      );
    for (const log of outcome.logs) {
      if (typeof log !== "string" || !log.trimStart().startsWith("EVENT_JSON:"))
        continue;
      let event: any;
      try {
        event = JSON.parse(log.trimStart().slice("EVENT_JSON:".length));
      } catch {
        return failed(
          "Withdrawal event is malformed; exact USDC payout is unverified.",
        );
      }
      if (!Array.isArray(event?.data)) continue;
      if (
        executor === SUPPLY_RHEA &&
        event.standard === "burrow" &&
        event.event === "withdraw_failed" &&
        event.data.some(
          (d: any) =>
            d?.account_id === attempt.accountId && d?.token_id === SUPPLY_USDC,
        )
      )
        return failed(
          "Rhea reported withdraw_failed; the withdrawal was refunded to the lending position. Inspect Rhea before retrying.",
        );
      if (
        executor !== SUPPLY_USDC ||
        event.standard !== "nep141" ||
        event.version !== "1.0.0" ||
        event.event !== "ft_transfer"
      )
        continue;
      for (const d of event.data) {
        if (
          !d ||
          typeof d !== "object" ||
          typeof d.amount !== "string" ||
          !/^(0|[1-9]\d*)$/.test(d.amount)
        )
          return failed(
            "Withdrawal transfer event is malformed; exact USDC payout is unverified.",
          );
        if (
          d.old_owner_id === attempt.accountId &&
          d.new_owner_id === SUPPLY_RHEA
        )
          return failed(
            "USDC was returned to Rhea; the withdrawal payout is not confirmed.",
          );
        if (
          d.old_owner_id !== SUPPLY_RHEA ||
          d.new_owner_id !== attempt.accountId
        )
          continue;
        if (d.amount !== expected)
          return failed(
            "Withdrawal transferred a different USDC amount than requested. Inspect the finalized transaction.",
          );
        exactTransfers++;
      }
    }
  }
  // execute returns void; a false callback value cannot be treated as a successful payout.
  if (result.status.SuccessValue === btoa("false"))
    return failed(
      "Withdrawal callback reported failure or refund. Inspect Rhea before retrying.",
    );
  if (incomplete)
    return {
      index,
      state: "pending",
      message: "Withdrawal receipt status is incomplete; payout is unverified.",
    };
  if (exactTransfers !== 1)
    return failed(
      "Exact native USDC transfer from Rhea to the signer could not be verified.",
    );
  return {
    index,
    state: "confirmed",
    message: "Finalized exact native USDC withdrawal payout verified.",
  };
}

function verifyPayDeposit(
  result: any,
  attempt: WalletAttempt,
  index: number,
): ReturnType<typeof verifyOutcome> {
  for (const r of result.receipts_outcome) {
    const st = r.outcome?.status;
    if (
      !st ||
      !(
        typeof st.SuccessValue === "string" ||
        typeof st.SuccessReceiptId === "string"
      ) ||
      !Array.isArray(r.outcome?.logs)
    )
      return {
        index,
        state: "pending",
        message: "Source deposit receipt status or logs are incomplete.",
      };
  }
  const p = attempt.preparation as PayPreparation;
  let matches = 0;
  for (const r of result.receipts_outcome) {
    if (r.outcome?.executor_id !== SUPPLY_USDC) continue;
    for (const log of r.outcome.logs ?? []) {
      if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
      let e: any;
      try {
        e = JSON.parse(log.slice(11));
      } catch {
        return {
          index,
          state: "failed",
          message: "Malformed source USDC deposit event.",
        };
      }
      if (
        e.standard !== "nep141" ||
        e.version !== "1.0.0" ||
        e.event !== "ft_transfer"
      )
        continue;
      for (const d of e.data ?? []) {
        if (
          d.old_owner_id === p.accountId &&
          d.new_owner_id === p.depositAddress &&
          d.amount === units(p.amount).toString()
        )
          matches++;
      }
    }
  }
  return matches === 1
    ? {
        index,
        state: "confirmed",
        message:
          "Source deposit verified. Recipient payment still requires destination proof.",
      }
    : {
        index,
        state: "failed",
        message: "Exact USDC deposit transfer could not be verified.",
      };
}
