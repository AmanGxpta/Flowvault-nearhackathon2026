import { z } from "zod";
import { units } from "./money.ts";
const amount = z
  .string()
  .max(40)
  .refine((v) => {
    try {
      units(v);
      return true;
    } catch {
      return false;
    }
  }, "Use a nonnegative USDC amount with at most 6 decimals.");
export const mandateSchema = z.object({
  reserve: amount,
  cashAmount: amount,
  cashDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
      "Choose a valid cash date.",
    ),
  destination: z.enum(["arb", "base", "near", "bnb", "eth"]),
  leadDays: z.number().int().min(1).max(7).default(3),
  horizon: z.number().int().min(1).max(3650),
  maxMoveCost: amount,
  approved: z
    .array(z.enum(["rhea-usdc", "usdc-vault", "linear", "rnear", "native"]))
    .max(5),
  borrowing: z.boolean(),
});
