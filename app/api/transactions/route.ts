import { saleJournalAction } from "@/lib/flowvault/sale-journal";
import { swapJournalAction } from "@/lib/flowvault/swap-journal";
import { vaultJournalAction } from "@/lib/flowvault/vault-ops-live"; // Stream A
import { isAave } from "@/lib/flowvault/aave";
import { aaveJournalAction } from "@/lib/flowvault/aave-journal";
import {
  isStakingKind,
  freshStakingAttempt,
  assertStakingContext,
} from "@/lib/flowvault/staking-execution";
import type { StakingPreparation } from "@/lib/flowvault/staking-execution";
import { verifyLinearReceipts } from "@/lib/flowvault/staking-receipts";
import {
  freshPaymentDeposit,
  assertPaymentContext,
} from "@/lib/flowvault/payment-service";
import { paymentGet } from "@/lib/flowvault/payment-store";
import type { PayPreparation } from "@/lib/flowvault/payments";
import { appendStep, outcomeFee } from "@/lib/flowvault/timeline";
import { reservePolicy, checkPolicy } from "@/lib/flowvault/policy-store";
import { preparationAction, defaultPolicy } from "@/lib/flowvault/policy";
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import {
  attemptsDb,
  listAttempts,
  readAttempt,
  saveAttempt,
} from "@/lib/flowvault/attempts";
import {
  supplyHoldback,
  assertSignable,
  sameTransactions,
  verifyOutcome,
  summarizeOutcomes,
} from "@/lib/flowvault/execution";
import { freshSupply, freshWithdraw } from "@/lib/flowvault/prepare";
import { networkRpc } from "@/lib/flowvault/near";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
import { isLendingKind } from "@/lib/flowvault/lending";
import type { LendingPreparation } from "@/lib/flowvault/lending";
import { freshLendingAttempt } from "@/lib/flowvault/lending-live";
import { isNativeKind } from "@/lib/flowvault/staking-native";
import type { NativeStakingPreparation } from "@/lib/flowvault/staking-native";
import { freshNativeAttempt, assertNativeContext } from "@/lib/flowvault/staking-native-live";
import { policyContractId } from "@/lib/flowvault/policy-contract";
import { env as workerEnv } from "cloudflare:workers";
const workerSetting = (name: string) => {
  const v = (workerEnv as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v : process.env[name];
};
import { holdback } from "@/lib/flowvault/obligations";
export async function GET(request: Request) {
  try {
    const s = await session(request);
    await withCapitalEvidence(s.workspace);
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        attempts: await listAttempts(s.id),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    mutation(request);
    const s = await session(request);
    await withCapitalEvidence(s.workspace);
    const b = z
      .object({
        id: z.string().uuid(),
        action: z.enum(["authorize", "attach", "check", "uncertain"]),
        hashes: z
          .array(z.string().regex(/^(?:[1-9A-HJ-NP-Za-km-z]{43,44}|0x[0-9a-fA-F]{64})$/))
          .max(4)
          .optional(),
      })
      .parse(await request.json());
    const { attempt, previous } = await readAttempt(s.id, b.id);
    if (attempt.kind === "sell") return json({attempt:await saleJournalAction(request,b.id,b.action,b.hashes)},s.cookie);
    if (attempt.kind === "swap") return json({ attempt: await swapJournalAction(request, b.id, b.action, b.hashes) }, s.cookie);
    if ((b.hashes?.length ?? 0) > 2) throw new Error("This operation accepts at most two transaction hashes.");
    if (isAave(attempt.preparation)) return json({ attempt: await aaveJournalAction(request, b.id, b.action, b.hashes) }, s.cookie);
    if (attempt.kind.startsWith("vault_")) return json({ attempt: await vaultJournalAction(request, b.id, b.action, b.hashes) }, s.cookie); // Stream A
    if (b.hashes?.some(h => h.startsWith("0x"))) throw new Error("NEAR attempts require NEAR transaction hashes.");
    let authorizationRevision: number | undefined;
    if (b.action === "authorize") {
      assertSignable(
        attempt,
        s.workspace.accountId,
        s.workspace.mode,
        s.workspace.mandate.version,
      );
      const fresh =
        attempt.kind === "pay"
          ? await freshPaymentDeposit(
              attempt.preparation as PayPreparation,
              s.workspace,
              s.id,
            )
          : attempt.kind === "withdraw"
            ? await freshWithdraw(attempt.accountId, attempt.amount)
            : isStakingKind(attempt.kind)
              ? await freshStakingAttempt(
                  attempt.preparation as StakingPreparation,
                  s.workspace,
                  s.revision,
                )
              : isNativeKind(attempt.kind)
                ? await freshNativeAttempt(
                    attempt.preparation as NativeStakingPreparation,
                    s.workspace,
                    s.revision,
                    policyContractId(workerSetting),
                  )
              : isLendingKind(attempt.kind)
                ? await freshLendingAttempt(
                    attempt.preparation as LendingPreparation,
                    s.workspace.policy,
                    attempt.kind === "repay"
                      ? holdback(s.workspace.mandate)
                      : undefined,
                  )
                : await freshSupply(
                    attempt.accountId,
                    supplyHoldback(s.workspace.mandate),
                    attempt.amount,
                  );
      if (!sameTransactions(attempt.preparation, fresh))
        throw new Error(
          "Registration or transaction details changed. Prepare and review again.",
        );
      // Re-read after RPCs so another tab cannot silently change the account/plan during checks.
      const current = await session(request);
      assertSignable(
        attempt,
        current.workspace.accountId,
        current.workspace.mode,
        current.workspace.mandate.version,
      );
      if (isNativeKind(attempt.kind))
        assertNativeContext(attempt.preparation as NativeStakingPreparation, current.workspace, current.revision);
      if (isStakingKind(attempt.kind))
        assertStakingContext(
          attempt.preparation as StakingPreparation,
          current.workspace,
          current.revision,
        );
      await checkPolicy(
        s.id,
        preparationAction(fresh, attempt.kind, attempt.id),
        current.workspace.policy ??
          defaultPolicy(current.workspace.mandate.maxMoveCost),
      );
      await reservePolicy(
        s.id,
        preparationAction(fresh, attempt.kind, attempt.id),
        current.workspace.policy ??
          defaultPolicy(current.workspace.mandate.maxMoveCost),
        current.revision,
      );
      authorizationRevision = current.revision;
      attempt.state = "awaiting_wallet";
      attempt.message =
        "Wallet approval requested. Check status before retrying.";
    } else if (b.action === "uncertain") {
      if (attempt.state === "awaiting_wallet") {
        attempt.state = "unknown";
        attempt.message =
          "Wallet did not return a complete result. It may have been cancelled or partly submitted. Inspect wallet history and attach any hashes before retrying.";
      }
    } else {
      if (attempt.state === "prepared")
        throw new Error("This request has not been opened in the wallet.");
      const hashes = [...new Set([...attempt.hashes, ...(b.hashes ?? [])])];
      if (hashes.length > attempt.preparation.transactions.length)
        throw new Error("Too many transaction hashes for this request.");
      const outcomes: ReturnType<typeof verifyOutcome>[] = [];
      const db = await attemptsDb();
      for (const hash of hashes) {
        const result = await networkRpc("EXPERIMENTAL_tx_status", {
          tx_hash: hash,
          sender_account_id: attempt.accountId,
          wait_until: "FINAL",
        });
        if (result.transaction?.hash !== hash)
          throw new Error("RPC returned a different transaction hash.");
        if (
          isStakingKind(attempt.kind) &&
          attempt.kind === "withdraw_unstaked" &&
          result.final_execution_status === "FINAL"
        ) {
          result.stakingTransferReceipts = await Promise.all(
            (result.receipts_outcome ?? [])
              .filter((o: any) => o.outcome?.executor_id === attempt.accountId)
              .map((o: any) =>
                networkRpc("EXPERIMENTAL_receipt", { receipt_id: o.id }),
              ),
          );
        }
        const outcome = verifyOutcome(result, attempt);
        const stakingProof = isStakingKind(attempt.kind)
          ? verifyLinearReceipts(
              result,
              (attempt.preparation as StakingPreparation).quote,
              attempt.accountId,
              result.stakingTransferReceipts ?? [],
            )
          : undefined;
        const block = await networkRpc("block", {
          block_id: result.transaction_outcome.block_hash,
        });
        if (
          BigInt(block.header.timestamp_nanosec) / 1000000n <
          BigInt(Date.parse(attempt.createdAt))
        )
          throw new Error("This transaction predates the reviewed request.");
        if (outcomes.some((o) => o.index === outcome.index))
          throw new Error("Multiple hashes match the same transaction step.");
        const claim = await db
          .prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?")
          .bind(hash)
          .first<{ attempt_id: string }>();
        if (claim && claim.attempt_id !== attempt.id)
          throw new Error("This hash belongs to a different request.");
        const fee = outcomeFee(result);
        const evidence = {
          hash,
          blockHash: result.transaction_outcome.block_hash,
          blockHeight: block.header.height,
          finality: result.final_execution_status,
          receiptIds: (result.receipts_outcome ?? []).map((x: any) => x.id),
          verifiedState: outcome.state,
          ...(stakingProof ? { stakingEffect: stakingProof } : {}),
        };
        attempt.verificationEvidence = [
          ...(attempt.verificationEvidence ?? []).filter(
            (x: any) => x.hash !== hash,
          ),
          evidence,
        ];
        appendStep(attempt, "receipt:" + hash, outcome.state, outcome.message, {
          explorerLinks: ["https://nearblocks.io/txns/" + hash],
          fees: [fee],
          refund: /refund|returned/i.test(outcome.message)
            ? { reported: true, message: outcome.message, amount: null }
            : null,
          evidence,
        });
        outcomes.push(outcome);
      }
      // Unique hashes cannot be attributed to two different requests.
      for (const hash of hashes) {
        await db
          .prepare(
            "INSERT OR IGNORE INTO wallet_hashes (hash,attempt_id) VALUES (?,?)",
          )
          .bind(hash, attempt.id)
          .run();
        const claim = await db
          .prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?")
          .bind(hash)
          .first<{ attempt_id: string }>();
        if (claim?.attempt_id !== attempt.id)
          throw new Error("This hash belongs to a different request.");
      }
      attempt.hashes = hashes;
      if (hashes.length)
        Object.assign(attempt, summarizeOutcomes(attempt, outcomes));
      else
        attempt.message =
          "No hashes returned yet. Inspect wallet history, then attach hashes to verify.";
    }
    await saveAttempt(s.id, attempt, previous, authorizationRevision);
    return json({ attempt }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
