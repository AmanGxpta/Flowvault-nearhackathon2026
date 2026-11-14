"use client";
// Swap-then-supply flows that still need you (or are still moving), shown at the top of Activity. Each opens exactly
// where it stands on Earn, so a declined wallet prompt or a closed tab never loses an operation.
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "../live";
import { TokenIcon } from "../AssetIdentity";
import { ago } from "../swap-format";
import { tokenText } from "@/lib/flowvault/supply-flow";
import { demoSupplyRead, type DemoSupplyRow, type SupplyFlowRead } from "./SupplyFlowView";
import { demoList } from "../demo/demo-store";

export function OpenSupplyFlows({ navigate, example = false }: { navigate?: (screen: string) => void; example?: boolean }) {
  const [flows, setFlows] = useState<SupplyFlowRead[]>([]);
  useEffect(() => {
    let active = true;
    // Demo Mode: this tab's example flows, never the server.
    if (example) { const refresh = () => setFlows(demoList<DemoSupplyRow>("supply").map((r) => demoSupplyRead(r)).filter((f) => !["done", "cancelled"].includes(f.status))); refresh(); const t = setInterval(refresh, 2000); window.addEventListener("fv:demo-flows", refresh); return () => { clearInterval(t); window.removeEventListener("fv:demo-flows", refresh); }; }
    const refresh = () => api("/api/lend/flows", undefined, "GET").then((r: { flows?: SupplyFlowRead[] }) => { if (active) setFlows((r.flows ?? []).filter((f) => !["done", "cancelled"].includes(f.status))); }).catch(() => {});
    void refresh(); const timer = setInterval(() => void refresh(), 15000); window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [example]);
  if (!flows.length) return null;
  const open = (id: string) => { const u = new URL(window.location.href); u.searchParams.set("sflow", id); u.searchParams.set("tab", "supply"); history.replaceState(null, "", u); navigate?.("earn"); };
  return <section className="fv-panel fv-open-flows">
    <div className="fv-section-head"><h2>In progress{example ? " · example" : ""}</h2><small>{flows.length} supply flow{flows.length === 1 ? "" : "s"} to finish</small></div>
    {flows.map((f) => { const step = f.steps.find((s) => s.id === f.current); const s = f.flow.source; return <article key={f.flow.id} className={"fv-flow-row is-" + f.status}>
      <TokenIcon symbol={s.fromSymbol} core size={30} />
      <div><strong>Supply {f.flow.symbol} to Rhea · step {Math.min(f.done + 1, f.total)} of {f.total}</strong><small>{s.amount} {s.fromSymbol}{s.fromNetwork === "NEAR" ? "" : " on " + s.fromNetwork} → ≈ {tokenText(f.supplyRaw ?? s.expectedRaw, f.flow.decimals)} {f.flow.symbol}</small><small>{step ? step.title + " · " + step.detail : ""}</small></div>
      <div className="fv-flow-row-end"><span className={"fv-flow-badge is-" + (f.status === "your_turn" ? "turn" : f.status === "attention" ? "bad" : "busy")}>{f.status === "your_turn" ? "Your turn" : f.status === "attention" ? "Needs attention" : "In progress"}</span><small>{ago(f.flow.updatedAt)} · {f.done}/{f.total} steps done</small><button type="button" className="fv-text-button" onClick={() => open(f.flow.id)}>{f.status === "your_turn" ? "Continue" : "Open status"} <ArrowRight size={13} /></button></div>
    </article>; })}
  </section>;
}
