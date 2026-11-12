import { READ_BUDGET, withDeadline } from "./deadline.ts";
/** Process-local public-read cache. Never used by preparation/authorization RPC checks.
 * R22: a load is bounded by `loadMs`, and a caller waits on another request's in-flight load for at most
 * READ_BUDGET.shared before starting its own, so a load owned by a cancelled workerd request can't wedge
 * later reads. */
const values = new Map<
  string,
  { value: unknown; at: number; pending?: Promise<unknown>; pendingAt?: number }
>();
export async function snapshot<T>(
  key: string,
  load: () => Promise<T>,
  degrade: (old: T, error: string) => T,
  now = Date.now(),
  loadMs: number = READ_BUDGET.section,
  sharedMs: number = READ_BUDGET.shared,
): Promise<T> {
  let row = values.get(key);
  if (row && now - row.at < 15000 && row.value)
    return structuredClone(row.value as T);
  if (row?.pending && Date.now() - (row.pendingAt ?? 0) < loadMs) {
    try {
      return structuredClone((await withDeadline(row.pending, sharedMs, "Shared read " + key)) as T);
    } catch {
      // Stuck, slow or failed: run an independent bounded load below.
    }
  }
  if (!row) {
    if (values.size >= 128) values.delete(values.keys().next().value!);
    row = { value: null, at: 0 };
    values.set(key, row);
  }
  const current = row;
  const pending: Promise<T> = withDeadline(load(), loadMs, "Read " + key)
    .then((value) => {
      current.value = structuredClone(value);
      current.at = Date.now();
      return value;
    })
    .catch((e) => {
      if (current.value && now - current.at <= 300000)
        return degrade(structuredClone(current.value as T), String(e));
      throw e;
    })
    .finally(() => {
      if (current.pending === pending) {
        current.pending = undefined;
        current.pendingAt = undefined;
      }
    });
  current.pending = pending;
  current.pendingAt = Date.now();
  return structuredClone(await pending);
}
export function clearSnapshots() {
  values.clear();
}
