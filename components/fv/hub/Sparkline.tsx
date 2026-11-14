"use client";
// A tiny trend line for a stat: the last days' values, drawn in on first show. Hidden until there are two days.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 60, h = 22, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const up = values[values.length - 1] >= values[0];
  const [lx, ly] = pts[pts.length - 1];
  return <svg className={"fv-spark" + (up ? " is-up" : " is-down")} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: last ${values.length} days, ${up ? "up" : "down"} from ${values[0].toLocaleString("en-US", { maximumFractionDigits: 0 })} to ${values[values.length - 1].toLocaleString("en-US", { maximumFractionDigits: 0 })}`}>
    <path d={d + ` L ${lx.toFixed(1)} ${h} L 2 ${h} Z`} className="fv-spark-fill" />
    <path d={d} pathLength={1} className="fv-spark-line" />
    <circle cx={lx} cy={ly} r={2.2} />
  </svg>;
}
