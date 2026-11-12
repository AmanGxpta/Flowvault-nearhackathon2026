// Engines R22: hard deadlines for every external read. On workerd (dev server and deployment) a promise
// started inside one request can never settle once that request is cancelled, so anything shared across
// requests or awaited without a bound can wedge every later read. Callers fail closed on timeout.
export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms.`);
    this.name = "DeadlineError";
  }
}

/** Resolves or rejects with `work`, or rejects with DeadlineError after `ms`. Never leaves a timer behind. */
export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Read budgets (ms). One RPC attempt, one whole RPC call across providers, one portfolio section. */
export const READ_BUDGET = {
  attempt: 4000,
  rpcCall: 9000,
  /** How long a caller waits on another request's in-flight read before running its own. */
  shared: 3000,
  section: 9000,
  http: 10000,
} as const;
