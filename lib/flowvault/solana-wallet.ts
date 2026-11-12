"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- Wallet Standard objects are wallet-provided */
// Solana wallet signing (owner: Stream A). The server's prepared transfer is rebuilt here with @solana/kit from
// its plain fields; only if the bytes match exactly is it handed to the wallet (Phantom, Solflare, Backpack… via
// Wallet Standard `solana:signAndSendTransaction`). Returns the transaction signature (base58).
import { solanaWallet, type WalletSession } from "./wallets";
import { fromBase64, signatureText, toBase64, verifyPreparedTransfer, type PreparedSolanaTransfer } from "./solana-tx";

export type SolanaTransfer = PreparedSolanaTransfer;

export async function checkSolanaTransfer(session: Pick<WalletSession, "chain" | "address">, tx: SolanaTransfer, depositAddress: string, amountRaw: string) {
  if (session.chain !== "solana") throw new Error("Use the Solana wallet that holds the USDC.");
  return verifyPreparedTransfer(session.address, tx, depositAddress, amountRaw);
}

export async function sendSolanaTransfer(session: WalletSession, tx: SolanaTransfer, depositAddress: string, amountRaw: string): Promise<string> {
  const wire = await checkSolanaTransfer(session, tx, depositAddress, amountRaw);
  const wallet = solanaWallet(session.walletId);
  if (!wallet) throw new Error(session.walletName + " isn't available in this browser. Reconnect it from the wallet menu.");
  const send = wallet.features?.["solana:signAndSendTransaction"];
  if (!send) throw new Error(session.walletName + " can't send Solana transactions from this site. Use Phantom, Solflare or Backpack.");
  if (!wallet.accounts?.some((a: any) => a.address === session.address)) await wallet.features["standard:connect"].connect();
  const account = wallet.accounts?.find((a: any) => a.address === session.address);
  if (!account) throw new Error("Select " + session.address + " in " + session.walletName + ", then try again.");
  const [out] = await send.signAndSendTransaction({ account, chain: "solana:mainnet", transaction: fromBase64(toBase64(wire)), options: { preflightCommitment: "confirmed" } });
  if (!out?.signature) throw new Error(session.walletName + " didn't return a transaction signature.");
  return signatureText(new Uint8Array(out.signature));
}

/** Funding-mesh leg (plan step): the handoff returns the leg's transaction with a fresh blockhash. */
export async function sendSolanaLeg(session: WalletSession, tx: unknown): Promise<string> {
  const t = tx as SolanaTransfer;
  return sendSolanaTransfer(session, t, t.depositAddress, t.amountRaw);
}
