// Demo Mode simulation, pure. The example workspace can't sign, so its flows play a scripted run instead: a step the
// viewer "approves" waits briefly in the (pretend) wallet, then is in progress, then lands. State is derived from
// the time each step was approved, so a reloaded page shows exactly where the run stands. Every hash is labelled as
// an example and links nowhere.
export interface SimAttempt { id: string; state: string; message: string; hashes: number; hash: string | null; deliveredRaw?: string | null; refundedRaw?: null; suppliedRaw?: string | null }
export interface SimTiming { walletMs: number; settleMs: number }
export const SIM_DEFAULT: SimTiming = { walletMs: 1600, settleMs: 9000 };

/** A short, stable, obviously fictional hash for a simulated transaction. */
export function exampleHash(seed: string) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return "example-" + hex(h) + hex(Math.imul(h, 2654435761));
}

/** The simulated journal attempt for one step: null until approved. `deliveredRaw` lands with confirmation. */
export function simAttempt(id: string, approvedAt: number | null | undefined, now: number, o: Partial<SimTiming> & { deliveredRaw?: string | null; suppliedRaw?: string | null; working?: string; done?: string } = {}): SimAttempt | null {
  if (!approvedAt) return null;
  const t = { ...SIM_DEFAULT, ...o }, elapsed = now - approvedAt;
  if (elapsed < t.walletMs) return { id, state: "awaiting_wallet", message: "Example: approving in the wallet…", hashes: 0, hash: null };
  const hash = exampleHash(id);
  if (elapsed < t.settleMs) return { id, state: "submitted", message: o.working ?? "Example: in progress.", hashes: 1, hash };
  return { id, state: "confirmed", message: o.done ?? "Example: completed.", hashes: 1, hash, deliveredRaw: o.deliveredRaw ?? null, refundedRaw: null, suppliedRaw: o.suppliedRaw ?? null };
}

/** Example delivery after a route: the quoted output less a small, made-up shortfall (never above the quote). */
export function simDelivered(expectedRaw: string | null | undefined, bps = 8n) {
  if (!expectedRaw || !/^\d+$/.test(expectedRaw)) return null;
  const v = BigInt(expectedRaw);
  return (v - (v * bps) / 10_000n).toString();
}
