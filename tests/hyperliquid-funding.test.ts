import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";
import { addressOf, bytesToHex, hlRefusal, readSpot, recoverTyped, signTyped, typedDigest, usdClassTransferAction, userTypedData } from "../lib/flowvault/hyperliquid.ts";

const enc = (s: string) => keccak_256(new TextEncoder().encode(s));
const uint = (n: bigint) => { const b = new Uint8Array(32); for (let i = 31; i >= 0 && n > 0n; i--) (b[i] = Number(n & 0xffn), (n >>= 8n)); return b; };
const cat = (...parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

test("spot → perps move is the documented UsdClassTransfer typed data, bool encoded as one word", () => {
  const action = usdClassTransferAction("10.40", true, 1794578240678, 1);
  assert.deepEqual(action, { type: "usdClassTransfer", hyperliquidChain: "Mainnet", signatureChainId: "0x1", amount: "10.4", toPerp: true, nonce: 1794578240678 });
  const t = userTypedData(action);
  assert.equal(t.primaryType, "HyperliquidTransaction:UsdClassTransfer");
  // Independent EIP-712 digest for the same message.
  const domain = keccak_256(cat(enc("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), enc("HyperliquidSignTransaction"), enc("1"), uint(1n), new Uint8Array(32)));
  const msg = keccak_256(cat(enc("HyperliquidTransaction:UsdClassTransfer(string hyperliquidChain,string amount,bool toPerp,uint64 nonce)"), enc("Mainnet"), enc("10.4"), uint(1n), uint(1794578240678n)));
  assert.equal(bytesToHex(typedDigest(t)), bytesToHex(keccak_256(cat(Uint8Array.of(0x19, 0x01), domain, msg))));
  const key = new Uint8Array(32).fill(7);
  assert.equal(recoverTyped(t, signTyped(t, key)), addressOf(key));
  assert.notEqual(bytesToHex(typedDigest(userTypedData({ ...action, toPerp: false }))), bytesToHex(typedDigest(t)));
});

test("spot balances and Hyperliquid refusals read in plain words", () => {
  assert.deepEqual(readSpot({ balances: [{ coin: "USDC", total: "10.123456", hold: "0" }, { coin: "HYPE", total: "0.0" }] }), { spotUsdcRaw: "10123456", spotHeld: true });
  assert.deepEqual(readSpot(null), { spotUsdcRaw: "0", spotHeld: false });
  assert.match(hlRefusal({ status: "err", response: "Must deposit before performing actions. User: 0x32e5" }), /hasn't seen a deposit from this wallet/);
  assert.match(hlRefusal({ status: "err", response: "Something else" }), /^Hyperliquid refused: Something else/);
});
