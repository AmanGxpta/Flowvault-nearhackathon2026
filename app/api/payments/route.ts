import { z } from "zod";
import { session, json, failure, mutation } from "@/lib/flowvault/store";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import {
  paymentList,
  paymentInsert,
  paymentGet,
} from "@/lib/flowvault/payment-store";
import { createPaymentPlan } from "@/lib/flowvault/payment-service";
import { obligationIdentity } from "@/lib/flowvault/payments";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        payments: await paymentList(s.id),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    mutation(r);
    const s = await session(r);
    const b = z
      .object({ key: z.string().uuid(), obligationId: z.string() })
      .parse(await r.json());
    const id = await keyedAttemptId(s.id, "payment:" + b.key);
    let existing;
    try {
      existing = (await paymentGet(s.id, id)).plan;
    } catch (e) {
      if (
        !(e instanceof Error) ||
        e.message !== "Payment plan not found in this session."
      )
        throw e;
    }
    if (existing) {
      const o = s.workspace.obligations.find((x) => x.id === b.obligationId);
      if (
        s.workspace.mode !== "live" ||
        !o ||
        existing.obligationId !== o.id ||
        existing.mandateVersion !== s.workspace.mandate.version ||
        existing.accountId !== s.workspace.accountId ||
        existing.obligationIdentity !== obligationIdentity(o)
      )
        throw new Error(
          "Payment idempotency key conflicts with the current request.",
        );
      return json({ payment: existing }, s.cookie);
    }
    const active = (await paymentList(s.id)).find(
      (p) =>
        p.obligationId === b.obligationId &&
        !["paid", "cancelled"].includes(p.state),
    );
    if (active)
      throw new Error(
        "An active payment already exists for this obligation. Recover or cancel it before replanning.",
      );
    const p = await createPaymentPlan(
      s.workspace,
      id,
      b.key,
      b.obligationId,
      s.id,
    );
    return json({ payment: await paymentInsert(s.id, p) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
