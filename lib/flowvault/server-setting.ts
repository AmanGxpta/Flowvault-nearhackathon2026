// Server settings (Cloudflare binding, else process env). Missing → null; callers fail closed.
export async function serverSetting(name: string): Promise<string | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const v = (env as unknown as Record<string, unknown>)[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    /* not in a worker */
  }
  const p = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return p && p.trim() ? p.trim() : null;
}
