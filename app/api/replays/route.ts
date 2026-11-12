import { z } from "zod";
import { json, failure } from "@/lib/flowvault/store";
import {
  replays,
  REPLAY_KINDS,
  REPLAY_OUTCOMES,
} from "@/lib/flowvault/replays";
export async function GET(r: Request) {
  try {
    const q = Object.fromEntries(new URL(r.url).searchParams);
    const filter = z
      .object({
        workspace: z.enum(["example", "personal", "live"]).optional(),
        kind: z.enum(REPLAY_KINDS).optional(),
        outcome: z.enum(REPLAY_OUTCOMES).optional(),
        id: z.string().startsWith("simulated:").optional(),
      })
      .strict()
      .parse(q);
    const data = replays(filter);
    if (filter.id && !data.length)
      throw new Error("Simulated replay not found.");
    return json({
      source: "simulated",
      simulation: true,
      label: "SIMULATED — no funds moved",
      readOnly: true,
      replays: data,
    });
  } catch (e) {
    return failure(e);
  }
}
