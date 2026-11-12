/* eslint-disable @typescript-eslint/no-explicit-any -- jsonParsed token account data */
// Solana USDC funding, server side (owner: Stream A), on @solana/kit's RPC client. Everything fails closed:
// mainnet only (genesis hash), the real USDC mint, the owner's associated token account verified (mint, owner,
// 6 decimals, initialized — not frozen), enough SOL for the fee and, when needed, the deposit's token-account rent,
// a fresh blockhash per wallet handoff, and outcomes only at finalized commitment.
import { address, createSolanaRpc, signature } from "@solana/kit";
import { SOL, expiredAt, toBase64, usdcAta, usdcTransferTransaction } from "./solana-tx";
import type { LegQuote } from "./funding-mesh-quote";
import type { LegTransaction } from "./funding-mesh-store";

// Keyless default (plain account reads work); a keyed provider in SOLANA_RPC_URL replaces it, as for account reads.
const DEFAULT_RPC = "https://solana-rpc.publicnode.com";
async function rpcUrl(): Promise<string> {
  try {
    const { env } = (await import("cloudflare:workers")) as unknown as { env: Record<string, unknown> };
    const v = env?.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL;
    if (typeof v === "string" && /^https:\/\//.test(v)) return v;
  } catch {
    if (typeof process !== "undefined" && /^https:\/\//.test(process.env.SOLANA_RPC_URL ?? "")) return process.env.SOLANA_RPC_URL!;
  }
  return DEFAULT_RPC;
}
let checked: { url: string; at: number } | null = null;
export async function solana() {
  const url = await rpcUrl();
  const rpc = createSolanaRpc(url);
  if (!checked || checked.url !== url || Date.now() - checked.at > 3_600_000) {
    if ((await rpc.getGenesisHash().send()) !== SOL.genesis) throw new Error("Solana RPC is not mainnet.");
    checked = { url, at: Date.now() };
  }
  return rpc;
}

export interface UsdcAccount {
  ata: string;
  exists: boolean;
  amountRaw: bigint;
}

/** The owner's associated USDC account at finalized commitment, verified field by field. No account = 0 USDC. */
export async function usdcAccount(owner: string): Promise<UsdcAccount> {
  const rpc = await solana();
  const ata = await usdcAta(owner);
  const r: any = await rpc.getAccountInfo(address(ata), { encoding: "jsonParsed", commitment: "finalized" }).send();
  if (!r.value) return { ata, exists: false, amountRaw: 0n };
  if (String(r.value.owner) !== SOL.tokenProgram) throw new Error("That USDC account isn't owned by the Token program.");
  const info = r.value.data?.parsed?.info;
  if (info?.mint !== SOL.usdcMint) throw new Error("That token account isn't USDC.");
  if (info?.owner !== owner) throw new Error("That USDC account belongs to someone else.");
  if (info?.tokenAmount?.decimals !== 6 || !/^\d+$/.test(String(info?.tokenAmount?.amount))) throw new Error("USDC account unverified.");
  if (info?.state !== "initialized") throw new Error(info?.state === "frozen" ? "Your USDC account is frozen; it can't send." : "USDC account isn't initialized.");
  return { ata, exists: true, amountRaw: BigInt(info.tokenAmount.amount) };
}

export async function solanaUsdcBalance(owner: string): Promise<bigint> {
  return (await usdcAccount(owner)).amountRaw;
}

/** Lamports one transfer may cost: fee bound, plus rent when the deposit address has no USDC account yet. */
export async function solFeeNeed(createDepositAta: boolean): Promise<bigint> {
  if (!createDepositAta) return SOL.feeBound;
  const rent = await (await solana()).getMinimumBalanceForRentExemption(165n).send().catch(() => SOL.tokenAccountRent);
  return SOL.feeBound + BigInt(rent);
}

export async function assertSolFee(owner: string, createDepositAta = true): Promise<void> {
  const need = await solFeeNeed(createDepositAta);
  const { value } = await (await solana()).getBalance(address(owner), { commitment: "finalized" }).send();
  if (BigInt(value) < need)
    throw new Error(`${owner} needs about ${(Number(need) / 1e9).toFixed(6)} SOL for the network fee${createDepositAta ? " and the deposit's USDC account" : ""} and holds ${(Number(value) / 1e9).toFixed(6)}. Nothing was prepared.`);
}

async function depositHasUsdcAccount(deposit: string) {
  const r: any = await (await solana()).getAccountInfo(address(await usdcAta(deposit)), { encoding: "jsonParsed", commitment: "confirmed" }).send();
  if (!r.value) return false;
  if (r.value.data?.parsed?.info?.mint !== SOL.usdcMint) throw new Error("The deposit address's token account isn't USDC.");
  return true;
}

type SolanaTx = Extract<LegTransaction, { kind: "solana" }>;

/** Builds the exact transfer for a live quote: source verified and funded, fee covered, fresh blockhash. */
export async function solanaLegTransaction(from: string, q: LegQuote): Promise<SolanaTx> {
  if (!q.depositAddress) throw new Error("The quote has no deposit address.");
  const amount = BigInt(q.amountInRaw);
  const src = await usdcAccount(from);
  if (!src.exists || src.amountRaw < amount) throw new Error(`${from} holds ${(Number(src.amountRaw) / 1e6).toFixed(2)} USDC in its USDC account; this needs ${(Number(amount) / 1e6).toFixed(2)}.`);
  const createDepositAta = !(await depositHasUsdcAccount(q.depositAddress));
  await assertSolFee(from, createDepositAta);
  return withBlockhash({
    kind: "solana", from, mint: SOL.usdcMint, depositAddress: q.depositAddress, amountRaw: q.amountInRaw, memo: q.depositMemo, createRecipientAta: createDepositAta,
    sourceAta: src.ata, transactionBase64: "", blockhash: "", lastValidBlockHeight: "0",
  });
}

/** A blockhash lives ~60–90 s, so every wallet handoff gets a fresh one (same transfer, new lifetime). */
export async function withBlockhash(tx: SolanaTx): Promise<SolanaTx> {
  const { value } = await (await solana()).getLatestBlockhash({ commitment: "confirmed" }).send();
  const next = { ...tx, blockhash: String(value.blockhash), lastValidBlockHeight: String(value.lastValidBlockHeight) };
  const wire = await usdcTransferTransaction({ from: next.from, depositAddress: next.depositAddress, amountRaw: next.amountRaw, memo: next.memo, createDepositAta: next.createRecipientAta, blockhash: next.blockhash, lastValidBlockHeight: next.lastValidBlockHeight });
  return { ...next, transactionBase64: toBase64(wire) };
}

/** Finalized outcome of a sent transfer; null while not found or not finalized. */
export async function solanaTxOutcome(sig: string): Promise<{ failed: boolean; final: boolean; feeRaw: string | null } | null> {
  const rpc = await solana();
  const { value } = await rpc.getSignatureStatuses([signature(sig)], { searchTransactionHistory: true }).send();
  const st = value[0];
  if (!st) return null;
  if (st.err) return { failed: true, final: st.confirmationStatus === "finalized", feeRaw: null };
  if (st.confirmationStatus !== "finalized") return null;
  const tx: any = await rpc.getTransaction(signature(sig), { commitment: "finalized", maxSupportedTransactionVersion: 0, encoding: "json" }).send();
  if (!tx?.meta) return null;
  return { failed: !!tx.meta.err, final: true, feeRaw: String(tx.meta.fee) };
}

/** True once the network is past the transaction's last valid block height: an unsent transfer can't land any more. */
export async function blockhashExpired(lastValidBlockHeight: string): Promise<boolean> {
  // getEpochInfo's blockHeight, not getBlockHeight: some public endpoints return the slot from getBlockHeight
  // (seen on publicnode, 13 Nov 2026), which would call every transfer expired.
  const { blockHeight } = await (await solana()).getEpochInfo({ commitment: "confirmed" }).send();
  return expiredAt(BigInt(blockHeight), BigInt(lastValidBlockHeight));
}
