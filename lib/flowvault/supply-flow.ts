// Supply flows: "supply X from what I hold" as one resumable operation. When the owner wants to supply a Rhea market
// they don't hold (or don't hold enough of), FlowVault offers to swap something they do hold into it first: pay on the
// origin chain (or on NEAR) → NEAR Intents delivers the token to their own NEAR account → one signature supplies
// exactly what arrived → earning. Like staking flows, progress is derived from the journal attempts the flow links,
// never from the browser, so closing the tab or declining a wallet prompt never loses the place. A flow never signs
// or moves anything by itself.
import { decimal } from "./money.ts";

export interface SupplyFlow {
  id: string;
  accountId: string;
  /** The Rhea market: its NEAR token contract, symbol and decimals. */
  tokenId: string;
  symbol: string;
  decimals: number;
  /** Supply APY when the flow was started, for the summary only (rates are variable). */
  apy: number | null;
  source: { from: string; fromSymbol: string; fromNetwork: string; amount: string; expectedRaw: string | null };
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  links: { pay?: string; supply?: string };
}
export interface SupplyAttemptView { id: string; state: string; message: string; hashes: number; deliveredRaw?: string | null; refundedRaw?: string | null; suppliedRaw?: string | null }
export type SupplyStepState = "done" | "current" | "working" | "waiting" | "failed";
export interface SupplyStep { id: "pay" | "swap" | "supply" | "earning"; title: string; detail: string; state: SupplyStepState }
export type SupplyFlowStatus = "your_turn" | "working" | "done" | "attention" | "cancelled";

export const tokenText = (raw: string | null | undefined, decimals: number, places = 4) => {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const [w, f = ""] = decimal(BigInt(raw), decimals).split(".");
  const frac = f.slice(0, places).replace(/0+$/, "");
  if (BigInt(raw) > 0n && w === "0" && !frac) return "<" + (places ? "0." + "0".repeat(places - 1) + "1" : "1");
  return w.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "");
};
const notSent = (a?: SupplyAttemptView | null) => !!a && a.state === "failed" && a.hashes === 0;
const inFlight = (a?: SupplyAttemptView | null) => !!a && ["awaiting_wallet", "submitted", "unknown", "partial"].includes(a.state);

/** Steps and status. The amount supplied is what NEAR Intents actually delivered, never the quote. */
export function deriveSupplyFlow(f: SupplyFlow, a: { pay?: SupplyAttemptView | null; supply?: SupplyAttemptView | null }) {
  const s = f.source, pay = a.pay, sup = a.supply;
  const delivered = pay && (pay.state === "confirmed" || pay.state === "partial") && pay.deliveredRaw && pay.deliveredRaw !== "0" ? pay.deliveredRaw : null;
  const refunded = !!pay && (/refund/i.test(pay.message) || !!pay.refundedRaw);
  const payFailed = !!pay && pay.state === "failed" && pay.hashes > 0;
  const amt = (raw: string | null | undefined) => tokenText(raw, f.decimals);
  const steps: SupplyStep[] = [
    {
      id: "pay", title: `Send ${s.amount} ${s.fromSymbol}${s.fromNetwork === "NEAR" ? "" : " on " + s.fromNetwork}`,
      detail: !pay || pay.state === "prepared" || notSent(pay) ? (notSent(pay) ? "Not sent. Your wallet request was declined or closed; nothing moved." : "Approve one transfer in your wallet.")
        : pay.hashes > 0 || pay.state !== "awaiting_wallet" ? "Sent." : "Waiting for your wallet.",
      state: !pay || pay.state === "prepared" || notSent(pay) ? "current" : pay.state === "awaiting_wallet" && pay.hashes === 0 ? "working" : refunded || payFailed ? "failed" : "done",
    },
    {
      id: "swap", title: `NEAR Intents swaps it into ${f.symbol} for ${f.accountId}`,
      detail: delivered ? `${amt(delivered)} ${f.symbol} arrived in your NEAR account.` : refunded ? pay!.message : inFlight(pay) ? pay!.message || "Delivering to your account, usually under a minute." : `About ${amt(s.expectedRaw)} ${f.symbol} expected.`,
      state: delivered ? "done" : refunded || payFailed ? "failed" : inFlight(pay) && pay!.hashes > 0 ? "working" : "waiting",
    },
  ];
  steps.push({
    id: "supply", title: delivered ? `Supply ${amt(delivered)} ${f.symbol} to Rhea` : `Supply ${f.symbol} to Rhea`,
    detail: !delivered ? "Starts when the swap arrives. It supplies exactly what arrived." : !sup || sup.state === "prepared" || notSent(sup) ? (notSent(sup) ? "Not sent. Sign again when you're ready." : "Review, then sign once in your NEAR wallet.") : sup.state === "confirmed" ? "Signed." : sup.message || "Waiting for final receipts.",
    state: !delivered ? "waiting" : !sup || sup.state === "prepared" || notSent(sup) ? "current" : sup.state === "confirmed" ? "done" : sup.state === "failed" ? "failed" : "working",
  });
  steps.push({
    id: "earning", title: `Earning on Rhea`,
    detail: sup?.state === "confirmed" ? `Your ${f.symbol} is supplied and earning the variable supply APY${f.apy !== null ? ` (${f.apy.toFixed(2)}% when you started)` : ""}. Withdraw any time the pool has free liquidity.` : `${f.symbol} earns interest from borrowers once supplied.`,
    state: sup?.state === "confirmed" ? "done" : "waiting",
  });
  const failed = steps.some((x) => x.state === "failed");
  const done = steps.filter((x) => x.state === "done").length;
  const status: SupplyFlowStatus = f.cancelledAt ? "cancelled" : sup?.state === "confirmed" ? "done" : failed ? "attention" : steps.some((x) => x.state === "current") ? "your_turn" : "working";
  const current = steps.find((x) => x.state === "current" || x.state === "working" || x.state === "failed")?.id ?? null;
  return { steps, status, current, done, total: steps.length, supplyRaw: delivered };
}

export const SUPPLY_STATUS_LABEL: Record<SupplyFlowStatus, string> = { your_turn: "Your turn", working: "In progress", done: "Done", attention: "Needs attention", cancelled: "Closed" };

const trimZeros = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);

/** Which holding to offer first: the most valuable one NEAR Intents can pay from, leaving gas on native coins. */
export function defaultSource<T extends { id: string; contract: string; decimals: number }>(candidates: { token: T; raw: string; usd: string | null }[]) {
  const ranked = [...candidates].filter((c) => /^\d+$/.test(c.raw) && BigInt(c.raw) > 0n).sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0));
  const top = ranked[0];
  if (!top) return null;
  const raw = BigInt(top.raw);
  // Native coins pay their own gas: offer 90% so the wallet keeps enough to send. Tokens can go in full.
  let use = top.token.contract === "native" ? (raw * 9n) / 10n : raw;
  // Keep the suggestion readable: at most 6 decimals, rounded down so it never exceeds the balance.
  if (top.token.contract === "native" && top.token.decimals > 6) { const step = 10n ** BigInt(top.token.decimals - 6); use = (use / step) * step; }
  return { token: top.token, amount: trimZeros(decimal(use, top.token.decimals)) };
}
