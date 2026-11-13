"use client";
// Staking flows that still need you (or are still moving), shown at the top of Activity. Each opens exactly where it
// stands, so a cancelled wallet prompt or a closed tab never loses an operation.
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "../live";
import { TokenIcon } from "../AssetIdentity";
import { ago } from "../swap-format";
import { nearText, flowStage } from "@/lib/flowvault/stake-flow";
import type { FlowRead } from "./StakeFlowView";

export function OpenStakeFlows({ navigate }: { navigate?: (screen: string) => void }) {
  const [flows, setFlows] = useState<FlowRead[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => api("/api/staking/flows", undefined, "GET").then((r: { flows?: FlowRead[] }) => {if(active) setFlows((r.flows ?? []).filter(f => !["done", "cancelled"].includes(f.status)));}).catch(() => {});
    void refresh(); const timer = setInterval(()=>void refresh(),15000); window.addEventListener("focus",refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",refresh);};
  }, []);
  if (!flows.length) return null;
  const open = (id: string) => { const u = new URL(window.location.href); u.searchParams.set("flow", id); u.searchParams.set("tab", "stake"); history.replaceState(null, "", u); navigate?.("earn"); };
  return <section className="fv-panel fv-open-flows">
    <div className="fv-section-head"><h2>In progress</h2><small>{flows.length} staking flow{flows.length === 1 ? "" : "s"} to finish</small></div>
    {flows.map((f) => { const step = f.steps.find((s) => s.id === f.current); return <article key={f.flow.id} className={"fv-flow-row is-" + f.status}>
      <TokenIcon symbol={f.flow.source.kind === "swap" ? f.flow.source.fromSymbol : "NEAR"} core size={30} />
      <div><strong>Stake into {f.flow.venue === "rnear" ? "rNEAR" : "LiNEAR"} · step {Math.min(f.done + 1, f.total)} of {f.total}</strong><small>{f.flow.source.kind === "swap" ? `${f.flow.source.amount} ${f.flow.source.fromSymbol} on ${f.flow.source.fromNetwork} → ≈ ${nearText(f.stakeRaw ?? f.flow.source.expectedNearRaw)} NEAR` : `${nearText(f.flow.source.amountRaw)} NEAR`}</small><small>{step ? step.title + " · " + step.detail : ""}</small></div>
      <div className="fv-flow-row-end"><span className={"fv-flow-badge is-" + (f.status === "your_turn" ? "turn" : f.status === "attention" ? "bad" : "busy")}>{flowStage(f)}</span><small>{ago(f.flow.updatedAt)} · {f.done}/{f.total} steps done</small><button type="button" className="fv-text-button" onClick={() => open(f.flow.id)}>{f.status === "your_turn" ? "Continue" : "Open status"} <ArrowRight size={13} /></button></div>
    </article>; })}
  </section>;
}
