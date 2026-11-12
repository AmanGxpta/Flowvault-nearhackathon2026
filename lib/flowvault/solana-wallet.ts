"use client";
// Solana wallet signing for funding legs (owner: Stream A). Implemented in slice 2; until then no Solana leg
// can be prepared (capabilities.ts LEG_NETWORKS), so this is never reached.
import type { WalletSession } from "./wallets";
export async function sendSolanaLeg(session: WalletSession, tx: unknown): Promise<string> {
  void session;
  void tx;
  throw new Error("Solana transfers aren't enabled yet. Nothing was sent.");
}
