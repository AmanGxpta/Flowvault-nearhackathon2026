// Display formatting only. Amounts arrive as exact decimal strings; Number is used solely to print them.
export function fmtAmount(v: string | null | undefined, max = 6): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n === 0) return "0";
  if (n < 0.000001) return "<0.000001";
  if (n >= 1_000_000) return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : max });
}
export function fmtUsd(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 1) return n < 1e-10 ? "<$0.0000000001" : "$" + n.toFixed(Math.min(12, Math.max(2, Math.ceil(-Math.log10(n)) + 3))).replace(/(\.\d*?[1-9])0+$/, "$1");
  if (n >= 100_000) return "$" + n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: n >= 1_000_000 ? 2 : 1 });
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(digits) + "%";
}
export function ago(iso: string | number | null | undefined): string {
  if (!iso) return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
