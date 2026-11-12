// Agent-key custody for Hyperliquid (owner: Stream C). The agent key is created on the server, encrypted with
// AES-GCM under a key derived (HKDF-SHA256) from the server setting FLOWVAULT_AGENT_KEY_SECRET, and stored only
// encrypted. Without that setting no agent can be created or used (fail closed). The key can trade on the
// approved master account but cannot withdraw or transfer (Hyperliquid enforces that); revoking deletes it here.
import { secp256k1 } from "@noble/curves/secp256k1";
import { addressOf } from "./hyperliquid.ts";

const enc = new TextEncoder();
const b64 = {
  encode: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

export const NO_SECRET = "Agent wallets are unavailable: the server has no FLOWVAULT_AGENT_KEY_SECRET setting (32+ characters). Nothing can trade on your behalf until the operator sets it.";

async function aesKey(secret: string, info: string) {
  if (!secret || secret.length < 32) throw new Error(NO_SECRET);
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("flowvault-agent-key-v1"), info: enc.encode(info) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A fresh agent key (never reused: Hyperliquid warns pruned nonce state allows replay on reused addresses). */
export async function newAgentKey(secret: string, bindingFor: (address: string) => string) {
  if (!secret || secret.length < 32) throw new Error(NO_SECRET);
  const priv = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const address = addressOf(priv);
  const binding = bindingFor(address);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(binding) }, await aesKey(secret, binding), priv));
  return { address, sealed: b64.encode(iv) + "." + b64.encode(sealed) };
}

/** `binding` (session + master + agent) is authenticated data: a sealed key moved to another row won't open. */
export async function openAgentKey(secret: string, binding: string, sealed: string, expectedAddress: string) {
  const [iv, data] = sealed.split(".");
  const priv = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.decode(iv), additionalData: enc.encode(binding) }, await aesKey(secret, binding), b64.decode(data)));
  if (addressOf(priv) !== expectedAddress.toLowerCase()) throw new Error("Agent key doesn't match its address.");
  return priv;
}
