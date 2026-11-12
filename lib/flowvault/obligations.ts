import { defaultPolicy } from "./policy.ts";
import { z } from "zod";
import { units, decimal } from "./money.ts";
import type { Mandate, Workspace, Obligation } from "./types.ts";
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid due date.",
  );
const amount = z
  .string()
  .max(40)
  .refine((v) => {
    try {
      return units(v) > 0n;
    } catch {
      return false;
    }
  }, "Use a positive net amount with at most 6 decimals.");
export const obligationInput = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  label: z.string().trim().min(1).max(120),
  recipient: z.string().trim().max(100),
  destination: z.enum(["near", "arb", "base", "bnb", "eth"]),
  note: z.string().max(2000).optional(),
  recurrence: z.enum(["none", "monthly", "weekly", "yearly"]).default("none"),
  token: z.enum(["USDC", "USDT", "NEAR"]),
  amount,
  dueDate: dateSchema,
  status: z.enum(["pending", "cancelled"]).default("pending"),
});
export function obligationCash(m: Mandate, now = Date.now()): bigint {
  if (!m.obligations) return units(m.cashAmount); // legacy callers retain the original guard
  const end = Date.parse(
    new Date(now + m.horizon * 86400000).toISOString().slice(0, 10) +
      "T23:59:59.999Z",
  );
  return m.obligations
    .filter(
      (o) =>
        !["paid", "cancelled"].includes(o.status) &&
        (o.legacyProtected || Date.parse(o.dueDate + "T23:59:59.999Z") <= end),
    )
    .reduce((sum, o) => {
      if (o.token !== "USDC" && !(m.source === "demo" && o.token === "USDT"))
        throw new Error(
          "Obligation valuation unavailable: only native USDC obligations can be reserved automatically.",
        );
      return sum + units(o.amount);
    }, 0n);
}
export function holdback(m: Mandate, now = Date.now()) {
  return units(m.reserve) + obligationCash(m, now);
}
export function invalidatePlan(w: Workspace) {
  w.mandate.version++;
  w.operations = w.operations.map((o) =>
    o.state === "draft" ? { ...o, state: "superseded" } : o,
  );
}
export function projectObligations(w: Workspace, now = Date.now()): Workspace {
  w.mandate.source = w.mode;
  w.mandate.leadDays ??= 3;
  w.mandate.obligations = w.obligations;
  try {
    w.mandate.cashAmount = decimal(obligationCash(w.mandate, now));
  } catch {
    /* retain legacy projection; executable guard still throws */
  }
  const earliest = w.obligations
    .filter((o) => !["paid", "cancelled"].includes(o.status))
    .sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
    )[0];
  if (earliest) {
    w.mandate.cashDate = earliest.dueDate;
    w.mandate.destination = earliest.destination;
  }
  return w;
}
export function migrateWorkspace(
  input: unknown,
  now = Date.now(),
): { workspace: Workspace; changed: boolean } {
  const w = structuredClone(input) as Workspace;
  let changed = false;
  if (!Array.isArray(w.obligations)) {
    w.obligations = [];
    if (units(w.mandate.cashAmount) > 0n)
      w.obligations.push({
        id: "legacy-cash-need",
        label: "Migrated cash need",
        recipient: "",
        destination: w.mandate.destination,
        token: "USDC",
        amount: w.mandate.cashAmount,
        dueDate: w.mandate.cashDate,
        status: "pending",
        legacyProtected: true,
      });
    invalidatePlan(w);
    changed = true;
  }
  w.policy ??= defaultPolicy(w.mandate.maxMoveCost);
  w.schemaVersion = 3;
  return { workspace: projectObligations(w, now), changed };
}
export function editObligation(
  w: Workspace,
  operation: "create" | "update" | "delete",
  input: unknown,
): Workspace {
  const next = structuredClone(w);
  const parsed =
    operation === "delete"
      ? z.object({ id: z.string() }).parse(input)
      : obligationInput.parse(input);
  const id = parsed.id ?? crypto.randomUUID();
  const index = next.obligations.findIndex((o) => o.id === id);
  if (operation === "create" && index >= 0)
    throw new Error("Obligation ID already exists.");
  if (operation !== "create" && index < 0)
    throw new Error("Obligation not found.");
  if (
    index >= 0 &&
    ["paid", "processing"].includes(next.obligations[index].status)
  )
    throw new Error(
      "A processing or verified paid obligation cannot be edited.",
    );
  if (operation === "delete") next.obligations.splice(index, 1);
  else {
    const o = { ...parsed, id } as Obligation;
    if (operation === "create") next.obligations.push(o);
    else next.obligations[index] = o;
  }
  invalidatePlan(next);
  return projectObligations(next);
}
