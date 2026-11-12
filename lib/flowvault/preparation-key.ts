import { decimal, positive } from "./money.ts";
import type { PreparationKind, WalletAttempt } from "./execution.ts";
export interface PreparationRequest {
  kind: PreparationKind;
  accountId: string;
  mandateVersion: number;
  amount: string;
}
export function requestIdentity(request: PreparationRequest): string {
  return JSON.stringify([
    request.kind,
    request.accountId,
    request.mandateVersion,
    decimal(positive(request.amount)),
  ]);
}
export function assertPreparationRetry(
  attempt: WalletAttempt,
  request: PreparationRequest,
) {
  if (requestIdentity(attempt) !== requestIdentity(request))
    throw new Error(
      "Preparation key was already used with a different account, mandate, kind or amount. Use a new key.",
    );
}
/** Session-scoped deterministic UUID: one insert winner even for concurrent retry requests. */
export async function keyedAttemptId(sessionId: string, key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([sessionId, key])),
    ),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
