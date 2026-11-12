import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  makeChallenge,
  verifyEvm,
  verifySolana,
  verifyNear,
  nep413Hash,
  checksumAddress,
  base58Encode,
  base58Decode,
  assertLive,
  b64,
  _test,
} from "../lib/flowvault/account-proof.ts";

const ORIGIN = "http://localhost:5173";
const NOW = Date.parse("2026-11-12T10:00:00Z");
const enc = new TextEncoder();
const fixed = (n: number) => new Uint8Array(n).fill(7);

function evmWallet() {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  const address = "0x" + _test.bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  const personalSign = (message: string) => {
    const msg = enc.encode(message);
    const digest = keccak_256(new Uint8Array([...enc.encode("\x19Ethereum Signed Message:\n" + msg.length), ...msg]));
    const s = secp256k1.sign(digest, priv);
    return "0x" + _test.bytesToHex(s.toCompactRawBytes()) + (27 + s.recovery).toString(16);
  };
  return { address, personalSign };
}

test("checksum and base58 helpers", () => {
  assert.equal(checksumAddress("0x32e54827dca55754ea9cc1cc8455b2b6a7be004a"), "0x32E54827dca55754ea9Cc1Cc8455B2b6A7BE004A");
  const b = Uint8Array.from([0, 0, 1, 2, 255]);
  assert.deepEqual(base58Decode(base58Encode(b)), b);
});

test("SIWE: the message is EIP-4361 shaped; only the challenged address's signature passes", () => {
  const w = evmWallet();
  const c = makeChallenge("evm", w.address, ORIGIN, NOW, fixed);
  assert.match(c.message, /^localhost:5173 wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n\n/);
  assert.match(c.message, /\nURI: http:\/\/localhost:5173\nVersion: 1\nChain ID: 1\nNonce: [0-9a-f]{32}\nIssued At: 2026-11-12T10:00:00.000Z\nExpiration Time: 2026-11-12T10:10:00.000Z$/);
  assert.equal(verifyEvm(c, w.personalSign(c.message)).method, "siwe");
  const other = evmWallet();
  assert.throws(() => verifyEvm(c, other.personalSign(c.message)), /different account/);
  assert.throws(() => verifyEvm(c, w.personalSign(c.message + " ")), /different account/);
  assert.throws(() => verifyEvm(c, "0x1234"), /Smart-contract wallets/);
});

test("SIWS: ed25519 over the message with the address as the key", () => {
  const priv = ed25519.utils.randomPrivateKey();
  const address = base58Encode(ed25519.getPublicKey(priv));
  const c = makeChallenge("solana", address, ORIGIN, NOW, fixed);
  assert.match(c.message, /wants you to sign in with your Solana account:\n/);
  assert.equal(verifySolana(c, ed25519.sign(enc.encode(c.message), priv)).method, "siws");
  const wrong = ed25519.utils.randomPrivateKey();
  assert.throws(() => verifySolana(c, ed25519.sign(enc.encode(c.message), wrong)), /doesn’t match/);
});

test("NEP-413: borsh payload, ed25519, and only a full-access key of the account", async () => {
  const priv = ed25519.utils.randomPrivateKey();
  const publicKey = "ed25519:" + base58Encode(ed25519.getPublicKey(priv));
  const c = makeChallenge("near", "datamastr3.near", ORIGIN, NOW, fixed);
  assert.equal(c.recipient, "localhost:5173");
  assert.equal(b64.decode(c.nonce).length, 32);
  const signature = b64.encode(ed25519.sign(nep413Hash(c.message, b64.decode(c.nonce), c.recipient), priv));
  const full = async () => "FullAccess" as const;
  assert.equal((await verifyNear(c, { accountId: "datamastr3.near", publicKey, signature }, full)).method, "nep413");
  await assert.rejects(verifyNear(c, { accountId: "other.near", publicKey, signature }, full), /different account/);
  await assert.rejects(verifyNear(c, { accountId: "datamastr3.near", publicKey, signature }, async () => "FunctionCall"), /full-access/);
  await assert.rejects(verifyNear(c, { accountId: "datamastr3.near", publicKey, signature }, async () => null), /doesn’t belong/);
  const forged = b64.encode(ed25519.sign(nep413Hash("something else", b64.decode(c.nonce), c.recipient), priv));
  await assert.rejects(verifyNear(c, { accountId: "datamastr3.near", publicKey, signature: forged }, full), /doesn’t match/);
});

test("NEP-413 hash matches the reference layout (tag 2^31+413, little-endian lengths, None callback)", () => {
  const h = nep413Hash("hi", new Uint8Array(32), "app");
  const expected = new Uint8Array([0x9d, 0x01, 0x00, 0x80, 2, 0, 0, 0, 0x68, 0x69, ...new Uint8Array(32), 3, 0, 0, 0, 0x61, 0x70, 0x70, 0]);
  return crypto.subtle.digest("SHA-256", expected).then((d) => assert.deepEqual(h, new Uint8Array(d)));
});

test("challenges expire after ten minutes", () => {
  const c = makeChallenge("near", "a.near", ORIGIN, NOW, fixed);
  assertLive(c, NOW + 9 * 60_000);
  assert.throws(() => assertLive(c, NOW + 11 * 60_000), /expired/);
});
