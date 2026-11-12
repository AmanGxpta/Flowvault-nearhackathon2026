"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- plan JSON from /api/plans and /api/funding/legs */
// Funding sources for a multi-source plan (owner: Stream A). Mounted inside PlanDock. Before review: why each
// offered set of sources was chosen and how single and mixed compare after every known cost. After review: the
// frozen sources, each leg's wallet, and where every leg's money is right now (the recovery view). Nothing here
// signs; the step rows in PlanDock hand each leg to the wallet that controls its source.
import { useEffect, useState } from "react";
import { api } from "./live";
import { meshLabel } from "@/lib/flowvault/funding-mesh";
import { NETWORK_NAME } from "@/lib/flowvault/capabilities";

const usd = (raw: string | null | undefined) => (raw == null ? "Unknown" : (Number(BigInt(raw)) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const short = (a: string) => (a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);
const WHERE: Record<string, [string, string]> = {
  source: ["Still in the source", "var(--fvc-5B6458)"],
  in_transit: ["On its way", "var(--fvc-3F5A7A)"],
  target: ["In your NEAR account", "var(--fvc-2F552D)"],
  refunded_to_source: ["Refunded to the source", "var(--fvc-8A5F25)"],
  unknown: ["Unconfirmed", "var(--fvc-9A3F32)"],
};
const H3: React.CSSProperties = { margin: "0 0 8px", fontSize: "11px", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--fvc-6F786B)" };
const box: React.CSSProperties = { padding: "12px", borderRadius: "10px", background: "var(--fvb-F7F8F3)", fontSize: "13px", color: "var(--fvc-4A5349)" };

/** Readable label for a multi-source alternative in the plan's alternative list. */
export function fundingChoiceLabel(plan: any, choiceId: string) {
  return meshLabel(choiceId, plan?.funding?.legs && plan.selectedChoiceId === choiceId ? plan.funding : plan?.fundingOptions?.[choiceId]);
}

function Comparison({ f }: { f: any }) {
  const rows = (f.comparison ?? []).filter((c: any) => c.eligible || c.mode === "single");
  if (rows.length < 2) return null;
  return (
    <details style={{ marginTop: "8px" }}>
      <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--fvc-3F6B3C)" }}>Single source vs mixed, after every known cost</summary>
      <table style={{ width: "100%", marginTop: "6px", fontSize: "12px", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map((c: any) => (
            <tr key={c.choiceId} style={{ borderTop: "1px solid var(--fvb-E3E6DB)" }}>
              <td style={{ padding: "4px 0" }}>{c.mode === "mixed" ? "Mixed (" + c.legs.length + " sources)" : NETWORK_NAME[c.choiceId.split(":").at(-1) as keyof typeof NETWORK_NAME] + " " + short(c.choiceId.split(":").slice(3, -1).join(":"))}</td>
              <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 600 }}>{c.eligible ? "costs up to " + usd(c.costsUsdcRaw) : String(c.reasons[0] ?? "unavailable").split(":")[0].replace(/_/g, " ").toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function FundingSources({ plan }: { plan: any }) {
  const reviewed = plan?.funding && plan.selectedChoiceId?.startsWith("mesh:");
  const [where, setWhere] = useState<{ key: string; locations: any[] } | null>(null);
  const key = plan ? plan.id + ":" + plan.updatedAt : "";
  useEffect(() => {
    if (!reviewed || !plan?.steps?.length) return;
    let live = true;
    api("/api/funding/legs?planId=" + encodeURIComponent(plan.id), undefined, "GET").then(
      (r) => live && setWhere({ key, locations: r.locations ?? [] }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, reviewed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return null;

  if (reviewed) {
    const f = plan.funding;
    const locs = where?.locations ?? [];
    const partial = ["partial", "failed"].includes(plan.state) || locs.some((l) => l.where === "refunded_to_source" || l.where === "unknown");
    return (
      <section aria-label="Funding sources" style={box}>
        <h3 style={{ ...H3, marginTop: 0 }}>Sources · kept from review through execution</h3>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          {f.legs.map((l: any) => {
            const loc = locs.find((x) => x.legId === l.id);
            const tag = loc ? WHERE[loc.where] : null;
            return (
              <li key={l.id} style={{ borderTop: "1px solid var(--fvb-E3E6DB)", paddingTop: "8px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                  <span style={{ flex: 1, fontWeight: 600, color: "var(--fvc-1E2A22)" }}>
                    {l.operation === "hold" ? "NEAR · " + l.address : NETWORK_NAME[l.network as keyof typeof NETWORK_NAME] + " · " + short(l.address)}
                  </span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{usd(l.amountRaw)} USDC</span>
                </div>
                <div style={{ fontSize: "12px", marginTop: "2px" }}>{l.rationale}</div>
                <div style={{ fontSize: "12px", marginTop: "2px", color: "var(--fvc-6F786B)" }}>
                  {l.operation === "hold" ? "No signature" : "Approved in the wallet for " + short(l.address)}
                  {tag ? <> · <span style={{ color: tag[1], fontWeight: 600 }}>{tag[0]}</span></> : null}
                </div>
                {loc && loc.where !== "target" ? <div style={{ fontSize: "12px", marginTop: "2px" }}>{loc.detail}{loc.next ? " " + loc.next : ""}</div> : null}
              </li>
            );
          })}
        </ol>
        {partial ? (
          <div role="status" style={{ marginTop: "10px", padding: "10px", borderRadius: "8px", background: "var(--fvb-FFF6E8)", color: "var(--fvc-7A521E)", fontSize: "12.5px" }}>
            Part of this plan finished and part didn’t. Every leg above says where its money is now. Money that reached your NEAR account stays there and counts in your next plan.
          </div>
        ) : null}
        <ul style={{ margin: "10px 0 0", paddingLeft: "18px", fontSize: "12px" }}>
          {f.explanation.slice(0, 4).map((x: string) => <li key={x}>{x}</li>)}
        </ul>
        <Comparison f={f} />
      </section>
    );
  }

  const options = Object.entries(plan.fundingOptions ?? {}) as [string, any][];
  if (!options.length || plan.selectedChoiceId) return null;
  return (
    <section aria-label="How the sources were chosen" style={box}>
      <h3 style={{ ...H3, marginTop: 0 }}>Using your other accounts</h3>
      {options.map(([id, f]) => (
        <div key={id} style={{ marginBottom: "8px" }}>
          <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{meshLabel(id, f)} · costs up to {usd(f.costsUsdcRaw)}</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: "18px", fontSize: "12px" }}>
            {f.explanation.map((x: string) => <li key={x}>{x}</li>)}
          </ul>
          <Comparison f={f} />
        </div>
      ))}
    </section>
  );
}
