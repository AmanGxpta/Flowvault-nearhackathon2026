/* eslint-disable @typescript-eslint/no-explicit-any -- wallet capability JSON and ERC-4337 user operations */
// EVM network fees paid in USDC through Circle Paymaster (owner: Stream A). Pure: no network or wallet access.
//
// Verified 13 Nov 2026 from developers.circle.com/paymaster (+ /addresses-and-events, /pay-gas-fees-usdc):
//   permissionless on-chain contract, no Circle account or API key; USDC only; 10% surcharge on gas;
//   Paymaster v0.7 (EntryPoint v0.7): Arbitrum, Base — 0x6C973eBe80dCD8660841D4356bf15c32460271C9
//   Paymaster v0.8 (EntryPoint v0.8): Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain —
//     0x0578cFB241215b77442a541325d6A4E6dFE700Ec
//   EOAs work through EIP-7702; paymasterData = encodePacked(uint8 0, address usdc, uint256 permitAmount, bytes permitSig)
//   with an EIP-2612 USDC permit to the paymaster whose deadline must be max uint256 (the paymaster can't read
//   block.timestamp under ERC-4337 rules); paymasterVerificationGasLimit 200000, paymasterPostOpGasLimit 35000.
//
// How FlowVault uses it: a browser wallet never hands a site a raw EIP-7702 authorization, so FlowVault can't
// build and bundle the user operation itself. Instead the wallet's own EIP-5792 `wallet_sendCalls` builds it,
// with an ERC-7677 `paymasterService` pointing at FlowVault's paymaster endpoint, which returns Circle's
// paymaster and the owner-signed, bounded permit — only for the exact reviewed call. The bundler is the wallet's.
// USDC gas is offered ONLY when the wallet reports `paymasterService` + atomic batching for that chain, and the
// endpoint answers only for an EntryPoint Circle supports on that chain; every other wallet pays gas in ETH.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

export type GasNetwork = "ethereum" | "base" | "arbitrum";
export const CHAIN_ID: Record<GasNetwork, number> = { ethereum: 1, base: 8453, arbitrum: 42161 };
export const USDC: Record<GasNetwork, string> = {
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  arbitrum: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
};
export const ENTRYPOINT = { "0.7": "0x0000000071727de22e5e9d8baf0edac6f37da032", "0.8": "0x4337084d9e255ff0702461cf8895ce9e3b5ff108" } as const;
export interface CirclePaymaster {
  version: "0.7" | "0.8";
  entryPoint: string;
  paymaster: string;
}
const V07: CirclePaymaster = { version: "0.7", entryPoint: ENTRYPOINT["0.7"], paymaster: "0x6c973ebe80dcd8660841d4356bf15c32460271c9" };
const V08: CirclePaymaster = { version: "0.8", entryPoint: ENTRYPOINT["0.8"], paymaster: "0x0578cfb241215b77442a541325d6a4e6dfe700ec" };
/** Circle Paymaster deployments for the networks FlowVault reads (Avalanche/Optimism/Polygon/Unichain aren't read). */
export const CIRCLE: Record<GasNetwork, CirclePaymaster[]> = { ethereum: [V08], base: [V08, V07], arbitrum: [V08, V07] };
export const CIRCLE_MARKUP_BPS = 1000n;
export const PAYMASTER_VERIFICATION_GAS = 200_000n;
export const PAYMASTER_POSTOP_GAS = 35_000n;
/** Whole user operation bound: account validation + paymaster validation/postOp + the transfer + pre-verification. */
export const USEROP_GAS_BOUND = 500_000n;
/** The permit never lets the paymaster take more than this, whatever the gas market does. */
export const MAX_PERMIT_RAW = 5_000000n;
export const MIN_PERMIT_RAW = 250000n;
export const MAX_UINT256 = (1n << 256n) - 1n;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("Invalid hex.");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
};
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const addrWord = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/* ───────────── capability detection ───────────── */

/** Is USDC gas available for this wallet on this chain? `caps` = wallet_getCapabilities(address)[chainIdHex]. */
export function usdcGasSupport(network: string, caps: any): { supported: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!(network in CIRCLE)) reasons.push("CHAIN_NOT_SUPPORTED: Circle Paymaster isn't deployed on this network");
  if (!caps || typeof caps !== "object") reasons.push("WALLET_NO_CAPABILITIES: the wallet doesn't report EIP-5792 capabilities");
  else {
    if (caps.paymasterService?.supported !== true) reasons.push("WALLET_NO_PAYMASTER_SERVICE: the wallet can't use a paymaster from this site");
    const atomic = caps.atomic?.status ?? (caps.atomicBatch?.supported ? "supported" : undefined);
    if (atomic !== "supported" && atomic !== "ready") reasons.push("WALLET_NOT_SMART: the wallet can't run this as a smart-account operation");
  }
  return { supported: reasons.length === 0, reasons };
}

/* ───────────── quote: principal / gas / markup ───────────── */

export interface UsdcGasQuote {
  network: GasNetwork;
  principalRaw: string;
  /** Gas in the native asset at the bound, and its USDC value at the oracle's upper price. */
  gasWei: string;
  gasUsdcRaw: string;
  /** Circle's 10% surcharge on the gas. */
  markupUsdcRaw: string;
  totalFeeUsdcRaw: string;
  /** The most the permit allows the paymaster to take (bounded; actual charge is reconciled from the receipt). */
  maxChargeUsdcRaw: string;
  gasPriceWei: string;
  basis: string;
}

/** `usdcPerEthRaw` = USDC (6 dp) for 1 ETH at the oracle's upper bound. Returns null when the bound exceeds the cap. */
export function usdcGasQuote(i: { network: GasNetwork; principalRaw: bigint; gasPriceWei: bigint; usdcPerEthRaw: bigint; gasUnits?: bigint }): UsdcGasQuote | null {
  if (i.gasPriceWei <= 0n || i.usdcPerEthRaw <= 0n) throw new Error("Gas price or ETH price unavailable.");
  const units = i.gasUnits ?? USEROP_GAS_BOUND;
  const wei = units * i.gasPriceWei;
  const gas = ceilDiv(wei * i.usdcPerEthRaw, 10n ** 18n);
  const markup = ceilDiv(gas * CIRCLE_MARKUP_BPS, 10_000n);
  const total = gas + markup;
  // 3× headroom for fee movement between quote and inclusion, at least 0.25 USDC, never above 5 USDC.
  const cap = total * 3n < MIN_PERMIT_RAW ? MIN_PERMIT_RAW : total * 3n;
  if (cap > MAX_PERMIT_RAW) return null;
  return {
    network: i.network, principalRaw: i.principalRaw.toString(), gasWei: wei.toString(), gasUsdcRaw: gas.toString(), markupUsdcRaw: markup.toString(),
    totalFeeUsdcRaw: total.toString(), maxChargeUsdcRaw: cap.toString(), gasPriceWei: i.gasPriceWei.toString(),
    basis: `${units} gas × ${i.gasPriceWei} wei at the ETH oracle upper price, + Circle's 10%`,
  };
}

/* ───────────── bounded permit (EIP-2612) ───────────── */

export interface PermitFields {
  network: GasNetwork;
  tokenName: string;
  tokenVersion: string;
  owner: string;
  spender: string;
  valueRaw: string;
  nonce: string;
}

/** eth_signTypedData_v4 payload. Deadline is max uint256 because Circle's paymaster can't read the clock. */
export function permitTypedData(p: PermitFields) {
  return {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
    },
    primaryType: "Permit" as const,
    domain: { name: p.tokenName, version: p.tokenVersion, chainId: CHAIN_ID[p.network], verifyingContract: USDC[p.network] },
    message: { owner: p.owner.toLowerCase(), spender: p.spender, value: p.valueRaw, nonce: p.nonce, deadline: MAX_UINT256.toString() },
  };
}

const k = (s: string) => keccak_256(new TextEncoder().encode(s));
export function permitDigest(p: PermitFields): Uint8Array {
  const domainType = k("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
  const permitType = k("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
  const domain = keccak_256(unhex(hex(domainType) + hex(k(p.tokenName)) + hex(k(p.tokenVersion)) + word(BigInt(CHAIN_ID[p.network])) + addrWord(USDC[p.network])));
  const struct = keccak_256(unhex(hex(permitType) + addrWord(p.owner) + addrWord(p.spender) + word(BigInt(p.valueRaw)) + word(BigInt(p.nonce)) + word(MAX_UINT256)));
  return keccak_256(unhex("1901" + hex(domain) + hex(struct)));
}

/** The address that signed a permit (65-byte r‖s‖v). */
export function permitSigner(p: PermitFields, signature: string): string {
  const sig = unhex(signature);
  if (sig.length !== 65) throw new Error("Invalid permit signature length.");
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error("Invalid signature recovery id.");
  const s = BigInt("0x" + hex(sig.slice(32, 64)));
  if (s > secp256k1.CURVE.n / 2n) throw new Error("Non-canonical signature (high s).");
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(permitDigest(p)).toRawBytes(false);
  return "0x" + hex(keccak_256(pub.slice(1)).slice(-20));
}

/** Circle's paymasterData: encodePacked(uint8 0, address usdc, uint256 permitAmount, bytes permitSignature). */
export function paymasterData(network: GasNetwork, permitRaw: string, signature: string): string {
  const sig = unhex(signature);
  if (sig.length !== 65) throw new Error("Invalid permit signature length.");
  return "0x00" + USDC[network].slice(2).toLowerCase() + word(BigInt(permitRaw)) + hex(sig);
}

/* ───────────── allowlisted call: exactly the reviewed USDC transfer ───────────── */

export interface Call {
  target: string;
  value: bigint;
  data: string;
}
const readWord = (b: Uint8Array, at: number) => {
  if (at + 32 > b.length) throw new Error("Truncated call data.");
  return BigInt("0x" + hex(b.slice(at, at + 32)));
};
const readBytes = (b: Uint8Array, at: number) => {
  const len = Number(readWord(b, at));
  if (at + 32 + len > b.length) throw new Error("Truncated call data.");
  return b.slice(at + 32, at + 32 + len);
};
const addrAt = (b: Uint8Array, at: number) => "0x" + hex(b.slice(at + 12, at + 32));
function decodeCallArray(args: Uint8Array, base: number): Call[] {
  const n = Number(readWord(args, base));
  if (n > 16) throw new Error("Too many calls.");
  const out: Call[] = [];
  for (let i = 0; i < n; i++) {
    const t = base + 32 + Number(readWord(args, base + 32 + i * 32));
    out.push({ target: addrAt(args, t), value: readWord(args, t + 32), data: "0x" + hex(readBytes(args, t + Number(readWord(args, t + 64)))) });
  }
  return out;
}

/**
 * The calls inside a smart-account callData, for the account shapes 7702 wallets use: execute(address,uint256,bytes)
 * and executeBatch((address,uint256,bytes)[]) (Simple7702Account and most accounts), and ERC-7579
 * execute(bytes32,bytes) single/batch. Anything else is unknown and refused.
 */
export function decodeAccountCalls(callData: string): Call[] {
  const b = unhex(callData);
  const sel = hex(b.slice(0, 4));
  const a = b.slice(4);
  if (sel === "b61d27f6") return [{ target: addrAt(a, 0), value: readWord(a, 32), data: "0x" + hex(readBytes(a, Number(readWord(a, 64)))) }];
  if (sel === "34fcd5be") return decodeCallArray(a, Number(readWord(a, 0)));
  if (sel === "e9ae5c53") {
    const mode = a.slice(0, 32);
    if (mode[1] !== 0) throw new Error("Unsupported ERC-7579 exec type.");
    const exec = readBytes(a, Number(readWord(a, 32)));
    if (mode[0] === 0x00) return [{ target: "0x" + hex(exec.slice(0, 20)), value: BigInt("0x" + (hex(exec.slice(20, 52)) || "0")), data: "0x" + hex(exec.slice(52)) }];
    if (mode[0] === 0x01) return decodeCallArray(exec, Number(readWord(exec, 0)));
    throw new Error("Unsupported ERC-7579 call type.");
  }
  throw new Error("This wallet's smart-account call format isn't recognized.");
}

export const transferData = (to: string, amountRaw: string) => "0xa9059cbb" + addrWord(to) + word(BigInt(amountRaw));

/**
 * ERC-7677 request check before FlowVault returns paymaster data: right chain, an EntryPoint Circle supports there,
 * the owner as sender (a 7702 EOA, so the permit's owner pays), and exactly one call: the reviewed USDC transfer.
 */
export function checkSponsoredOp(i: { network: GasNetwork; owner: string; depositAddress: string; amountRaw: string; userOp: any; entryPoint: string; chainId: string | number }): CirclePaymaster {
  if (Number(i.chainId) !== CHAIN_ID[i.network]) throw new Error("Wrong chain for this operation.");
  const pm = CIRCLE[i.network].find((p) => p.entryPoint === String(i.entryPoint).toLowerCase());
  if (!pm) throw new Error("Circle Paymaster doesn't support this wallet's EntryPoint on this chain.");
  if (String(i.userOp?.sender ?? "").toLowerCase() !== i.owner.toLowerCase()) throw new Error("The operation's account isn't the address that signed the permit.");
  const calls = decodeAccountCalls(String(i.userOp?.callData ?? ""));
  const want = transferData(i.depositAddress, i.amountRaw);
  if (calls.length !== 1 || calls[0].target.toLowerCase() !== USDC[i.network] || calls[0].value !== 0n || calls[0].data.toLowerCase() !== want)
    throw new Error("The operation isn't exactly the reviewed USDC transfer.");
  return pm;
}

/* ───────────── reconciliation from the receipt ───────────── */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topicAddr = (t: string) => "0x" + t.slice(-40).toLowerCase();

/**
 * USDC actually charged for gas = USDC the owner sent to the paymaster minus refunds back, and whether the principal
 * transfer to the deposit address happened exactly. From the bundle transaction's finalized receipt logs only.
 */
export function reconcileReceipt(i: { network: GasNetwork; owner: string; paymaster: string; depositAddress: string; amountRaw: string; logs: { address: string; topics: string[]; data: string }[] }) {
  const owner = i.owner.toLowerCase(), pm = i.paymaster.toLowerCase(), dep = i.depositAddress.toLowerCase();
  let charged = 0n, principal = 0n;
  for (const l of i.logs) {
    if (l.address.toLowerCase() !== USDC[i.network] || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || l.topics.length !== 3) continue;
    const from = topicAddr(l.topics[1]), to = topicAddr(l.topics[2]), v = BigInt(l.data);
    if (from === owner && to === pm) charged += v;
    if (from === pm && to === owner) charged -= v;
    if (from === owner && to === dep) principal += v;
  }
  return { chargedUsdcRaw: charged < 0n ? 0n : charged, principalRaw: principal, principalExact: principal === BigInt(i.amountRaw) };
}
