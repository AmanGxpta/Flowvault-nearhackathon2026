// Hyperliquid perpetuals (owner: Stream C). GET reads every proven EVM account's Hyperliquid state (public API).
// POST: approve a FlowVault agent (the master wallet signs in the browser; FlowVault verifies and relays), create
// a perps mandate naming that agent, place/close orders under the mandate (agent-signed after every check),
// prepare a master-signed withdrawal, revoke the agent, and book fills/fees/funding into the ledger.
import { z } from "zod";
import { session, mutation, json, failure, type SessionInfo } from "@/lib/flowvault/store";
import { proven } from "@/lib/flowvault/account-registry";
import { cloidFor, finishLink, getLink, listLinks, listOrders, placeOrder, prepareWithdraw, readPerps, reconcileOrders, relayUserAction, revokeLink, startLink, syncPerpLedger, verifyLink } from "@/lib/flowvault/perps-service";
import { draftPerpMandate, fromRaw, HL_BRIDGE_ARBITRUM, HL_MIN_DEPOSIT_RAW } from "@/lib/flowvault/hyperliquid";
import { draftMandate } from "@/lib/flowvault/mandate";
import { STRATEGY_SPECS } from "@/lib/flowvault/strategy-spec";
import { killSwitch, mandateGet, mandateInsert, auditAppend } from "@/lib/flowvault/mandate-store";
import { serverSetting } from "@/lib/flowvault/server-setting";
import { keyedAttemptId } from "@/lib/flowvault/preparation-key";
import { units } from "@/lib/flowvault/money";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase());
const chainId = z.number().int().min(1).max(2 ** 32);

/** GET /api/perps — Hyperliquid state per proven EVM account; nothing is written. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const masters = s.workspace.mode === "live" ? (s.workspace.accounts ?? []).filter((a) => a.chain === "evm" && proven(a)).map((a) => a.address.toLowerCase()) : [];
    const links = s.workspace.mode === "live" ? await listLinks(s.id) : [];
    const accounts = await Promise.all(
      masters.map(async (master) => {
        try {
          const view = await readPerps(master);
          return {
            master,
            snapshot: view.snapshot,
            agentsOnHyperliquid: view.agents,
            link: links.find((l) => l.master === master) ?? null,
            orders: await listOrders(s.id, master, 20),
            error: null,
          };
        } catch (e) {
          return { master, snapshot: null, link: links.find((l) => l.master === master) ?? null, orders: [], error: (e as Error).message };
        }
      }),
    );
    return json(
      {
        source: s.workspace.mode,
        agentsAvailable: !!(await serverSetting("FLOWVAULT_AGENT_KEY_SECRET")),
        accounts,
        deposit: {
          observedOnly: true,
          note: `FlowVault doesn't prepare deposits. Hyperliquid documents its Arbitrum bridge (${HL_BRIDGE_ARBITRUM}) as deprecated in favour of CCTP, and deposits under ${fromRaw(HL_MIN_DEPOSIT_RAW, 6)} USDC are lost. Deposit from Hyperliquid's own app with your master address; FlowVault then reads the balance and books the deposit.`,
        },
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}

const order = z.object({
  action: z.literal("order"),
  mandateId: z.string().max(80),
  master: addr,
  coin: z.string().regex(/^[A-Z0-9]{1,12}$/),
  isBuy: z.boolean(),
  size: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/),
  kind: z.enum(["market", "limit", "stop_loss", "take_profit"]),
  price: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/).optional(),
  tif: z.enum(["Gtc", "Ioc", "Alo"]).optional(),
  reduceOnly: z.boolean(),
  leverage: z.number().int().min(1).max(50),
  key: z.string().uuid(),
}).strict();
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link_start"), master: addr, chainId, days: z.number().int().min(1).max(180).optional() }).strict(),
  z.object({ action: z.literal("link_finish"), master: addr, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict(),
  z.object({ action: z.enum(["link_verify", "sync", "mandate_create"]), master: addr }).strict(),
  z.object({ action: z.literal("revoke"), master: addr, chainId }).strict(),
  z.object({ action: z.literal("withdraw_prepare"), master: addr, amount: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/), chainId }).strict(),
  z.object({ action: z.literal("relay"), master: addr, userAction: z.record(z.string(), z.unknown()), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict(),
  order,
  z.object({ action: z.literal("close"), mandateId: z.string().max(80), master: addr, coin: z.string().regex(/^[A-Z0-9]{1,12}$/), key: z.string().uuid() }).strict(),
]);

function requireOwner(s: SessionInfo) {
  if (s.workspace.mode !== "live") throw new Error("This runs on your own workspace, not the example.");
  if (!s.workspace.accountId) throw new Error("Connect your NEAR wallet first. Mandates and agents are saved with your NEAR account.");
  if (s.slot === "personal" && s.account !== s.workspace.accountId) throw new Error("Connect your NEAR wallet first. Mandates and agents are saved with your NEAR account.");
  return s.workspace.accountId;
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await session(r);
    const accountId = requireOwner(s);
    const secret = await serverSetting("FLOWVAULT_AGENT_KEY_SECRET");
    if (b.action === "link_start") return json(await startLink(s, b.master, b.chainId, secret, b.days), s.cookie);
    if (b.action === "link_finish") return json({ link: await finishLink(s, b.master, b.signature) }, s.cookie);
    if (b.action === "link_verify") return json({ link: await verifyLink(s, b.master) }, s.cookie);
    if (b.action === "revoke") return json(await revokeLink(s, b.master, b.chainId), s.cookie);
    if (b.action === "relay") return json({ response: await relayUserAction(s, b.master, b.userAction as never, b.signature) }, s.cookie);
    if (b.action === "withdraw_prepare") return json(prepareWithdraw(await readPerps(b.master), b.master, b.amount, b.chainId), s.cookie);
    if (b.action === "sync") {
      const row = await getLink(s.id, b.master);
      const settled = await reconcileOrders(s.id);
      const entries = await syncPerpLedger(s.id, b.master, row ? Date.parse(row.link.createdAt) : Date.now() - 30 * 864e5);
      return json({ settled, entries }, s.cookie);
    }
    if (b.action === "mandate_create") {
      const row = await getLink(s.id, b.master);
      if (!row || row.link.status !== "verified") throw new Error("Approve a FlowVault agent wallet on Hyperliquid first.");
      const now = Date.now();
      const id = "mdt_" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, "0")).join("");
      const base = draftMandate({ id, accountId, source: "live", now, reserveUsdcRaw: units(s.workspace.mandate.reserve).toString(), strategy: STRATEGY_SPECS[0] });
      const m = draftPerpMandate({ id, accountId, master: b.master, agent: { address: row.link.agentAddress, name: row.link.agentName, validUntil: row.link.validUntil }, now, base });
      await mandateInsert(s.id, m);
      await auditAppend(s.id, [{ id: await keyedAttemptId(s.id, "mandate-audit:" + id + ":create"), mandateId: id, mandateVersion: 1, runId: null, at: m.createdAt, phase: "lifecycle", summary: `Perps draft created naming agent ${row.link.agentAddress}.` }]);
      return json({ mandate: m }, s.cookie);
    }
    // order / close: under an active perps mandate, agent-signed only after every check passes.
    if (b.action !== "order" && b.action !== "close") throw new Error("Unknown action.");
    const stored = await mandateGet(s.id, b.mandateId);
    if (!stored || stored.mandate.accountId !== accountId) throw new Error("Mandate not found.");
    const m = stored.mandate;
    if (!m.scope.accounts.includes("evm:" + b.master)) throw new Error("This mandate doesn't cover that account.");
    const kill = !!(await killSwitch(s.id));
    let rec;
    if (b.action === "close") {
      const view = await readPerps(b.master);
      const p = view.snapshot.positions.find((x) => x.coin === b.coin && !/^-?0(\.0+)?$/.test(x.szi));
      if (!p) throw new Error(`No open ${b.coin} position.`);
      const short = p.szi.startsWith("-");
      rec = await placeOrder({ sessionId: s.id, mandate: m, master: b.master, intent: { coin: b.coin, isBuy: short, size: short ? p.szi.slice(1) : p.szi, kind: "market", reduceOnly: true, cloid: cloidFor(s.id + ":" + b.key) }, leverage: p.leverage.value, secret, killSwitch: kill });
    } else {
      rec = await placeOrder({ sessionId: s.id, mandate: m, master: b.master, intent: { coin: b.coin, isBuy: b.isBuy, size: b.size, kind: b.kind, price: b.price, tif: b.tif, reduceOnly: b.reduceOnly, cloid: cloidFor(s.id + ":" + b.key) }, leverage: b.leverage, secret, killSwitch: kill });
    }
    const at = new Date().toISOString();
    await auditAppend(s.id, [{ id: await keyedAttemptId(s.id, "mandate-audit:" + m.id + ":order:" + rec.cloid + ":" + rec.state), mandateId: m.id, mandateVersion: m.version, runId: null, at, phase: rec.state === "rejected" && !rec.wire ? "check" : "execute", summary: `${rec.intent.reduceOnly ? "Reduce-only" : "Order"} ${rec.intent.coin} ${rec.intent.isBuy ? "buy" : "sell"} ${rec.intent.size}: ${rec.state}${rec.error ? " — " + rec.error : ""}.`, data: { order: rec } }]);
    if (rec.state === "unknown") {
      const latest = await mandateGet(s.id, m.id);
      if (latest) {
        const { mandateSave } = await import("@/lib/flowvault/mandate-store");
        await mandateSave(s.id, { ...latest.mandate, frozen: { at, reason: `Order ${rec.cloid} outcome unknown; check Hyperliquid before anything else runs.`, ref: rec.cloid }, updatedAt: at }, latest.revision).catch(() => undefined);
      }
    }
    return json({ order: rec }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
