// Fund NEAR from EVM USDC (owner: Interface; engine in lib/flowvault/evm-funding.ts).
//   POST {action:"quote", chain, from, amount}        → preview (dry 1Click quote, no deposit address)
//   POST {action:"prepare", chain, from, amount}      → live quote + the one USDC transfer for MetaMask to sign
//   POST {action:"submitted", id, txHash}             → records the signed transfer's hash and tells 1Click
//   GET  ?id=…                                         → delivery status from 1Click (+ wNEAR balance once delivered)
//   POST {action:"unwrap"}                             → the wrap.near near_withdraw transaction for your NEAR wallet
// Only a browser signed in to its NEAR account may use this, only from an EVM address proven yours, and never
// for more USDC than that address holds. FlowVault signs nothing.
import { z } from "zod";
import { session, mutation, json, failure, database } from "@/lib/flowvault/store";
import { mayRead } from "@/lib/flowvault/account-registry";
import { units } from "@/lib/flowvault/money";
import { view } from "@/lib/flowvault/near";
import { FUND_CHAINS, CHAIN_NAME, fundQuote, transferTx, usdcBalance, fundStatus, submitDeposit, unwrapTransaction, registerTransaction, type FundChain } from "@/lib/flowvault/evm-funding";

async function table() {
  const db = await database();
  await db.prepare("CREATE TABLE IF NOT EXISTS funding_transfers (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)").run();
  return db;
}

const req = { chain: z.enum(FUND_CHAINS), from: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.string().regex(/^\d+(\.\d{1,6})?$/) };
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), ...req }).strict(),
  z.object({ action: z.literal("prepare"), ...req }).strict(),
  z.object({ action: z.literal("submitted"), id: z.string().uuid(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict(),
  z.object({ action: z.literal("unwrap") }).strict(),
  z.object({ action: z.literal("register") }).strict(),
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

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await signedIn(r);
    const to = s.account!;
    if (b.action === "quote" || b.action === "prepare") {
      const chain = b.chain as FundChain;
      if (!mayRead(s.workspace, "evm", b.from)) throw new Error("Connect that Ethereum wallet first so FlowVault knows it’s yours.");
      const amountRaw = units(b.amount, 6);
      const have = await usdcBalance(chain, b.from);
      if (amountRaw > have) throw new Error(`That address holds ${Number(have) / 1e6} USDC on ${CHAIN_NAME[chain]}.`);
      const storage = await view<unknown>("wrap.near", "storage_balance_of", { account_id: to });
      if (!storage.data) throw new Error(to + " isn’t registered with wNEAR yet, so 1Click can’t deliver to it. Register it in your NEAR wallet first.");
      const q = await fundQuote({ chain, from: b.from, to, amountRaw: amountRaw.toString() }, b.action === "quote");
      if (b.action === "quote") return json({ quote: q }, s.cookie);
      const id = crypto.randomUUID();
      const tx = transferTx(chain, b.from, q.depositAddress!, q.amountInRaw);
      const record = { id, quote: q, tx, createdAt: new Date().toISOString(), txHash: null as string | null };
      await (await table()).prepare("INSERT INTO funding_transfers (id, session_id, payload) VALUES (?,?,?)").bind(id, s.id, JSON.stringify(record)).run();
      return json({ id, quote: q, tx, warning: `Send exactly ${q.amountIn} USDC from ${b.from} on ${CHAIN_NAME[chain]} before ${new Date(q.deadline).toLocaleTimeString()}. Later deposits are refunded to that address.` }, s.cookie);
    }
    if (b.action === "submitted") {
      const db = await table();
      const row = await db.prepare("SELECT payload FROM funding_transfers WHERE id=? AND session_id=?").bind(b.id, s.id).first<{ payload: string }>();
      if (!row) throw new Error("That conversion isn’t in your workspace.");
      const rec = JSON.parse(row.payload);
      rec.txHash = b.txHash;
      await db.prepare("UPDATE funding_transfers SET payload=? WHERE id=?").bind(JSON.stringify(rec), b.id).run();
      await submitDeposit(rec.quote.depositAddress, b.txHash);
      return json({ ok: true }, s.cookie);
    }
    if (b.action === "register") {
      const have = await view<unknown>("wrap.near", "storage_balance_of", { account_id: to });
      if (have.data) throw new Error(to + " is already registered with wNEAR.");
      const bounds = await view<{ min: string }>("wrap.near", "storage_balance_bounds", {});
      const min = String(bounds.data?.min ?? "");
      return json({ accountId: to, depositRaw: min, transaction: registerTransaction(to, min) }, s.cookie);
    }
    // unwrap: all wNEAR the account holds, back into NEAR in the same account.
    const bal = await wnear(to);
    if (bal <= 0n) throw new Error("There’s no wNEAR to unwrap in " + to + ".");
    return json({ accountId: to, amountRaw: bal.toString(), transaction: unwrapTransaction(bal.toString()) }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function GET(r: Request) {
  try {
    const s = await signedIn(r);
    const id = new URL(r.url).searchParams.get("id") ?? "";
    const row = await (await table()).prepare("SELECT payload FROM funding_transfers WHERE id=? AND session_id=?").bind(id, s.id).first<{ payload: string }>();
    if (!row) throw new Error("That conversion isn’t in your workspace.");
    const rec = JSON.parse(row.payload);
    const st = await fundStatus(rec.quote.depositAddress);
    const wnearRaw = st.status === "SUCCESS" ? (await wnear(s.account!)).toString() : null;
    return json({ id, status: st.status, nearOutRaw: st.nearOutRaw, wnearRaw, txHash: rec.txHash, quote: rec.quote }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
