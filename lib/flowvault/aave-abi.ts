// Small, strict ABI boundary for fixed-width Aave v3 calls. No floating point amounts.
import { keccak_256 } from "@noble/hashes/sha3";
export const hashText = (s: string) => Array.from(keccak_256(new TextEncoder().encode(s)), b => b.toString(16).padStart(2, "0")).join("");
export function word(v: bigint | string) {
  const h = typeof v === "bigint" ? v.toString(16) : v.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h) || h.length > 64) throw new Error("Invalid ABI word.");
  return h.padStart(64, "0");
}
export const calldata = (signature: string, ...args: (bigint | string)[]) => "0x" + hashText(signature).slice(0, 8) + args.map(word).join("");
export function words(v: unknown, min = 1): bigint[] {
  if (typeof v !== "string" || !/^0x(?:[0-9a-fA-F]{64})+$/.test(v) || (v.length - 2) / 64 < min) throw new Error("Malformed EVM ABI response.");
  return v.slice(2).match(/.{64}/g)!.map(x => BigInt("0x" + x));
}
export function address(v: bigint) {
  if (v <= 0n || v >= 1n << 160n) throw new Error("Unverified contract address.");
  return "0x" + v.toString(16).padStart(40, "0");
}
export const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
