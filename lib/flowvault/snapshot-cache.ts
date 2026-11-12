/** Process-local public-read cache. Never used by preparation/authorization RPC checks. */
const values = new Map<
  string,
  { value: unknown; at: number; pending?: Promise<unknown> }
>();
export async function snapshot<T>(
  key: string,
  load: () => Promise<T>,
  degrade: (old: T, error: string) => T,
  now = Date.now(),
): Promise<T> {
  let row = values.get(key);
  if (row && now - row.at < 15000 && row.value)
    return structuredClone(row.value as T);
  if (row?.pending) return structuredClone((await row.pending) as T);
  if (!row) {
    if (values.size >= 128) values.delete(values.keys().next().value!);
    row = { value: null, at: 0 };
    values.set(key, row);
  }
  const current = row;
  const pending = load()
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
      current.pending = undefined;
    });
  current.pending = pending;
  return structuredClone(await pending);
}
export function clearSnapshots() {
  values.clear();
}
