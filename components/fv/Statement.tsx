"use client";
import {HolderVaultReceipts} from "./HolderVaultReceipts";
// Activity · Statement. Every figure comes from Engines' journal-derived ledger (GET /api/statement); this
// component only formats it. Realized totals, pending/unresolved items and forecasts are kept apart, and an
// unpriced entry is shown as unpriced, never as zero. CSV export is GET /api/ledger?format=csv.
import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/flowvault/contracts";
import type { Scope } from "./live";
import { api } from "./live";
import { openPlan } from "./PlanDock";

type Sum = { usdcRaw: string | null; pricedUsdcRaw: string; count: number; unpriced: number };
interface Statement {
  fictional: boolean;
  period: { from: string; to: string };
  capital: { netWorthEffect: Sum; internalMoves: Sum; positionEntries: Sum; positionExits: Sum; paymentsOut: Sum; note: string };
  cost: { fees: Sum; gasNearRaw: string; interestPaid: Sum; note: string };
  earned: { yield: Sum; incentives: Sum; refunds: Sum };
  owed: {
    borrowedInPeriod: Sum;
    repaidInPeriod: Sum;
    journaledPrincipalUsdcRaw: string;
    observedDebtUsdcRaw: string | null;
    accruedInterestUsdcRaw: string | null;
    debtObservedAt: string | null;
    upcomingObligations: { id: string; dueDate: string; token: string; amount: string; reservedUsdcRaw: string | null; unavailableReason?: string }[];
    reasons: string[];
  };
  forecast: { entries: LedgerEntry[]; days: number; basis: string };
  pending: LedgerEntry[];
  unresolved: LedgerEntry[];
  entries: LedgerEntry[];
}

const KIND: Record<string, string> = {
  contribution: "Money in", external_withdrawal: "Money out", internal_transfer: "Internal move", position_entry: "Position entered",
  position_exit: "Position exited", yield: "Yield", fee: "Fee", refund: "Refund", borrow: "Borrowed", interest: "Interest",
  repay: "Repaid", incentive: "Incentive", valuation_change: "Valuation change", payment_out: "Payment out",
};
const STATUS: Record<string, [string, string, string]> = {
  confirmed: ["VERIFIED", "var(--fvb-E2EAD6)", "var(--fvc-2F552D)"],
  pending: ["PENDING", "var(--fvb-EEF3F9)", "var(--fvc-3F5A7A)"],
  unresolved: ["UNRESOLVED", "var(--fvb-F6EBDD)", "var(--fvc-8A5F25)"],
};

function usd(raw: string | null | undefined, signed = false) {
  if (raw == null) return "Unknown";
  const v = BigInt(raw);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const cents = (a + 5000n) / 10000n;
  const s = "$" + (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + (cents % 100n).toString().padStart(2, "0");
  return neg ? "−" + s : signed && v > 0n ? "+" + s : s;
}
function qty(raw: string, decimals: number) {
  const v = BigInt(raw);
  const neg = v < 0n;
  const a = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = a.slice(0, a.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = decimals ? a.slice(a.length - decimals).slice(0, Math.min(decimals, 6)).replace(/0+$/, "") : "";
  return (neg ? "−" : "") + whole + (frac ? "." + frac : "");
}
/** A total with unpriced entries shows the priced part and says how many are missing. */
function sumText(s: Sum, signed = false) {
  return s.usdcRaw !== null ? usd(s.usdcRaw, signed) : usd(s.pricedUsdcRaw, signed) + " + " + s.unpriced + " unpriced";
}
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function periodFor(p: "30d" | "month" | "last") {
  const now = new Date();
  if (p === "30d") return null;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (p === "month") return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(now) };
  return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
}

const card: React.CSSProperties = { background: "var(--fvb-FFFFFF)", border: "1px solid var(--fvb-E3E6DB)", borderRadius: "18px", padding: "16px 18px" };
const H: React.CSSProperties = { margin: "0 0 8px", fontSize: "11px", letterSpacing: ".14em", fontWeight: 600, color: "var(--fvc-8A9285)" };
const tab = (on: boolean): React.CSSProperties => ({
  padding: "7px 12px", borderRadius: "9px", fontSize: "13px", cursor: "pointer", fontWeight: 500,
  border: on ? "1px solid var(--fvb-2A4034)" : "1px solid var(--fvb-E3E6DB)", background: on ? "var(--fvb-2A4034)" : "var(--fvb-FFFFFF)", color: on ? "var(--fvc-FFFFFF)" : "var(--fvc-1E2A22)",
});

function Rows({ entries, empty }: { entries: LedgerEntry[]; empty: string }) {
  if (!entries.length) return <p style={{ margin: 0, fontSize: "13px", color: "var(--fvc-8A9285)" }}>{empty}</p>;
  const cols = "72px minmax(0,1.6fr) 104px 130px 110px 110px 110px 64px";
  return (
    <div style={{ overflowX: "auto" }}>
      <div role="table" aria-label="Ledger entries" style={{ minWidth: "860px" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: cols, gap: "12px", padding: "10px 4px", fontSize: "11px", letterSpacing: ".12em", fontWeight: 600, color: "var(--fvc-8A9285)", borderBottom: "1px solid var(--fvb-EEF0E8)" }}>
          <div role="columnheader">DATE</div>
          <div role="columnheader">LINE</div>
          <div role="columnheader">STATUS</div>
          <div role="columnheader" style={{ textAlign: "right" }}>AMOUNT</div>
          <div role="columnheader" style={{ textAlign: "right" }}>USDC VALUE</div>
          <div role="columnheader" style={{ textAlign: "right" }}>NET WORTH</div>
          <div role="columnheader" style={{ textAlign: "right" }}>OWED</div>
          <div role="columnheader" />
        </div>
        {entries.map((e) => {
          const st = STATUS[e.status] ?? STATUS.unresolved;
          return (
            <div role="row" key={e.id} style={{ display: "grid", gridTemplateColumns: cols, gap: "12px", padding: "11px 4px", alignItems: "center", fontSize: "13px", borderBottom: "1px solid var(--fvb-F1F2EB)" }}>
              <div role="cell" style={{ color: "var(--fvc-6F786B)" }}>{day(e.at)}</div>
              <div role="cell" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--fvc-1E2A22)" }}>{KIND[e.kind] ?? e.kind}{e.realized ? "" : " · not realized"}</div>
                <div style={{ fontSize: "12px", color: "var(--fvc-8A9285)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.basis}>{e.basis}</div>
                {e.acquisitionHistoryMissing && e.kind !== "fee" ? <div style={{fontSize:12,color:"var(--fvc-8A5F25)"}}>Acquisition history missing · realized PnL unavailable</div> : null}
              </div>
              <div role="cell"><span style={{ padding: "3px 7px", borderRadius: "6px", fontSize: "10.5px", fontWeight: 700, background: st[1], color: st[2] }}>{st[0]}</span></div>
              <div role="cell" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{qty(e.amountRaw, e.decimals)} {e.asset}</div>
              <div role="cell" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.usdcRaw === null ? "unpriced" : usd(e.usdcRaw)}</div>
              <div role="cell" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: e.netWorthEffectUsdcRaw && BigInt(e.netWorthEffectUsdcRaw) < 0n ? "var(--fvc-9A3F32)" : e.netWorthEffectUsdcRaw && BigInt(e.netWorthEffectUsdcRaw) > 0n ? "var(--fvc-3F6B3C)" : "var(--fvc-6F786B)" }}>
                {e.netWorthEffectUsdcRaw === null ? "unpriced" : BigInt(e.netWorthEffectUsdcRaw) === 0n ? "internal" : usd(e.netWorthEffectUsdcRaw, true)}
              </div>
              <div role="cell" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.liabilityEffectUsdcRaw && BigInt(e.liabilityEffectUsdcRaw) !== 0n ? usd(e.liabilityEffectUsdcRaw, true) : "—"}</div>
              <div role="cell" style={{ textAlign: "right" }}>
                {e.planId ? (
                  <button type="button" onClick={() => openPlan({ planId: e.planId })} style={{ border: "none", background: "none", padding: 0, fontSize: "13px", color: "var(--fvc-3F6B3C)", cursor: "pointer" }} aria-label={"Open the plan for " + (KIND[e.kind] ?? e.kind)}>
                    Plan ↗
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatementPanel({ scope }: { scope: Scope }) {
  const [period, setPeriod] = useState<"30d" | "month" | "last">("30d");
  const [data, setData] = useState<{ key: string; s: Statement | null; err: string | null } | null>(null);
  const range = periodFor(period);
  const qs = range ? `from=${range.from}&to=${range.to}` : "";
  const key = scope + "|" + qs;
  useEffect(() => {
    let live = true;
    api("/api/statement" + (qs ? "?" + qs : ""), undefined, "GET", scope).then(
      (s: Statement) => live && setData({ key, s, err: null }),
      (e) => live && setData({ key, s: null, err: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [scope, qs, key]);
  const cur = data?.key === key ? data : null;
  const s = cur?.s ?? null;
  const csv = `/api/ledger?format=csv&workspace=${scope === "example" ? "example" : "personal"}${qs ? "&" + qs : ""}`;
  const debt = s ? s.owed.observedDebtUsdcRaw ?? s.owed.journaledPrincipalUsdcRaw : null;

  return (
    <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <div role="group" aria-label="Statement period" style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button type="button" style={tab(period === "30d")} aria-pressed={period === "30d"} onClick={() => setPeriod("30d")}>Last 30 days</button>
          <button type="button" style={tab(period === "month")} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>This month</button>
          <button type="button" style={tab(period === "last")} aria-pressed={period === "last"} onClick={() => setPeriod("last")}>Last month</button>
        </div>
        <span style={{ fontSize: "12.5px", color: "var(--fvc-8A9285)" }}>
          {s ? `${day(s.period.from)} – ${day(new Date(Date.parse(s.period.to) - 1).toISOString())}` : ""}
          {s?.fictional ? " · fictional example ledger" : s ? " · from verified journals" : ""}
        </span>
        <a href={csv} download style={{ marginLeft: "auto", ...tab(false), textDecoration: "none" }}>Export CSV</a>
      </div>

      {cur?.err ? <p role="alert" style={{ margin: 0, fontSize: "13px", color: "var(--fvc-9A3F32)" }}>The statement couldn’t be built: {cur.err}</p> : null}
      {!cur ? <p style={{ margin: 0, fontSize: "13px", color: "var(--fvc-8A9285)" }}>Building the statement from your journals…</p> : null}

      {s ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))", gap: "12px" }}>
            {[
              { k: "Net worth effect", v: sumText(s.capital.netWorthEffect, true), sub: "realized · principal moves excluded" },
              { k: "Earned", v: sumText(s.earned.yield), sub: `incentives ${sumText(s.earned.incentives)} · refunds ${sumText(s.earned.refunds)}` },
              { k: "Cost", v: sumText(s.cost.fees), sub: `interest paid ${sumText(s.cost.interestPaid)}${BigInt(s.cost.gasNearRaw) > 0n ? " · gas " + qty(s.cost.gasNearRaw, 24) + " NEAR" : ""}` },
              { k: "Payments out", v: sumText(s.capital.paymentsOut), sub: `${s.capital.paymentsOut.count} verified at the destination` },
              { k: "Still owed", v: usd(debt), sub: s.owed.observedDebtUsdcRaw !== null ? `Rhea read ${s.owed.debtObservedAt ? day(s.owed.debtObservedAt) : ""}${s.owed.accruedInterestUsdcRaw ? " · accrued " + usd(s.owed.accruedInterestUsdcRaw) : ""}` : "journaled principal" },
            ].map((b) => (
              <div key={b.k} style={card}>
                <div style={{ fontSize: "12.5px", color: "var(--fvc-6F786B)" }}>{b.k}</div>
                <div style={{ marginTop: "8px", fontSize: "22px", fontWeight: 500, letterSpacing: "-0.02em", color: "var(--fvc-1E2A22)", fontVariantNumeric: "tabular-nums" }}>{b.v}</div>
                <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--fvc-8A9285)" }}>{b.sub}</div>
              </div>
            ))}
          </div>

          <section aria-label="Ledger for the period" style={card}>
            <h3 style={H}>LEDGER · {s.entries.length} {s.entries.length === 1 ? "ENTRY" : "ENTRIES"}</h3>
            <Rows entries={s.entries} empty="No journal entries in this period." />
            <p style={{ margin: "10px 0 0", fontSize: "12px", color: "var(--fvc-6F786B)", lineHeight: 1.5 }}>
              {s.capital.note} {s.cost.note}
            </p>
          </section>

          {s.pending.length || s.unresolved.length ? (
            <section aria-label="Not yet verified" style={card}>
              <h3 style={H}>NOT YET VERIFIED · NOT IN THE TOTALS</h3>
              <Rows entries={[...s.unresolved, ...s.pending]} empty="" />
            </section>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: "12px" }}>
            <section aria-label="What you still owe and have to pay" style={card}>
              <h3 style={H}>WHAT YOU STILL OWE AND HAVE TO PAY</h3>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: "6px", columnGap: "12px", fontSize: "13px" }}>
                <dt style={{ color: "var(--fvc-5B6458)" }}>Borrowed this period</dt><dd style={{ margin: 0, textAlign: "right" }}>{sumText(s.owed.borrowedInPeriod)}</dd>
                <dt style={{ color: "var(--fvc-5B6458)" }}>Repaid this period</dt><dd style={{ margin: 0, textAlign: "right" }}>{sumText(s.owed.repaidInPeriod)}</dd>
                {s.owed.upcomingObligations.map((o) => (
                  <div key={o.id} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--fvc-5B6458)" }}>{o.id} · {o.amount} {o.token} on {day(o.dueDate + "T00:00:00Z")}</dt>
                    <dd style={{ margin: 0, textAlign: "right" }} title={o.unavailableReason}>{o.reservedUsdcRaw === null ? "reserve unavailable" : usd(o.reservedUsdcRaw) + " held"}</dd>
                  </div>
                ))}
              </dl>
              {s.owed.reasons.length ? <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--fvc-8A5F25)" }}>{s.owed.reasons.join(" · ")}</p> : null}
            </section>
            <section aria-label="Forecast" style={card}>
              <h3 style={H}>FORECAST · NEXT {s.forecast.days} DAYS · NEVER COUNTED AS REALIZED</h3>
              {s.forecast.entries.length ? (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px" }}>
                  {s.forecast.entries.map((e) => (
                    <li key={e.id}>{KIND[e.kind] ?? e.kind}: {e.usdcRaw === null ? "unpriced" : usd(e.usdcRaw)} · {e.basis}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, fontSize: "13px", color: "var(--fvc-8A9285)" }}>Nothing to forecast from today’s balances.</p>
              )}
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--fvc-6F786B)" }}>{s.forecast.basis}</p>
            <HolderVaultReceipts scope={scope} />
</section>
          </div>
        </>
      ) : null}
    </div>
  );
}
