"use client";
// The hazard scan on every approval card: each check FlowVault ran before your wallet opens, as one list (caps,
// "$X left today", asset permission, protected assets, venue, recipient, contract calls, moving cost, fees, plus the
// card's own: slippage, health, debt). Read-only; the checks themselves run on the server.
import { Check, CircleAlert, Minus, ShieldAlert, ShieldCheck } from "lucide-react";
import type { HazardCheck } from "@/lib/flowvault/policy";

export function HazardScan({ checks, compact }: { checks?: HazardCheck[] | null; compact?: boolean }) {
  if (!checks?.length) return null;
  const failing = checks.filter((c) => c.ok === false);
  return <div className={"fv-hazard" + (failing.length ? " is-blocked" : " is-clear") + (compact ? " is-compact" : "")} role="group" aria-label="Hazard scan">
    <div className="fv-hazard-head">{failing.length ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}<strong>Hazard scan · {failing.length ? `${failing.length} to resolve` : "all clear"}</strong></div>
    <ul>{checks.map((c) => <li key={c.id} className={c.ok === false ? "is-bad" : c.ok === null ? "is-na" : "is-ok"} title={c.detail}>
      <span aria-hidden>{c.ok === false ? <CircleAlert size={13} /> : c.ok === null ? <Minus size={13} /> : <Check size={13} />}</span>
      <span>{c.label}{c.ok === false && c.detail ? <small>{c.detail}</small> : null}</span>
    </li>)}</ul>
  </div>;
}
