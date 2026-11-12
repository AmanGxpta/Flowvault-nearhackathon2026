// Proof that an account is yours (owner: Interface, multi-wallet A3). The server issues a one-time challenge,
// your wallet signs it (free, no transaction, can't move funds), and the server verifies the signature itself:
//   EVM    EIP-4361 "Sign-In with Ethereum" message, personal_sign, secp256k1 recovery to the address
//   Solana "Sign-In with Solana" message, ed25519 over the message bytes with the address as public key
//   NEAR   NEP-413 signMessage (borsh payload, sha256, ed25519) + the key must be a FULL-ACCESS key of the account
// Pure functions here; the challenge store and RPC key check are injected so everything is tested offline.
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";
import { canonical, validAddress } from "./account-registry.ts";
import type { AccountChain } from "./types.ts";

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const enc = new TextEncoder();

/* ───────────── encodings ───────────── */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("Invalid base58.");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) + BigInt(x);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = "1" + out;
  }
  return out;
}
const hexToBytes = (h: string) => {
  const s = h.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error("Invalid hex.");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
};
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const b64 = {
  encode: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

/** EIP-55 checksum address (SIWE requires it in the message). */
export function checksumAddress(address: string) {
  const a = address.toLowerCase().replace(/^0x/, "");
  const h = bytesToHex(keccak_256(enc.encode(a)));
  return "0x" + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join("");
}

/* ───────────── challenges ───────────── */

export interface Challenge {
  id: string;
  chain: AccountChain;
  address: string;
  message: string;
  /** NEAR: the 32-byte NEP-413 nonce, base64. EVM/Solana: the nonce inside the message. */
  nonce: string;
  /** NEAR: NEP-413 recipient (the app's host). */
  recipient: string;
  issuedAt: string;
  expiresAt: string;
}

export function makeChallenge(chain: AccountChain, address: string, origin: string, now = Date.now(), random = (n: number) => crypto.getRandomValues(new Uint8Array(n))): Challenge {
  if (!validAddress(chain, address.trim())) throw new Error("That isn’t a valid " + (chain === "evm" ? "EVM" : chain === "near" ? "NEAR" : "Solana") + " address.");
  const url = new URL(origin);
  const host = url.host;
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  const nonceBytes = random(32);
  const nonce = chain === "near" ? b64.encode(nonceBytes) : bytesToHex(nonceBytes).slice(0, 32);
  const statement = "Prove this account is yours to FlowVault. Signing is free, sends no transaction and can't move funds.";
  const addr = chain === "evm" ? checksumAddress(address) : canonical(chain, address);
  const message =
    chain === "evm"
      ? `${host} wants you to sign in with your Ethereum account:\n${addr}\n\n${statement}\n\nURI: ${url.origin}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`
      : chain === "solana"
        ? `${host} wants you to sign in with your Solana account:\n${addr}\n\n${statement}\n\nURI: ${url.origin}\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`
        : `${statement}\n\nAccount: ${addr}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`;
  return { id: bytesToHex(random(16)), chain, address: canonical(chain, address), message, nonce, recipient: host, issuedAt, expiresAt };
}

/* ───────────── verification ───────────── */

/** EVM: personal_sign over the exact message; recovers the signer and compares it with the challenged address. */
export function verifyEvm(c: Challenge, signatureHex: string) {
  const sig = hexToBytes(signatureHex);
  if (sig.length !== 65) throw new Error("Unexpected signature length. Smart-contract wallets can't prove ownership this way yet.");
  const msg = enc.encode(c.message);
  const digest = keccak_256(new Uint8Array([...enc.encode("\x19Ethereum Signed Message:\n" + msg.length), ...msg]));
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error("Invalid signature recovery id.");
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(digest).toRawBytes(false);
  const recovered = "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  if (recovered !== c.address.toLowerCase()) throw new Error("The signature is from a different account.");
  return { method: "siwe" as const };
}

/** Solana: ed25519 over the exact message bytes; the address is the public key. */
export function verifySolana(c: Challenge, signature: Uint8Array) {
  const pub = base58Decode(c.address);
  if (pub.length !== 32) throw new Error("Invalid Solana address.");
  if (signature.length !== 64 || !ed25519.verify(signature, enc.encode(c.message), pub)) throw new Error("The signature doesn’t match this account.");
  return { method: "siws" as const };
}

/** NEP-413 payload: borsh(tag u32 = 2^31 + 413, message string, nonce [32], recipient string, callbackUrl Option<string>). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string | null) {
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes.");
  const parts: number[] = [];
  const u32 = (n: number) => parts.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const str = (s: string) => {
    const b = enc.encode(s);
    u32(b.length);
    parts.push(...b);
  };
  u32(2 ** 31 + 413);
  str(message);
  parts.push(...nonce);
  str(recipient);
  if (callbackUrl) {
    parts.push(1);
    str(callbackUrl);
  } else parts.push(0);
  return sha256(Uint8Array.from(parts));
}

/**
 * NEAR: the wallet's NEP-413 signature over the challenge, from a key that is a full-access key of the account
 * at a final block (a function-call key or a key from another account doesn't prove ownership).
 */
export async function verifyNear(
  c: Challenge,
  signed: { accountId: string; publicKey: string; signature: string; callbackUrl?: string | null },
  keyPermission: (accountId: string, publicKey: string) => Promise<"FullAccess" | "FunctionCall" | null>,
) {
  if (canonical("near", signed.accountId) !== c.address) throw new Error("The wallet signed for a different account.");
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(signed.publicKey)) throw new Error("Only ed25519 keys can prove a NEAR account.");
  const pub = base58Decode(signed.publicKey.slice(8));
  const sig = b64.decode(signed.signature);
  if (pub.length !== 32 || sig.length !== 64) throw new Error("Malformed NEAR signature.");
  const hash = nep413Hash(c.message, b64.decode(c.nonce), c.recipient, signed.callbackUrl);
  if (!ed25519.verify(sig, hash, pub)) throw new Error("The signature doesn’t match this message.");
  const permission = await keyPermission(c.address, signed.publicKey);
  if (permission !== "FullAccess") throw new Error(permission ? "That key can only call contracts; sign with the account’s full-access key." : "That key doesn’t belong to this account.");
  return { method: "nep413" as const };
}

export function assertLive(c: Challenge, now = Date.now()) {
  if (now > Date.parse(c.expiresAt)) throw new Error("This sign-in request expired. Try connecting again.");
}

export const _test = { hexToBytes, bytesToHex };
