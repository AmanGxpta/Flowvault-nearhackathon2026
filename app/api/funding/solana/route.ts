// Convert Solana USDC to NEAR (owner: Stream A; engine in lib/flowvault/solana-*.ts and funding-mesh-*.ts).
// Same shape as /api/funding, so the Convert dialog tracks it the same way:
//   POST {action:"quote", from, amount}      → preview (dry 1Click quote, route resolved from /v0/tokens)
//   POST {action:"prepare", from, amount}    → live quote + the exact SPL transfer for the Solana wallet
//   POST {action:"submitted", id, txHash}    → records the signature and tells 1Click
//   POST {action:"uncertain", id}            → the wallet didn't say; tracking asks the chain and 1Click instead
//   GET  ?id=…                               → delivery status (+ wNEAR balance once delivered)
// Only a browser signed in to its NEAR account, only from a Solana address proven yours, from its verified USDC
// account, never for more than it holds, and only with enough SOL for the fee. FlowVault signs nothing.
import { z } from "zod";
import { session, mutation, json, failure, database } from "@/lib/flowvault/store";
import { mayRead } from "@/lib/flowvault/account-registry";
import { units, decimal } from "@/lib/flowvault/money";
import { view } from "@/lib/flowvault/near";
import { legQuote, providerStatus, submitLegDeposit, tokenCatalog } from "@/lib/flowvault/funding-mesh-live";
import { resolveUsdc, resolveWnear, type LegQuote, type LegRequest } from "@/lib/flowvault/funding-mesh-quote";
import { blockhashExpired, solanaLegTransaction, solanaTxOutcome, usdcAccount } from "@/lib/flowvault/solana-funding";

const TABLE = "CREATE TABLE IF NOT EXISTS funding_solana (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)";
async function table() {
  const db = await database();
  await db.prepare(TABLE).run();
  return db;
}
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const req = { from: z.string().regex(SOL_ADDR), amount: z.string().regex(/^\d+(\.\d{1,6})?$/) };
const id = z.string().regex(/^sol:[0-9a-f-]{36}$/);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), chain: z.literal("sol").optional(), ...req }).strict(),
  z.object({ action: z.literal("prepare"), chain: z.literal("sol").optional(), ...req }).strict(),
  z.object({ action: z.literal("submitted"), id, txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/) }).strict(),
  z.object({ action: z.literal("uncertain"), id }).strict(),
]);

async function signedIn(r: Request) {
  const s = await session(r);
  if (s.slot !== "personal" || s.workspace.mode !== "live") throw new Error("Converting to NEAR needs your own workspace, not Demo Mode.");
  if (!s.account) throw new Error("Connect your NEAR wallet first. The NEAR is delivered to your NEAR account.");
  return s;
}
async function wnear(account: string) {
  const r = await view<string>("wrap.near", "ft_balance_of", { account_id: account });
  return BigInt(r.data ?? "0");
}
/** The dialog's quote shape (shared with the EVM route). */
function shaped(q: LegQuote) {
  return {
    dry: q.dry, chain: "sol", from: q.from, to: q.to, amountIn: decimal(BigInt(q.amountInRaw), 6), amountInRaw: q.amountInRaw,
    nearOut: decimal(BigInt(q.amountOutRaw), 24), nearOutRaw: q.amountOutRaw, minNearOut: decimal(BigInt(q.minAmountOutRaw), 24), minNearOutRaw: q.minAmountOutRaw,
    usdOut: null, seconds: q.seconds, depositAddress: q.depositAddress, depositMemo: q.depositMemo, deadline: q.deadline, capturedAt: q.capturedAt,
  };
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await signedIn(r);
    const to = s.account!;
    if (b.action === "quote" || b.action === "prepare") {
      if (!mayRead(s.workspace, "solana", b.from)) throw new Error("Connect that Solana wallet first so FlowVault knows it’s yours.");
      const amountRaw = units(b.amount, 6);
      if (amountRaw <= 0n) throw new Error("Enter an amount above zero.");
      const acct = await usdcAccount(b.from);
      if (amountRaw > acct.amountRaw) throw new Error(`That address holds ${decimal(acct.amountRaw, 6)} USDC on Solana.`);
      const storage = await view<unknown>("wrap.near", "storage_balance_of", { account_id: to });
      if (!storage.data) throw new Error(to + " isn’t registered with wNEAR yet, so 1Click can’t deliver to it. Register it in your NEAR wallet first.");
      const tokens = await tokenCatalog();
      const lr: LegRequest = { network: "solana", from: b.from, to, amountRaw: amountRaw.toString(), originAsset: resolveUsdc(tokens, "solana").assetId, destinationAsset: resolveWnear(tokens).assetId };
      const q = await legQuote(lr, b.action === "quote");
      if (b.action === "quote") return json({ quote: shaped(q) }, s.cookie);
      const tx = await solanaLegTransaction(b.from, q);
      const rid = "sol:" + crypto.randomUUID();
      const record = { id: rid, quote: q, tx, createdAt: new Date().toISOString(), txHash: null as string | null, uncertain: false };
      await (await table()).prepare("INSERT INTO funding_solana (id, session_id, payload) VALUES (?,?,?)").bind(rid, s.id, JSON.stringify(record)).run();
      return json(
        { id: rid, quote: shaped(q), tx, warning: `Send exactly ${decimal(amountRaw, 6)} USDC from ${b.from} on Solana before ${new Date(q.deadline).toLocaleTimeString()}. Later deposits are refunded to that address.` },
        s.cookie,
      );
    }
    const db = await table();
    const row = await db.prepare("SELECT payload FROM funding_solana WHERE id=? AND session_id=?").bind(b.id, s.id).first<{ payload: string }>();
    if (!row) throw new Error("That conversion isn’t in your workspace.");
    const rec = JSON.parse(row.payload);
    if (b.action === "submitted") {
      if (rec.txHash && rec.txHash !== b.txHash) throw new Error("A different transaction is already recorded for this conversion.");
      rec.txHash = b.txHash;
    } else rec.uncertain = true;
    await db.prepare("UPDATE funding_solana SET payload=? WHERE id=? AND payload=?").bind(JSON.stringify(rec), b.id, row.payload).run();
    if (b.action === "submitted") await submitLegDeposit(rec.quote.depositAddress, b.txHash, rec.quote.depositMemo);
    return json({ ok: true }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function GET(r: Request) {
  try {
    const s = await signedIn(r);
    const rid = new URL(r.url).searchParams.get("id") ?? "";
    const row = await (await table()).prepare("SELECT payload FROM funding_solana WHERE id=? AND session_id=?").bind(rid, s.id).first<{ payload: string }>();
    if (!row) throw new Error("That conversion isn’t in your workspace.");
    const rec = JSON.parse(row.payload);
    // A transfer that failed on Solana never reached 1Click: the USDC stayed put (only the fee was spent).
    if (rec.txHash) {
      const out = await solanaTxOutcome(rec.txHash).catch(() => null);
      if (out?.failed) return json({ id: rid, status: "SOURCE_FAILED", nearOutRaw: null, wnearRaw: null, txHash: rec.txHash, quote: shaped(rec.quote) }, s.cookie);
    }
    const st = await providerStatus(rec.quote.depositAddress, rec.quote.depositMemo);
    let status: string = st.status;
    // Nothing arrived, no signature, and the transaction's blockhash expired: it can't land any more.
    if (st.status === "PENDING_DEPOSIT" && !rec.txHash && (await blockhashExpired(rec.tx.lastValidBlockHeight).catch(() => false))) status = "NOT_SENT";
    const wnearRaw = status === "SUCCESS" ? (await wnear(s.account!)).toString() : null;
    return json({ id: rid, status, nearOutRaw: st.deliveredRaw, wnearRaw, txHash: rec.txHash, uncertain: !!rec.uncertain, quote: shaped(rec.quote) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
