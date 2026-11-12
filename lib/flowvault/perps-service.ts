// Hyperliquid perpetuals service (owner: Stream C). Observe (public info API) → Configure (owner's master wallet
// approves a FlowVault agent; owner signs a mandate naming it) → Decide/Check (checkPerpOrder under the mandate)
// → Execute (journal first, then the agent signs and FlowVault submits) → Account (fills, fees, funding and
// transfers into the ledger outbox). Withdrawals and agent approval are signed by the master wallet in the
// browser; FlowVault only relays a signature it has verified. A deposit is made by the owner; FlowVault observes it.
import type { AgentMandate, LedgerEntry, MandateCheck } from "./contracts";
import type { Workspace } from "./types";
import {
  HL_API, HL_MAX_AGENT_DAYS, HL_WITHDRAW_FEE_RAW, approveAgentAction, checkPerpOrder, fromRaw, l1TypedData, orderAction,
  orderStatus, orderWire, parseClearinghouse, parseMeta, perpLedger, protectiveOrders, realizedPerpResult, recoverTyped,
  signTyped, splitSig, toRaw, updateLeverageAction, userTypedData, withdrawAction,
  type AssetMeta, type OrderIntent, type PerpSnapshot, type TypedData,
} from "./hyperliquid";
import { mandateDigest } from "./mandate";
import { newAgentKey, openAgentKey, NO_SECRET } from "./perps-keys";
import { PERP_TABLES, LINK_UPSERT, LINK_GET, LINK_LIST, ORDER_INSERT, ORDER_ADVANCE, ORDER_GET, ORDER_LIST, ORDER_OPEN } from "./perps-sql";
import { proven } from "./account-registry";
import { ledgerOutbox, readLedgerOutbox } from "./plans-store";

const TIMEOUT_MS = 10_000;

async function db() {
  const { database } = await import("./store");
  const d = await database();
  for (const sql of PERP_TABLES) await d.prepare(sql).run();
  return d;
}

/* ───────────── public API reads ───────────── */

export async function hlPost(path: "/info" | "/exchange", body: unknown, fetcher: typeof fetch = fetch) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetcher(HL_API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`Hyperliquid ${path} ${r.status}: ${text.slice(0, 200)}`), { status: r.status });
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

export interface PerpView {
  snapshot: PerpSnapshot;
  meta: AssetMeta[];
  mids: Record<string, string>;
  agents: { name: string; address: string; validUntil: number }[];
}
export async function readPerps(master: string): Promise<PerpView> {
  const user = master.toLowerCase();
  const [meta, mids, ch, agents] = await Promise.all([
    hlPost("/info", { type: "meta" }),
    hlPost("/info", { type: "allMids" }),
    hlPost("/info", { type: "clearinghouseState", user }),
    hlPost("/info", { type: "extraAgents", user }),
  ]);
  return { snapshot: parseClearinghouse(user, ch), meta: parseMeta(meta), mids, agents: (agents ?? []).map((a: { name: string; address: string; validUntil: number }) => ({ ...a, address: a.address.toLowerCase() })) };
}

/* ───────────── agent link ───────────── */

export interface PerpLink {
  master: string;
  agentAddress: string;
  agentName: string;
  validUntil: number;
  status: "awaiting_master_signature" | "submitted" | "verified" | "revoked" | "expired";
  /** The approveAgent action the master signs (nonce fixed at creation). */
  action: ReturnType<typeof approveAgentAction>;
  createdAt: string;
  verifiedAt?: string;
  revokedAt?: string;
  note?: string;
}
const binding = (sessionId: string, master: string, agent: string) => `${sessionId}|${master}|${agent}`;

export function assertOwnedEvm(w: Workspace, master: string) {
  const a = (w.accounts ?? []).find((x) => x.chain === "evm" && x.address.toLowerCase() === master.toLowerCase());
  if (!a || !proven(a)) throw new Error("Connect and prove this Ethereum address first: only your own master account can approve an agent.");
  return a.address.toLowerCase();
}

export async function getLink(sessionId: string, master: string) {
  const d = await db();
  const row = await d.prepare(LINK_GET).bind(sessionId, master.toLowerCase()).first<{ payload: string; sealed_key: string | null; revision: number }>();
  return row ? { link: JSON.parse(row.payload) as PerpLink, sealed: row.sealed_key, revision: Number(row.revision) } : null;
}
export async function listLinks(sessionId: string) {
  const d = await db();
  const rows = await d.prepare(LINK_LIST).bind(sessionId).all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as PerpLink);
}
async function saveLink(sessionId: string, link: PerpLink, sealed: string | null, revision: number) {
  const d = await db();
  const r = await d.prepare(LINK_UPSERT).bind(sessionId, link.master, JSON.stringify(link), sealed, revision).run();
  if (r.meta.changes !== 1) throw new Error("The agent link changed in another tab. Refresh and try again.");
}

/** Creates a fresh agent and returns the typed data the master wallet signs. chainId = the wallet's current chain. */
export async function startLink(s: { id: string; workspace: Workspace }, master: string, chainId: number, secret: string | null, days = 30, now = Date.now()) {
  if (!secret) throw new Error(NO_SECRET);
  const m = assertOwnedEvm(s.workspace, master);
  const prior = await getLink(s.id, m);
  if (prior?.link.status === "verified") throw new Error("An agent is already approved for this account. Revoke it before creating another.");
  const key = await newAgentKey(secret, (address) => binding(s.id, m, address));
  const validUntil = now + Math.min(days, HL_MAX_AGENT_DAYS) * 864e5;
  const name = `flowvault valid_until ${validUntil}`;
  const action = approveAgentAction(key.address, name, now, chainId);
  const link: PerpLink = { master: m, agentAddress: key.address, agentName: name, validUntil, status: "awaiting_master_signature", action, createdAt: new Date(now).toISOString() };
  await saveLink(s.id, link, key.sealed, prior?.revision ?? 0);
  return { link, typedData: userTypedData(action) };
}
/** Verifies the master's signature over the stored action, relays it, then confirms the agent on Hyperliquid. */
export async function finishLink(s: { id: string; workspace: Workspace }, master: string, signatureHex: string, fetcher: typeof fetch = fetch) {
  const m = assertOwnedEvm(s.workspace, master);
  const row = await getLink(s.id, m);
  if (!row || row.link.status !== "awaiting_master_signature") throw new Error("No agent approval is waiting for a signature. Start again.");
  const sig = splitSig(signatureHex);
  const signer = recoverTyped(userTypedData(row.link.action), sig);
  if (signer !== m) throw new Error(`The signature is from ${signer}, not ${m}. Sign with the master account.`);
  const link: PerpLink = { ...row.link, status: "submitted" };
  await saveLink(s.id, link, row.sealed, row.revision);
  const resp = await hlPost("/exchange", { action: row.link.action, nonce: row.link.action.nonce, signature: sig }, fetcher);
  if (resp?.status !== "ok") {
    const failed: PerpLink = { ...link, status: "awaiting_master_signature", note: "Hyperliquid refused: " + JSON.stringify(resp).slice(0, 200) };
    await saveLink(s.id, failed, row.sealed, row.revision + 1);
    throw new Error(failed.note);
  }
  return verifyLink(s, m, fetcher);
}

/** Reads extraAgents: the agent is verified only when Hyperliquid lists it for the master. */
export async function verifyLink(s: { id: string }, master: string, fetcher: typeof fetch = fetch) {
  const row = await getLink(s.id, master);
  if (!row) throw new Error("No agent link.");
  const agents = (await hlPost("/info", { type: "extraAgents", user: master }, fetcher)) as { address: string; name: string; validUntil: number }[];
  const found = agents.find((a) => a.address.toLowerCase() === row.link.agentAddress);
  const now = Date.now();
  let link = row.link;
  if (found && found.validUntil > now) link = { ...link, status: "verified", verifiedAt: link.verifiedAt ?? new Date(now).toISOString(), validUntil: found.validUntil };
  else if (link.status === "verified") link = { ...link, status: found ? "expired" : "revoked", note: found ? "Expired on Hyperliquid." : "No longer listed on Hyperliquid (replaced or pruned)." };
  if (JSON.stringify(link) !== JSON.stringify(row.link)) await saveLink(s.id, link, link.status === "verified" || link.status === "submitted" ? row.sealed : null, row.revision);
  return link;
}

/** Deletes the key here (FlowVault can never sign again) and prepares a replacement approval that deregisters
 * the agent on Hyperliquid immediately (an approveAgent with the same name replaces it; the burn key is discarded). */
export async function revokeLink(s: { id: string; workspace: Workspace }, master: string, chainId: number, now = Date.now()) {
  const m = assertOwnedEvm(s.workspace, master);
  const row = await getLink(s.id, m);
  if (!row) throw new Error("No agent link.");
  const link: PerpLink = { ...row.link, status: "revoked", revokedAt: new Date(now).toISOString(), note: "Key deleted from FlowVault." };
  await saveLink(s.id, link, null, row.revision);
  const burn = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
  const action = approveAgentAction(burn, row.link.agentName, now, chainId);
  return { link, deregister: { action, typedData: userTypedData(action), note: "Optional: sign to replace the agent on Hyperliquid now. Otherwise it stays listed until " + new Date(row.link.validUntil).toISOString() + ", with no key anywhere that can use it." } };
}
/** Relays a master-signed user action after verifying the signer (deregistration or withdrawal). */
export async function relayUserAction(s: { workspace: Workspace }, master: string, action: { type: string; signatureChainId: string } & Record<string, unknown>, signatureHex: string, fetcher: typeof fetch = fetch) {
  const m = assertOwnedEvm(s.workspace, master);
  if (!["approveAgent", "withdraw3"].includes(action.type)) throw new Error("Only agent approval and withdrawal are relayed.");
  if (action.type === "withdraw3" && String(action.destination).toLowerCase() !== m) throw new Error("Withdrawals go only to your own master address.");
  const sig = splitSig(signatureHex);
  const signer = recoverTyped(userTypedData(action), sig);
  if (signer !== m) throw new Error("The signature is not from your master account.");
  const nonce = Number(action.type === "withdraw3" ? action.time : action.nonce);
  return hlPost("/exchange", { action, nonce, signature: sig }, fetcher);
}

export function prepareWithdraw(view: PerpView, master: string, amount: string, chainId: number, now = Date.now()) {
  const raw = toRaw(amount, 6);
  if (raw <= HL_WITHDRAW_FEE_RAW) throw new Error("Withdraw more than the 1 USDC Hyperliquid fee.");
  if (raw > BigInt(view.snapshot.withdrawableUsdcRaw)) throw new Error(`Only ${fromRaw(BigInt(view.snapshot.withdrawableUsdcRaw), 6)} USDC is withdrawable now (the rest backs open positions).`);
  const action = withdrawAction(master, fromRaw(raw, 6), now, chainId);
  return {
    action,
    typedData: userTypedData(action) as TypedData,
    youReceiveUsdc: fromRaw(raw - HL_WITHDRAW_FEE_RAW, 6),
    note: "Arrives on Arbitrum at your own address in about 5 minutes; Hyperliquid charges 1 USDC (per its docs at the time of writing).",
  };
}

/* ───────────── orders ───────────── */

export interface PerpOrderRecord {
  cloid: string;
  master: string;
  mandateId: string;
  mandateVersion: number;
  intent: OrderIntent;
  leverage: number;
  wire: ReturnType<typeof orderWire> | null;
  nonce: number | null;
  state: "prepared" | "submitted" | "resting" | "filled" | "rejected" | "unknown" | "cancelled";
  checks: MandateCheck[];
  notionalUsdcRaw: string | null;
  response?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
async function advance(sessionId: string, from: PerpOrderRecord["state"], rec: PerpOrderRecord) {
  const d = await db();
  const r = await d.prepare(ORDER_ADVANCE).bind(rec.state, JSON.stringify(rec), rec.cloid, sessionId, from).run();
  if (r.meta.changes !== 1) throw new Error("Order journal changed concurrently; read it again.");
}
export async function listOrders(sessionId: string, master: string, limit = 50) {
  const d = await db();
  const rows = await d.prepare(ORDER_LIST).bind(sessionId, master.toLowerCase(), limit).all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as PerpOrderRecord);
}
export async function openOrders(sessionId: string) {
  const d = await db();
  const rows = await d.prepare(ORDER_OPEN).bind(sessionId).all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as PerpOrderRecord);
}
function todayNotional(orders: PerpOrderRecord[], now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  return orders.filter((o) => o.createdAt.slice(0, 10) === day && !o.intent.reduceOnly && ["submitted", "resting", "filled", "unknown"].includes(o.state)).reduce((n, o) => n + BigInt(o.notionalUsdcRaw ?? "0"), 0n);
}
export async function perpRealizedLoss(sessionId: string, master: string) {
  const entries = (await readLedgerOutbox(sessionId)).filter((e: LedgerEntry) => e.planId === "perps:" + master.toLowerCase() || e.positionId === "hyperliquid:" + master.toLowerCase());
  const r = realizedPerpResult(entries);
  return r < 0n ? -r : 0n;
}

/** Gate shared with every mandate action: signed terms, validity, freeze, kill switch, named agent. */
export function perpGate(m: AgentMandate, link: PerpLink | null, killSwitch: boolean, now: number): MandateCheck[] {
  return [
    { id: "kill_switch", ok: !killSwitch, detail: killSwitch ? "Kill switch is on." : "Kill switch off." },
    { id: "signed_terms", ok: !!m.approval && m.approval.digest === mandateDigest(m), detail: "Owner signature matches these terms." },
    { id: "validity", ok: now >= Date.parse(m.validFrom) && now < Date.parse(m.validUntil), detail: `Valid until ${m.validUntil}.` },
    { id: "authority_kind", ok: m.authority.kind === "hyperliquid_agent", detail: `Authority ${m.authority.kind}.` },
    { id: "named_agent", ok: !!link && link.status === "verified" && m.authority.delegate?.address?.toLowerCase() === link.agentAddress && now < link.validUntil, detail: link ? `Agent ${link.agentAddress} ${link.status}; mandate names ${m.authority.delegate?.address ?? "none"}.` : "No agent link." },
  ];
}

/**
 * Places one order under a mandate. Journal row first (cloid = idempotency key), then checks, then the agent signs
 * and FlowVault submits. A timeout or unreadable response is "unknown": the mandate must freeze and the order is
 * reconciled by cloid, never resent.
 */
export async function placeOrder(input: {
  sessionId: string;
  mandate: AgentMandate;
  master: string;
  intent: OrderIntent;
  leverage: number;
  secret: string | null;
  killSwitch: boolean;
  now?: number;
  fetcher?: typeof fetch;
}): Promise<PerpOrderRecord> {
  const { sessionId, mandate: m, intent } = input;
  const now = input.now ?? Date.now();
  const at = new Date(now).toISOString();
  const master = input.master.toLowerCase();
  const d = await db();
  const existing = await d.prepare(ORDER_GET).bind(intent.cloid, sessionId).first<{ payload: string }>();
  if (existing) return JSON.parse(existing.payload) as PerpOrderRecord;
  if (!input.secret) throw new Error(NO_SECRET);
  const row = await getLink(sessionId, master);
  const view = await readPerps(master);
  const gate = perpGate(m, row?.link ?? null, input.killSwitch, now);
  const prior = await listOrders(sessionId, master, 200);
  const res = checkPerpOrder({
    mandate: m, limits: m.perps, snapshot: view.snapshot, meta: view.meta, midPx: view.mids[intent.coin] ?? null, intent, leverage: input.leverage,
    todayNotionalUsdcRaw: todayNotional(prior, now).toString(), realizedLossUsdcRaw: (await perpRealizedLoss(sessionId, master)).toString(), now,
    agentVerified: row?.link.status === "verified",
  });
  const checks = [...gate, ...res.checks];
  const allowed = checks.every((c) => c.ok === true);
  const rec: PerpOrderRecord = { cloid: intent.cloid, master, mandateId: m.id, mandateVersion: m.version, intent, leverage: input.leverage, wire: null, nonce: null, state: "prepared", checks, notionalUsdcRaw: res.notionalUsdcRaw, createdAt: at, updatedAt: at };
  if (!allowed) {
    rec.state = "rejected";
    rec.error = "Blocked by checks: " + checks.filter((c) => c.ok !== true).map((c) => c.id).join(", ");
  } else {
    const asset = view.meta.find((a) => a.name === intent.coin)!;
    rec.wire = orderWire(intent, asset, view.mids[intent.coin] ?? null, m.limits.maxSlippageBps);
  }
  const ins = await d.prepare(ORDER_INSERT).bind(rec.cloid, sessionId, master, rec.state, JSON.stringify(rec), at).run();
  if (ins.meta.changes !== 1) return JSON.parse((await d.prepare(ORDER_GET).bind(intent.cloid, sessionId).first<{ payload: string }>())!.payload);
  if (!allowed) return rec;

  const priv = await openAgentKey(input.secret, binding(sessionId, master, row!.link.agentAddress), row!.sealed!, row!.link.agentAddress);
  const asset = view.meta.find((a) => a.name === intent.coin)!;
  const pos = view.snapshot.positions.find((p) => p.coin === intent.coin);
  const fetcher = input.fetcher ?? fetch;
  // Leverage applies per asset; set it before an opening order when it differs (agents may sign this L1 action).
  if (!intent.reduceOnly && (!pos || pos.leverage.value !== input.leverage)) {
    const lev = updateLeverageAction(asset.index, input.leverage, true);
    const n = now;
    const r = await hlPost("/exchange", { action: lev, nonce: n, signature: signTyped(l1TypedData(lev, n), priv) }, fetcher).catch((e) => ({ status: "err", response: String(e) }));
    if (r?.status !== "ok") {
      const failed = { ...rec, state: "rejected" as const, error: "Leverage not set: " + JSON.stringify(r).slice(0, 200), updatedAt: new Date().toISOString() };
      await advance(sessionId, "prepared", failed);
      return failed;
    }
  }
  const action = orderAction([rec.wire!]);
  const nonce = now + 1;
  const submitted: PerpOrderRecord = { ...rec, state: "submitted", nonce, updatedAt: new Date().toISOString() };
  await advance(sessionId, "prepared", submitted);
  let resp: unknown;
  try {
    resp = await hlPost("/exchange", { action, nonce, signature: signTyped(l1TypedData(action, nonce), priv) }, fetcher);
  } catch (e) {
    const status = (e as { status?: number }).status;
    // A 4xx means it never executed; anything else (timeout, 5xx, network) may have executed.
    const out = { ...submitted, state: status && status >= 400 && status < 500 ? ("rejected" as const) : ("unknown" as const), error: (e as Error).message, updatedAt: new Date().toISOString() };
    await advance(sessionId, "submitted", out);
    return out;
  }
  const st = orderStatus(resp);
  const out: PerpOrderRecord = { ...submitted, state: st.state, response: resp, error: st.error, updatedAt: new Date().toISOString() };
  await advance(sessionId, "submitted", out);
  return out;
}

/** Resolves submitted/unknown orders by cloid from Hyperliquid's own order status. */
export async function reconcileOrders(sessionId: string, fetcher: typeof fetch = fetch) {
  const out: PerpOrderRecord[] = [];
  for (const o of (await openOrders(sessionId)).filter((x) => x.state === "unknown" || x.state === "submitted")) {
    try {
      const r = await hlPost("/info", { type: "orderStatus", user: o.master, oid: o.cloid }, fetcher);
      const s = r?.order?.status as string | undefined;
      const state: PerpOrderRecord["state"] | null =
        r?.status === "unknownOid" ? (Date.now() - Date.parse(o.updatedAt) > 120_000 ? "rejected" : null)
        : s === "filled" ? "filled" : s === "open" || s === "triggered" ? "resting" : s && /canceled|rejected/i.test(s) ? "cancelled" : null;
      if (!state) continue;
      const next = { ...o, state, response: r, updatedAt: new Date().toISOString(), error: state === "rejected" ? "Hyperliquid has no record of this order after 2 minutes: it was never placed." : o.error };
      await advance(sessionId, o.state, next);
      out.push(next);
    } catch {
      /* still unknown; the mandate stays frozen */
    }
  }
  return out;
}

/** Books fills, fees, funding and transfers since the link was created into the ledger outbox (idempotent ids). */
export async function syncPerpLedger(sessionId: string, master: string, since: number, fetcher: typeof fetch = fetch) {
  const user = master.toLowerCase();
  const [fills, funding, transfers] = await Promise.all([
    hlPost("/info", { type: "userFillsByTime", user, startTime: since }, fetcher),
    hlPost("/info", { type: "userFunding", user, startTime: since }, fetcher),
    hlPost("/info", { type: "userNonFundingLedgerUpdates", user, startTime: since }, fetcher),
  ]);
  const entries = perpLedger(user, fills ?? [], funding ?? [], transfers ?? []).map((e) => ({ ...e, planId: "perps:" + user }));
  await ledgerOutbox(sessionId, "perps:" + user, entries);
  return entries;
}

/** Protective run for a perps mandate: reduce-only orders when the loss stop or liquidation cushion requires it. */
export async function protect(input: { sessionId: string; mandate: AgentMandate; master: string; secret: string | null; killSwitch: boolean; now?: number }) {
  const m = input.mandate;
  if (!m.perps) return { reason: null, orders: [] as PerpOrderRecord[] };
  const view = await readPerps(input.master);
  const loss = await perpRealizedLoss(input.sessionId, input.master);
  const minute = new Date(input.now ?? Date.now()).toISOString().slice(0, 16);
  const plan = protectiveOrders({
    snapshot: view.snapshot, meta: view.meta, limits: m.perps, maxLossUsdcRaw: m.limits.maxStrategyLossUsdcRaw, realizedLossUsdcRaw: loss.toString(),
    cloid: (coin) => cloidFor(`${m.id}:protect:${coin}:${minute}`),
  });
  const orders: PerpOrderRecord[] = [];
  for (const o of plan.orders) orders.push(await placeOrder({ sessionId: input.sessionId, mandate: m, master: input.master, intent: o, leverage: 1, secret: input.secret, killSwitch: input.killSwitch, now: input.now }));
  return { reason: plan.reason, orders };
}

/** Deterministic 16-byte client order id. */
export function cloidFor(key: string) {
  let h = 0x811c9dc5n;
  const out: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (const ch of key + ":" + round) h = ((h ^ BigInt(ch.charCodeAt(0))) * 0x01000193n) & 0xffffffffn;
    out.push(h.toString(16).padStart(8, "0"));
  }
  return "0x" + out.join("");
}
