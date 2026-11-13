// Staking flows: one resumable operation from "what you hold" to a staked position. A flow records what the owner
// asked for and which journal attempts carry each step; its progress is always derived from those attempts' own
// states (never from the browser), so it can be closed, cancelled mid-way or reopened from Activity and still show
// exactly where it stands and what the owner needs to do next. A flow never signs or moves anything by itself.

export type FlowSource =
  | { kind: "near"; amountRaw: string }
  | { kind: "swap"; from: string; fromSymbol: string; fromNetwork: string; amount: string; expectedNearRaw: string | null };
export interface StakeFlow {
  id: string;
  accountId: string;
  venue: "linear" | "rnear";
  source: FlowSource;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  links: { pay?: string; stake?: string };
}
/** What a step needs from the journal: the attempt's state, its message, and (for a swap) what was delivered. */
export interface AttemptView { id: string; state: string; message: string; hashes: number; deliveredRaw?: string | null; refundedRaw?: string | null; stakedRaw?: string | null }
export type StepState = "done" | "current" | "working" | "waiting" | "failed";
export interface FlowStep { id: "pay" | "swap" | "arrival" | "stake" | "staked"; title: string; detail: string; state: StepState }
export type FlowStatus = "your_turn" | "working" | "done" | "attention" | "cancelled";

const NEAR = 10n ** 24n;
export const nearText = (raw: string | null | undefined) => {
  if (!raw || !/^\d+$/.test(raw)) return "—";
  const v = BigInt(raw), whole = v / NEAR, frac = (v % NEAR).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  if(v > 0n && whole === 0n && !/[1-9]/.test(frac)) return "<0.0001";
  return whole.toString() + (frac ? "." + frac : "");
};
/** A wallet request that was declined or never opened (failed with nothing on chain) can simply be tried again. */
const notSent = (a?: AttemptView | null) => !!a && a.state === "failed" && a.hashes === 0;
const inFlight = (a?: AttemptView | null) => !!a && ["awaiting_wallet", "submitted", "unknown", "partial"].includes(a.state);

/**
 * Steps and status. Swap-funded: pay on the origin chain → NEAR Intents delivers NEAR to the account → one signature
 * stakes exactly what arrived → staked. NEAR-funded: stake → staked. The amount staked after a swap is the
 * delivered amount, never the quote.
 */
export function deriveFlow(f: StakeFlow, a: { pay?: AttemptView | null; stake?: AttemptView | null }) {
  const symbol = f.venue === "rnear" ? "rNEAR" : "LiNEAR";
  const steps: FlowStep[] = [];
  let stakeRaw: string | null = f.source.kind === "near" ? f.source.amountRaw : null;
  if (f.source.kind === "swap") {
    const s = f.source, pay = a.pay;
    const delivered = pay?.state === "confirmed" ? pay.deliveredRaw ?? null : null;
    const refunded = pay && /refund/i.test(pay.message) || !!pay?.refundedRaw;
    stakeRaw = delivered;
    steps.push({
      id: "pay", title: `Send ${s.amount} ${s.fromSymbol} on ${s.fromNetwork}`,
      detail: !pay || pay.state === "prepared" || notSent(pay) ? (notSent(pay) ? "Not sent. Your wallet request was declined or closed; nothing moved." : "Approve one transfer in your wallet.")
        : pay.hashes > 0 || pay.state !== "awaiting_wallet" ? "Sent." : "Waiting for your wallet.",
      state: !pay || pay.state === "prepared" || notSent(pay) ? "current" : pay.state === "awaiting_wallet" && pay.hashes === 0 ? "working" : refunded || (pay.state === "failed" && pay.hashes > 0) ? "failed" : "done",
    });
    steps.push({
      id: "swap", title: "NEAR Intents swaps it into NEAR",
      detail: delivered ? `${nearText(delivered)} NEAR arrived in ${f.accountId}.` : refunded ? pay!.message : inFlight(pay) ? pay!.message || "Delivering to your account, usually under a minute." : `About ${nearText(s.expectedNearRaw)} NEAR expected.`,
      state: delivered ? "done" : refunded || pay?.state === "failed" && pay.hashes > 0 ? "failed" : inFlight(pay) && pay!.hashes > 0 ? "working" : "waiting",
    });
  }
  if (f.source.kind === "swap") steps.push({
    id: "arrival", title: `NEAR arrives in ${f.accountId}`,
    detail: stakeRaw ? `${nearText(stakeRaw)} NEAR received. The stake uses this actual amount.` : "Funds go to your own NEAR account before staking.",
    state: stakeRaw ? "done" : "waiting",
  });
  const st = a.stake, ready = !!stakeRaw && stakeRaw !== "0";
  steps.push({
    id: "stake", title: ready ? `Stake ${nearText(stakeRaw)} NEAR into ${symbol}` : `Stake into ${symbol}`,
    detail: !ready ? "Starts when the NEAR arrives." : !st || st.state === "prepared" || notSent(st) ? (notSent(st) ? "Not sent. Sign again when you're ready." : "Sign once in your NEAR wallet.") : st.state === "confirmed" ? "Signed." : st.message || "Waiting for final receipts.",
    state: !ready ? "waiting" : !st || st.state === "prepared" || notSent(st) ? "current" : st.state === "confirmed" ? "done" : st.state === "failed" ? "failed" : "working",
  });
  steps.push({
    id: "staked", title: `Earning with ${symbol}`,
    detail: st?.state === "confirmed" ? `${st.stakedRaw ? nearText(st.stakedRaw) + " NEAR" : "Your NEAR"} is earning in ${symbol}. Swapping ${symbol} back depends on market liquidity; delayed unstaking takes about 2–3 days.` : `${symbol} arrives in your account.`,
    state: st?.state === "confirmed" ? "done" : "waiting",
  });
  const failed = steps.some((s) => s.state === "failed");
  const done = steps.filter((s) => s.state === "done").length;
  const status: FlowStatus = f.cancelledAt ? "cancelled" : st?.state === "confirmed" ? "done" : failed ? "attention" : steps.some((s) => s.state === "current") ? "your_turn" : "working";
  const current = steps.find((s) => s.state === "current" || s.state === "working" || s.state === "failed")?.id ?? null;
  return { steps, status, current, done, total: steps.length, stakeRaw };
}

export const STATUS_LABEL: Record<FlowStatus, string> = { your_turn: "Your turn", working: "In progress", done: "Done", attention: "Needs attention", cancelled: "Closed" };

/** User-facing stage from recorded progress, including unsigned or declined wallet requests. */
export function flowStage(f: {status: FlowStatus; current: FlowStep["id"] | null; flow?: StakeFlow}): string {
  if(f.status === "done") return "Earning with " + (f.flow?.venue === "rnear" ? "rNEAR" : "LiNEAR");
  if(f.status === "cancelled") return "Closed · progress saved";
  if(f.status === "attention") return "Check recorded outcome";
  if(f.current === "pay") return f.status === "working" ? "Waiting for wallet" : "Waiting for payment";
  if(f.current === "swap" || f.current === "arrival") return "NEAR is on its way";
  return f.status === "working" ? "Confirming stake" : "Ready to stake";
}
