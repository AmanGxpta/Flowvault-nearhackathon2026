/* eslint-disable @typescript-eslint/no-explicit-any -- adapters between untyped design view-model data and API JSON */
// Maps live API snapshots onto the design's view model. Used only in the personal (live)
// workspace. When the API cannot establish a figure the view shows "Unavailable", never 0.
import { api, type LiveSnapshot, type Usable } from "./live";
import { missingEntries, withEntries } from "@/lib/flowvault/plans-policy";
import { startPlan, openPlan } from "./PlanDock";
import { accountState, chainName as regChain, shortAddress, unreadAccounts } from "@/lib/flowvault/account-registry";
import type { LinkedAccount } from "@/lib/flowvault/types";
import { chainName, days, dlabel, f, hhmm, livePayoutSupported, LIVE_ROUTES_TEXT, money, num, short, usd, whenLabel, TODAY } from "./format";

const RHEA = "contract.main.burrow.near";
export const isLiveAccount = (snap: LiveSnapshot | undefined) =>
  !!snap && snap.workspace?.mode === "live" && !!snap.workspace.accountId;

const sumUsdc = (snap: LiveSnapshot, pick: (p: any) => boolean) =>
  (snap.portfolio?.positions ?? []).filter((p: any) => p.asset === "USDC" && pick(p)).reduce((a: number, p: any) => a + Number(p.amount), 0);

const OB_STATUS: Record<string, string> = { pending: "upcoming", processing: "paying", paid: "paid", cancelled: "cancelled" };
const ATTEMPT_STATUS: Record<string, string> = {
  prepared: "prepared",
  awaiting_wallet: "awaiting",
  submitted: "progress",
  confirmed: "confirmed",
  failed: "failedtx",
  partial: "stuck",
  unknown: "stuck",
};
const KIND: Record<string, string> = { supply: "Supply", withdraw: "Withdrawal", pay: "Payout" };
const stepState = (status: string) =>
  /fail|error|reject|revert/i.test(status) ? "fail" : /unknown|uncertain|warn|refund/i.test(status) ? "warn" : /pending|wait|await|prepar/i.test(status) ? "pending" : "done";
const phaseLabel = (p: string) => p.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

// Design asset rows ↔ policy.assetRows (R4). Generic rows apply to every chain; chain rows take priority.
export const ASSET_ROWS: Record<string, { asset: string; chain?: string; label: string }> = {
  usdc: { asset: "USDC", label: "USDC · NEAR wallet" },
  evmusdc: { asset: "USDC", chain: "base", label: "USDC · Base and Arbitrum" },
  near: { asset: "NEAR", label: "NEAR" },
  staked: { asset: "NEAR", label: "Staked NEAR" },
  linear: { asset: "LiNEAR", label: "LiNEAR" },
  rnear: { asset: "rNEAR", label: "rNEAR" },
  eth: { asset: "ETH", label: "ETH · Arbitrum" },
};
// Venue chips ↔ policy.venues via GET /api/policy venueIds (R5). The USDC vault has no verified adapter or id.
export const VENUE_KEYS = ["rhea", "oneclick", "native", "linear", "rnear"] as const;
export const DEFAULT_VENUE_IDS: Record<string, string> = { rhea: RHEA, oneclick: "1click", native: "native", linear: "linear-protocol.near", rnear: "lst.rhealab.near" };
export const venueIds = (snap: LiveSnapshot): Record<string, string> => ({ ...DEFAULT_VENUE_IDS, ...((snap.policy as any)?.venueIds ?? {}) });
const findRow = (rows: any[] | undefined, asset: string, chain?: string) => {
  const m = (rows ?? []).filter((r) => String(r.asset).toLowerCase() === asset.toLowerCase());
  return (chain ? m.find((r) => r.chain === chain) : m.find((r) => !r.chain || r.chain === "near")) ?? m.find((r) => !r.chain) ?? null;
};
/** What the engine permits today when no per-asset rows are saved yet: everything except protected assets. */
const defaultUses: Record<string, string[]> = { usdc: ["hold", "supply", "pay", "fees"], evmusdc: ["hold", "pay"], near: ["hold", "fees", "stake"], staked: ["hold"], linear: ["hold"], rnear: ["hold"], eth: ["hold"] };

/** Workspace fields the design logic keeps in state, read from the API. */
export function liveState(snap: LiveSnapshot) {
  const w = snap.workspace;
  const m = w?.mandate;
  const pol = snap.policy?.policy;
  const today = new Date(TODAY).toISOString().slice(0, 10);
  const used = (snap.policy?.ledger ?? [])
    .filter((r) => r.createdAt.slice(0, 10) === today && r.state !== "cancelled-before-wallet")
    .reduce((a, r) => a + Number(r.amount), 0);
  const prot = new Set<string>((pol?.protectedAssets ?? []).map((x: string) => x.toLowerCase()));
  const ids = venueIds(snap);
  const venues: Record<string, boolean> = { vault: false };
  for (const k of VENUE_KEYS) venues[k] = (pol?.venues ?? []).includes(ids[k]);
  const assets: Record<string, { p: string; uses: string[]; saved: boolean }> = {};
  for (const [k, def] of Object.entries(ASSET_ROWS)) {
    const row = findRow(pol?.assetRows, def.asset, def.chain);
    const fallback = prot.has(def.asset.toLowerCase()) ? ["hold"] : defaultUses[k];
    assets[k] = row ? { p: row.priority, uses: [...row.uses], saved: true } : { p: "—", uses: pol?.assetRows?.length ? [] : fallback, saved: false };
  }
  const P = {
    rev: pol?.version ?? 0,
    perAction: f(pol?.perActionCap) ?? 0,
    daily: f(pol?.dailyCap) ?? 0,
    used,
    maxMove: f(pol?.maxMoveCost) ?? 0,
    borrow: !!m?.borrowing,
    venues,
    assets,
    protectedAssets: [...(pol?.protectedAssets ?? [])],
    hasRows: !!pol?.assetRows?.length,
  };
  const timeline = new Map((snap.timeline ?? []).map((t) => [t.id, t]));
  const ops = [...(snap.attempts ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => {
      const t = timeline.get(a.id);
      const steps = (t?.timeline ?? []).map((st) => ({
        label: phaseLabel(st.phase),
        detail: st.message,
        time: whenLabel(st.at),
        hash: st.explorerLinks?.length ? "Explorer ↗" : "",
        link: st.explorerLinks?.[0] ?? "",
        state: stepState(st.status),
      }));
      const amount = Number(a.amount);
      return {
        id: a.id,
        src: "journal",
        kind: KIND[a.kind] ?? a.kind,
        title: a.kind === "pay" ? "Payout" : "Rhea Lending",
        amount,
        sub: whenLabel(a.createdAt) + " · " + (a.kind === "supply" ? "native USDC → Rhea · collateral off" : a.kind === "withdraw" ? "Rhea → wallet" : "payout"),
        status: ATTEMPT_STATUS[a.state] ?? "progress",
        steps: steps.length ? steps : [{ label: phaseLabel(a.state), detail: a.message, time: whenLabel(a.updatedAt), hash: "", state: stepState(a.state) }],
        foot: a.message || "Status from the server journal.",
        live: true,
      };
    });
  const REC: Record<string, string> = { weekly: "repeats weekly", monthly: "repeats monthly", yearly: "repeats yearly" };
  const obs = (w?.obligations ?? []).map((o: any) => ({
    id: o.id,
    name: o.label,
    amount: Number(o.amount),
    asset: o.token,
    chain: chainName(o.destination),
    recipient: o.recipient || "not set",
    due: o.dueDate,
    recurrence: o.recurrence ?? "none",
    rawNote: o.note ?? "",
    note: [
      o.legacyProtected ? "Migrated cash need · protected until edited" : o.note,
      REC[o.recurrence],
      // Recurrence (recurrence.ts): "<series>-rN" is the Nth concrete instance of a repeating payment.
      /-r(\d{1,4})$/.test(o.id) && Number(o.id.match(/-r(\d{1,4})$/)[1]) >= 2 ? "payment " + o.id.match(/-r(\d{1,4})$/)[1] + " in this series" : "",
    ].filter(Boolean).join(" · "),
    status: OB_STATUS[o.status] ?? "upcoming",
  }));
  const connected = snap.scope === "personal" && !!snap.walletAccount && snap.walletAccount === w?.accountId;
  const firstRun = snap.scope === "personal" && !!w && !isLiveAccount(snap);
  const lead = Number(m?.leadDays ?? 3);
  const history = ((snap.policy as any)?.history ?? []) as { version: number; savedAt: string; summary: string }[];
  return {
    wallet: sumUsdc(snap, (p) => p.ownership !== "watched" && p.kind === "wallet" && (!p.chain || p.chain === "near")),
    rhea: sumUsdc(snap, (p) => p.ownership !== "watched" && p.kind === "supplied" && String(p.id).startsWith("rhea")),
    evm: sumUsdc(snap, (p) => p.ownership !== "watched" && p.kind === "wallet" && (p.chain === "base" || p.chain === "arb")),
    reserve: f(m?.reserve) ?? 0,
    reserveDraft: m?.reserve ?? "",
    version: m?.version ?? 1,
    horizon: m?.horizon ?? 30,
    lead,
    planDraft: { reserve: m?.reserve ?? "", horizon: String(m?.horizon ?? 30), lead: String(lead) },
    obs,
    ops,
    pol: P,
    polDraft: JSON.parse(JSON.stringify(P)),
    revisions: [...history].sort((a, b) => b.version - a.version).map((h) => ({ rev: h.version, when: whenLabel(h.savedAt), what: h.summary })),
    intents: [],
    connected,
    firstRun,
  };
}

/** The full policy for a save or a draft test: caps, venue chips, per-asset rows and protection (R4/R5/R11). */
export function draftPolicy(snap: LiveSnapshot, D: any) {
  const P = snap.policy?.policy;
  if (!P) return null;
  const ids = venueIds(snap);
  const venues = new Set<string>(P.venues ?? []);
  for (const k of VENUE_KEYS) {
    if (D.venues[k]) venues.add(ids[k]);
    else venues.delete(ids[k]);
  }
  const rows: any[] = [];
  const push = (asset: string, chain: string | undefined, a: any) => {
    if (a.p === "—") return;
    if (!rows.some((r) => r.asset === asset && (r.chain ?? null) === (chain ?? null))) rows.push({ asset, ...(chain ? { chain } : {}), priority: a.p, uses: [...a.uses] });
  };
  push("USDC", undefined, D.assets.usdc);
  push("USDC", "base", D.assets.evmusdc);
  push("USDC", "arb", D.assets.evmusdc);
  push("NEAR", undefined, D.assets.near);
  push("LiNEAR", undefined, D.assets.linear);
  push("rNEAR", undefined, D.assets.rnear);
  push("ETH", undefined, D.assets.eth);
  // Keep any saved rows the design doesn't show (other assets or chains) unchanged.
  for (const r of P.assetRows ?? []) if (!rows.some((x) => x.asset.toLowerCase() === String(r.asset).toLowerCase() && (x.chain ?? null) === (r.chain ?? null))) rows.push(r);
  const spendable = (k: string) => D.assets[k].uses.some((u: string) => u !== "hold");
  const protectedAssets = (P.protectedAssets ?? []).filter((a: string) => !(a.toLowerCase() === "eth" && spendable("eth")));
  return { ...P, perActionCap: String(D.perAction), dailyCap: String(D.daily), maxMoveCost: String(D.maxMove), venues: [...venues], protectedAssets, ...(rows.length ? { assetRows: rows } : {}) };
}

/** Short, human reason for a section that couldn't be read (the API's text stays in the Portfolio read-failure row). */
export const readReason = (r: string) => {
  const sec = r.match(/^([a-z-]+):/)?.[1];
  const what: Record<string, string> = { "native-staking": "native staking", "linear-staking": "LiNEAR", "rnear-staking": "rNEAR", near: "NEAR wallet", base: "Base", arb: "Arbitrum", rhea: "Rhea" };
  if (sec) return (what[sec] ?? sec.replace(/-/g, " ")) + (/429|providers failed|NetworkError|fetch/i.test(r) ? " read failed (NEAR RPC)" : " read failed");
  return r;
};
const reasonList = (rs: string[]) => {
  const rpc: string[] = [], other: string[] = [];
  for (const r of [...new Set(rs.map(readReason))]) {
    if (r.endsWith(" read failed (NEAR RPC)")) rpc.push(r.replace(" read failed (NEAR RPC)", ""));
    else other.push(r);
  }
  return [...(rpc.length ? [rpc.join(", ") + (rpc.length > 1 ? " reads" : " read") + " failed (NEAR RPC)"] : []), ...other].join(" · ");
};
/** Portfolio sections (BACKEND_API §13): each read succeeds or fails on its own. */
export const SECTION_NAME: Record<string, string> = { "near-native": "NEAR balance", "near-usdc": "NEAR wallet USDC", rhea: "Rhea supply", "linear-balance": "LiNEAR balance", "base-usdc": "Base USDC", "arb-usdc": "Arbitrum USDC", "native-staking": "Native staking", "linear-staking": "LiNEAR staking", "rnear-staking": "rNEAR staking", staking: "Staking" };
const secName = (id: string) => SECTION_NAME[id] ?? id.replace(/-/g, " ");
const shortWhy = (rs: string[] = []) => (rs.some((r) => /429|providers failed|NetworkError|fetch|RPC/i.test(r)) ? "NEAR RPC unavailable" : rs[0] ?? "");
const metricSub = (m: Usable | undefined, fallback: string) => {
  if (!m) return "not read yet";
  const ex: any[] = (m as any).excludedSections ?? [];
  if (m.amount === null && ex.length) return "known so far " + money(m.knownSubtotal) + " · missing " + ex.map((x) => secName(x.id) + (x.status === "not-configured" ? " (not set up)" : "")).join(", ") + (shortWhy(ex.flatMap((x) => x.reasons ?? [])) ? " · " + shortWhy(ex.flatMap((x) => x.reasons ?? [])) : "");
  if (m.amount === null) return (Number(m.knownSubtotal) > 0 || m.reasons.some((r) => /read failed|NetworkError|providers failed/i.test(r)) ? "known so far " + money(m.knownSubtotal) + " · " : "") + (reasonList(m.reasons) || "unavailable");
  const stale = m.fresh === false ? "last good read " + hhmm(m.capturedAt) + " · " : "";
  return stale + (m.coverage === "partial" ? "partial · " + fallback : fallback);
};
/** USD value of a position: USDC at face value, else the API's valuation (fictional in the example), else null. */
export const posValue = (p: any): number | null => (p.asset === "USDC" ? Number(p.amount) : p.valuation?.amount != null ? Number(p.valuation.amount) : null);
const owned = (snap: LiveSnapshot) => (snap.portfolio?.positions ?? []).filter((p: any) => p.ownership !== "watched");
const watchedPos = (snap: LiveSnapshot) => (snap.portfolio?.positions ?? []).filter((p: any) => p.ownership === "watched");

/** View-model overrides for the live workspace. `v` is the design's computed view model. */
/** A dated payment that isn't paying or paid can be removed from the calendar (the obligations API refuses the rest). */
function withRemove(self: any, example: boolean, o: any) {
  if (example || ["Receipt", "Check status"].includes(String(o.btnLabel))) return o;
  const onRemove = () => {
    self.remember();
    self.setState({
      modal: "confirm",
      confirm: {
        live: true,
        eyebrow: "CALENDAR",
        title: "Remove " + o.name + "?",
        text: o.name + " (" + o.amountF + ", due " + o.dueLabel + ") leaves your calendar and stops counting toward your holdback. Plans made for it are cancelled. Nothing on-chain changes, and you can add it again.",
        ok: "Removed " + o.name + " from your calendar.",
        no: "Keep it",
        yes: "Remove payment",
        apply: () => self.props.actions.removeObligation(o.id),
      },
    });
  };
  return { ...o, onRemove };
}

/** Forget the main NEAR account (account registry), behind a confirmation. Nothing on-chain changes. */
function askForgetMain(self: any, acct: string, connected: boolean) {
  self.setState({ menu: null });
  self.remember();
  self.setState({
    modal: "confirm",
    confirm: {
      live: true,
      eyebrow: "ACCOUNTS",
      title: "Forget " + acct + "?",
      text: "FlowVault stops reading " + acct + " and the workspace goes back to having no main account. Unexecuted drafts are cancelled. Nothing on-chain changes, your other accounts stay, and you can connect or add it again any time.",
      ok: "Forgot " + acct + ". Nothing on-chain changed.",
      no: "Keep it",
      yes: "Forget account",
      apply: async () => {
        if (connected) await self.props.actions.disconnect();
        await self.props.actions.accounts({ action: "forget", id: "near:" + acct });
      },
    },
  });
}

export function liveVals(snap: LiveSnapshot, v: any, ctx: { self: any; s: any; example: boolean }) {
  const { self, s, example } = ctx;
  const out: any = {};
  const u = snap.portfolio?.usable;
  // Engines' capitalView (same pass as /api/valuation): the one source for net worth, spendable, holdback, surplus.
  const capital = (u as any)?.capital as { spendableNow?: string; holdback?: string | null; surplus?: string | null; netWorth?: string | null; blocksAutomation?: boolean; reasons?: string[] } | undefined;
  out.scope = snap.scope;
  out.planCta =
    s.screen === "strategies" ? { label: "Plan putting surplus to work →", onClick: () => void startPlan({ objective: "deploy_surplus" }).catch(() => undefined), note: "Compares every venue against your dates and policy" }
    : s.screen === "credit" ? { label: "Plan borrowing →", onClick: () => void startPlan({ objective: "borrow" }).catch(() => undefined) }
    : null;
  // Borrow-to-payment continuity (e): credit as a source opens the next payment's plan, where borrowing is one
  // alternative carrying its debt, approval and resulting liability through to the payout.
  if (s.screen === "credit") {
    const nextPay = (s.obs ?? []).filter((o: any) => o.status === "upcoming").sort((a: any, b: any) => String(a.due).localeCompare(String(b.due)))[0];
    out.creditSourceLabel = nextPay ? "Use credit for " + nextPay.name + " →" : "Use credit for a payment →";
    out.goPay = nextPay ? () => void startPlan({ objective: "pay_obligation", obligationId: nextPay.id }).catch(() => undefined) : () => self.go("pay");
  }
  const cap = snap.portfolio?.capturedAt;
  const acct = snap.workspace?.accountId ?? "";
  const connected = !!snap.walletAccount && snap.walletAccount === acct;
  const readOnly = !connected;

  // Header, account and workspace labels (the example workspace keeps the design's example account).
  if (!example) {
  // Account registry: the main account is yours whether or not a wallet is connected right now; "connected"
  // is only whether a wallet can sign for it in this browser. Disconnecting never turns it into "watching".
  out.acctLabel = connected ? acct : acct ? acct + " · not connected" : "Connect wallet";
  out.netLabel = connected ? "Mainnet · wallet connected" : acct ? "Mainnet · not connected, read only" : "Not connected · read only";
  out.netColor = connected ? "#4E7A4A" : "#8A9285";
  out.wsRole = connected ? "Owner · can approve" : acct ? "Yours · read only until you connect" : "Read only · not connected";
  out.acctMenuNote = connected
    ? "Signed in on NEAR mainnet · " + (snap.walletName || "wallet")
    : acct
      ? "Yours · no wallet connected · nothing can be approved"
      : "No wallet connected";
  const forgetMain = { label: "Forget " + acct, color: "#9A3F32", onClick: () => askForgetMain(self, acct, connected) };

  const copy = { label: "Copy address", color: "#1E2A22", onClick: () => { try { navigator.clipboard.writeText(acct); } catch {} self.closeMenu(); self.toastMsg("Copied " + acct + "."); } };
  out.acctItems = connected
    ? [
        { label: "Switch wallet", color: "#1E2A22", onClick: () => { self.closeMenu(); self.liveCall(() => self.props.actions.connect()); } },
        copy,
        { label: "Disconnect", color: "#9A3F32", onClick: () => { self.setState({ menu: null }); self.liveCall(() => self.props.actions.disconnect(), "Disconnected. " + acct + " stays in your accounts, read only. Use Forget to remove it."); } },
        forgetMain,
      ]
    : [
        { label: "Connect wallet", color: "#3F6B3C", onClick: () => { self.setState({ menu: null }); self.liveCall(() => self.props.actions.connect()); } },
        ...(acct ? [copy, forgetMain] : []),
      ];
  out.walletApprove = () => self.toastMsg(readOnly ? "Connect the wallet that owns " + (acct || "this account") + " first. Nothing was signed." : "Use the dialog’s approve button. Nothing was signed.");
  }

  // Data tag and sources: real capture times only. A last-good snapshot keeps its original capture time (R12).
  const stale = !!u && u.cashNow?.fresh === false;
  if (example) {
    out.dataTag = snap.status === "loading" && !snap.portfolio ? "READING EXAMPLE…" : "EXAMPLE · FICTIONAL";
    out.dataTagBg = "#F6EBDD";
    out.dataTagColor = "#8A5F25";
    out.barSrc = cap ? "Fictional example figures · server example workspace · " + hhmm(cap) : "Reading the example workspace…";
    out.footLabel = "Example workspace · fictional server seed, no wallet, nothing can be signed";
  } else {
    out.dataTag = snap.status === "loading" && !snap.portfolio ? "READING MAINNET…" : snap.portfolioError ? "LIVE READ FAILED" : stale ? "LAST GOOD READ · " + hhmm(cap) : "LIVE READS · MAINNET";
    out.dataTagBg = snap.portfolioError ? "#F6E3DE" : stale ? "#F6EBDD" : "#E2EAD6";
    out.dataTagColor = snap.portfolioError ? "#9A3F32" : stale ? "#8A5F25" : "#3F6B3C";
    out.barSrc = cap ? (stale ? "Last good read · captured " + hhmm(cap) + " · fresh read failed" : "Observed USDC · wallet + Rhea · read " + hhmm(cap)) : snap.portfolioError ? "Balances unavailable · " + snap.portfolioError : "Reading balances…";
    out.footLabel = cap ? (stale ? "Last good mainnet snapshot · captured " : "Observed mainnet data · read ") + whenLabel(cap) : "Mainnet reads";
  }
  if (example) {
    out.acctLabel = "Example workspace";
    out.netLabel = "Fictional data · no wallet · read only";
    out.netColor = "#8A5F25";
    out.wsRole = "Demo Mode · nothing can be approved";
    out.acctMenuNote = "Fictional example account · it has no wallet and nothing here can be signed";
    out.acctItems = [{ label: "Leave Demo Mode", color: "#3F6B3C", onClick: () => { self.setState({ menu: null }); self.setWorkspace("live"); } }];
    out.acc = "fictional example account";
    out.resetLabel = s.resetting ? "Resetting…" : "Reset example";
    out.resetExample = () => {
      if (s.resetting) return;
      self.setState({ resetting: true, payEval: null, polTest: null, creditRes: null, cmpRes: null, cmpAmount: null, stakeQuote: null, modal: null });
      self.props.actions.resetExample()
        .then(() => { self.setState({ resetting: false }); self.toastMsg("Example workspace reset to its fictional seed, with dates relative to today."); })
        .catch((e: Error) => { self.setState({ resetting: false }); self.toastMsg(e.message); });
    };
    out.connectFirst = () => self.toastMsg("The example workspace has no wallet. Leave Demo Mode to connect yours.");
    out.walletApprove = () => self.toastMsg("Example workspace: nothing can be signed.");
  }
  out.planLabel = "Plan v" + s.version;

  // Plan to action: the engine's recommendation from /api/plan.
  const a = snap.plan?.action;
  if (a) {
    const caveats = (a.caveats ?? []).join(" ");
    const body = [a.detail, caveats].filter(Boolean).join(" ");
    const R: any =
      a.kind === "supply"
        ? { tag: "SURPLUS", title: a.title, body, cta: "Review supply", onClick: () => self.openOp("supply", a.amount) }
        : a.kind === "withdraw"
          ? { tag: "RESTORE", title: a.title, body, cta: "Withdraw USDC", onClick: () => self.openOp("withdraw", a.amount) }
          : /below your plan/i.test(a.title) && acct
            ? { tag: "FUND", title: a.title, body, cta: "Copy your NEAR account", onClick: () => { try { navigator.clipboard.writeText(acct); } catch {} self.toastMsg("Copied " + acct + ". Send native USDC on NEAR to it; FlowVault reads it, it never holds it."); } }
            : a.kind === "none"
              ? { tag: "NO STEP", title: a.title, body, cta: "Read balances again", onClick: () => self.liveCall(() => self.props.actions.refresh(), "Balances read again.") }
              : { tag: "PLAN", title: a.title, body, cta: "Open your calendar", onClick: () => self.go("calendar") };
    R.tagBg = "rgba(255,255,255,.1)";
    R.tagColor = "#C9D6C1";
    out.rec = R;
  } else {
    out.rec = { tag: "READING", title: snap.status === "loading" ? "Reading your balances…" : "No recommendation yet.", body: snap.error || "FlowVault recommends a step only after your balances and plan are read.", cta: "Review your calendar", onClick: () => self.go("calendar"), tagBg: "rgba(255,255,255,.1)", tagColor: "#C9D6C1" };
  }

  // Balances usable by date: Today plus each outstanding payment date the API evaluated.
  const wbd = u?.withdrawableByDate ?? [];
  const dated = wbd.filter((x) => x.date && days(x.date) > 0);
  const pick = dated.find((x) => x.date === s.pfLiveDate) ?? null;
  const tab = (on: boolean, label: string, onClick: () => void) => ({ label, bg: on ? "#fff" : "transparent", shadow: on ? "0 1px 3px rgba(0,0,0,.08)" : "none", onClick });
  const obName = (d: string) => (s.obs.find((o: any) => o.due === d)?.name ?? "").split(" ")[0];
  out.pfDateTabs = [tab(!pick, "Today", () => self.setState({ pfLiveDate: "now" })), ...dated.slice(0, 4).map((x) => tab(pick?.date === x.date, dlabel(x.date!) + (obName(x.date!) ? " · " + obName(x.date!) : ""), () => self.setState({ pfLiveDate: x.date })))];
  const wd = pick ?? wbd.find((x) => x.date && days(x.date) <= 0) ?? null;
  const wdLabel = pick ? dlabel(pick.date!) : "today";
  out.pfDlUpper = wdLabel.toUpperCase();
  const MD = ["#2B4233", "#D8B98F", "#4E7A4A", "#9DB48C", "#8A9285"];
  const unvalued = u?.unvaluedAssets?.filter((x) => x.amount !== "0").length ?? 0;
  const nWatched = watchedPos(snap).length;
  const bal = [
    { label: "Net worth", m: u?.netWorth, sub: (example ? "fictional valuations" : unvalued ? "owned positions · " + unvalued + " unvalued" : "owned positions") + (nWatched ? " · watched excluded" : "") },
    capital?.spendableNow != null
      ? { label: "Spendable now", m: { ...(u?.cashNow ?? {}), amount: capital.spendableNow } as Usable, sub: "USDC in the NEAR account you sign from" + (snap.evm?.base || snap.evm?.arb || example ? " · Base and Arbitrum are read-only" : "") }
      : { label: "Cash now", m: u?.cashNow, sub: example ? "USDC on NEAR, Base and Arbitrum" : "USDC in your wallet" + (snap.evm?.base || snap.evm?.arb ? ", Base and Arbitrum" : "") },
    { label: "Withdrawable by " + wdLabel, m: wd ?? u?.cashNow, sub: pick ? "cash plus positions verified to exit in time" : "cash available now" },
    { label: "Borrowing headroom", m: u?.borrowingHeadroom, sub: "read-only preview · no borrowing in this build" },
    { label: "Committed", m: u?.committedCapital, sub: "Rhea supply and payments in flight" },
  ];
  out.ovMetrics = bal.map((b, i) => ({ label: b.label, value: b.m ? money(b.m.amount) : snap.portfolioError ? "Unavailable" : "…", sub: metricSub(b.m, b.sub), dot: MD[i], border: i ? "1px solid #EEF0E8" : "none" }));
  const W = { bg: "#fff", color: "#1E2A22", border: "#E3E6DB" };
  out.pfBalances = bal.map((b, i) => ({ label: b.label, value: b.m ? money(b.m.amount) : "…", sub: metricSub(b.m, b.sub), ...(i === 0 ? { bg: "#2B4233", color: "#EAF0E2", border: "#2B4233" } : W) }));

  // Reserve / payments / surplus bar from API figures.
  const reserve = f(snap.workspace?.mandate.reserve) ?? 0;
  const inH = f(snap.obligations?.obligationsInHorizon) ?? 0;
  const surplus = f(capital?.surplus ?? snap.strategies?.surplus) ?? 0; // unknown surplus draws as none, never as free money
  const total = Math.max(reserve + inH + surplus, f(u?.netWorth.knownSubtotal) ?? 0, 1);
  const pct = (x: number) => Math.min(100, (x / total) * 100) + "%";
  out.bar = { reserve: pct(reserve), obs: pct(inH), surplus: pct(surplus) };

  // Portfolio grouped from observed positions; labels and valuations come from the API (R9).
  const pos = owned(snap).filter((p: any) => p.amount !== "0");
  const grp = (name: string, icon: string, iconBg: string, iconColor: string, rows: any[], exit: string, action: string, onAction: () => void, isLabel = false) => {
    if (!rows.length) return null;
    const known = rows.map(posValue).filter((x): x is number => x !== null);
    const sum = known.reduce((a, b) => a + b, 0);
    const balance = known.length === rows.length ? usd(sum) : known.length ? usd(sum) + " + unvalued" : "Unvalued";
    return { icon, iconBg, iconColor, name, sub: rows.map((x) => x.label + (x.asset !== "USDC" ? " · " + num(Number(x.amount)) + " " + x.asset : "") + (x.chain && x.chain !== "near" && !String(x.label).includes(chainName(x.chain)) ? " · " + chainName(x.chain) : "")).join(", "), balance, exit, action, onAction, isBtn: !isLabel, isLabel };
  };
  out.ovPositions = [
    grp("Cash", "$", "#E2EAD6", "#3F6B3C", pos.filter((p: any) => p.kind === "wallet" && p.asset === "USDC"), "Available now · the NEAR wallet holds your holdback", "Supply surplus", () => self.openOp("supply", a?.kind === "supply" ? a.amount : "")),
    grp("Earning", "↑", "#E2EAD6", "#3F6B3C", pos.filter((p: any) => p.kind === "supplied"), "Withdrawable now, liquidity-dependent · timing unverified", "Withdraw", () => self.openOp("withdraw", "")),
    (() => {
      // Engines: exits are planned per position (claimable unstaked NEAR first, then the largest position).
      const rows = pos.filter((p: any) => p.kind === "staking");
      const exitable = rows.filter((p: any) => /^(native-stake-|native-unstaking-|linear-shares$|linear-unstaking$)/.test(p.id));
      const claimable = exitable.find((p: any) => p.availableAt && /unstaking/.test(p.id));
      const target = claimable ?? [...exitable].sort((x: any, y: any) => (posValue(y) ?? 0) - (posValue(x) ?? 0))[0];
      // Example exits are reviewable with fictional prices; an example plan can never be prepared or signed.
      return target
        ? grp("Staking", "N", "#ECE8F4", "#6B5E99", rows, "Unstaking takes about 4 epochs · never counted as dated cash", (claimable ? "Plan claim · " : "Plan exit · ") + target.label + " →", () => void startPlan({ objective: "unstake", positionId: target.id }).catch(() => undefined))
        : grp("Staking", "N", "#ECE8F4", "#6B5E99", rows, "Unstaking takes epochs · never counted as dated cash", "Compare staking", () => self.go("strategies"));
    })(),
    grp("Debt and collateral", "◐", "#F6EBDD", "#8A5F25", pos.filter((p: any) => p.kind === "debt" || p.kind === "collateral"), "Manage on Rhea · not withdrawable here", "Open credit", () => self.go("credit")),
    grp("Protected", "◆", "#ECE8F4", "#5B4F8A", pos.filter((p: any) => p.kind === "wallet" && !["USDC", "NEAR"].includes(p.asset)), "Protected by your policy · never sold or pledged", "View policy", () => self.go("policy")),
    grp("Fees", "N", "#EEF0E8", "#4A5349", pos.filter((p: any) => p.kind === "wallet" && p.asset === "NEAR"), "Gas and fees" + (snap.portfolio?.staking?.exitReserveNear ? " · " + snap.portfolio.staking.exitReserveNear + " NEAR exit reserve" : ""), "Gas and fees only", () => {}, true),
    grp("Watched · excluded", "◎", "#F4F5EF", "#8A9285", watchedPos(snap), "Read only · excluded from net worth and every plan figure", "Open portfolio", () => self.go("portfolio")),
  ].filter(Boolean);
  if (!out.ovPositions.length)
    out.ovPositions = [
      snap.portfolioError || snap.portfolio?.errors?.length
        ? { icon: "!", iconBg: "#F6E3DE", iconColor: "#9A3F32", name: "Balances unavailable", sub: snap.portfolioError || snap.portfolio!.errors.join(" · "), balance: "Unavailable", exit: "Nothing is assumed while a read fails", action: "Read again", onAction: () => self.liveCall(() => self.props.actions.refresh(), "Balances read again."), isBtn: true, isLabel: false }
        : { icon: "◎", iconBg: "#F4F5EF", iconColor: "#8A9285", name: snap.portfolio ? "No positions found" : "Reading positions…", sub: acct ? acct + (snap.portfolio ? " holds no USDC, NEAR or staking positions" : "") : "Connect or watch an account", balance: snap.portfolio ? "$0.00" : "…", exit: snap.portfolio ? "Send native USDC on NEAR to start a plan" : "", action: "Open portfolio", onAction: () => self.go("portfolio"), isBtn: true, isLabel: false },
    ];
  out.positions = out.ovPositions;
  // Payments: the live pay flow is wired with Pay on a date (BACKEND_API §7); until then Pay opens that page.
  out.upcoming = (v.upcoming ?? []).map((o: any) =>
    withRemove(self, example, o.btnLabel === "Pay" || o.btnLabel === "Pay again" ? { ...o, onPay: () => self.setState({ screen: "pay", payPick: o.id }) } : o),
  );
  const n = (v.upcoming ?? []).length;
  out.obsCountLabel = String(v.obsCountLabel ?? "").replace(/^1 payments/, "1 payment").replace(/^\d+ payments/, (m: string) => (n === 1 ? "1 payment" : m));
  return out;
}

const USDC_TOKEN = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ASSET_SYMBOL: Record<string, string> = { usdc: "USDC", evmusdc: "USDC", near: "NEAR", staked: "NEAR", linear: "LiNEAR", rnear: "rNEAR", eth: "ETH" };
const yocto = (x: string | undefined) => {
  try {
    return Number(BigInt(x ?? "0") / 10n ** 20n) / 1e4;
  } catch {
    return 0;
  }
};

/** Runs the engine's read-only policy test; an unsaved draft is evaluated read-only (R11). */
export function runPolicyTest(self: any, snap: LiveSnapshot, T: any, key: string, draft: any) {
  const example = snap.scope === "example";
  const acct = example ? "fictional-example" : snap.workspace?.accountId ?? "";
  const ids = venueIds(snap);
  const venue = ids[T.venue] ?? T.venue;
  const kind = T.kind;
  const body: any = {
    kind,
    asset: ASSET_SYMBOL[T.asset] ?? T.asset,
    chain: T.asset === "evmusdc" ? "base" : T.asset === "eth" ? "arb" : "near",
    amount: String(T.amount || "0"),
    recipient: acct,
    accountId: acct,
    venue,
    source: example ? "demo" : "live",
    movingCost: kind === "supply" && T.venue === "rhea" ? "0" : null,
    gasNear: "0.25",
    methods:
      kind === "supply" && T.venue === "rhea"
        ? [{ receiver: USDC_TOKEN, method: "ft_transfer_call", nestedReceiver: RHEA }]
        : kind === "pay"
          ? [{ receiver: USDC_TOKEN, method: "ft_transfer" }]
          : kind === "stake"
            ? [{ receiver: venue, method: "deposit_and_stake" }]
            : [{ receiver: venue, method: kind }],
  };
  if (draft) body.draftPolicy = draft;
  self.props.actions
    .policyTest(body)
    .then((r: any) => self.setState({ polTest: { key, result: r, error: "" } }))
    .catch((e: Error) => self.setState({ polTest: { key, result: null, error: e.message } }));
}

const RULES: [string, string][] = [
  ["PER_ACTION_CAP", "Per-action cap"],
  ["DAILY_CAP", "Daily cap"],
  ["VENUE_NOT_ALLOWED", "Venue is allowlisted"],
  ["PROTECTED_ASSET", "Asset isn’t protected"],
  ["ASSET_SCOPE_UNVERIFIED", "Asset has a policy row for this chain"],
  ["ASSET_USE_NOT_ALLOWED", "Asset may be used this way"],
  ["RECIPIENT_NOT_ALLOWED", "Recipient is allowlisted"],
  ["MOVING_COST_CAP", "Moving cost within your limit"],
  ["COST_UNVERIFIED", "Moving cost is verified"],
  ["GAS_CAP", "NEAR fee budget within your limit"],
  ["METHOD_NOT_ALLOWED", "Contract method is allowlisted"],
  ["NESTED_RECEIVER_NOT_ALLOWED", "Token transfer targets an approved venue"],
];
const pct = (x: string | number) => (Math.round(Number(x) * 100) / 100).toString() + "%";
const DEST: Record<string, string> = { NEAR: "near", Base: "base", Arbitrum: "arb", "BNB Chain": "bnb", Ethereum: "eth" };
/** Honest route support for a dated payment: the calendar holds any of these; only Base/Arbitrum USDC pays out live. */
export const routeNote = (chain: string, token: string, example: boolean) =>
  livePayoutSupported(chain, token)
    ? example
      ? "Costed with fictional example routes here. In your personal workspace, exact " + token + " on " + chain + " pays out live through NEAR Intents 1Click, funded from NEAR USDC."
      : "Payable here: exact " + token + " on " + chain + " through NEAR Intents 1Click, funded from your NEAR USDC. Marked paid only after delivery is verified on " + chain + "."
    : (example ? "Planned with fictional example routes. " : "Saved in your calendar and held back in the plan. ") + "Live payout isn’t supported for " + token + " on " + chain + "; only " + LIVE_ROUTES_TEXT + " pays out."

/** Calendar, Policy and Portfolio, from the API, in both workspaces. */
export function liveConfigure(snap: LiveSnapshot, v: any, ctx: { self: any; s: any; example: boolean }) {
  const { self, s, example } = ctx;
  const out: any = {};
  const acts = self.props.actions;
  const acct = snap.workspace?.accountId ?? "";
  const connected = !example && !!snap.walletAccount && snap.walletAccount === acct;
  const tag = example ? "Example workspace: " : "";

  // ---- Calendar: reserve, horizon and lead days are saved on the mandate (R3).
  const pd = s.planDraft;
  out.planClean = String(pd.reserve) === String(snap.workspace?.mandate.reserve ?? "") && Number(pd.horizon) === s.horizon && Number(pd.lead) === s.lead;
  out.savePlanBg = out.planClean ? "#B9C0B2" : "#2A4034";
  out.savePlan = () => {
    if (out.planClean) return;
    const lead = Number(pd.lead);
    if (!Number.isInteger(lead) || lead < 1 || lead > 7) return self.toastMsg("Lead days must be a whole number from 1 to 7.");
    self.liveCall(
      () => acts.savePlan({ reserve: String(pd.reserve).trim(), horizon: Number(pd.horizon), leadDays: lead }),
      tag + "Plan saved with a " + lead + "-day lead. Earlier drafts were superseded.",
    );
  };
  out.recurNote = s.form?.recurrence && s.form.recurrence !== "none" ? "The next one is added after each payment is made or its date passes, and counted in your holdback; each payment is still approved by you" : "";
  out.saveOb = () => {
    if (v.formInvalid) return;
    const fm = s.form;
    const destination = DEST[fm.chain];
    if (!destination) return self.toastMsg("Choose a destination chain.");
    const token = fm.token === "USDT" ? "USDT" : "USDC";
    self.setState({ modal: null });
    self.liveCall(
      () =>
        acts.addObligation({
          label: fm.name.trim(),
          recipient: fm.recipient.trim(),
          destination,
          token,
          amount: String(fm.amount).trim(),
          dueDate: fm.due,
          ...(fm.note?.trim() ? { note: fm.note.trim() } : {}),
          recurrence: fm.recurrence || "none",
        }),
      tag + fm.name.trim() + " added. " + routeNote(fm.chain, token, example),
    );
  };
  if (s.modal === "add") {
    const amt = Number(s.form.amount);
    const token = s.form.token === "USDT" ? "USDT" : "USDC";
    const hold = f(snap.obligations?.holdback);
    if (amt > 0)
      out.impact = {
        text:
          (hold !== null ? "Holdback rises to " + usd(hold + amt) + " if it’s due within " + s.horizon + " days. " : "") +
          (token === "USDT" && !example ? "Live USDT isn’t valued in USDC yet, so automatic holdback stays blocked until FX is verified. " : "") +
          routeNote(s.form.chain, token, example),
        bg: livePayoutSupported(s.form.chain, token) ? "#E2EAD6" : "#FBF6EE",
        color: livePayoutSupported(s.form.chain, token) ? "#2F552D" : "#6E4A1A",
      };
  }
  if (!snap.policy) out.planMoveCost = "…";

  // ---- Policy: caps, venue chips (R5), per-asset priority and uses (R4), history (R6), draft tests (R11).
  const D = s.polDraft;
  const P0 = s.pol;
  const dirtyAssets = JSON.stringify(P0.assets) !== JSON.stringify(D.assets);
  const dirty = P0.perAction !== D.perAction || P0.daily !== D.daily || P0.maxMove !== D.maxMove || P0.borrow !== D.borrow || JSON.stringify(P0.venues) !== JSON.stringify(D.venues) || dirtyAssets;
  const draft = dirty ? draftPolicy(snap, D) : null;
  out.polAssets = (v.polAssets ?? []).map((a: any, i: number) => {
    const k = Object.keys(ASSET_ROWS)[i];
    const row = D.assets?.[k];
    const sub = k === "staked" ? "follows the NEAR row · staking moves NEAR" : k === "evmusdc" ? "saved as Base and Arbitrum rows" : a.sub;
    const locked = k === "staked";
    return {
      ...a,
      sub: (row && !row.saved && P0.rev && k !== "staked" ? "no saved row · " : "") + sub,
      prio: a.prio.map((b: any) => (locked ? { ...b, bg: row?.p === b.label ? "#fff" : "transparent", onClick: () => self.toastMsg("Staked NEAR follows the NEAR row; the engine has no separate staked-NEAR asset.") } : b)),
      uses: a.uses.map((u: any) => (locked ? { ...u, onClick: () => self.toastMsg("Staked NEAR follows the NEAR row; the engine has no separate staked-NEAR asset.") } : u)),
    };
  });
  out.savePolicy = () => {
    if (!dirty) return;
    if (!draft) return self.toastMsg("Policy unavailable. Nothing was saved.");
    const borrowChanged = D.borrow !== P0.borrow;
    self.liveCall(async () => {
      await acts.savePolicy(draft);
      if (borrowChanged) await acts.savePlan({ borrowing: D.borrow });
    }, tag + "Policy saved as revision " + (P0.rev + 1) + ". Actions prepared under the previous revision must be prepared again.");
  };
  if (dirty && dirtyAssets && !P0.hasRows)
    out.polSave = { ...(v.polSave ?? {}), sub: (v.polSave?.sub ?? "") + " Saving creates per-asset rows; any asset without a row is then refused (fail closed)." };
  // Test bench: evaluated by the engine (POST /api/policy/test), against the unsaved draft when there is one.
  const T = s.test;
  const key = JSON.stringify([T, snap.policy?.policy?.version, acct, snap.scope, draft]);
  const canTest = example || !!acct;
  if (canTest && snap.policy && s.screen === "policy" && (!s.polTest || s.polTest.key !== key) && self.polTestKey !== key) {
    self.polTestKey = key;
    clearTimeout(self.polTestTimer);
    self.polTestTimer = setTimeout(() => runPolicyTest(self, snap, T, key, draft), 350);
  }
  const pt = s.polTest && s.polTest.key === key ? s.polTest : null;
  if (!canTest) {
    out.testRows = [];
    out.testVerdict = { text: "Connect your wallet to test actions against your policy", bg: "#F4F5EF", color: "#5B6458" };
  } else if (!pt) {
    out.testRows = [];
    out.testVerdict = { text: "Checking with the engine…", bg: "#F4F5EF", color: "#5B6458" };
  } else if (pt.error) {
    out.testRows = [];
    out.testVerdict = { text: "Couldn’t test: " + pt.error, bg: "#F6E3DE", color: "#7F3528" };
  } else {
    const vio = pt.result.violations ?? [];
    const codes = new Set(vio.map((x: any) => x.code));
    const extra = vio.filter((x: any) => !RULES.some(([c]) => c === x.code));
    out.testRows = [
      ...RULES.filter(([c]) => codes.has(c) || !["ASSET_SCOPE_UNVERIFIED", "COST_UNVERIFIED", "NESTED_RECEIVER_NOT_ALLOWED"].includes(c)).map(([c, label]) => {
        const hit = vio.find((x: any) => x.code === c);
        return { glyph: hit ? "✕" : "✓", color: hit ? "#9A3F32" : "#3F6B3C", text: hit ? hit.message : label, k: hit ? hit.message : label };
      }),
      ...extra.map((x: any) => ({ glyph: "✕", color: "#9A3F32", text: x.message, k: x.message })),
    ];
    const nf = vio.length;
    out.testVerdict = nf
      ? { text: "Refused at prepare · " + nf + (nf > 1 ? " rules fail" : " rule fails"), bg: "#F6E3DE", color: "#7F3528" }
      : { text: "Passes every rule · " + (example ? "would be prepared for approval in a live workspace" : "can be prepared for your approval"), bg: "#E2EAD6", color: "#2F552D" };
    if (pt.result.dailyTotal != null) out.polUsedLabel = money(pt.result.dailyTotal) + " of " + usd(D.daily) + " used today" + (example ? " · simulated prior usage" : "");
    out.testAgainst = (pt.result.evaluatedAgainst === "unsaved-draft" ? "Checked by the engine against your unsaved draft" : "Checked by the engine against saved revision " + pt.result.policyVersion) + (example ? " · fictional example" : "");
  }
  if (!pt) out.testAgainst = dirty ? "Will be checked against your unsaved draft" : "Checked against saved revision " + (snap.policy?.policy?.version ?? "—");
  // Proposals: none exist until the optional on-chain policy contract (§9) is deployed by the owner.
  out.proposals = [];
  out.hasAgent = false;
  // Authority: components/fv/PolicyContract.tsx reads /api/policy-contract for the on-chain row (f).
  out.policyVersion = snap.policy?.policy?.version ?? null;
  out.policyLive = !example;
  out.agentName = "No agent registered";
  out.agentSub = "The optional on-chain policy contract is built but not deployed. After you deploy it and add an agent, its propose-only key appears here.";
  out.proposalsNote = "No proposals yet. Agent proposals arrive only through the deployed policy contract; approving one would open the normal review, and you still sign in your wallet.";
  // Until the saved values arrive, fields stay empty rather than showing 0.
  if (!snap.policy) {
    out.polD = { ...D, perAction: "", daily: "", maxMove: "" };
    out.polRev = "…";
    out.polSave = { title: snap.status === "loading" ? "Reading your policy…" : "Policy unavailable", sub: snap.errors?.policy || snap.error || "Nothing can be saved until the saved policy is read.", bg: "#F4F5EF", border: "#E3E6DB", color: "#4A5349", btnBg: "#B9C0B2" };
    out.polUsedLabel = "…";
  }
  if (!snap.workspace) out.planDraft = { ...pd, reserve: "" };

  // ---- Portfolio: every position with its API label, chain, valuation and ownership (R9/R10).
  const pf = snap.portfolio;
  const cap = pf?.capturedAt;
  const stale = pf?.usable?.cashNow?.fresh === false;
  const srcOf = (p: any) => (p.venue ? p.venue + " · " : "") + (example ? "fictional example" : stale ? "last good read" : "mainnet read") + (p.capturedAt || cap ? " · " + hhmm(p.capturedAt ?? cap) : "");
  const protSet = new Set((snap.policy?.policy?.protectedAssets ?? []).map((x: string) => x.toLowerCase()));
  const rows = (pf?.positions ?? []).filter((p: any) => p.amount !== "0" || p.id === "usdc-wallet");
  out.pfRows = rows.map((p: any) => {
    const watched = p.ownership === "watched";
    const isUsdc = p.asset === "USDC";
    const fees = p.asset === "NEAR" && p.kind === "wallet";
    const prot = protSet.has(String(p.asset).toLowerCase());
    const val = posValue(p);
    const by = watched ? "Excluded" : prot ? "Protected" : fees ? "Fees only" : p.kind === "wallet" && isUsdc ? "✓ Usable" : p.kind === "supplied" ? (p.availableAt && !p.availabilityIsEstimate ? "From " + dlabel(String(p.availableAt).slice(0, 10)) : "Timing unverified") : p.kind === "debt" ? "Debt" : "Hold";
    return {
      name: p.label,
      sub: (p.asset !== "USDC" ? (p.amount === "unknown" ? "quantity unknown" : num(Number(p.amount)) + " " + p.asset) : p.accountId ?? (example ? "fictional account" : acct)) + (p.venue ? " · " + p.venue : ""),
      chain: chainName(p.chain ?? "near"),
      value: val !== null ? usd(val) : "Unvalued",
      valColor: val !== null ? "#1E2A22" : "#8A5F25",
      by,
      byColor: by === "✓ Usable" ? "#3F6B3C" : prot ? "#5B4F8A" : "#8A9285",
      path: watched ? "Read only · never counted" : p.kind === "wallet" ? (fees ? "Gas and fees" : "Available now") : p.kind === "supplied" ? "Withdrawable now · liquidity-dependent" : p.kind === "staking" ? "Unstake or swap · timing estimated" : "Manage on Rhea",
      tag: watched ? "WATCHED" : example ? "FICTIONAL" : val === null ? "UNVALUED" : stale ? "LAST GOOD" : "LIVE READ",
      tagBg: watched ? "#EEF0E8" : example ? "#F6EBDD" : val === null ? "#F6E3DE" : stale ? "#F6EBDD" : "#E2EAD6",
      tagColor: watched ? "#5B6458" : example ? "#8A5F25" : val === null ? "#9A3F32" : stale ? "#8A5F25" : "#3F6B3C",
      src: srcOf(p) + (p.valuation?.basis && !isUsdc ? " · " + p.valuation.basis : ""),
      opacity: watched ? 0.75 : 1,
    };
  });
  const sections: any[] = (pf as any)?.sections ?? [];
  const readErr = [snap.portfolioError, ...(pf?.errors ?? []), ...(sections.length ? [] : [...new Set(((pf?.usable?.netWorth?.reasons ?? []) as string[]).filter((r) => /^[a-z-]+:/.test(r)).map(readReason))]), ...((pf as any)?.watchedErrors ?? []).map((e: any) => (typeof e === "string" ? e : (e.label ?? e.id ?? "watched") + ": " + (e.error ?? e.message ?? "read failed")))].filter(Boolean);
  // One row per section that couldn't be read, beside the real rows; unconfigured EVM wallets are said plainly.
  for (const sec of sections.filter((x) => x.status === "unavailable" || x.status === "partial"))
    out.pfRows.push({ name: secName(sec.id) + (sec.status === "partial" ? " · partly read" : " · unavailable"), sub: (sec.reasons ?? []).map(readReason).join(" · ") || "read failed", chain: /base/.test(sec.id) ? "Base" : /arb/.test(sec.id) ? "Arbitrum" : "NEAR", value: "Unavailable", valColor: "#9A3F32", by: "Excluded", byColor: "#8A9285", path: "Not counted until it reads · affects " + (sec.affects ?? []).join(", "), tag: sec.status === "partial" ? "PARTIAL" : "READ FAILED", tagBg: "#F6E3DE", tagColor: "#9A3F32", src: sec.capturedAt ? "tried " + hhmm(sec.capturedAt) : "", opacity: 1 });
  const unset = sections.filter((x) => x.status === "not-configured").map((x) => secName(x.id));
  if (unset.length && !example)
    out.pfRows.push({ name: unset.join(" and ") + " · not set up", sub: "No EVM wallet connected yet. Ethereum wallet connections are next. Nothing is assumed meanwhile.", chain: "—", value: "—", valColor: "#8A9285", by: "Not read", byColor: "#8A9285", path: "Not a zero balance", tag: "NOT SET UP", tagBg: "#EEF0E8", tagColor: "#5B6458", src: "", opacity: 0.85 });
  if (readErr.length)
    out.pfRows.push({ name: "Some reads failed", sub: readErr.join(" · "), chain: "—", value: "Unavailable", valColor: "#9A3F32", by: "Excluded", byColor: "#8A9285", path: "Nothing is assumed while a read fails", tag: "READ FAILED", tagBg: "#F6E3DE", tagColor: "#9A3F32", src: "", opacity: 1 });
  out.pfHas = out.pfRows.length > 0;
  out.pfEmpty = !out.pfHas;
  // Account registry (any chain, any number per chain). Accounts enter only through their wallet; rows show
  // connected / yours / not proven. "Connected" is computed here from live wallet sessions and never stored.
  const W: any = snap.workspace ?? {};
  const reg: LinkedAccount[] = W.accounts ?? [];
  const live = new Set<string>(snap.walletAccount ? ["near:" + snap.walletAccount] : []);
  const unread = new Set(unreadAccounts(W).map((a) => a.id));
  const evmOwn = reg.filter((a) => a.chain === "evm" && a.proof).map((a) => a.address);
  const NET: Record<string, string> = { near: "NEAR", ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", solana: "Solana" };
  const READ_NOW: Record<string, string[]> = { near: ["near"], evm: ["base", "arbitrum"], solana: [] };
  const acctCall = (body: any, ok?: string) => self.liveCall(() => acts.accounts(body), ok);
  const proofText = (a: LinkedAccount) => (a.proof?.method === "wallet-session" ? "proven by a wallet connection" : "ownership proven by signature");
  out.pfAccounts = example
    ? [{ name: "Fictional example account", sub: "NEAR · no wallet · nothing can be approved", tag: "EXAMPLE", tagBg: "#F6EBDD", tagColor: "#8A5F25" }]
    : reg.map((a) => {
        const st = accountState(a, live);
        const nets = a.networks.map((n) => NET[n] ?? n).join(", ");
        const readNets = a.networks.filter((n) => READ_NOW[a.chain].includes(n)).map((n) => NET[n] ?? n);
        const notRead = st === "unproven" ? "" : unread.has(a.id) ? "balances not read yet" : readNets.length < a.networks.length ? "reads " + (readNets.join(", ") || "nothing yet") + " for now" : "";
        const sub = [
          regChain(a.chain) + (a.chain === "evm" ? " · " + nets : ""),
          ![a.address, shortAddress(a.address)].includes(a.label.toLowerCase()) && ![a.address, shortAddress(a.address)].includes(a.label) ? shortAddress(a.address) : "",
          st === "unproven"
            ? "added before wallet proof was required · not read or counted until its wallet connects" + (a.chain === "near" ? "" : " (" + regChain(a.chain) + " wallet connection is next)")
            : st === "connected"
              ? (snap.walletName || "wallet") + " connected · can approve"
              : "yours · counted · " + proofText(a) + " · connect its wallet to approve",
          notRead,
        ].filter(Boolean).join(" · ");
        const tagText = st === "connected" ? "CONNECTED" : st === "yours" ? (a.primary ? "MAIN · YOURS" : "YOURS") : "NOT PROVEN";
        const actions = st !== "connected" && a.chain === "near" ? [{ label: "Connect wallet", onClick: () => self.liveCall(() => acts.connect()) }] : [];
        return {
          name: a.label,
          sub,
          tag: tagText,
          tagBg: st === "connected" ? "#E2EAD6" : st === "yours" ? "#E7ECF3" : "#F6EBDD",
          tagColor: st === "connected" ? "#3F6B3C" : st === "yours" ? "#3F5A7A" : "#8A5F25",
          actions,
          removeLabel: "Forget " + a.label,
          onRemove: a.primary
            ? () => askForgetMain(self, a.address, connected)
            : () => acctCall({ action: "forget", id: a.id }, "Forgot " + a.label + ". Nothing on-chain changed."),
        };
      });
  // Adding an account always goes through its wallet: NEAR now; EVM and Solana wallet connections are next (A3).
  out.acctAddLabel = example ? "" : "+ Connect another wallet";
  out.acctAdd = () => (example ? undefined : self.liveCall(() => acts.connect()));
  out.acctFoot = "FlowVault shows only accounts you’ve proven are yours by connecting their wallet. Only a connected wallet can approve anything, and FlowVault never signs for you. NEAR wallets connect now; Ethereum and Solana wallets are next.";
  // Staking from GET /api/portfolio (native pools) where the API returns them.
  const nat = pf?.staking?.native;
  if (!example) {
    const ps: any[] = nat?.status === "observed" ? nat.positions : [];
    const staked = ps.reduce((a, x) => a + yocto(x.staked), 0);
    const unst = ps.reduce((a, x) => a + yocto(x.unstaked), 0);
    const wdr = ps.reduce((a, x) => a + yocto(x.withdrawable ?? (x.canWithdraw ? x.unstaked : "0")), 0);
    const unk = nat?.status !== "observed";
    const firstUnlock = ps.find((x) => yocto(x.unstaked) > 0);
    out.pfStake = [
      { label: "STAKED", v: unk ? "Unavailable" : num(staked) + " NEAR", sub: unk ? nat?.error ?? "native staking not read" : ps.length + (ps.length === 1 ? " pool" : " pools") + " · native validators", bg: "#F7F8F3" },
      { label: "UNSTAKING", v: unk ? "Unavailable" : num(unst) + " NEAR", sub: firstUnlock ? (firstUnlock.epochsRemaining ?? "?") + " epochs left · estimate" : "nothing unbonding", bg: "#FBF6EE" },
      { label: "WITHDRAWABLE", v: unk ? "Unavailable" : num(wdr) + " NEAR", sub: "moves here when unbonding ends", bg: "#F7F8F3" },
    ];
    out.pfStakeHead = ps.length ? ps.map((x) => x.pool).join(", ") + " · native" : unk ? "native staking · not read" : "no native stake";
  } else {
    const byId = (id: string) => (pf?.positions ?? []).find((p: any) => p.id === id);
    const st = byId("native-staked"), un = byId("native-unstaking");
    out.pfStake = [
      { label: "STAKED", v: st ? num(Number(st.amount)) + " NEAR" : "…", sub: "fictional native stake", bg: "#F7F8F3" },
      { label: "UNSTAKING", v: un ? num(Number(un.amount)) + " NEAR" : "…", sub: "fictional · unlock is an estimate", bg: "#FBF6EE" },
      { label: "WITHDRAWABLE", v: "0.00 NEAR", sub: "moves here when unbonding ends", bg: "#F7F8F3" },
    ];
    out.pfStakeHead = "fictional validator · native";
  }
  const evmA = evmOwn[0] ?? "";
  const SUB: Record<string, string> = example
    ? { "USDC · NEAR wallet": "fictional NEAR account", "USDC · Base and Arbitrum": "fictional EVM address · read only", NEAR: "liquid · gas and fees", "Staked NEAR": "follows the NEAR row", LiNEAR: "liquid staking", rNEAR: "liquid staking", "ETH · Arbitrum": "fictional · protected" }
    : { "USDC · NEAR wallet": acct || "no account", "USDC · Base and Arbitrum": evmA ? short(evmA) + " · read only" : "no EVM address added", NEAR: "liquid · gas and fees", "Staked NEAR": "follows the NEAR row", LiNEAR: "liquid staking", rNEAR: "liquid staking", "ETH · Arbitrum": evmA ? short(evmA) + " · no USD price source yet" : "no EVM address added" };
  out.polAssets = out.polAssets.map((a: any) => ({ ...a, sub: (String(a.sub).startsWith("no saved row") ? "no saved row · " : "") + (SUB[a.name] ?? a.sub) }));
  out.pfStakeNote = "Unlock times are estimates from the current epoch, so staked or unbonding NEAR never counts toward a payment date." + (pf?.staking?.exitReserveNear ? " Exit reserve kept: " + pf.staking.exitReserveNear + " NEAR." : "");
  return out;
}

const REASON: Record<string, string> = {
  NOT_NEEDED_IDLE_CASH_COVERS: "Not needed: idle cash covers it",
  NEW_DEBT_NEEDS_EXPLICIT_APPROVAL: "New debt needs your explicit approval",
  IDLE_CASH_SHORT: "Idle cash after other payments is short",
  SOURCES_UNVERIFIED: "Sources couldn’t be verified",
  NO_STRESS_CAPACITY: "No borrowing capacity under your stress limits",
  CAPACITY_UNKNOWN: "Borrowing capacity can’t be established from verified values",
  NO_DEBT_FOUND: "No loan found to repay",
  NO_CASH_ABOVE_HOLDBACK: "No cash above your reserve and dated payments",
  PARTIAL_REPAY_ONLY: "Cash covers only part of the loan",
  HOLDBACK_UNAVAILABLE: "Holdback can’t be established",
  NO_LIVE_ROUTE: "No live payout route for this token and chain",
  RHEA_SUPPLY_SHORT: "Rhea supply doesn’t cover the shortfall",
  NO_PENDING_PAYMENT: "No pending payment",
  NO_ELIGIBLE_SURPLUS: "No surplus above your holdback",
  NO_IDLE_NEAR: "No idle NEAR above the 0.75 NEAR kept for gas and exits",
  NOT_ENOUGH_IDLE_NEAR: "More than your idle NEAR (0.75 NEAR stays for gas and exits)",
  EXCEEDS_VERIFIED_SURPLUS: "Worth more than your verified surplus after reserve and payments",
  NEAR_BALANCE_UNKNOWN: "Your NEAR balance couldn’t be read",
  NEAR_VALUATION_UNAVAILABLE: "NEAR has no fresh price right now",
  SURPLUS_UNAVAILABLE: "Surplus can’t be established",
  VALIDATOR_NOT_ELIGIBLE: "This validator didn’t pass verification",
  VALIDATOR_UNREAD: "The validator couldn’t be checked",
  NO_SWAP_STEP: "Unstaking returns NEAR, not USDC; FlowVault has no swap step",
  EXCEEDS_POSITION: "More than this position holds",
  LINEAR_PRICE_UNAVAILABLE: "LiNEAR’s NEAR rate couldn’t be read",
  STAKE_NEEDS_EXPLICIT_APPROVAL: "Approve the stake first",
  EXAMPLE_WORKSPACE: "Example workspace · nothing can be prepared",
  EXAMPLE_WORKSPACE_STAKE_NOT_SIZED: "Example workspace · staking isn’t sized",
  PLAN_EXPIRED: "Plan expired after 24 hours without execution",
  CASH_PLAN_CHANGED: "Your cash plan changed",
  POLICY_CHANGED: "Your policy changed",
  WORKSPACE_CHANGED: "Your workspace changed",
  QUOTE_UNAVAILABLE: "Quote unavailable",
  CREDIT_READ_FAILED: "Credit read failed",
  CREDIT_UNAVAILABLE: "Credit unavailable",
  VENUE_NOT_APPROVED: "Not in your approved venues",
  ASSET_MISMATCH: "Asset doesn’t match this USDC plan",
  RATE_OR_AVAILABILITY_UNVERIFIED: "Rate or availability unverified",
  STALE_MARKET: "Market data is stale",
  PORTFOLIO_COVERAGE_INCOMPLETE: "Portfolio read is incomplete",
  OBLIGATION_VALUATION_UNKNOWN: "A payment can’t be valued in USDC",
  NO_SURPLUS: "No surplus above your holdback",
  EXIT_WINDOW_UNKNOWN: "Exit window unknown",
  COSTS_UNVERIFIED: "Entry or exit costs unverified",
  EXIT_LIQUIDITY_UNVERIFIED: "Exit liquidity unverified",
  INSUFFICIENT_EXIT_LIQUIDITY: "Not enough exit liquidity",
  DEADLINE_PASSED: "Payment date has passed",
  EXIT_MISSES_DUE_DATE: "Exit misses the payment date",
  POSITION_TOO_SMALL: "Position is worth less than the amount needed",
  POSITION_VALUE_UNKNOWN: "Position value unknown",
  NO_NET_ADVANTAGE_OVER_LIQUID: "Doesn’t beat staying liquid",
  AMOUNT_EXCEEDS_SURPLUS: "Amount is above your surplus",
  STALE_PORTFOLIO: "Balances are stale",
  HORIZON_UNSUPPORTED: "Date is beyond the supported horizon",
  PROTOCOL_LIMIT_OR_LIQUIDITY_UNKNOWN: "Protocol borrow limit or liquidity unknown",
  UNKNOWN_DEBT_LIMIT_OR_LIQUIDITY: "Protocol borrow limit or liquidity unknown",
  INELIGIBLE_COLLATERAL: "Not pledgeable under your policy",
  PERMISSION_DENIED: "Your policy doesn’t allow borrowing against it",
  ASSET_USE_NOT_ALLOWED: "Your policy doesn’t allow this use",
  ASSET_SCOPE_UNVERIFIED: "No policy row for this asset",
  NEAR_USDC_VALUATION_UNVERIFIED: "NEAR isn’t valued in USDC yet",
  MATCHING_CALENDAR_RECIPIENT_REQUIRED: "No matching payment in your calendar",
  AMBIGUOUS_CALENDAR_RECIPIENT: "More than one matching payment in your calendar",
  UNSUPPORTED_FUNDING_SOURCE: "That funding source isn’t supported",
  PER_ACTION_CAP: "Over your per-action cap",
  RATE_UNVERIFIED: "Rate couldn’t be verified",
  READ_FAILED: "Read failed",
  VALIDATOR_REQUIRED: "Choose a verified validator",
  LIVE_EXACT_OUTPUT_COSTS_UNVERIFIED: "No verified live exact-output cost yet",
  NO_VERIFIED_VALIDATORS_AVAILABLE: "No verified validator available right now",
  FICTIONAL_EXAMPLE_NO_LIVE_VALIDATORS: "The example has no live validators",
  MOVING_COST_CAP: "Route cost is over your moving-cost limit",
  DAILY_CAP: "Over your daily cap",
  PROTECTED_ASSET: "Protected asset",
  VENUE_NOT_ALLOWED: "Venue not allowlisted",
  RECIPIENT_NOT_ALLOWED: "Recipient not allowlisted",
};
/** "12.5" NEAR → raw yoctoNEAR string; null when not a positive amount with at most 24 decimals. */
export function nearToYocto(v: string): string | null {
  if (!/^(0|[1-9]\d{0,12})(\.\d{1,24})?$/.test(v)) return null;
  const [w, f = ""] = v.split(".");
  const raw = BigInt(w) * 10n ** 24n + BigInt(f.padEnd(24, "0"));
  return raw > 0n ? raw.toString() : null;
}
export const reasonText = (codes: string[] = []) => codes.map((c) => REASON[c] ?? c.replace(/_/g, " ").toLowerCase()).join(" · ");
const BIND: Record<string, string> = { stressed_health: "Minimum stressed health", policy_ltv: "Your LTV cap", ltv_cap: "Your LTV cap", protocol_ltv: "Protocol LTV", protocol_limit: "Protocol borrow limit", liquidity: "Available liquidity", existing_debt: "Existing debt" };
const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

/** Strategies, staking options, Credit and the supply/withdraw dialog, in both workspaces. */
export function liveDecide(snap: LiveSnapshot, v: any, ctx: { self: any; s: any; example: boolean }) {
  const { self, s, example } = ctx;
  const out: any = {};
  const acts = self.props.actions;
  const acct = snap.workspace?.accountId ?? "";
  const connected = !example && !!snap.walletAccount && snap.walletAccount === acct;

  // ---- Strategies: ranked by /api/strategies; a custom comparison amount is ranked by the API too (R13).
  const custom = s.cmpAmount != null && String(s.cmpAmount).trim() !== "" && String(s.cmpAmount).trim() !== String(snap.strategies?.surplus ?? "");
  const amt = custom ? String(s.cmpAmount).trim() : "";
  const ckey = JSON.stringify([amt, snap.scope, snap.strategies?.capturedAt]);
  if (custom && s.screen === "strategies" && (!s.cmpRes || s.cmpRes.key !== ckey) && self.cmpKey !== ckey) {
    self.cmpKey = ckey;
    clearTimeout(self.cmpTimer);
    self.cmpTimer = setTimeout(() => {
      if (!(Number(amt) > 0)) return self.setState({ cmpRes: { key: ckey, res: null, err: "Enter an amount above zero." } });
      acts.strategies(amt).then((r: any) => self.setState({ cmpRes: { key: ckey, res: r, err: "" } })).catch((e: Error) => self.setState({ cmpRes: { key: ckey, res: null, err: e.message } }));
    }, 400);
  }
  const cr0 = custom && s.cmpRes?.key === ckey ? s.cmpRes : null;
  // While a custom amount is being ranked, keep the previous ranking on screen so the input keeps focus.
  const pendingCustom = custom && !cr0;
  const st = custom ? (cr0 ? cr0.res : s.cmpRes?.res ?? snap.strategies) : snap.strategies;
  const cmpId = s.compareTo ?? (st?.strategies?.[0]?.dates ?? []).find((d: any) => days(d.dueDate) > 0)?.obligationId;
  const sorted = (st?.strategies ?? []).map((x: any) => ({ x, d: x.dates.find((d: any) => d.obligationId === cmpId) ?? x.dates[0] ?? null }));
  const elig = sorted.filter((r: any) => r.x.eligible && r.d?.eligible).sort((a: any, b: any) => Number(b.d.netEarnings ?? 0) - Number(a.d.netEarnings ?? 0));
  const ordered = [...elig, ...sorted.filter((r: any) => !elig.includes(r))];
  out.cmpAmount = s.cmpAmount ?? snap.strategies?.surplus ?? "";
  out.onCmpAmount = (e: any) => self.setState({ cmpAmount: e.target.value });
  if (st) {
    out.strategies = ordered.map(({ x, d }: any) => {
      const rank = elig.findIndex((r: any) => r.x === x);
      const ok = rank >= 0;
      const top = rank === 0;
      const isRhea = x.id === "rhea-usdc";
      const g = x.gettingThisBack ?? {};
      const cost = (c: string | null) => (c === null || c === undefined ? "unverified" : "−" + usd(Number(c)));
      const canSupply = isRhea && ok && !custom;
      return {
        key: x.id,
        icon: x.asset === "NEAR" ? "N" : "$",
        iconBg: x.asset === "NEAR" ? "#ECE8F4" : "#E2EAD6",
        iconColor: x.asset === "NEAR" ? "#6B5E99" : "#3F6B3C",
        name: x.name,
        kind: x.asset + " · " + (x.source === "demo" ? "fictional example rates" : "live read") + (x.principal ? " · on " + usd(Number(x.principal)) : ""),
        rows: [
          { k: "Earnings to " + (d ? dlabel(d.dueDate) + " · " + (d.earningDays ?? d.days) + " earning days" : "your date"), v: d ? "+" + usd(Number(d.grossEarnings)) : "—", color: "#1E2A22" },
          { k: "Entry cost", v: cost(d?.entryCost ?? g.entryCost), color: "#8A5F25" },
          { k: "Exit cost", v: cost(d?.exitCost ?? g.exitCost), color: "#8A5F25" },
        ],
        notes: [
          { glyph: "◷", text: g.exitDays === null || g.exitDays === undefined ? "Exit timing unverified" : g.exitDays === 0 ? "Withdrawable now, liquidity-dependent" : "Back in about " + g.exitDays + " days", color: "#5B6458" },
          ...(g.note ? [{ glyph: "⚠", text: g.note, color: "#8A5F25" }] : []),
        ],
        net: ok && d?.netEarnings != null ? (Number(d.netEarnings) >= 0 ? "+" : "") + usd(Number(d.netEarnings)) : "—",
        netColor: ok ? "#1E2A22" : "#8A9285",
        netSub: ok ? "engine estimate · net of entry and exit · " + (d?.days ?? "") + " days" : reasonText(d?.exclusions?.length ? d.exclusions : x.reasons),
        tag: ok ? (top ? "BEST FIT #1" : "FITS #" + (rank + 1)) : "INELIGIBLE",
        tagBg: ok ? (top ? "#C9E86B" : "#EEF0E8") : "#F6EBDD",
        tagColor: ok ? "#1E2A22" : "#8A5F25",
        border: top ? "#9DB48C" : "#E3E6DB",
        opacity: ok ? 1 : 0.85,
        disabled: !canSupply,
        cta: isRhea ? (custom && ok ? "Comparison only" : ok ? "Review supply" : "Not eligible today") : ok ? "No adapter yet" : "Not eligible",
        onClick: () => (canSupply ? self.openOp("supply", x.principal) : undefined),
        btnBg: canSupply ? "#2A4034" : "#F4F5EF",
        btnColor: canSupply ? "#fff" : "#8A9285",
        btnBorder: canSupply ? "none" : "1px solid #E3E6DB",
      };
    });
    out.stratHas = true;
    out.stratEmpty = false;
    out.walletSurplusF = money(snap.strategies?.surplus);
    if (custom) out.cmpNote = "Ranked by the engine for " + usd(Number(amt)) + " · your surplus is " + money(snap.strategies?.surplus) + " · nothing is prepared from a comparison";
  } else {
    const e = custom ? cr0?.err || (pendingCustom ? "" : "") : snap.errors?.strategies;
    out.stratHas = false;
    out.stratEmpty = true;
    out.stratEmptyTitle = e ? (custom ? "Couldn’t rank that amount." : "Ranking unavailable right now.") : custom ? "Ranking that amount…" : "Reading strategies…";
    out.stratEmptyBody = e ? (custom ? e : "The engine couldn’t read markets or balances (" + e + "). Nothing is ranked on assumed figures.") : "Strategies are ranked once markets and balances are read.";
    out.stratEmptyCta = custom ? "Use my surplus" : "Read again";
    out.stratEmptyAction = custom ? () => self.setState({ cmpAmount: null }) : () => self.liveCall(() => acts.refresh(), "Read again.");
  }
  out.cmpTabs = (snap.strategies?.strategies?.[0]?.dates ?? []).filter((d: any) => days(d.dueDate) > 0).slice(0, 4).map((d: any) => {
    const ob = s.obs.find((o: any) => o.id === d.obligationId);
    const on = d.obligationId === cmpId;
    return { label: (ob ? ob.name.split(" ")[0] + " · " : "") + dlabel(d.dueDate), bg: on ? "#fff" : "transparent", shadow: on ? "0 1px 3px rgba(0,0,0,.08)" : "none", onClick: () => self.setState({ compareTo: d.obligationId }) };
  });
  const cmpD = sorted[0]?.d;
  if (cmpD) {
    out.cmpDays = cmpD.days;
    out.cmpDue = dlabel(cmpD.dueDate);
    out.cmpDueUpper = dlabel(cmpD.dueDate).toUpperCase();
  }

  // ---- Staking options with rate source and exit fit (R14). Quotes are unsigned; wallet execution stays disabled.
  const nearPos = owned(snap).find((p: any) => p.asset === "NEAR" && p.kind === "wallet");
  out.stkSub = nearPos ? "Idle NEAR " + num(Number(nearPos.amount)) + " · 0.50 kept as exit reserve" + (example ? " · fictional" : "") : snap.portfolio ? "No liquid NEAR read" : "NEAR balance not read";
  const cashDates = s.obs.filter((o: any) => days(o.due) > 0 && o.status !== "paid").sort((a: any, b: any) => a.due.localeCompare(b.due));
  const stOb = cashDates.find((o: any) => o.id === s.stk.by) ?? cashDates[0];
  const tab = (on: boolean, label: string, onClick: () => void) => ({ label, bg: on ? "#fff" : "transparent", shadow: on ? "0 1px 3px rgba(0,0,0,.08)" : "none", onClick });
  const rateSrc = (snap.staking?.options ?? []).find((o: any) => o.rateSource)?.rateSource;
  out.stkRateTag = example ? "FICTIONAL EXAMPLE RATES" : rateSrc ? "RATES · " + String(rateSrc).toUpperCase() : snap.staking ? "RATES UNAVAILABLE" : "READING RATES…";
  out.stkTabs = cashDates.slice(0, 4).map((o: any) => tab(stOb?.id === o.id, dlabel(o.due) + " · " + o.name.split(" ")[0], () => self.setState({ stk: { ...s.stk, by: o.id } })));
  out.stkDueUpper = stOb ? dlabel(stOb.due).toUpperCase() : "YOUR DATE";
  out.lead = s.lead;
  // Native staking needs a verified validator (R20); the selected pool's own option row replaces the generic one.
  const valStale = s.validators?.err && Date.now() - (s.validators.at ?? 0) > 20000; // a failed read is retried on the next visit after 20 s
  if (s.screen === "strategies" && (s.validators?.scope !== snap.scope || valStale) && !self.valBusy) {
    self.valBusy = true;
    acts.validators().then((r: any) => { self.valBusy = false; self.setState({ validators: { scope: snap.scope, res: r, err: "", at: Date.now() } }); })
      .catch((e: Error) => { self.valBusy = false; self.setState({ validators: { scope: snap.scope, res: null, err: e.message, at: Date.now() } }); });
  }
  const vals = s.validators?.scope === snap.scope ? s.validators : null;
  const pool = s.stkPool?.scope === snap.scope ? s.stkPool.id : "";
  if (pool && s.poolOpt?.pool !== pool && self.poolBusy !== pool) {
    self.poolBusy = pool;
    acts.stakingOptions(pool).then((r: any) => { self.poolBusy = null; self.setState({ poolOpt: { pool, res: r } }); }).catch((e: Error) => { self.poolBusy = null; self.setState({ poolOpt: { pool, res: null, err: e.message } }); });
  }
  const poolRow = pool && s.poolOpt?.pool === pool ? (s.poolOpt.res?.options ?? []).find((o: any) => o.id === "native") : null;
  const verified = (vals?.res?.validators ?? []).filter((v: any) => v.eligible !== false);
  const opts: any[] = (snap.staking?.options ?? []).map((o: any) => (o.id === "native" && poolRow ? { ...poolRow, pool } : o));
  const NAMES: Record<string, string> = { native: "Native staking", linear: "LiNEAR", rnear: "rNEAR" };
  const KINDS: Record<string, string> = { native: "validator", linear: "liquid staking", rnear: "liquid staking on Rhea" };
  if (opts.length) {
    out.stakeCards = opts.map((o: any) => {
      const unlock = o.exit?.estimatedUnlockAt ? Date.parse(o.exit.estimatedUnlockAt) : null;
      const fits = stOb && unlock ? unlock + s.lead * 864e5 <= Date.parse(stOb.due + "T00:00:00Z") : null;
      const elig = o.eligible !== false && o.aprPercent != null;
      const q = s.stakeQuote?.kind === o.id && s.stakeQuote?.scope === snap.scope ? s.stakeQuote : null;
      const needsPool = o.id === "native" && !o.pool;
      const isNative = o.id === "native";
      const refusals = reasonText((o.refusals ?? []).map((r: any) => (typeof r === "string" ? r : r.code ?? r.message)));
      // Default-deny: LST staking needs its venue and deposit_and_stake; the owner adds exactly those on confirmation.
      const PP: any = snap.policy?.policy;
      // LiNEAR and verified native validators execute through owner-signed plans; rNEAR stays quote-only.
      const executable = o.id === "linear" || (isNative && !!o.pool);
      // Only an executable venue asks for policy entries; allowing a quote-only venue would grant nothing usable.
      const polMiss = PP && executable ? (isNative ? missingEntries(PP, [{ kind: "native_stake", pool: o.pool }]) : missingEntries(PP, [{ kind: "stake", strategy: o.id }])) : [];
      const allowStake = () => {
        self.remember();
        self.setState({
          modal: "confirm",
          confirm: {
            live: true,
            title: "Allow " + (NAMES[o.id] ?? o.id) + " staking in your policy?",
            text: "Staking through " + (NAMES[o.id] ?? o.id) + " needs " + polMiss.map((e) => e.label).join(" and ") + ". Saving adds exactly these as a new revision; caps, protected assets and other rules stay as they are. Nothing is prepared or signed.",
            apply: () => acts.savePolicy(withEntries(PP, polMiss)),
          },
        });
      };
      const rows = [
        { k: "Rate", v: o.aprPercent != null ? pct(o.aprPercent) + " · " + (o.rateSource ?? "") : "unknown" },
        { k: "Earliest unlock", v: unlock ? whenLabel(o.exit.estimatedUnlockAt) + " · estimate" : "unknown" },
        { k: "Exit", v: (o.exit?.minimumEpochs ?? 4) + " epochs minimum · not guaranteed" },
        ...(q?.res ? [{ k: "Unsigned quote", v: (q.res.unsignedTransactions?.length ?? 0) + " call(s) · signable: no" + (q.res.policy?.violations?.length ? " · " + q.res.policy.violations.map((x: any) => x.code).join(", ") : "") }] : []),
        ...(q?.err ? [{ k: "Quote", v: q.err }] : []),
        ...(polMiss.length ? [{ k: "Policy", v: "Not allowed yet · needs " + polMiss.map((e) => e.label).join(", ") }] : []),
      ];
      return {
        name: NAMES[o.id] ?? o.venue, kind: (o.pool ?? KINDS[o.id] ?? o.venue) + (o.codeHashVerified ? " · code verified" : ""),
        // Same rule as the staking engine: a stake is sized from surplus only (never from money reserved for a
        // payment), so an exit landing after the next payment is information, not a block.
        tag: needsPool ? "PICK A VALIDATOR" : !elig ? "NOT ELIGIBLE" : !executable ? "QUOTE ONLY" : polMiss.length ? "NEEDS POLICY" : "EXECUTABLE · SURPLUS",
        tagBg: executable && elig && !polMiss.length ? "#E2EAD6" : "#F6EBDD", tagColor: executable && elig && !polMiss.length ? "#3F6B3C" : "#8A5F25",
        net: "—", netColor: "#8A9285",
        netSub: needsPool ? "Native staking needs a verified validator"
          : !elig ? refusals || "Rate or availability unknown"
          : !executable ? "Quote only · no execution path for " + (NAMES[o.id] ?? o.id) + " yet"
          : polMiss.length ? "Executable once your policy allows it · nothing is allowed by default"
          : "Owner-signed through a plan · you approve the stake, then sign in your wallet · exit takes about 4 epochs",
        rows, exit: o.exit?.reason === "EXIT_MISSES_DUE_DATE" ? "Unbonding ends after the next payment · information only for surplus" : o.exit?.reason ? reasonText([o.exit.reason]) : "Unbonding takes at least four epochs",
        fitText: !stOb ? "Surplus only · no payment counts on this NEAR" : fits === null ? "Unlock estimate unavailable · surplus only, so no payment counts on it" : fits ? "✓ Could be back before " + dlabel(stOb.due) + " with your " + s.lead + "-day lead · staked from surplus only" : "Back after " + dlabel(stOb.due) + " if you exit · fine: it’s staked from surplus only and no payment counts on it",
        fitColor: fits === false ? "#5B6458" : "#3F6B3C", border: "#E3E6DB",
        ...(isNative
          ? {
              poolOptions: verified.map((v: any) => ({ id: v.id, label: (v.label || v.id) + (v.aprPercent != null ? " · " + pct(v.aprPercent) : "") + (v.feePercent != null ? " · fee " + pct(v.feePercent) : "") })),
              pool,
              poolPlaceholder: !vals ? "Checking verified validators…" : vals.err ? "Validators unavailable · " + vals.err : verified.length ? "Choose a verified validator" : reasonText(vals.res?.refusals?.length ? vals.res.refusals.map((r: any) => (typeof r === "string" ? r : r.code)) : ["NO_VERIFIED_VALIDATORS_AVAILABLE"]),
              onPool: (ev: any) => self.setState({ stkPool: { scope: snap.scope, id: ev.target.value }, stakeQuote: null }),
            }
          : {}),
        cta: needsPool ? "Validator needed" : polMiss.length ? "Allow in Policy…" : executable ? (example ? "Plan staking (example) →" : "Plan staking →") : q?.busy ? "Preparing…" : "Inspect unsigned quote", btnBg: "#fff", btnColor: needsPool ? "#8A9285" : polMiss.length || executable ? "#3F6B3C" : "#1E2A22", btnBorder: "1px solid #E3E6DB",
        onClick: () => {
          if (polMiss.length && !needsPool) return allowStake();
          if (needsPool) return self.toastMsg("Choose a verified validator first; no validator is approved by default.");
          if (executable) {
            // Opens a stake plan sized by the engines in raw NEAR (blank amount = idle NEAR within verified surplus).
            const amt = String(s.stk.amt || "").trim();
            const amountRaw = amt ? nearToYocto(amt) : undefined;
            if (amt && !amountRaw) return self.toastMsg("Enter a NEAR amount like 12.5, or leave it blank to stake idle NEAR within your surplus.");
            return void startPlan({ objective: "stake", venue: isNative ? o.pool : "linear", ...(amountRaw ? { amountRaw } : {}) }).catch(() => undefined);
          }
          const amount = String(s.stk.amt || "").trim();
          if (!(Number(amount) > 0)) return self.toastMsg("Enter a NEAR amount to quote.");
          self.setState({ stakeQuote: { kind: o.id, scope: snap.scope, busy: true } });
          acts.stakeQuote({ kind: o.id, amount, ...(o.pool ? { pool: o.pool } : {}) })
            .then((r: any) => { self.setState({ stakeQuote: { kind: o.id, scope: snap.scope, res: r } }); self.toastMsg((r.message || r.note || "Unsigned quote ready.") + " Nothing can be signed from here."); })
            .catch((e: Error) => self.setState({ stakeQuote: { kind: o.id, scope: snap.scope, err: e.message } }));
        },
      };
    });
  } else {
    out.stakeCards = [];
    out.stkSub = snap.errors?.staking ? "Staking options unavailable · " + snap.errors.staking : out.stkSub;
  }

  // ---- Credit: read-only stress preview computed by POST /api/credit with your policy rows and API valuations.
  const c = s.credit;
  const pos = owned(snap);
  const byId = (pred: (p: any) => boolean) => pos.find(pred);
  const rheaSt = (snap.strategies?.strategies ?? []).find((x: any) => x.id === "rhea-usdc");
  const rheaLiq = rheaSt?.gettingThisBack?.liquidity ?? null;
  const cfg = s.creditCfg?.scope === snap.scope ? s.creditCfg.res : null;
  if (s.screen === "credit" && self.cfgBusy !== snap.scope && s.creditCfg?.scope !== snap.scope) {
    self.cfgBusy = snap.scope; // a render must not set state; the read's answer does
    api("/api/credit/config", undefined, "GET", snap.scope)
      .then((r: any) => self.setState({ creditCfg: { scope: snap.scope, res: r } }))
      .catch(() => self.setState({ creditCfg: { scope: snap.scope, res: null } }))
      .finally(() => { self.cfgBusy = null; });
  }
  const usdcCfg = cfg?.assets?.find((x: any) => x.assetId === cfg.debtAsset)?.config;
  const protocolLimit = usdcCfg?.borrowed_limit ? (Number(BigInt(usdcCfg.borrowed_limit) / 10n ** BigInt(usdcCfg.extra_decimals + 6))).toFixed(2) : null;
  const A = s.pol.assets;
  const protSet = new Set((s.pol.protectedAssets ?? []).map((x: string) => x.toLowerCase()));
  const PERM = new Set(["hold", "sell", "supply", "pledge", "borrow", "fees"]);
  const ST_A = [
    { k: "eth", name: "ETH", sym: "ETH", chain: "Arbitrum", venue: "Aave v3 · Arbitrum · no adapter", p: byId((x) => x.asset === "ETH"), lt: 0.8, rhea: false },
    { k: "linear", name: "LiNEAR", sym: "LiNEAR", chain: "NEAR", venue: "Rhea Lending", p: byId((x) => x.asset === "LiNEAR"), lt: 0.6, rhea: true },
    { k: "rnear", name: "rNEAR", sym: "rNEAR", chain: "NEAR", venue: "Rhea Lending", p: byId((x) => x.asset === "rNEAR"), lt: 0.55, rhea: true },
    { k: "near", name: "NEAR", sym: "NEAR", chain: "NEAR", venue: "Rhea Lending", p: byId((x) => x.asset === "NEAR" && x.kind === "wallet"), lt: 0.65, rhea: true },
    { k: "staked", name: "Staked NEAR", sym: "NEAR", chain: "NEAR", venue: "No supported venue", p: byId((x) => x.asset === "NEAR" && x.kind === "staking"), lt: 0, rhea: false, unsupported: "Unsupported: no venue accepts natively staked NEAR" },
    { k: "usdc", name: "USDC · Rhea supply", sym: "USDC", chain: "NEAR", venue: "Rhea Lending", p: byId((x) => x.kind === "supplied" && String(x.id).startsWith("rhea")), lt: 0.9, rhea: true, unsupported: "Collateral stays off so your reserve can’t be liquidated" },
  ];
  // Saved credit rows (example §14) supply the risk factors, so this page and Overview's headroom agree.
  const cRow = (a: any) => (((snap.policy?.policy as any)?.creditRows ?? []) as any[]).find((r) => r.assetId === a.name);
  const conf = (a: any) => (a.k === "eth" ? { on: s.stress.eth.on, dd: c.dd, cap: c.cap } : s.stress[a.k] || { on: false, dd: 60, cap: 50 });
  const rowFor = (a: any) => {
    const row = A[a.k] ?? A.near;
    const uses = (row?.uses ?? []).filter((u: string) => PERM.has(u));
    const prot = protSet.has(a.sym.toLowerCase());
    return { uses, prio: ["P1", "P2", "P3"].includes(row?.p) ? row.p : "P3", prot, pledge: uses.includes("pledge") && !prot };
  };
  const markets = ST_A.filter((a) => !a.unsupported && a.p && conf(a).on).map((a) => {
    const r = rowFor(a);
    const val = posValue(a.p);
    return {
      id: a.k, source: example ? "demo" : "live", capturedAt: "", existingDebt: a.k === "eth" ? String(c.debt) : "0",
      protocolLimit: a.rhea ? protocolLimit : null, liquidity: a.rhea ? rheaLiq : null,
      assets: [{ assetId: a.name, collateralId: a.p!.id, value: val === null ? null : String(val), drawdownBps: conf(a).dd * 100, ltvCapBps: conf(a).cap * 100, liquidationThresholdBps: cRow(a)?.liquidationThresholdBps ?? Math.round(a.lt * 10000), protocolLtvBps: cRow(a)?.protocolLtvBps ?? Math.round(a.lt * 10000), minHealth: (c.hp / 10).toFixed(1), priority: r.prio, permissions: r.uses, eligible: r.pledge }],
    };
  });
  const ck = JSON.stringify(markets.map((m) => [m.id, m.existingDebt, m.protocolLimit, m.liquidity, m.assets[0]]));
  if (s.screen === "credit" && (!s.creditRes || s.creditRes.key !== ck) && self.creditKey !== ck) {
    self.creditKey = ck;
    clearTimeout(self.creditTimer);
    self.creditTimer = setTimeout(() => {
      const at = new Date().toISOString(); // scenarios are evaluated as of now; a stale timestamp yields null capacity
      (markets.length ? acts.credit({ markets: markets.map((m) => ({ ...m, capturedAt: at })) }) : Promise.resolve({ capacityDisplay: "0.00", markets: [] }))
        .then((r: any) => self.setState({ creditRes: { key: ck, res: r, err: "" } }))
        .catch((e: Error) => self.setState({ creditRes: { key: ck, res: null, err: e.message } }));
    }, 250);
  }
  const cr = s.creditRes && s.creditRes.key === ck ? s.creditRes : null;
  const mById: Record<string, any> = Object.fromEntries((cr?.res?.markets ?? []).map((m: any) => [m.id, m]));
  const hpv = (c.hp / 10).toFixed(1);
  const EXCL: Record<string, string> = { INELIGIBLE_COLLATERAL: "Not pledgeable under your policy", PROTECTED_ASSET: "Protected · hold only" };
  const bindText = (m: any, a: any) => {
    const r = rowFor(a);
    if (r.prot) return "Protected by your policy · hold only";
    if (!r.pledge) return "Your policy doesn’t allow borrowing against " + a.name;
    if (m?.capacity == null && m?.reasons?.length) return reasonText(m.reasons.map((x: string) => (x === "UNKNOWN_DEBT_LIMIT_OR_LIQUIDITY" ? "PROTOCOL_LIMIT_OR_LIQUIDITY_UNKNOWN" : x)));
    const ex = m?.rows?.[0]?.excluded;
    if (ex === "PERMISSION_DENIED" && !r.uses.includes("borrow")) return "Your policy lets " + a.name + " be pledged but not borrowed against";
    if (ex) return EXCL[ex] ?? reasonText([ex]);
    return m?.bindingConstraint === "stressed_health" ? "Minimum health " + hpv : m?.bindingConstraint && /ltv|policy/.test(m.bindingConstraint) ? "Your " + conf(a).cap + "% LTV cap" : BIND[m?.bindingConstraint] ?? (m?.bindingConstraint ? String(m.bindingConstraint).replace(/_/g, " ") : "…");
  };
  let run = 0;
  out.stressRows = ST_A.filter((a) => a.p || a.unsupported).map((a) => {
    const cf = conf(a);
    const m = mById[a.k];
    const eligible = !a.unsupported && !!a.p;
    const val = a.p ? posValue(a.p) : null;
    if (eligible && cf.on && m?.capacity != null) run += Number(m.capacity);
    const setS = (key: string, val2: any) => (a.k === "eth" ? self.setState(key === "on" ? { stress: { ...s.stress, eth: { on: val2 } } } : { credit: { ...s.credit, [key]: val2 } }) : self.setState({ stress: { ...s.stress, [a.k]: { ...cf, [key]: val2 } } }));
    return {
      name: a.name, chain: a.chain, venue: a.venue, valueF: val !== null ? usd(val) + (example ? " · fictional" : "") : a.p ? "Unvalued · no price source" : "not held", on: eligible && cf.on, dis: !eligible, dd: String(cf.dd), cap: String(cf.cap),
      capF: !eligible || (a.p && !rowFor(a).pledge) ? "$0.00" : !cf.on ? "—" : m ? (m.capacityDisplay != null ? money(m.capacityDisplay) : "Unavailable") : cr?.err ? "Unavailable" : "…",
      binding: a.unsupported ?? (cf.on ? bindText(m, a) : "Not selected"), bindColor: eligible ? "#4A5349" : "#8A5F25", canAllow: false,
      running: eligible && cf.on && m?.capacity != null ? usd(run) : "—", opacity: eligible ? 1 : 0.8,
      onToggle: (e: any) => setS("on", e.target.checked), onDd: (e: any) => setS("dd", +e.target.value), onCap: (e: any) => setS("cap", +e.target.value),
    };
  });
  out.stTotalF = cr?.res ? (cr.res.capacityDisplay != null ? money(cr.res.capacityDisplay) : "Unavailable") : cr?.err ? "Unavailable" : "…";
  const ethA = ST_A[0];
  const eth = mById["eth"];
  const er = eth?.rows?.[0];
  const ethR = rowFor(ethA);
  const ethVal = ethA.p ? posValue(ethA.p) : null;
  out.credit = {
    capF: !ethA.p ? "$0.00" : !s.stress.eth.on ? "$0.00" : eth ? (eth.capacityDisplay != null ? money(eth.capacityDisplay) : ethR.pledge ? "Unavailable" : "$0.00") : cr?.err ? "Unavailable" : "…",
    binding: !ethA.p ? "No ETH position read" : !s.stress.eth.on ? "ETH isn’t selected in the scenario" : bindText(eth, ethA).toLowerCase(),
    blocked: ethR.prot,
    rows: [
      { k: "Stressed value at −" + c.dd + "%", v: ethVal !== null ? usd(ethVal * (1 - c.dd / 100)) : "unvalued", kc: "#5B6458", w: 400 },
      { k: "Policy ceiling (" + c.cap + "% cap)", v: er?.policyCeiling != null ? usd(Number(er.policyCeiling)) : ethR.pledge ? "…" : "$0.00 · not pledgeable", kc: "#1E2A22", w: 600 },
      { k: "Health cap (scenario LT ÷ " + hpv + ")", v: er?.healthCeiling != null ? usd(Number(er.healthCeilingDisplay ?? er.healthCeiling)) : "—", kc: "#1E2A22", w: 400 },
      { k: "Existing debt", v: "−" + usd(c.debt), kc: "#5B6458", w: 400 },
    ],
  };
  out.creditUses = [["hold", "Hold"], ["sell", "Sell"], ["pledge", "Borrow against"], ["fees", "Use for fees"]].map(([u, l]) => {
    const on = (A.eth?.uses ?? []).includes(u);
    return { label: (on ? "✓ " : "") + l, bg: on ? "#E2EAD6" : "#fff", color: on ? "#3F6B3C" : "#8A9285", border: on ? "#E2EAD6" : "#E3E6DB" };
  });
  out.creditPrio = !A.eth?.saved ? (ethR.prot ? "protected · no asset row saved" : "no asset row saved") : ethR.prot ? A.eth.p + " · protected" : A.eth.p + " · from your policy";
  out.creditEthLine = ethA.p ? num(Number(ethA.p.amount)) + " ETH · " + (ethVal !== null ? usd(ethVal) + (example ? " fictional valuation" : "") : "no USD price source yet") : "No ETH position read";
  out.creditPermNote = "Permissions and priority come from policy revision " + (s.pol.rev || "—") + ". " + (((snap.policy?.policy as any)?.creditRows ?? []).length ? "LiNEAR and rNEAR risk factors come from your saved credit rows; others are scenario assumptions" : "Liquidation thresholds are scenario assumptions") + (protocolLimit ? "; the Rhea borrow limit comes from " + (example ? "fictional " : "") + "protocol config" : "") + ". Nothing here can borrow.";
  out.creditHas = true;
  out.creditEmpty = false;

  // ---- Supply / withdraw dialog: real preparation, real wallet, journal-backed tracking.
  const op = s.op;
  if (op && s.modal === "op" && op.kind !== "replay") {
    const sup = op.kind === "supply";
    const rhea = (st?.strategies ?? []).find((x: any) => x.id === "rhea-usdc");
    const g = rhea?.gettingThisBack ?? {};
    const d = rhea?.dates?.find((x: any) => x.obligationId === s.compareTo) ?? rhea?.dates?.[0];
    const opv: any = { ...v.opv };
    opv.netLine = d?.netEarnings != null ? "Engine estimate: " + usd(Number(d.netEarnings)) + " net by " + dlabel(d.dueDate) + " after entry and exit costs. Not a forecast." : "Net earnings to your next date are unverified" + (d ? ": " + reasonText(d.exclusions) : "") + ". No rate is assumed.";
    const prep = op.prep;
    if (prep) {
      const methods = (prep.transactions ?? []).flatMap((t: any) => t.actions.map((a: any) => t.receiverId + " · " + a.params.methodName));
      opv.payload = [
        { k: "From", v: prep.accountId },
        { k: "Transactions", v: String(prep.transactions?.length ?? 0) },
        ...methods.map((m: string, i: number) => ({ k: "Call " + (i + 1), v: m })),
        { k: "Amount", v: prep.amount + " USDC" },
        ...(sup ? [{ k: "Registration deposit", v: (prep.registrationNear ?? "0") + " NEAR" }] : []),
        { k: "Collateral", v: "off · no debt created" },
        { k: "Expires", v: hhmm(prep.expiresAt) },
        { k: "Journal entry", v: short(prep.attemptId) },
        ...(prep.warning ? [{ k: "Note", v: prep.warning }] : []),
        ...(prep.exitEstimate ? [{ k: "Getting it back", v: prep.exitEstimate.note ?? JSON.stringify(prep.exitEstimate).slice(0, 120) }] : []),
        ...(prep.policy?.version ? [{ k: "Policy revision", v: String(prep.policy.version) }] : []),
      ];
      opv.prepTime = "Fresh preflight passed at " + hhmm(new Date(op.preparedAt ?? Date.now()).toISOString());
    }
    const attempt = prep ? s.ops.find((o: any) => o.id === prep.attemptId) : null;
    if (op.step === "tracking") {
      opv.track = op.signing
        ? [{ label: "Waiting for your wallet", detail: "Approve or reject in " + (snap.walletName || "your wallet") + ". FlowVault never signs.", time: "", hash: "", dotBg: "#fff", dotBorder: "#4E7A4A", glyph: "", labelColor: "#1E2A22", anim: "fvpulse 1.2s infinite" }]
        : (attempt?.steps ?? []).map((x: any) => ({ ...x, ...({ done: { dotBg: "#4E7A4A", dotBorder: "#4E7A4A", glyph: "✓", labelColor: "#1E2A22", anim: "none" }, pending: { dotBg: "#fff", dotBorder: "#D5DACB", glyph: "", labelColor: "#8A9285", anim: "none" }, fail: { dotBg: "#B4543F", dotBorder: "#B4543F", glyph: "✕", labelColor: "#9A3F32", anim: "none" }, warn: { dotBg: "#C08A45", dotBorder: "#C08A45", glyph: "!", labelColor: "#8A5F25", anim: "none" } } as any)[x.state] }));
      const stt = attempt?.status;
      const done = stt === "confirmed";
      opv.finBg = done ? "#E2EAD6" : stt === "failedtx" || stt === "stuck" ? "#F6E3DE" : "#F4F5EF";
      opv.finColor = done ? "#2F552D" : stt === "failedtx" || stt === "stuck" ? "#7F3528" : "#5B6458";
      opv.finText = done ? (sup ? "Confirmed. " + prep.amount + " USDC supplied to Rhea with collateral off, verified from the finalized receipt." : "Confirmed. " + prep.amount + " native USDC arrived in " + prep.accountId + ", verified from the payout event.") : stt === "failedtx" ? "Failed. " + (attempt?.foot ?? "Nothing moved.") : stt === "stuck" ? "Status unknown. Check status in Activity before trying again; nothing will be re-sent automatically." : op.signing ? "Nothing has been sent yet." : "Safe to close. The server journal keeps checking; Activity shows the verified status.";
      opv.closeLabel = done ? "Done" : "Close";
      if (!op.signing && prep && attempt && !["confirmed", "failedtx"].includes(stt) && self.opPollFor !== prep.attemptId) {
        self.opPollFor = prep.attemptId;
        setTimeout(() => { self.opPollFor = null; if (self.state.modal === "op") acts.check(prep.attemptId).catch(() => {}); }, 6000);
      }
    }
    out.opv = opv;
    out.exitRows = sup
      ? [
          { k: "Rhea available liquidity now", v: g.liquidity != null ? usd(Number(g.liquidity)) + " USDC" : "Unverified", src: "Calendar exit model · " + (st?.source === "demo" ? "example" : "live read") + (st?.capturedAt ? " · " + hhmm(st.capturedAt) : ""), color: "#1E2A22", retryDisplay: g.liquidity != null ? "none" : "block", onRetry: () => self.liveCall(() => acts.refresh(), "Read again.") },
          { k: "Exit timing", v: g.exitDays != null ? (g.exitDays === 0 ? "Same day · liquidity-dependent" : "About " + g.exitDays + " days") : "Unverified", src: g.note ?? "", color: g.exitDays != null ? "#3F6B3C" : "#8A5F25", retryDisplay: "none", onRetry: () => {} },
          { k: "Entry and exit cost", v: g.entryCost != null && g.exitCost != null ? usd(Number(g.entryCost) + Number(g.exitCost)) : "Unverified", src: "Shown before entry; never assumed", color: "#1E2A22", retryDisplay: "none", onRetry: () => {} },
          { k: "Collateral", v: "Off · your reserve can never be liquidated", src: "Supplied USDC is not pledged", color: "#3F6B3C", retryDisplay: "none", onRetry: () => {} },
        ]
      : v.exitRows;
    out.wdChecks = [
      { glyph: "◷", color: "#8A5F25", k: "Collateral and debt on this position", v: "Checked at prepare" },
      { glyph: "◷", color: "#8A5F25", k: "Rhea available liquidity", v: "Checked at prepare" },
      { glyph: "✓", color: "#4E7A4A", k: "Arrives as", v: "native USDC · " + acct },
      { glyph: "◷", color: "#8A5F25", k: "Timing", v: "Unverified · usually 1 block" },
    ];
    out.onOpAmount = (e: any) => self.setState({ op: { ...op, amount: e.target.value, key: uuid(), prep: null } });
    out.opPrepare = () => {
      if (example) return self.toastMsg("Example workspace: the exit and costs above are the engine’s fictional figures. Preparing needs your live account; nothing can be signed here.");
      if (v.opv.blocked || op.busy) return;
      const key = op.key ?? uuid();
      self.setState({ op: { ...op, key, busy: true } });
      acts.prepare(op.kind, String(op.amount).trim(), op.kind === "withdraw" ? key : undefined)
        .then((r: any) => self.setState({ op: { ...self.state.op, busy: false, step: "prepared", prep: r, preparedAt: Date.now() } }))
        .catch((e: Error) => { self.setState({ op: { ...self.state.op, busy: false } }); self.toastMsg(e.message); });
    };
    out.opBack = () => self.setState({ op: { ...op, step: "review", prep: null, key: uuid() } });
    out.opToWallet = () => {
      if (!connected) return self.toastMsg("Connect the wallet for " + (prep?.accountId ?? acct) + " to approve. Nothing was signed.");
      if (!prep) return;
      if (Date.parse(prep.expiresAt) <= Date.now()) { self.setState({ op: { ...op, step: "review", prep: null, key: uuid() } }); return self.toastMsg("That preparation expired. Prepare again for a fresh review."); }
      self.setState({ op: { ...op, step: "tracking", signing: true } });
      acts.sign(prep)
        .then(() => self.setState({ op: { ...self.state.op, signing: false } }))
        .catch((e: Error) => { self.setState({ op: { ...self.state.op, signing: false, step: "review", prep: null, key: uuid() } }); self.toastMsg(e.message + " Prepare again to retry."); });
    };
  }
  return out;
}

const DOTS: any = {
  done: { dotBg: "#4E7A4A", dotBorder: "#4E7A4A", glyph: "✓", labelColor: "#1E2A22", anim: "none" },
  active: { dotBg: "#fff", dotBorder: "#4E7A4A", glyph: "", labelColor: "#1E2A22", anim: "fvpulse 1.2s infinite" },
  pending: { dotBg: "#fff", dotBorder: "#D5DACB", glyph: "", labelColor: "#8A9285", anim: "none" },
  fail: { dotBg: "#B4543F", dotBorder: "#B4543F", glyph: "✕", labelColor: "#9A3F32", anim: "none" },
  warn: { dotBg: "#C08A45", dotBorder: "#C08A45", glyph: "!", labelColor: "#8A5F25", anim: "none" },
};
const stepsOf = (timeline: any[] = []) =>
  timeline.map((st: any) => {
    const state = stepState(String(st.status ?? ""));
    return { label: phaseLabel(String(st.phase ?? st.label ?? "")), detail: st.message ?? st.detail ?? "", time: st.at ? whenLabel(st.at) : "", hash: st.explorerLinks?.length ? "Explorer ↗" : "", ...DOTS[state] };
  });
const u6 = (x: any) => {
  try {
    return Number(BigInt(String(x))) / 1e6;
  } catch {
    return null;
  }
};
const PAY_TERMINAL = ["paid", "cancelled", "refunded", "failed"];
/** Destination token decimals: BNB Chain USDT is 18, every other supported payout token 6 (BACKEND_API §7). */
const outDecimals = (pay: any, chain: string, asset: string) => Number(pay?.destinationToken?.decimals ?? pay?.quoteRequest?.destinationToken?.decimals ?? (chain === "BNB Chain" && asset === "USDT" ? 18 : 6));
const units = (x: any, dec: number) => {
  try {
    const b = BigInt(String(x));
    const d = 10n ** BigInt(dec);
    return Number(b / d) + Number(b % d) / Number(d);
  } catch {
    return null;
  }
};
/** Quote figures in source USDC. For USDT the payout's USDC value comes from the provider's fresh price evidence, never parity. */
const quoteFigures = (pay: any, chain: string, asset: string) => {
  const q = pay?.retainedSignedQuote?.quote;
  if (!q) return null;
  const inN = u6(q.amountIn), minN = u6(q.minAmountIn), outN = units(q.amountOut, outDecimals(pay, chain, asset));
  const cb = pay?.costBreakdown;
  const val = pay?.valuation ?? pay?.retainedSignedQuote?.valuation ?? pay?.quoteRequest?.valuation;
  const outUsdc = asset === "USDC" ? outN : val?.outputValueUsdc != null ? Number(val.outputValueUsdc) : null;
  const fee = minN !== null && outUsdc !== null ? minN - outUsdc : null;
  return { inN, minN, outN, outUsdc, fee, buffer: inN !== null && minN !== null ? inN - minN : null, maxCost: cb?.maximumInputMinusNet != null ? Number(cb.maximumInputMinusNet) : null, fx: asset !== "USDC" ? val : null, q };
};
const stepForPay = (state?: string) =>
  !state ? "confirm" : ["planned", "needs-withdrawal", "withdrawal-prepared"].includes(state) ? "sources" : ["quoted", "deposit-prepared"].includes(state) ? "quote" : "tracking";


/** Pay on a date, the live pay flow, Activity and Replays, in both workspaces. */
export function liveExecute(snap: LiveSnapshot, v: any, ctx: { self: any; s: any; example: boolean }) {
  const { self, s, example } = ctx;
  const out: any = {};
  const acts = self.props.actions;
  const acct = snap.workspace?.accountId ?? "";
  const connected = !example && !!snap.walletAccount && snap.walletAccount === acct;
  const P = snap.policy?.policy;
  const payFor = (obId: string) =>
    [...(snap.payments ?? [])].filter((p: any) => p.obligationId === obId && p.state !== "cancelled").sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const attemptOf = (id?: string) => (id ? s.ops.find((o: any) => o.id === id) : null);
  const fail = (e: Error) => self.toastMsg(e.message);
  const openLivePay = (obId: string) => {
    self.remember();
    self.setState({ modal: "pay", asst: { ...s.asst, open: false }, pay: { obId, step: stepForPay(payFor(obId)?.state), t: 0, expires: 0, outcome: "success", leg: null, need: 0, final: null, live: true } });
  };
  const planPayment = (obId: string) => self.liveCall(() => acts.payment(obId, uuid()), "Sources compared with a dry quote. Nothing was sent.");

  // Policy entries a 1Click payout needs (BACKEND_API §7). Adding them is an owner decision, confirmed first.
  const needs = (ob: any) => {
    const miss: string[] = [];
    if (!P) return miss;
    if (!P.venues.includes("1click")) miss.push("venue 1click");
    if (!P.methods.some((m: any) => m.receiver === USDC_TOKEN && m.method === "ft_transfer")) miss.push("native USDC ft_transfer");
    if (/^0x[0-9a-fA-F]{40}$/.test(String(ob?.recipient)) && !P.recipients.includes(String(ob.recipient).toLowerCase())) miss.push("recipient " + short(ob.recipient));
    return miss;
  };
  const allowPayout = (ob: any) => {
    const miss = needs(ob);
    self.remember();
    self.setState({
      modal: "confirm",
      confirm: {
        live: true,
        title: "Allow this payout in your policy?",
        text: "Payouts through NEAR Intents 1Click need " + miss.join(", ") + " in your policy. Saving adds exactly these as a new revision; caps, protected assets and other rules stay as they are. Actions prepared under the current revision must be prepared again.",
        apply: () => {
          const next = {
            ...P,
            venues: P.venues.includes("1click") ? P.venues : [...P.venues, "1click"],
            methods: P.methods.some((m: any) => m.receiver === USDC_TOKEN && m.method === "ft_transfer") ? P.methods : [...P.methods, { receiver: USDC_TOKEN, method: "ft_transfer" }],
            recipients: ob?.recipient && !P.recipients.includes(String(ob.recipient).toLowerCase()) ? [...P.recipients, String(ob.recipient).toLowerCase()] : P.recipients,
          };
          return acts.savePolicy(next);
        },
      },
    });
  };
  if (s.modal === "confirm" && s.confirm?.live) {
    out.confirmText = s.confirm.text;
    out.confirmYes = () => {
      const c = s.confirm;
      self.setState({ modal: null, confirm: null });
      self.refocus();
      self.liveCall(() => c.apply(), c.ok ?? "Policy saved as a new revision.");
    };
    // Live confirmations are policy entries or account changes, never the design's protected-asset prompt.
    out.m = { eyebrow: s.confirm.eyebrow ?? "POLICY · NEW REVISION", title: s.confirm.title, hasSteps: false, steps: [] };
    out.confirmNoLabel = s.confirm.no ?? "Not now";
    out.confirmYesLabel = s.confirm.yes ?? "Save as a new revision";
  }

  // ---- Pay on a date screen
  out.pyTag = example ? "FICTIONAL ROUTE COSTS · NOTHING CAN BE SIGNED" : "DRY QUOTES · NOTHING MOVES WITHOUT APPROVAL";
  const payables = s.obs.filter((o: any) => o.status === "upcoming" || o.status === "paying");
  const ob = payables.find((o: any) => o.id === s.payPick) ?? payables[0] ?? null;
  // One persistent plan for this payment: alternatives, review, wallet handoff and verification (I3).
  if (s.screen === "pay") out.planCta = ob ? { label: "Plan this payment →", onClick: () => void startPlan({ objective: "pay_obligation", obligationId: ob.id }).catch(() => undefined), note: example ? "Example plan · reviewable, never signable" : "Saved as a plan you can leave and resume" } : null;
  // A route is payable live when the backend's comparison says so (BNB/Ethereum USDT arrive this way), or it is a known Base/Arbitrum USDC route.
  const liveRoute = (o: any) => livePayoutSupported(o.chain, o.asset) || (s.payEval?.res?.comparison?.obligationId === o.id && s.payEval.res.comparison.executionSupported === true && s.payEval.res.comparison.source === "live");
  const evalMode = (o: any) => example || !liveRoute(o);
  if (ob && evalMode(ob)) {
    // Example workspace, or a route the backend can't pay live: plan only, from the engine's read-only evaluation.
    const key = JSON.stringify([snap.scope, ob.id, ob.amount, ob.asset, ob.chain, ob.due, snap.revision, snap.policy?.policy?.version]);
    if (s.screen === "pay" && (!s.payEval || s.payEval.key !== key) && self.payEvalKey !== key) {
      self.payEvalKey = key;
      acts.compare(ob.id).then((r: any) => self.setState({ payEval: { key, res: r, err: "" } })).catch((e: Error) => self.setState({ payEval: { key, res: null, err: e.message } }));
    }
    const pe = s.payEval?.key === key ? s.payEval : null;
    const e = pe?.res?.comparison;
    const q = e?.quote;
    const src = e?.sources;
    const p0 = src?.plans?.find((x: any) => x.id === "idle-wallet-usdc");
    const p1 = src?.plans?.find((x: any) => x.id === "cash-plus-rhea");
    const wneed = Number(src?.withdrawalNeeded ?? 0);
    // The engine only picks a source the policy allows; a refused payment has no pick.
    const polOk = e?.policy ? !!e.policy.allowed : true;
    const pick = !src || !polOk ? null : wneed > 0 ? "rhea" : p0?.eligible ? "wallet" : p1?.eligible ? "rhea" : null;
    const vio: string[] = e?.policy?.violations?.map((x: any) => x.code) ?? e?.reasons ?? [];
    const fictional = q?.source === "demo" || example;
    out.pyHead = {
      amount: num(ob.amount) + " " + ob.asset,
      line: "to " + ob.name + " on " + ob.chain + " · due " + dlabel(ob.due) + " · in " + days(ob.due) + (days(ob.due) === 1 ? " day" : " days"),
      addr: ob.recipient,
      send: q ? num(Number(q.maxInput)) + " USDC" + (fictional ? " · fictional" : "") : pe?.err ? "unavailable" : "checking…",
      fee: q ? usd(Number(q.minInput) - Number(q.amountOut)) + (fictional ? " · fictional route cost" : "") : "—",
      buf: q ? usd(Number(q.buffer)) + " · refundable if unused" : "—",
    };
    const live = !example;
    const planOnly = { cta: live ? "Live payout not supported" : "Example · plan only", disabled: true, onClick: () => {} };
    const card = (o: any) => ({
      name: o.name, sub: o.sub, tag: o.tag, tagBg: o.tag === "ENGINE PICK" ? "#C9E86B" : o.ok ? "#EEF0E8" : "#F6EBDD", tagColor: o.tag === "ENGINE PICK" ? "#1E2A22" : o.ok ? "#1E2A22" : "#8A5F25",
      costF: o.costF ?? "—", costColor: o.ok ? "#1E2A22" : "#8A9285", costSub: o.costSub, subColor: o.ok ? "#8A9285" : "#8A5F25",
      rows: o.rows.map(([k, val]: any) => ({ k, v: val })), border: o.tag === "ENGINE PICK" ? "#9DB48C" : "#E3E6DB", opacity: o.ok || o.preview ? 1 : 0.82, disabled: true,
      cta: o.cta ?? planOnly.cta, btnBg: "#F4F5EF", btnColor: "#8A9285", btnBorder: "1px solid #E3E6DB", onClick: () => self.toastMsg(example ? "Example workspace: this is the engine’s plan with fictional route costs. Nothing can be prepared or signed." : "FlowVault can’t pay " + ob.asset + " on " + ob.chain + " live yet. It stays in your calendar and holdback."),
    });
    const sellable = Object.entries(s.pol.assets ?? {}).filter(([, a]: any) => a.uses?.includes("sell")).map(([k]) => ASSET_ROWS[k]?.label ?? k);
    out.pyPlans = [
      card({ name: "Idle wallet USDC", sub: "above your reserve and other payments", ok: !!p0?.eligible, tag: !src ? "CHECKING" : pick === "wallet" ? "ENGINE PICK" : !polOk && p0?.eligible ? "POLICY BLOCKS" : "NOT ENOUGH", costF: p0 ? usd(Number(p0.available)) : "—", costSub: p0 ? "free after reserve " + money(e?.reserve) + " and other payments" : pe?.err || "Comparing sources…", rows: [["Needed", src ? usd(Number(src.funding)) : "—"], ["Approvals", "1 · deposit"]] }),
      card({ name: "Withdraw from Rhea, then pay", sub: "withdrawal verified before the payout quote", ok: !!p1?.eligible, tag: !src ? "CHECKING" : pick === "rhea" ? "ENGINE PICK" : p1?.eligible ? (wneed > 0 ? "NEEDED" : "NOT NEEDED") : "NOT ENOUGH", costF: p1 ? usd(Number(p1.withdrawal ?? 0)) : "—", costSub: p1 ? (wneed > 0 ? "withdrawn first, then paid" : "idle cash covers it") : "—", rows: [["Rhea supply", p1?.available != null ? usd(Number(p1.available)) : "unknown"], ["Approvals", "2 · withdraw, deposit"]] }),
      card({ name: "Sell an approved asset for " + ob.asset, sub: sellable.length ? "sellable under your policy: " + sellable.join(", ") : "no asset is marked sellable in your policy", ok: false, tag: "NOT IN THIS BUILD", costSub: "The swap leg isn’t built; nothing can be sold here", rows: [["Protected", (s.pol.protectedAssets ?? []).join(", ") || "none"]], cta: "Not available" }),
      card({ name: "Borrow USDC against collateral", sub: "credit execution not registered yet", ok: false, preview: true, tag: "NOT AVAILABLE YET", costSub: "Borrowing appears here once Rhea credit execution is registered", rows: [["Repayment plan", "required"], ["Approvals", "new-debt approval"]], cta: "Not available yet" }),
    ];
    const chk = (ok: boolean | null, text: string) => ({ glyph: ok === null ? "◷" : ok ? "✓" : "✕", color: ok === null ? "#8A5F25" : ok ? "#3F6B3C" : "#9A3F32", text, k: text });
    out.pyChecks = [
      chk(src ? !!src.covered : null, src ? "Reserve " + money(e?.reserve) + " and other payments stay covered" : "Reserve and other payments: checking…"),
      chk(e?.policy ? !!e.policy.allowed : e ? false : null, e?.policy ? (e.policy.allowed ? "Passes your policy · " + money(e.policy.remainingDaily) + " left today" : "Policy blocks it: " + reasonText(vio)) : e ? "Not evaluated: " + reasonText(e.reasons ?? []) : "Policy: checking…"),
      chk(true, "Protected assets are never a source" + ((s.pol.protectedAssets ?? []).length ? " · " + s.pol.protectedAssets.join(", ") : "")),
      chk(livePayoutSupported(ob.chain, ob.asset), livePayoutSupported(ob.chain, ob.asset) ? "Live payout supported: exact " + ob.asset + " on " + ob.chain + (example ? " (fictional costs here)" : "") : "Live payout isn’t supported for " + ob.asset + " on " + ob.chain + " · only " + LIVE_ROUTES_TEXT),
      ...(fictional ? [chk(null, "Route costs are fictional example data, not a live quote")] : []),
      ...(pe?.err ? [chk(false, "Couldn’t compare sources: " + pe.err)] : []),
    ];
  } else if (ob) {
    const pay = payFor(ob.id);
    const src = pay?.sources;
    const qf = quoteFigures(pay, ob.chain, ob.asset);
    out.pyHead = {
      amount: num(ob.amount) + " " + ob.asset,
      line: "to " + ob.name + " on " + ob.chain + " · due " + dlabel(ob.due) + " · in " + days(ob.due) + (days(ob.due) === 1 ? " day" : " days"),
      addr: ob.recipient,
      send: qf?.inN != null ? num(qf.inN) + " USDC" : "after quote",
      fee: qf ? (qf.fee !== null ? usd(qf.fee) + (qf.fx ? " · USDT valued at 1Click prices" : "") : "needs a fresh FX price") : "after quote",
      buf: qf?.buffer != null ? usd(qf.buffer) + " · returned if unused" : "after quote",
    };
    const p0 = src?.plans?.[0];
    const p1 = src?.plans?.[1];
    const pick = p0?.eligible ? "wallet" : p1?.eligible ? "rhea" : null;
    const miss = needs(ob);
    const card = (o: any) => ({
      name: o.name, sub: o.sub, tag: o.tag, tagBg: o.tag === "ENGINE PICK" ? "#C9E86B" : o.ok ? "#EEF0E8" : "#F6EBDD", tagColor: o.tag === "ENGINE PICK" ? "#1E2A22" : o.ok ? "#1E2A22" : "#8A5F25",
      costF: o.costF ?? "—", costColor: o.ok ? "#1E2A22" : "#8A9285", costSub: o.costSub, subColor: o.ok ? "#8A9285" : "#8A5F25",
      rows: o.rows.map(([k, val]: any) => ({ k, v: val })), border: o.tag === "ENGINE PICK" ? "#9DB48C" : "#E3E6DB", opacity: o.ok || o.preview ? 1 : 0.82, disabled: !!o.disabled,
      cta: o.cta, btnBg: o.primary ? "#2A4034" : o.disabled ? "#F4F5EF" : "#fff", btnColor: o.primary ? "#fff" : o.disabled ? "#8A9285" : "#3F6B3C", btnBorder: o.primary ? "none" : "1px solid #E3E6DB", onClick: o.onClick,
    });
    const validTo = /^0x[0-9a-fA-F]{40}$/.test(String(ob.recipient));
    const gate = !validTo
      ? { cta: "Add the recipient first", disabled: true, onClick: () => {} }
      : miss.length
        ? { cta: "Allow in Policy ↗", disabled: false, onClick: () => allowPayout(ob) }
        : null;
    const sellable = Object.entries(s.pol.assets ?? {}).filter(([, a]: any) => a.uses?.includes("sell")).map(([k]) => ASSET_ROWS[k]?.label ?? k);
    out.pyPlans = [
      card({
        name: "Idle wallet USDC", sub: "above your reserve and other payments", ok: !!p0?.eligible, tag: !src ? "NOT CHECKED" : pick === "wallet" ? "ENGINE PICK" : "NOT ENOUGH",
        costF: p0 ? usd(Number(p0.available)) : "—", costSub: p0 ? "available now · cost known after the exact-output quote" : "Compare sources to check what’s free",
        rows: [["Needed", src ? usd(Number(src.funding)) : "after compare"], ["Approvals", "1 · deposit"]],
        ...(gate ?? (src ? { cta: pick === "wallet" ? "Review this plan →" : "Not enough idle cash", disabled: pick !== "wallet", primary: pick === "wallet", onClick: () => openLivePay(ob.id) } : { cta: "Compare sources →", primary: true, onClick: () => planPayment(ob.id) })),
      }),
      card({
        name: "Withdraw from Rhea, then pay", sub: "withdrawal verified before the payout quote", ok: !!p1?.eligible && Number(p1?.withdrawal ?? 0) > 0, tag: !src ? "NOT CHECKED" : pick === "rhea" ? "ENGINE PICK" : p1?.eligible ? "ALLOWED #2" : "NOT ENOUGH",
        costF: p1 ? usd(Number(p1.withdrawal)) : "—", costSub: p1 ? (p1.coverage === "unknown" ? "Rhea balance unknown · " + (src.rheaUnknownReason ?? "") : "withdrawn first, then paid") : "Compare sources to check",
        rows: [["Rhea supply", p1 ? (p1.available === null ? "unknown" : usd(Number(p1.available))) : "—"], ["Approvals", "2 · withdraw, deposit"]],
        ...(gate ?? (src ? { cta: pick === "rhea" ? "Review this plan →" : "Not needed", disabled: pick !== "rhea", primary: pick === "rhea", onClick: () => openLivePay(ob.id) } : { cta: "Compare sources →", onClick: () => planPayment(ob.id) })),
      }),
      card({ name: "Sell an approved asset for " + ob.asset, sub: sellable.length ? "sellable under your policy: " + sellable.join(", ") : "no asset is marked sellable in your policy", ok: false, tag: "NOT IN THIS BUILD", costSub: "The swap leg isn’t built; nothing can be sold here", rows: [["Protected", (s.pol.protectedAssets ?? []).join(", ") || "none"]], cta: "Not available", disabled: true, onClick: () => {} }),
      card({ name: "Borrow USDC against collateral", sub: "read-only credit preview", ok: false, preview: true, tag: "PREVIEW · PHASE 2", costSub: "Borrowing ships in phase 2", rows: [["Repayment plan", "required"], ["Approvals", "new-debt approval"]], cta: "Preview only · phase 2", disabled: true, onClick: () => {} }),
    ];
    const chk = (ok: boolean | null, text: string) => ({ glyph: ok === null ? "◷" : ok ? "✓" : "✕", color: ok === null ? "#8A5F25" : ok ? "#3F6B3C" : "#9A3F32", text, k: text });
    out.pyChecks = [
      chk(src ? !!src.covered : null, src ? "Reserve and other payments stay covered" : "Reserve and other payments: checked when sources are compared"),
      chk(true, "Payout on " + ob.chain + " is supported · exact " + ob.asset),
      chk(P ? P.venues.includes("1click") : null, "NEAR Intents 1Click is allowlisted"),
      chk(P ? P.methods.some((m: any) => m.receiver === USDC_TOKEN && m.method === "ft_transfer") : null, "Native USDC transfer is allowlisted"),
      chk(validTo ? (P ? P.recipients.includes(String(ob.recipient).toLowerCase()) : null) : false, validTo ? "Recipient " + short(ob.recipient) + " is allowlisted" : "No valid recipient address on this payment yet"),
      chk(true, "Marked paid only after delivery is verified on " + ob.chain),
      ...(pay ? [chk(!["failed", "unknown", "deadline-passed"].includes(pay.state), "Payment plan: " + pay.state.replace(/-/g, " ") + (pay.message ? " · " + pay.message : ""))] : []),
    ];
  }

  // ---- Live pay dialog
  const lp = s.pay;
  if (s.modal === "pay" && lp) {
    const pob = s.obs.find((o: any) => o.id === lp.obId);
    const pay = pob ? payFor(pob.id) : null;
    const src = pay?.sources;
    const q = pay?.retainedSignedQuote?.quote;
    const pv: any = { ...v.pv };
    out.showOutcome = false;
    out.wallet = { show: false, rows: [] };
    if (pob) {
      pv.amountF = num(pob.amount) + " " + pob.asset;
      pv.summary = [
        { k: "Recipient", v: pob.recipient, font: "'DM Mono',monospace" },
        { k: "Chain", v: pob.chain, font: "inherit" },
        { k: "Asset", v: pob.asset, font: "inherit" },
        { k: "Recipient receives", v: num(pob.amount) + " " + pob.asset + " (net, exact output)", font: "inherit" },
        { k: "Policy revision " + (P?.version ?? "—"), v: "Checked when sources are planned and again at prepare", font: "inherit" },
        { k: "Due", v: dlabel(pob.due) + " · in " + days(pob.due) + (days(pob.due) === 1 ? " day" : " days"), font: "inherit" },
      ];
      out.payToSources = () => {
        if (pay && !PAY_TERMINAL.includes(pay.state)) return self.setState({ pay: { ...lp, step: stepForPay(pay.state) } });
        self.setState({ pay: { ...lp, busy: true } });
        acts.payment(pob.id, uuid()).then((p: any) => self.setState({ pay: { ...self.state.pay, busy: false, step: stepForPay(p?.state) } })).catch((e: Error) => { self.setState({ pay: { ...self.state.pay, busy: false } }); fail(e); });
      };
      const idle = src ? Number(src.idleAvailable) : 0;
      const wneed = src ? Number(src.withdrawalNeeded) : 0;
      const wa = attemptOf(pay?.withdrawAttemptId);
      const wDone = wneed <= 0 || wa?.status === "confirmed";
      pv.legs = src
        ? [
            { title: "Wallet USDC above reserve", sub: acct + " · " + usd(idle) + " free after your reserve and other payments", amount: num(Math.min(Number(src.funding), idle)), glyph: "1", dotBg: "#4E7A4A", border: "#E3E6DB", bg: "#fff" },
            ...(wneed > 0 ? [{ title: wDone ? "Rhea withdrawal · verified" : "Rhea withdrawal leg", sub: wDone ? "Payout event verified · native USDC in wallet" : "Separate approval · verified before payout · collateral off", amount: num(wneed), glyph: wDone ? "✓" : "2", dotBg: wDone ? "#4E7A4A" : "#C08A45", border: wDone ? "#E3E6DB" : "#EBD9BF", bg: wDone ? "#fff" : "#FBF6EE" }] : []),
          ]
        : [];
      pv.reserveAfter = "Reserve and other payments untouched";
      const signPrep = (r: any, next: string) => {
        if (!connected) return self.toastMsg("Connect the wallet for " + acct + " to approve. Nothing was signed.");
        self.setState({ pay: { ...self.state.pay, signing: true } });
        acts.sign(r.preparation).then(() => self.setState({ pay: { ...self.state.pay, signing: false, step: next } })).catch((e: Error) => { self.setState({ pay: { ...self.state.pay, signing: false } }); fail(e); });
      };
      if (!wDone) {
        pv.sourcesNote = "The withdrawal is a separate approval. It must be verified before a payout quote is requested.";
        pv.sourcesCta = lp.signing ? "Waiting for your wallet…" : wa && wa.status !== "failedtx" ? "Check withdrawal status" : "Approve withdrawal of " + num(wneed) + " USDC";
        pv.sourcesAction = lp.signing ? () => {} : wa && wa.status !== "failedtx" ? () => self.liveCall(() => acts.check(wa.id)) : () => acts.paymentAction(pay.id, "prepare-withdraw").then((r: any) => signPrep(r, "sources")).catch(fail);
      } else {
        pv.sourcesNote = "Next, FlowVault requests a live exact-output quote. That creates a deposit address but moves nothing until you approve.";
        pv.sourcesCta = lp.busy ? "Requesting quote…" : "Get a live quote →";
        pv.sourcesAction = () => {
          self.setState({ pay: { ...lp, busy: true } });
          acts.paymentAction(pay.id, "quote").then(() => self.setState({ pay: { ...self.state.pay, busy: false, step: "quote" } })).catch((e: Error) => { self.setState({ pay: { ...self.state.pay, busy: false } }); fail(e); });
        };
      }
      // Quote step: the retained signed exact-output quote.
      const cutoff = pay?.depositCutoff ? Date.parse(pay.depositCutoff) : null;
      const left = cutoff ? Math.max(0, Math.floor((cutoff - Date.now()) / 1000)) : 0;
      const expired = !!cutoff && left <= 0;
      pv.quoteTag = "LIVE QUOTE · EXACT OUTPUT";
      pv.quoteSrc = "NEAR Intents 1Click" + (pay?.updatedAt ? " · " + hhmm(pay.updatedAt) : "") + " · provider signature kept, not verified";
      const qf = quoteFigures(pay, pob.chain, pob.asset);
      const inN = qf?.inN ?? null, outN = qf?.outN ?? null;
      pv.depositF = inN !== null ? num(inN) + " USDC" : "—";
      pv.expired = expired;
      pv.expLabel = !cutoff ? "No quote yet" : expired ? "Deposit cutoff passed" : "Deposit by " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
      pv.expColor = expired ? "#9A3F32" : left < 60 ? "#8A5F25" : "#3F6B3C";
      pv.quoteOpacity = expired ? 0.5 : 1;
      pv.quoteRows = q
        ? [
            { k: "You send (most)", v: (inN !== null ? num(inN) : "—") + " USDC", color: "#1E2A22" },
            { k: "Recipient receives (exact)", v: (outN !== null ? num(outN) : "—") + " " + pob.asset + " on " + pob.chain, color: "#1E2A22" },
            ...(qf?.fx ? [{ k: "Payout value in USDC", v: qf.outUsdc !== null ? num(qf.outUsdc) + " USDC · 1Click prices " + hhmm(qf.fx.capturedAt ?? qf.fx.destinationUpdatedAt) + " · not an oracle" : "price unavailable", color: "#5B6458" }] : []),
            { k: "Non-refundable fees", v: qf?.fee != null ? usd(qf.fee) : "needs a fresh FX price", color: "#8A5F25" },
            { k: "Refundable buffer", v: qf?.buffer != null ? usd(qf.buffer) + " · returned if unused" : "—", color: "#3F6B3C" },
            ...(qf?.maxCost != null ? [{ k: "Most it can cost", v: usd(qf.maxCost) + " incl. buffer · counted against your moving-cost limit", color: "#8A5F25" }] : []),
            { k: "Deposit address", v: short(q.depositAddress), color: "#1E2A22" },
            { k: "Refund address", v: acct, color: "#1E2A22" },
            { k: "Refund deadline", v: pay?.refundDeadline ? whenLabel(pay.refundDeadline) : "—", color: "#1E2A22" },
          ]
        : [{ k: "Quote", v: "not requested yet", color: "#8A9285" }];
      pv.quoteCta = expired ? "Cancel this plan" : lp.signing ? "Waiting for your wallet…" : "Approve deposit in wallet →";
      pv.quoteAction = expired
        ? () => self.liveCall(() => acts.paymentAction(pay.id, "cancel"), "Plan cancelled. Compare sources again for a fresh quote.")
        : lp.signing ? () => {} : () => acts.paymentAction(pay.id, "prepare-deposit").then((r: any) => signPrep(r, "tracking")).catch(fail);
      // Tracking: provider status plus independent destination proof.
      pv.track = stepsOf(pay?.timeline ?? []);
      const st = pay?.state ?? "";
      pv.isStuck = ["unknown", "partial", "deadline-passed"].includes(st);
      pv.recovery = pay ? [{ k: "Deposit address", v: q ? short(q.depositAddress) : "—" }, { k: "Deposit tx", v: pay.hashes?.[0] ? short(pay.hashes[0]) : "—" }, { k: "Refund address", v: acct }, { k: "1Click status", v: (pay.lastStatus?.status ?? "—") + (pay.updatedAt ? " · " + hhmm(pay.updatedAt) : "") }] : [];
      pv.finBg = st === "paid" ? "#E2EAD6" : st === "refunded" ? "#F6EBDD" : pv.isStuck || st === "failed" ? "#F6E3DE" : "#F4F5EF";
      pv.finColor = st === "paid" ? "#2F552D" : st === "refunded" ? "#7A521E" : pv.isStuck || st === "failed" ? "#7F3528" : "#5B6458";
      pv.finText =
        st === "paid" ? "Paid and verified. " + num(pob.amount) + " " + pob.asset + " reached " + short(pob.recipient) + " on " + pob.chain + ", confirmed from a finalized destination receipt."
        : st === "refunded" ? "Not paid. 1Click reports a refund to " + acct + ". The refund isn’t independently verified yet; check your wallet before replanning."
        : st === "failed" ? "Not paid. " + (pay?.message || "The provider reported a failure.") + " Inspect the evidence before any retry."
        : st === "deadline-passed" ? "The deposit deadline passed. Don’t send funds; FlowVault keeps polling for a refund."
        : st === "destination-proof-required" ? "1Click reports success. Waiting for an independent finalized receipt on " + pob.chain + " before marking it paid."
        : pv.isStuck ? "Status unknown. Recovery details are saved; paying again stays disabled."
        : "Safe to close. FlowVault keeps polling; the payment is marked paid only after delivery is verified on " + pob.chain + ".";
      pv.finCta = PAY_TERMINAL.includes(st) ? "Done" : "Close";
      pv.finAction = () => self.endModal();
      out.payRecheck = () => self.liveCall(() => acts.paymentAction(pay.id, "poll"), "Checked again. Nothing was re-sent.");
      if (lp.step === "tracking" && pay && !PAY_TERMINAL.includes(st) && self.payPollFor !== pay.id) {
        self.payPollFor = pay.id;
        setTimeout(() => { self.payPollFor = null; if (self.state.modal === "pay") acts.paymentAction(pay.id, "poll").catch(() => {}); }, 8000);
      }
      const names: Record<string, string> = { wallet: "Idle wallet USDC", rhea: "Withdraw from Rhea, then pay" };
      const pick = src?.plans?.[0]?.eligible ? "wallet" : src?.plans?.[1]?.eligible ? "rhea" : null;
      pv.chosen = pick ? names[pick] : "—";
      pv.chosenCost = qf ? (qf.maxCost != null ? "up to " + usd(qf.maxCost) + " total cost" : qf.inN !== null && qf.outUsdc !== null ? "up to " + usd(qf.inN - qf.outUsdc) + " total cost" : "cost needs a fresh FX price") : "cost known after the quote";
      pv.alts = [
        ...(pick === "wallet" ? [{ name: names.rhea, note: "not needed · idle cash covers it", color: "#5B6458" }] : pick === "rhea" ? [{ name: names.wallet, note: "not enough idle cash above your reserve", color: "#8A5F25" }] : []),
        { name: "Sell an approved asset", note: "not in this build", color: "#8A5F25" },
        { name: "Borrow against collateral", note: "preview only · phase 2", color: "#8A5F25" },
      ];
    }
    out.pv = pv;
  }
  // Pay buttons everywhere open the live flow once Pay on a date is wired.
  const toPayScreen = (id: string) => self.setState({ screen: "pay", payPick: id, modal: null });
  const toLivePay = (o: any) => {
    if (!["Pay", "Pay again", "Check status"].includes(o.btnLabel)) return o;
    const ob2 = s.obs.find((x: any) => x.id === o.id);
    return { ...o, ...(ob2 && evalMode(ob2) ? { btnLabel: "Plan" } : {}), onPay: () => (ob2 && evalMode(ob2) ? toPayScreen(o.id) : openLivePay(o.id)) };
  };
  out.upcoming = (v.upcoming ?? []).map(toLivePay);
  out.obGroups = (v.obGroups ?? []).map((g: any) => ({ ...g, items: g.items.map((o: any) => withRemove(self, example, toLivePay(o))) }));

  // ---- "Pay or move money": the outcome becomes a dated payment (any calendar chain/token, R8), then its sources are compared.
  if (s.modal === "intent") {
    const I0 = s.intent || { amount: "1000", asset: "USDT", rid: "r0", addr: "", chain: "BNB Chain", due: v.intent?.due, save: true, repeats: "none" };
    const hold0 = f(snap.obligations?.holdback);
    out.intentNote = (hold0 !== null && Number(I0.amount) > 0 && days(I0.due) <= s.horizon ? "Holdback rises to " + usd(hold0 + Number(I0.amount)) + ". " : "") + routeNote(I0.chain, I0.asset === "USDT" ? "USDT" : "USDC", example) + (I0.repeats && I0.repeats !== "none" ? " Repeats " + I0.repeats + " on your calendar; each payment is still approved by you." : "");
    out.submitIntent = () => {
      if (v.intentInvalid) return;
      const I = I0;
      const rec = I.rid === "new" ? null : (v.intentRecips ?? []).find((r: any) => r.id === I.rid);
      const chain = rec ? rec.chain : I.chain;
      const destination = DEST[chain];
      if (!destination) return self.toastMsg("Choose a destination chain.");
      const token = I.asset === "USDT" ? "USDT" : "USDC";
      const recipient = rec ? rec.recipient : String(I.addr).trim();
      const label = "Pay " + (rec ? rec.name : short(recipient));
      self.setState({ modal: null });
      self.refocus();
      self.liveCall(async () => {
        await acts.addObligation({ label, recipient, destination, token, amount: String(I.amount).trim(), dueDate: I.due, recurrence: I.repeats && I.repeats !== "none" ? I.repeats : "none" });
        const created = (self.props.live?.workspace?.obligations ?? []).filter((o: any) => o.label === label).pop();
        self.setState({ screen: "pay", payPick: created?.id ?? s.payPick });
      }, (example ? "Example workspace: " : "") + label + " saved as a dated payment" + (I.save ? "" : " (one-off payments are saved in this build so they can be compared)") + ". " + routeNote(chain, token, example));
    };
  }

  // ---- Activity: journal entries with their verification basis.
  out.ops = (v.ops ?? []).map((o: any) => {
    if (!o.live) return o;
    const verify = o.kind === "Supply" ? "finalized receipt = prepared amount" : o.kind === "Withdrawal" ? "exact native-USDC payout event" : "independent finalized destination receipt";
    return {
      ...o, srcTag: "JOURNAL", srcBg: "#EEF0E8", srcColor: "#4A5349", hasPhases: false, phases: [],
      meta: [{ k: "Journal entry", v: short(o.id) }, { k: "Verified by", v: verify }, ...(o.kind !== "Payout" ? [{ k: "Collateral", v: "off" }] : []), { k: "Policy checked", v: "at prepare and at wallet handoff" }],
    };
  });
  // Statement: rendered by components/fv/Statement.tsx straight from Engines' GET /api/statement.
  out.noOps = (out.ops ?? []).length === 0;

  // ---- Replays: simulated recordings from GET /api/replays, shown in their own dialog.
  if ((snap.replays ?? []).length) {
    const RC: any = { ok: ["#E2EAD6", "#3F6B3C"], warn: ["#F6EBDD", "#8A5F25"], bad: ["#F6E3DE", "#9A3F32"] };
    const tone = (o: string) => (o === "success" ? "ok" : o === "refunded" || o === "deadline-passed" ? "warn" : "bad");
    out.replaysIntro = "Each replay is a recorded outcome served by the engine, with simulated identifiers. Nothing is signed or sent, no wallet is needed, and replays never touch your workspace, Activity or budget.";
    const order: Record<string, number> = { pay: 0, withdraw: 1, supply: 2 };
    out.replays = [...snap.replays].sort((a: any, b: any) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3)).map((r: any, i: number) => ({
      n: String(i + 1).padStart(2, "0"),
      title: phaseLabel(r.kind) + " · " + phaseLabel(r.outcome),
      desc: r.message,
      src: r.label ?? "SIMULATED — no funds moved",
      end: String(r.state ?? r.outcome).replace(/-/g, " ").toUpperCase(),
      endBg: RC[tone(r.outcome)][0], endColor: RC[tone(r.outcome)][1],
      onClick: () => { self.remember(); self.setState({ modal: "op", asst: { ...s.asst, open: false }, op: { kind: "replay", step: "tracking", amount: r.amount, ack: false, replay: r } }); },
    }));
  }
  if (s.modal === "op" && s.op?.kind === "replay") {
    const r = s.op.replay;
    out.replayOn = true;
    out.m = { eyebrow: "REPLAY · " + (r.label ?? "SIMULATED — no funds moved"), title: phaseLabel(r.kind) + " · " + phaseLabel(r.outcome), hasSteps: false, steps: [] };
    out.opv = { ...v.opv, track: stepsOf(r.timeline ?? []), finText: r.message + (typeof r.recording === "string" ? " " + r.recording : r.recording?.note ? " " + r.recording.note : r.recording?.description ? " " + r.recording.description : " Recorded provider shapes, not a funded FlowVault track record."), finBg: "#F6EBDD", finColor: "#7A521E", closeLabel: "Close" };
    out.isOpReview = false; out.isOpPrepared = false; out.isOpTracking = true;
    out.goActivityClose = () => self.setState({ modal: null, op: null });
  }
  return out;
}
const PROP_KIND: Record<string, string> = { pay: "payout", allocate_surplus: "surplus allocation", stress: "stress scenario", explain_block: "policy explanation", clarify: "needs details", borrow: "borrow under stress limits", repay: "repay a loan", respond_to_change: "changed payment" };
/** Protection preview and Ask FlowVault (POST /api/assistant), in both workspaces. */
export function livePreviews(snap: LiveSnapshot, v: any, ctx: { self: any; s: any; example: boolean }) {
  const { self, s, example } = ctx;
  const out: any = {};
  const pos = owned(snap).filter((p: any) => p.amount !== "0");
  const rheaPos = pos.filter((p: any) => p.kind === "supplied" && String(p.id).startsWith("rhea"));
  const rnear = pos.filter((p: any) => p.asset === "rNEAR");
  const rhea = rheaPos.reduce((a: number, p: any) => a + Number(p.amount), 0);
  const rnearVal = rnear.map(posValue).reduce((a: number | null, x) => (a === null || x === null ? null : a + x), 0 as number | null);
  out.protExposure = [
    ...rheaPos.map((p: any) => ({ k: p.label, sub: "collateral off · withdrawable, liquidity-dependent", v: usd(Number(p.amount)) })),
    ...rnear.map((p: any) => ({ k: p.label, sub: num(Number(p.amount)) + " rNEAR · priced by a Rhea pool", v: posValue(p) !== null ? usd(posValue(p)!) : "Unvalued" })),
  ];
  if (!out.protExposure.length) out.protExposure = [{ k: snap.portfolio ? "No exposure to this venue" : "Positions not read", sub: snap.portfolio ? "none of your observed positions are on Rhea" : snap.portfolioError || "reading…", v: snap.portfolio ? "$0.00" : "…" }];
  out.protTotal = usd(rhea + (rnearVal ?? 0)) + (rnear.length && rnearVal === null ? " + unvalued" : "");
  out.protNone = rhea <= 0 && !rnear.length;
  out.protExits = rhea > 0
    ? [
        { k: "Withdraw all USDC from Rhea", sub: "back to your wallet · reserve unaffected · you approve", cost: "network fee only", tag: example ? "Live account only" : "Built · you approve", tagColor: "#3F6B3C" },
        { k: "Withdraw half, keep watching", sub: num(rhea / 2) + " USDC back now", cost: "network fee only", tag: example ? "Live account only" : "Built · you approve", tagColor: "#3F6B3C" },
        ...(rnear.length ? [{ k: "Swap rNEAR to NEAR outside Rhea", sub: "removes pool exposure · needs a swap leg", cost: "not quoted", tag: "Preview", tagColor: "#8A5F25" }] : []),
        { k: "Stay and monitor", sub: "no cost now; risk depends on how the incident develops", cost: "$0.00", tag: "Option", tagColor: "#8A9285" },
      ]
    : [{ k: "Nothing to exit", sub: "none of your positions are on the affected venue", cost: "$0.00", tag: "", tagColor: "#8A9285" }];
  out.requestExit = () => (example ? self.toastMsg("Example workspace: withdrawals need your live account. Nothing can be signed here.") : rhea > 0 && self.openOp("withdraw", rhea.toFixed(2)));

  // Ask FlowVault: the engine builds the proposal and the answer; model use and the data sent are disclosed.
  out.asstTag1 = "READ-ONLY · NEVER PREPARES OR SIGNS";
  out.asstTag2 = example ? "FICTIONAL EXAMPLE FIGURES" : "ANSWERS FROM ENGINE FIGURES";
  const rent = s.obs.find((o: any) => o.asset === "USDT" && o.chain === "BNB Chain" && o.status === "upcoming");
  const QS: [string, string][] = [
    ["Pay Aman 1,000 USDT on BNB without touching my protected assets", "Pay Aman 1,000 USDT on BNB"],
    ["Put my eligible surplus to work until my next payment", "Surplus to work"],
    ["What can I borrow under my stress limits?", "Borrow"],
    ["My payment moved forward, what needs to change?", "Payment moved"],
    ["Can I pay 1,000 USDT on BNB by " + (rent ? dlabel(rent.due) : "Nov 23") + " without touching my ETH?", "By " + (rent ? dlabel(rent.due) : "Nov 23") + "?"],
    ["Why was my 6,000 USDC supply blocked?", "Why blocked"],
  ];
  out.asstSuggest = QS.map(([q]) => ({ q, onClick: () => self.ask(q, "chip") }));
  out.asstChips = QS.map(([q, sh]) => ({ short: sh, onClick: () => self.ask(q, "chip") }));
  const close = { asst: { ...s.asst, open: false } };
  const kv = (arr: any[]) => arr.filter(([, val]) => val !== null && val !== undefined && val !== "").map(([k, val]) => ({ k, v: String(val) }));
  const chk = (ok: boolean | null, text: string) => ({ glyph: ok === null ? "◷" : ok ? "✓" : "✕", color: ok === null ? "#8A5F25" : ok ? "#3F6B3C" : "#9A3F32", text, k: text });
  const ans = (m: any) => {
    if (m.pending) return { text: "Asking the engine…", hasProposal: false, sent: "", hasAction: false };
    if (m.err) return { text: "Couldn’t answer: " + m.err + ". Nothing was prepared.", hasProposal: false, sent: "nothing", hasAction: false };
    const r = m.res;
    const p = r.proposal ?? {};
    const e = r.evaluation ?? {};
    const ds = r.dataSent ?? {};
    const sent = ds.sent
      ? (ds.fields ?? []).join(", ") + " → " + (r.provider?.name ?? "model") + (r.provider?.model ? " (" + r.provider.model + ")" : "") + (ds.excluded?.length ? " · not sent: " + ds.excluded.join(", ") : "") + " · provider not attested"
      : "nothing · parsed on this server" + (r.provider?.name ? " (" + r.provider.name + ")" : "") + " · no balance, policy or account data leaves FlowVault";
    const vio: string[] = e.policy?.violations?.map((x: any) => x.code) ?? [];
    const reasons: string[] = [...new Set([...(e.reasons ?? []), ...vio])];
    const ok = !!e.allowed;
    const execNo = e.executionSupported === false;
    const verdict = p.kind === "clarify" ? "NEEDS DETAILS" : ok ? (execNo ? "PLAN COVERS IT · NO LIVE ROUTE" : "ENGINE: FEASIBLE") : "ENGINE: BLOCKED";
    const rows = kv([
      ["kind", PROP_KIND[p.kind] ?? p.kind],
      ["amount", p.amount ?? e.amount],
      ["asset", p.asset],
      ["chain", p.chain ? chainName(p.chain) : null],
      ["due", p.dueDate ? dlabel(p.dueDate) : null],
      ["matched payment", e.obligationId ? s.obs.find((o: any) => o.id === e.obligationId)?.name ?? e.obligationId : null],
      ["drawdown", p.drawdownBps != null ? p.drawdownBps / 100 + "%" : null],
      ["action", p.action],
      ["sources", (p.sources ?? []).join(", ")],
      ["excluded", (snap.policy?.policy?.protectedAssets ?? []).join(", ") + (snap.policy?.policy?.protectedAssets?.length ? " · protected" : "")],
    ]);
    const checks = [
      ...(e.policy ? [chk(!!e.policy.allowed, e.policy.allowed ? "Policy allows it · " + money(e.policy.remainingDaily) + " left today" : "Policy: " + reasonText(vio))] : []),
      ...(e.sources ? [chk(!!e.sources.covered, (e.sources.covered ? "Covered" : "Not covered") + " · funding up to " + money(e.sources.funding) + (Number(e.sources.withdrawalNeeded) > 0 ? " · Rhea withdrawal " + money(e.sources.withdrawalNeeded) : " · idle cash first"))] : []),
      ...(e.reserve ? [chk(true, "Reserve " + money(e.reserve) + " stays in place")] : []),
      ...(e.stress ? [chk(null, e.stress.asset + " " + money(e.stress.valueBefore) + " → " + money(e.stress.stressedValue) + " · loss " + money(e.stress.loss))] : []),
      ...(e.protectedAsset ? [chk(true, "Protected asset stays hold-only")] : []),
      ...(e.quote ? [chk(null, (e.quote.source === "demo" ? "Fictional route costs" : "Dry quote") + " · send up to " + num(Number(e.quote.maxInput)) + " USDC")] : []),
      ...(execNo ? [chk(false, "No live payout route for this token or chain")] : []),
      ...reasons.filter((c) => !vio.includes(c)).map((c) => chk(false, reasonText([c]))),
    ];
    const ob = e.obligationId;
    const plan = r.plan;
    const act =
      plan ? { actionLabel: (plan.state === "blocked" ? "See why and the alternatives →" : "Review this plan →"), onAction: () => { self.setState(close); openPlan({ plan, note: r.planNote ?? undefined }); } }
      : p.kind === "pay" && ob ? { actionLabel: "Open the source comparison →", onAction: () => self.setState({ ...close, screen: "pay", payPick: ob }) }
      : p.kind === "allocate_surplus" ? { actionLabel: "Open strategies →", onAction: () => self.setState({ ...close, screen: "strategies" }) }
      : p.kind === "stress" ? { actionLabel: "Open the credit preview →", onAction: () => self.setState({ ...close, screen: "credit" }) }
      : p.kind === "explain_block" ? { actionLabel: "Open the policy test →", onAction: () => self.setState({ ...close, screen: "policy", test: { ...s.test, kind: p.action ?? "supply", amount: String(p.amount ?? s.test.amount), asset: "usdc", venue: "rhea" } }) }
      : null;
    if (plan) checks.push(chk(plan.state === "blocked" ? false : null, (plan.state === "blocked" ? "Saved as a blocked plan" : "Saved as a plan") + " · next: " + (plan.state === "blocked" ? "read the engines’ alternatives" : "you review it") + " · then policy authorizes, you sign, FlowVault verifies"));
    if (r.planNote) checks.push(chk(null, r.planNote));
    if (r.provider && r.provider.attestationVerified === false && ds.sent) checks.push(chk(null, "Model output is not attested; it only extracted the intent fields above"));
    return {
      text: r.answer + (r.warning ? " " + r.warning : ""),
      hasProposal: p.kind !== "clarify",
      rows,
      verdict,
      vBg: p.kind === "clarify" ? "#F4F5EF" : ok ? (execNo ? "#F6EBDD" : "#E2EAD6") : "#F6E3DE",
      vColor: p.kind === "clarify" ? "#5B6458" : ok ? (execNo ? "#8A5F25" : "#3F6B3C") : "#9A3F32",
      checks,
      sent,
      hasAction: !!act,
      ...(act ?? {}),
      hasChips: p.kind === "clarify",
      chips: p.kind === "clarify" ? out.asstChips : [],
    };
  };
  out.asstMsgs = (s.asst.msgs ?? []).map((m: any) => (m.role === "user" ? { isUser: true, isAi: false, text: m.text, hasProposal: false, hasAction: false, hasChips: false, chips: [] } : { isUser: false, isAi: true, hasChips: false, chips: [], ...ans(m) }));
  return out;
}

export { short, usd, num };
