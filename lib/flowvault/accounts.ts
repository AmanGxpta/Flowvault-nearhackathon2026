import { z } from "zod";
import { validEvm } from "./evm.ts";
import type { Position, Source } from "./types.ts";
export const nearAddress = z
  .string()
  .regex(/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/);
const evm = z.string().refine(validEvm, "Enter a valid EVM address.");
export const evmAddressesSchema = z
  .object({ base: evm.optional(), arb: evm.optional() })
  .strict();
export const watchedAccountsSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(100),
        chain: z.enum(["near", "base", "arb"]),
        address: z.string(),
      })
      .strict()
      .refine(
        (x) =>
          x.chain === "near"
            ? nearAddress.safeParse(x.address).success
            : validEvm(x.address),
        "Watch address does not match its chain.",
      ),
  )
  .max(12)
  .refine(
    (xs) => new Set(xs.map((x) => x.id)).size === xs.length,
    "Duplicate watched account ID.",
  );
export function displayPosition(
  p: Position,
  source: Source,
  capturedAt: string,
): Position {
  return {
    ...p,
    label: p.label || p.asset + " position",
    chain: p.chain ?? "near",
    source,
    capturedAt: p.capturedAt ?? capturedAt,
    ownership: p.ownership ?? "owner",
    valuation: p.valuation ?? null,
  };
}
export function ownerPositions(p: Position[]) {
  return p.filter((x) => x.ownership !== "watched");
}
