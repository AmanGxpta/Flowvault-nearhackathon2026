// Loading placeholder: the adapters use "…" for "not read yet"; it renders as a shimmer, never as a figure.
export function Skel({ v }: { v: unknown }) {
  if (v === "…") return <span className="fv-skel" role="img" aria-label="Loading">…</span>;
  return <>{v as string}</>;
}
