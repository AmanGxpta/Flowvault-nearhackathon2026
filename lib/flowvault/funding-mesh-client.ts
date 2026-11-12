"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- route JSON and wallet errors */
// Funding mesh, browser side (owner: Stream A). Hands one prepared leg to the wallet that controls its source:
// MetaMask/Rabby/… for Ethereum, Base and Arbitrum (EIP-1193), Phantom/Solflare/… for Solana (Wallet Standard).
// The server's leg journal is told before (handoff, single-use) and after (attach / declined / uncertain).
import { sendUsdcTransfer, type WalletSession } from "./wallets";

type Api = (path: string, body?: unknown, method?: string, scope?: "personal" | "example") => Promise<any>;
export interface LegPreparation {
  kind: "fund_transfer";
  attemptId: string;
  signer: string;
  network: "ethereum" | "base" | "arbitrum" | "solana";
  from: string;
  depositAddress: string;
  amountRaw: string;
}
const short = (a: string) => (a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);
const NAME = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", solana: "Solana" } as const;
const rejected = (e: any) => e?.code === 4001 || /reject|denied|declin|cancel/i.test(String(e?.message ?? e));

/** The live session that can sign for the leg's source, or a clear instruction to connect it. */
export function legSession(p: LegPreparation, sessions: WalletSession[]) {
  const chain = p.network === "solana" ? "solana" : "evm";
  const s = sessions.find((x) => x.chain === chain && (chain === "evm" ? x.address.toLowerCase() === p.from.toLowerCase() : x.address === p.from));
  if (!s) throw new Error(`Connect ${short(p.from)} (${NAME[p.network]}) in its wallet first: wallet menu → Connect another wallet. Nothing was sent.`);
  return s;
}

export async function signFundingLeg(p: LegPreparation, sessions: WalletSession[], api: Api): Promise<string> {
  const session = legSession(p, sessions);
  const h = await api("/api/funding/legs", { action: "handoff", id: p.attemptId }, "POST", "personal");
  let hash: string;
  try {
    if (p.network === "solana") hash = await (await import("./solana-wallet")).sendSolanaLeg(session, h.tx);
    else hash = await sendUsdcTransfer(session, h.tx, h.depositAddress, h.amountRaw);
  } catch (e) {
    if (rejected(e)) {
      await api("/api/funding/legs", { action: "declined", id: p.attemptId }, "POST", "personal").catch(() => undefined);
      throw new Error("You declined in " + session.walletName + ". Nothing was sent.");
    }
    await api("/api/funding/legs", { action: "uncertain", id: p.attemptId }, "POST", "personal").catch(() => undefined);
    throw e;
  }
  await api("/api/funding/legs", { action: "attach", id: p.attemptId, txHash: hash }, "POST", "personal");
  return hash;
}
