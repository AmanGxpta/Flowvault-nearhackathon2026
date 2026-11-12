// Network fees in USDC (owner: Stream A; engine lib/flowvault/gas-abstraction*.ts). Circle Paymaster through the
// wallet's own EIP-5792 wallet_sendCalls + ERC-7677 paymasterService (see gas-abstraction.ts for the verified facts).
//   POST {action:"estimate", network, from, amountRaw}                  → fee split preview (no record)
//   POST {action:"quote", network, from, depositAddress, amountRaw}    → op + the bounded permit to sign
//   POST {action:"permit", id, signature}                              → verified permit; paymaster URL + context
//   POST {action:"submitted", id, callsId, txHash}                     → the bundle transaction
//   GET  ?id=…                                                         → actual USDC charged (finalized receipt)
// Only your own workspace, only from a proven EVM address. FlowVault never signs and never pays gas itself.
import { z } from "zod";
import { session, mutation, json, failure } from "@/lib/flowvault/store";
import { mayRead } from "@/lib/flowvault/account-registry";
import { CIRCLE, permitSigner, permitTypedData, type GasNetwork } from "@/lib/flowvault/gas-abstraction";
import { OP_TTL_MS, liveQuote, opGet, opInsert, opSave, permitFields, reconcileOp, usdcBalanceOf, type GasOp } from "@/lib/flowvault/gas-abstraction-live";

const evm = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const network = z.enum(["ethereum", "base", "arbitrum"]);
const raw = z.string().regex(/^[1-9]\d{0,15}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("estimate"), network, from: evm, amountRaw: raw }).strict(),
  z.object({ action: z.literal("quote"), network, from: evm, depositAddress: evm, amountRaw: raw }).strict(),
  z.object({ action: z.literal("permit"), id: z.string().uuid(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict(),
  z.object({ action: z.literal("submitted"), id: z.string().uuid(), callsId: z.string().min(1).max(200), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict(),
]);

async function own(r: Request) {
  const s = await session(r);
  if (s.slot !== "personal" || s.workspace.mode !== "live") throw new Error("Paying fees in USDC needs your own workspace, not Demo Mode.");
  return s;
}
const fresh = (op: GasOp) => Date.parse(op.expiresAt) > Date.now();

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await own(r);
    if (b.action === "estimate" || b.action === "quote") {
      if (!mayRead(s.workspace, "evm", b.from)) throw new Error("Connect that Ethereum wallet first so FlowVault knows it’s yours.");
      const n = b.network as GasNetwork;
      const { quote, reason } = await liveQuote(n, BigInt(b.amountRaw));
      if (!quote) return json({ supported: false, reason }, s.cookie);
      const balance = await usdcBalanceOf(n, b.from);
      if (balance < BigInt(b.amountRaw) + BigInt(quote.maxChargeUsdcRaw))
        return json({ supported: false, reason: `ROOM_FOR_FEE: leave up to ${(Number(quote.maxChargeUsdcRaw) / 1e6).toFixed(2)} USDC for the fee (the address holds ${(Number(balance) / 1e6).toFixed(2)})`, quote }, s.cookie);
      if (b.action === "estimate") return json({ supported: true, quote, paymaster: CIRCLE[n][0] }, s.cookie);
      const permit = await permitFields(n, b.from, quote.maxChargeUsdcRaw);
      const now = Date.now();
      const op: GasOp = {
        id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(), sessionId: s.id, network: n, owner: b.from.toLowerCase(), depositAddress: b.depositAddress.toLowerCase(),
        amountRaw: b.amountRaw, quote, permit: { ...permit, signature: null }, state: "quoted", callsId: null, txHash: null, chargedUsdcRaw: null, principalExact: null,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + OP_TTL_MS).toISOString(),
      };
      await opInsert(op);
      return json({ supported: true, id: op.id, quote, typedData: permitTypedData(permit), paymaster: CIRCLE[n][0] }, s.cookie);
    }
    const got = await opGet(b.id, s.id);
    if (!got) throw new Error("That fee payment isn’t in your workspace.");
    const { op, previous } = got;
    if (b.action === "permit") {
      if (op.state !== "quoted" || !fresh(op)) throw new Error("This fee quote is no longer open. Start again.");
      if (permitSigner(op.permit, b.signature) !== op.owner) throw new Error("The permit wasn’t signed by " + op.owner + ". Nothing was sent.");
      op.permit.signature = b.signature;
      op.state = "permitted";
      await opSave(op, previous);
      return json({ paymasterService: { url: new URL("/api/gas/paymaster", r.url).toString(), context: { opId: op.id, token: op.token } } }, s.cookie);
    }
    if (!["permitted", "sponsored"].includes(op.state)) throw new Error(`This fee payment is ${op.state}.`);
    op.callsId = b.callsId;
    op.txHash = b.txHash;
    op.state = "submitted";
    await opSave(op, previous);
    return json({ ok: true }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function GET(r: Request) {
  try {
    const s = await own(r);
    const got = await opGet(new URL(r.url).searchParams.get("id") ?? "", s.id);
    if (!got) throw new Error("That fee payment isn’t in your workspace.");
    const before = got.op.state;
    const op = await reconcileOp(got.op);
    if (op.state !== before) await opSave(op, got.previous);
    return json({ id: op.id, state: op.state, quote: op.quote, chargedUsdcRaw: op.chargedUsdcRaw, principalExact: op.principalExact, txHash: op.txHash }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
