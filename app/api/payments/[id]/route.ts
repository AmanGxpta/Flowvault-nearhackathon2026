import { payoutAsset } from "@/lib/flowvault/evm";
import { z } from "zod";
import { session, save, json, failure, mutation } from "@/lib/flowvault/store";
import {
  paymentGet,
  paymentSave,
  claimDestination,
  releasePaymentLock,
} from "@/lib/flowvault/payment-store";
import {
  preparePaymentWithdrawal,
  executableQuote,
  prepareDepositAttempt,
  pollPayment,
  assertPaymentContext,
} from "@/lib/flowvault/payment-service";
import { readAttempt } from "@/lib/flowvault/attempts";
import { destinationProof } from "@/lib/flowvault/evm";
import { obligationIdentity } from "@/lib/flowvault/payments";
import { units } from "@/lib/flowvault/money";
import { appendStep } from "@/lib/flowvault/timeline";
import {
  invalidatePlan,
  projectObligations,
} from "@/lib/flowvault/obligations";
import { withCapitalEvidence } from "@/lib/flowvault/valuation-evidence";
function idOf(r: Request) {
  return new URL(r.url).pathname.split("/").filter(Boolean).at(-1)!;
}
async function cleanupCancelled(
  r: Request,
  sessionId: string,
  p: import("@/lib/flowvault/payments").PaymentPlan,
) {
  const current = await session(r);
  const o = current.workspace.obligations.find((x) => x.id === p.obligationId);
  if (
    o?.status === "processing" &&
    obligationIdentity(o) === p.obligationIdentity
  ) {
    o.status = "pending";
    await save(current.id, current.workspace, current.revision);
  }
  await releasePaymentLock(sessionId, p);
}
export async function GET(r: Request) {
  try {
    const s = await session(r);
    await withCapitalEvidence(s.workspace);
    return json({ payment: (await paymentGet(s.id, idOf(r))).plan }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    await withCapitalEvidence(s.workspace);
    const b = z
      .object({
        action: z.enum([
          "prepare-withdraw",
          "quote",
          "prepare-deposit",
          "poll",
          "cancel",
        ]),
      })
      .parse(await r.json());
    const { plan: p, previous } = await paymentGet(s.id, idOf(r));
    if (["paid", "cancelled"].includes(p.state)) {
      if (p.state === "cancelled") await cleanupCancelled(r, s.id, p);
      return json({ payment: p }, s.cookie);
    }
    let attempt;
    if (b.action === "poll") {
      await pollPayment(s.id, p);
      if (p.state === "destination-proof-required") {
        if (
          !p.depositAttemptId ||
          (await readAttempt(s.id, p.depositAttemptId)).attempt.state !==
            "confirmed"
        )
          p.message =
            "Destination reported delivered; verify the source deposit attempt first.";
        else {
          const hashes =
            p.lastStatus?.swapDetails?.destinationChainTxHashes ?? [];
          if (!hashes.length)
            p.message =
              "Provider SUCCESS has no destination hash yet; payout is unverified.";
          else {
            let proof;
            let last = "Destination proof unavailable.";
            for (const x of hashes) {
              try {
                proof = await destinationProof(
                  payoutAsset(
                    p.obligationSnapshot.destination,
                    p.obligationSnapshot.token,
                  ).chain,
                  x.hash,
                  p.obligationSnapshot.recipient,
                  units(
                    p.obligationSnapshot.amount,
                    payoutAsset(
                      p.obligationSnapshot.destination,
                      p.obligationSnapshot.token,
                    ).decimals,
                  ).toString(),
                  p.createdAt,
                  p.obligationSnapshot.token as "USDC" | "USDT",
                );
                break;
              } catch (e) {
                last = String(e);
              }
            }
            if (proof) {
              await claimDestination(p.id, proof);
              p.destinationProof = proof;
              p.state = "paid";
              p.message =
                "Exact recipient payout independently verified on the finalized destination chain.";
              appendStep(p, "destination", "paid", p.message, {
                explorerLinks: [proof.explorerUrl],
                evidence: proof,
              });
              const current = await session(r);
              const o = current.workspace.obligations.find(
                (o) => o.id === p.obligationId,
              );
              if (
                current.workspace.mode === "live" &&
                current.workspace.accountId === p.accountId &&
                o &&
                obligationIdentity(o) === p.obligationIdentity &&
                ["pending", "processing"].includes(o.status)
              ) {
                o.status = "paid";
                invalidatePlan(current.workspace);
                projectObligations(current.workspace);
                await save(current.id, current.workspace, current.revision);
              }
            } else {
              p.message = last;
              appendStep(p, "destination", "unverified", last);
            }
          }
        }
      }
    } else if (b.action === "cancel") {
      // Cancelling an unhanded old plan must remain possible after a workspace revision.
      if (
        p.depositAttemptId &&
        (await readAttempt(s.id, p.depositAttemptId)).attempt.state !==
          "prepared"
      )
        throw new Error(
          "Payment reached the wallet; recover and verify it instead of cancelling.",
        );
      if (p.retainedSignedQuote) {
        const { providerStatus } = await import(
          "@/lib/flowvault/payment-service"
        );
        const status = await providerStatus(
          p.retainedSignedQuote.quote.depositAddress,
        );
        if (status?.status !== "PENDING_DEPOSIT")
          throw new Error(
            "Provider is not waiting for an untouched deposit; keep tracking this payment.",
          );
      }
      p.state = "cancelled";
      p.message =
        "Payment cancelled before wallet handoff. No automatic refund or execution claim.";
      appendStep(p, "cancel", "cancelled", p.message);
    } else {
      assertPaymentContext(p, s.workspace);
      if (b.action === "prepare-withdraw")
        attempt = await preparePaymentWithdrawal(s.id, s.workspace, p);
      if (b.action === "quote") await executableQuote(s.id, s.workspace, p);
      if (b.action === "prepare-deposit")
        attempt = await prepareDepositAttempt(s.id, s.workspace, p);
    }
    await paymentSave(s.id, p, previous);
    if (b.action === "cancel") {
      await cleanupCancelled(r, s.id, p);
    } else if (b.action === "quote" || b.action === "prepare-deposit") {
      const current = await session(r);
      const o = assertPaymentContext(p, current.workspace);
      if (o.status === "pending") {
        o.status = "processing";
        await save(current.id, current.workspace, current.revision);
      }
    }
    return json(
      {
        payment: p,
        ...(attempt
          ? {
              attempt,
              preparation: { ...attempt.preparation, attemptId: attempt.id },
            }
          : {}),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
