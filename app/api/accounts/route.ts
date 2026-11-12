// Accounts (owner: Interface). An account enters only when its own wallet signs a one-time challenge that this
// server verifies (NEP-413 for NEAR, Sign-In with Ethereum, Sign-In with Solana). There is no way to add an
// address by typing it, and a browser can't simply report a connection. Rename and forget. Nothing here signs
// a transaction or moves funds.
import { z } from "zod";
import { session, save, mutation, json, failure, bindAccount, unbindAccount } from "@/lib/flowvault/store";
import { applyAccountAction, type AccountAction } from "@/lib/flowvault/account-registry";
import { makeChallenge, verifyEvm, verifySolana, verifyNear, assertLive, b64, base58Decode } from "@/lib/flowvault/account-proof";
import { saveChallenge, takeChallenge, nearKeyPermission } from "@/lib/flowvault/account-proof-store";
import type { Workspace } from "@/lib/flowvault/types";

const chain = z.enum(["near", "evm", "solana"]);
const id = z.string().min(3).max(120);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("challenge"), chain, address: z.string().min(2).max(80) }).strict(),
  z
    .object({
      action: z.literal("prove"),
      challengeId: z.string().regex(/^[0-9a-f]{32}$/),
      /** EVM: 0x hex (65 bytes). Solana: base64 or base58 (64 bytes). NEAR: base64 (64 bytes). */
      signature: z.string().min(10).max(400),
      /** NEAR only: the signing key ("ed25519:…") and the account the wallet signed for. */
      publicKey: z.string().max(120).optional(),
      accountId: z.string().max(80).optional(),
    })
    .strict(),
  z.object({ action: z.literal("rename"), id, label: z.string().min(1).max(60) }).strict(),
  z.object({ action: z.literal("forget"), id }).strict(),
  /** Sign this browser out of its NEAR account. The account's calendar and history stay saved with it. */
  z.object({ action: z.literal("sign-out") }).strict(),
]);

function view(w: Workspace, revision: number, message = "", signedIn: string | null = null) {
  const fictional = w.mode === "demo" || !!w.fictional;
  return { fictional, accounts: fictional ? [] : (w.accounts ?? []), revision, message, signedIn };
}

export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(view(s.workspace, s.revision, "", s.account), s.cookie);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(r: Request) {
  try {
    mutation(r);
    const b = body.parse(await r.json());
    const s = await session(r);
    if (s.workspace.mode === "demo" || s.workspace.fictional) throw new Error("The example workspace’s accounts are fictional and can’t be changed.");
    if (b.action === "sign-out") {
      await unbindAccount(s.sessionId);
      const out = await session(r);
      return json(view(out.workspace, out.revision, "Signed out. Your calendar stays saved with " + (s.account ?? "your account") + ".", out.account), out.cookie);
    }
    if (b.action === "challenge") {
      const origin = r.headers.get("origin") ?? new URL(r.url).origin;
      const c = makeChallenge(b.chain, b.address, origin);
      await saveChallenge(s.id, c);
      return json({ challengeId: c.id, message: c.message, nonce: c.nonce, recipient: c.recipient, expiresAt: c.expiresAt }, s.cookie);
    }
    let act: AccountAction;
    if (b.action === "prove") {
      const c = await takeChallenge(s.id, b.challengeId);
      assertLive(c);
      const proof =
        c.chain === "evm"
          ? verifyEvm(c, b.signature)
          : c.chain === "solana"
            ? verifySolana(c, /^[A-Za-z0-9+/]+=*$/.test(b.signature) && b.signature.length % 4 === 0 && b64.decode(b.signature).length === 64 ? b64.decode(b.signature) : base58Decode(b.signature))
            : await verifyNear(c, { accountId: b.accountId ?? "", publicKey: b.publicKey ?? "", signature: b.signature }, nearKeyPermission);
      act = { action: "proven", chain: c.chain, address: c.address, method: proof.method };
    } else act = b;
    // Proving a different NEAR account while signed in switches accounts: that account's own workspace
    // records the proof; the current account's workspace is left as it is.
    if (act.action === "proven" && act.chain === "near" && s.account && s.account !== act.address) {
      const proof = act;
      await bindAccount(s, act.address, (w) => {
        applyAccountAction(w, proof);
      });
      const out = await session(r);
      return json(view(out.workspace, out.revision, "Signed in as " + act.address + ".", out.account), out.cookie);
    }
    const { counted, message } = applyAccountAction(s.workspace, act);
    if (counted) {
      // Same rule as every other account change: what counts moved, so unexecuted drafts no longer hold.
      s.workspace.mandate.version++;
      s.workspace.operations = s.workspace.operations.map((o) => (o.state === "draft" ? { ...o, state: "superseded" } : o));
    }
    const revision = await save(s.id, s.workspace, s.revision);
    // A verified NEAR proof signs this browser in to that account: from now on its calendar, policy and plans
    // are the account's own, wherever it signs in.
    if (act.action === "proven" && act.chain === "near") {
      const proof = act;
      await bindAccount({ ...s, revision }, act.address, (w) => {
        applyAccountAction(w, proof);
      });
      const out = await session(r);
      return json(view(out.workspace, out.revision, message, out.account), out.cookie);
    }
    return json(view(s.workspace, revision, message, s.account), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
