// Hyperliquid perpetuals (owner: Stream C). Pure: wire formats, signing payloads (verified against the official
// docs and the hyperliquid-python-sdk signing.py, 13 Nov 2026), snapshot parsing into USDC base units, perp
// checks under a mandate, protective deleveraging, hedge-leg failure handling and fill/funding reconciliation.
// Facts used (docs.hyperliquid.xyz): approveAgent is a master-signed EIP-712 "HyperliquidTransaction:ApproveAgent";
// an agent (API wallet) signs L1 actions only (orders, cancels, modify, leverage); withdraw3/usdSend/approveAgent
// are user-signed by the master; named agents may carry "valid_until <ms>" (≤180 days); agent addresses must not
// be reused (pruned nonce state allows replay); nonces are per signer, within (T−2d, T+1d), above the smallest of
// the 100 highest used. Withdrawals cost 1 USDC (docs, "at the time of writing") and take ~5 minutes. The legacy
// Arbitrum bridge (min 5 USDC; smaller deposits are lost) is documented as deprecated in favour of CCTP.
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { AgentMandate, LedgerEntry, MandateCheck } from "./contracts.ts";

export const HL_API = "https://api.hyperliquid.xyz";
export const HL_BRIDGE_ARBITRUM = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
export const HL_MIN_DEPOSIT_RAW = 5_000000n;
export const HL_WITHDRAW_FEE_RAW = 1_000000n;
export const HL_MAX_AGENT_DAYS = 180;
/** HyperCore spot USDC as NEAR Intents (1Click) lists it: funding a Hyperliquid account in-app delivers here. */
export const HL_INTENTS_USDC = "hypercore:0x6d1e7cde53ba9467b783cb7c530ce054";
const ZERO = "0x0000000000000000000000000000000000000000";

/* ───────────── decimals (strings ↔ bigint; never floats) ───────────── */

/** Decimal string → integer with `decimals` places. Extra digits are truncated toward zero (or rounded up). */
export function toRaw(v: string, decimals = 6, round: "down" | "up" = "down"): bigint {
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("Not a decimal: " + v);
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  let n = BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (round === "up" && /[1-9]/.test(f.slice(decimals))) n += 1n;
  return neg ? -n : n;
}
export function fromRaw(n: bigint, decimals: number): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const w = a / 10n ** BigInt(decimals);
  const f = decimals ? (a % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const out = w.toString() + (f ? "." + f : "");
  return neg && out !== "0" ? "-" + out : out;
}
/** Wire number: canonical decimal (no trailing zeros, no "-0"), as float_to_wire produces. */
export function wire(v: string) {
  return fromRaw(toRaw(v, 8), 8);
}

/** Perp price rule: ≤ 5 significant figures and ≤ (6 − szDecimals) decimals; integers always allowed. */
export function roundPx(px: string, szDecimals: number, dir: "down" | "up"): string {
  const maxDec = Math.max(0, 6 - szDecimals);
  let n = toRaw(px, maxDec, dir);
  if (n <= 0n) throw new Error("Price must be positive.");
  const whole = n / 10n ** BigInt(maxDec);
  if (whole < 100000n) {
    const digits = n.toString().length;
    const drop = Math.max(0, digits - 5);
    // never drop into the integer part: integer prices are always valid
    const keep = Math.min(drop, maxDec);
    const unit = 10n ** BigInt(keep);
    const r = n % unit;
    n -= r;
    if (dir === "up" && r > 0n) n += unit;
  } else n -= n % 10n ** BigInt(maxDec); // ≥ 100000: integer price
  return wire(fromRaw(n, maxDec));
}
export function roundSz(sz: string, szDecimals: number): string {
  const n = toRaw(sz, szDecimals, "down");
  if (n <= 0n) throw new Error("Size rounds to zero for this asset.");
  return wire(fromRaw(n, szDecimals));
}

/* ───────────── msgpack (subset msgpack-python emits for actions) ───────────── */

type Packable = null | boolean | number | bigint | string | Packable[] | { [k: string]: Packable };
export function msgpack(v: Packable): Uint8Array {
  const out: number[] = [];
  const be = (n: bigint, bytes: number) => {
    for (let i = bytes - 1; i >= 0; i--) out.push(Number((n >> BigInt(i * 8)) & 0xffn));
  };
  const enc = (x: Packable) => {
    if (x === null) out.push(0xc0);
    else if (x === true) out.push(0xc3);
    else if (x === false) out.push(0xc2);
    else if (typeof x === "number" || typeof x === "bigint") {
      if (typeof x === "number" && !Number.isInteger(x)) throw new Error("Floats are never packed; use decimal strings.");
      const n = BigInt(x);
      if (n >= 0n) {
        if (n < 128n) out.push(Number(n));
        else if (n < 256n) (out.push(0xcc), be(n, 1));
        else if (n < 65536n) (out.push(0xcd), be(n, 2));
        else if (n < 4294967296n) (out.push(0xce), be(n, 4));
        else (out.push(0xcf), be(n, 8));
      } else {
        if (n >= -32n) out.push(Number(n & 0xffn));
        else if (n >= -128n) (out.push(0xd0), be(n & 0xffn, 1));
        else if (n >= -32768n) (out.push(0xd1), be(n & 0xffffn, 2));
        else if (n >= -2147483648n) (out.push(0xd2), be(n & 0xffffffffn, 4));
        else (out.push(0xd3), be(n & 0xffffffffffffffffn, 8));
      }
    } else if (typeof x === "string") {
      const b = new TextEncoder().encode(x);
      const l = BigInt(b.length);
      if (b.length < 32) out.push(0xa0 | b.length);
      else if (b.length < 256) (out.push(0xd9), be(l, 1));
      else if (b.length < 65536) (out.push(0xda), be(l, 2));
      else (out.push(0xdb), be(l, 4));
      out.push(...b);
    } else if (Array.isArray(x)) {
      if (x.length < 16) out.push(0x90 | x.length);
      else if (x.length < 65536) (out.push(0xdc), be(BigInt(x.length), 2));
      else (out.push(0xdd), be(BigInt(x.length), 4));
      x.forEach(enc);
    } else {
      const keys = Object.keys(x).filter((k) => x[k] !== undefined);
      if (keys.length < 16) out.push(0x80 | keys.length);
      else (out.push(0xde), be(BigInt(keys.length), 2));
      for (const k of keys) {
        enc(k);
        enc(x[k]);
      }
    }
  };
  enc(v);
  return Uint8Array.from(out);
}

const hexToBytes = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((b) => parseInt(b, 16)));
export const bytesToHex = (b: Uint8Array) => "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** keccak(msgpack(action) ‖ nonce u64 BE ‖ vault flag[‖ address] [‖ 0x00 ‖ expiresAfter u64 BE]). */
export function actionHash(action: Packable, nonce: number, vaultAddress: string | null = null, expiresAfter: number | null = null) {
  const parts: number[] = [...msgpack(action)];
  const u64 = (n: number) => {
    const b = BigInt(n);
    for (let i = 7; i >= 0; i--) parts.push(Number((b >> BigInt(i * 8)) & 0xffn));
  };
  u64(nonce);
  if (vaultAddress) parts.push(1, ...hexToBytes(vaultAddress));
  else parts.push(0);
  if (expiresAfter !== null) (parts.push(0), u64(expiresAfter));
  return keccak_256(Uint8Array.from(parts));
}

/* ───────────── EIP-712 (string, address, uint64/uint256, bytes32) ───────────── */

export interface TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}
const DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];
function word(type: string, v: unknown): Uint8Array {
  const out = new Uint8Array(32);
  if (type === "string") return keccak_256(new TextEncoder().encode(String(v)));
  if (type === "bytes32") {
    const b = typeof v === "string" ? hexToBytes(v) : (v as Uint8Array);
    if (b.length !== 32) throw new Error("bytes32 must be 32 bytes.");
    return b;
  }
  if (type === "address") {
    const b = hexToBytes(String(v));
    if (b.length !== 20) throw new Error("Bad address.");
    out.set(b, 12);
    return out;
  }
  if (type === "bool") {
    out[31] = v === true ? 1 : 0;
    return out;
  }
  if (/^uint\d+$/.test(type)) {
    let n = BigInt(v as string | number);
    for (let i = 31; i >= 0 && n > 0n; i--) (out[i] = Number(n & 0xffn), (n >>= 8n));
    return out;
  }
  throw new Error("Unsupported EIP-712 type " + type);
}
function hashStruct(name: string, fields: { name: string; type: string }[], value: Record<string, unknown>) {
  const typeHash = keccak_256(new TextEncoder().encode(`${name}(${fields.map((f) => f.type + " " + f.name).join(",")})`));
  const parts = [typeHash, ...fields.map((f) => word(f.type, value[f.name]))];
  const buf = new Uint8Array(32 * parts.length);
  parts.forEach((p, i) => buf.set(p, i * 32));
  return keccak_256(buf);
}
export function typedDigest(t: TypedData) {
  const dom = hashStruct("EIP712Domain", DOMAIN_TYPE, t.domain as unknown as Record<string, unknown>);
  const msg = hashStruct(t.primaryType, t.types[t.primaryType], t.message);
  return keccak_256(Uint8Array.from([0x19, 0x01, ...dom, ...msg]));
}

/** What the agent key signs for an L1 action (order/cancel/modify/leverage). */
export function l1TypedData(action: Packable, nonce: number, mainnet = true, vault: string | null = null, expiresAfter: number | null = null): TypedData {
  return {
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: mainnet ? "a" : "b", connectionId: bytesToHex(actionHash(action, nonce, vault, expiresAfter)) },
  };
}

/** Master-signed actions. signatureChainId is the chain the wallet signs on (any; Hyperliquid replays on none). */
export function approveAgentAction(agentAddress: string, agentName: string, nonce: number, signatureChainId: number) {
  return { type: "approveAgent", hyperliquidChain: "Mainnet", signatureChainId: "0x" + signatureChainId.toString(16), agentAddress: agentAddress.toLowerCase(), agentName, nonce };
}
export function withdrawAction(destination: string, amount: string, time: number, signatureChainId: number) {
  return { type: "withdraw3", hyperliquidChain: "Mainnet", signatureChainId: "0x" + signatureChainId.toString(16), destination: destination.toLowerCase(), amount: wire(amount), time };
}
/** Moves USDC between the master's spot and perps balances on Hyperliquid (both are the owner's own). */
export function usdClassTransferAction(amount: string, toPerp: boolean, nonce: number, signatureChainId: number) {
  return { type: "usdClassTransfer", hyperliquidChain: "Mainnet", signatureChainId: "0x" + signatureChainId.toString(16), amount: wire(amount), toPerp, nonce };
}
/** Spot balances → USDC total in 6-decimal base units, and whether anything is held. */
export function readSpot(spot: unknown) {
  const balances = ((spot as { balances?: { coin?: string; total?: string }[] })?.balances ?? []).filter((b) => /^\d+(\.\d+)?$/.test(String(b.total ?? "")));
  const usdc = balances.find((b) => b.coin === "USDC");
  return { spotUsdcRaw: usdc ? toRaw(String(usdc.total), 6).toString() : "0", spotHeld: balances.some((b) => Number(b.total) > 0) };
}
/** Hyperliquid's refusals in words a person can act on; anything unrecognised is shown as Hyperliquid sent it. */
export function hlRefusal(resp: unknown) {
  const text = typeof (resp as { response?: unknown })?.response === "string" ? (resp as { response: string }).response : JSON.stringify(resp);
  if (/must deposit before performing actions/i.test(text)) return "Hyperliquid hasn't seen a deposit from this wallet yet, and it only accepts an agent (or any action) after one. Add trading funds first, then approve the agent.";
  if (/insufficient/i.test(text)) return "Hyperliquid says the balance is too low for this: " + text.slice(0, 160);
  return "Hyperliquid refused: " + text.slice(0, 200);
}
const USER_TYPES: Record<string, { primary: string; fields: { name: string; type: string }[] }> = {
  approveAgent: {
    primary: "HyperliquidTransaction:ApproveAgent",
    fields: [{ name: "hyperliquidChain", type: "string" }, { name: "agentAddress", type: "address" }, { name: "agentName", type: "string" }, { name: "nonce", type: "uint64" }],
  },
  withdraw3: {
    primary: "HyperliquidTransaction:Withdraw",
    fields: [{ name: "hyperliquidChain", type: "string" }, { name: "destination", type: "string" }, { name: "amount", type: "string" }, { name: "time", type: "uint64" }],
  },
  usdClassTransfer: {
    primary: "HyperliquidTransaction:UsdClassTransfer",
    fields: [{ name: "hyperliquidChain", type: "string" }, { name: "amount", type: "string" }, { name: "toPerp", type: "bool" }, { name: "nonce", type: "uint64" }],
  },
};
export function userTypedData(action: { type: string; signatureChainId: string } & Record<string, unknown>): TypedData {
  const t = USER_TYPES[action.type];
  if (!t) throw new Error("Not a supported user-signed action.");
  return {
    domain: { name: "HyperliquidSignTransaction", version: "1", chainId: parseInt(action.signatureChainId, 16), verifyingContract: ZERO },
    types: { [t.primary]: t.fields },
    primaryType: t.primary,
    message: Object.fromEntries(t.fields.map((f) => [f.name, action[f.name]])),
  };
}

/* ───────────── keys and signatures ───────────── */

export function addressOf(privateKey: Uint8Array) {
  const pub = secp256k1.getPublicKey(privateKey, false);
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}
export interface Sig {
  r: string;
  s: string;
  v: number;
}
export function signTyped(t: TypedData, privateKey: Uint8Array): Sig {
  const sig = secp256k1.sign(typedDigest(t), privateKey);
  return { r: "0x" + sig.r.toString(16).padStart(64, "0"), s: "0x" + sig.s.toString(16).padStart(64, "0"), v: 27 + sig.recovery };
}
export function splitSig(hex: string): Sig {
  const b = hexToBytes(hex);
  if (b.length !== 65) throw new Error("Expected a 65-byte signature.");
  const v = b[64] < 27 ? b[64] + 27 : b[64];
  return { r: bytesToHex(b.slice(0, 32)), s: bytesToHex(b.slice(32, 64)), v };
}
export function recoverTyped(t: TypedData, sig: Sig) {
  const rec = sig.v - 27;
  if (rec !== 0 && rec !== 1) throw new Error("Invalid recovery id.");
  const s = new secp256k1.Signature(BigInt(sig.r), BigInt(sig.s)).addRecoveryBit(rec);
  return bytesToHex(keccak_256(s.recoverPublicKey(typedDigest(t)).toRawBytes(false).slice(1)).slice(-20));
}

/* ───────────── orders ───────────── */

export interface AssetMeta {
  index: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
  delisted: boolean;
}
export function parseMeta(meta: { universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] }): AssetMeta[] {
  return meta.universe.map((u, index) => ({ index, name: u.name, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, delisted: !!u.isDelisted }));
}
export interface OrderIntent {
  coin: string;
  isBuy: boolean;
  /** Base-asset size as a decimal string. */
  size: string;
  kind: "market" | "limit" | "stop_loss" | "take_profit";
  /** limit price, or trigger price for stop/take-profit. Market orders use the mid ± slippage. */
  price?: string;
  tif?: "Gtc" | "Ioc" | "Alo";
  reduceOnly: boolean;
  /** 16-byte hex client order id: the idempotency key for this order. */
  cloid: string;
}
/** Market = IOC limit at mid ± slippage (Hyperliquid has no separate market type). */
export function orderWire(i: OrderIntent, a: AssetMeta, midPx: string | null, slippageBps: number) {
  if (a.delisted) throw new Error(`${a.name} is delisted.`);
  if (!/^0x[0-9a-f]{32}$/.test(i.cloid)) throw new Error("cloid must be 16 bytes of hex.");
  let p: string;
  let t: Record<string, Packable>;
  if (i.kind === "market") {
    if (!midPx) throw new Error("No mid price: a market order can't be bounded.");
    const mid = toRaw(midPx, 8);
    const bound = i.isBuy ? (mid * BigInt(10000 + slippageBps)) / 10000n : (mid * BigInt(10000 - slippageBps)) / 10000n;
    p = roundPx(fromRaw(bound, 8), a.szDecimals, i.isBuy ? "down" : "up");
    t = { limit: { tif: "Ioc" } };
  } else if (i.kind === "limit") {
    if (!i.price) throw new Error("A limit order needs a price.");
    p = roundPx(i.price, a.szDecimals, i.isBuy ? "down" : "up");
    t = { limit: { tif: i.tif ?? "Gtc" } };
  } else {
    if (!i.price) throw new Error("A trigger order needs a trigger price.");
    // Triggered as market; the limit price bounds slippage around the trigger.
    const trig = toRaw(i.price, 8);
    const bound = i.isBuy ? (trig * BigInt(10000 + slippageBps)) / 10000n : (trig * BigInt(10000 - slippageBps)) / 10000n;
    p = roundPx(fromRaw(bound, 8), a.szDecimals, i.isBuy ? "down" : "up");
    t = { trigger: { isMarket: true, triggerPx: roundPx(i.price, a.szDecimals, "down"), tpsl: i.kind === "stop_loss" ? "sl" : "tp" } };
  }
  return { a: a.index, b: i.isBuy, p, s: roundSz(i.size, a.szDecimals), r: i.reduceOnly, t, c: i.cloid };
}
export function orderAction(orders: ReturnType<typeof orderWire>[], grouping: "na" | "normalTpsl" | "positionTpsl" = "na") {
  return { type: "order", orders, grouping };
}
/**
 * A take profit and a stop loss each have to be on the right side of the entry price: for a long, the take profit is
 * above the entry and the stop loss below it; a short is the reverse. Returns what's wrong, or null when both are valid.
 */
export function tpslProblem(isBuy: boolean, entryPx: string, tp?: string, sl?: string): string | null {
  const e = Number(entryPx), side = isBuy ? "long" : "short";
  if (!(e > 0)) return "No entry price to check the take profit and stop loss against.";
  if (tp !== undefined && !(isBuy ? Number(tp) > e : Number(tp) < e)) return `Take profit ${tp} has to be ${isBuy ? "above" : "below"} the entry price (${entryPx}) for a ${side}.`;
  if (sl !== undefined && !(isBuy ? Number(sl) < e : Number(sl) > e)) return `Stop loss ${sl} has to be ${isBuy ? "below" : "above"} the entry price (${entryPx}) for a ${side}.`;
  return null;
}
export function cancelByCloidAction(asset: number, cloid: string) {
  return { type: "cancelByCloid", cancels: [{ asset, cloid }] };
}
export function updateLeverageAction(asset: number, leverage: number, isCross: boolean) {
  return { type: "updateLeverage", asset, isCross, leverage };
}

/** Classifies one /exchange response status. Anything unrecognised is "unknown" (never assumed failed). */
export function orderStatus(resp: unknown): { state: "resting" | "filled" | "rejected" | "unknown"; oid?: number; avgPx?: string; filledSz?: string; error?: string } {
  const r = resp as { status?: string; response?: { data?: { statuses?: unknown[] } } | string };
  if (r?.status === "err") return { state: "rejected", error: String(r.response) };
  const st = (r?.response as { data?: { statuses?: Record<string, unknown>[] } })?.data?.statuses?.[0];
  if (!st) return { state: "unknown", error: "No order status in the response." };
  if (st.error) return { state: "rejected", error: String(st.error) };
  const f = st.filled as { oid: number; avgPx: string; totalSz: string } | undefined;
  if (f) return { state: "filled", oid: f.oid, avgPx: f.avgPx, filledSz: f.totalSz };
  const rest = st.resting as { oid: number } | undefined;
  if (rest) return { state: "resting", oid: rest.oid };
  return { state: "unknown", error: "Unrecognised status." };
}

/* ───────────── snapshot → USDC base units ───────────── */

export interface PerpPosition {
  coin: string;
  /** Signed base size (decimal string): negative = short. */
  szi: string;
  entryPx: string | null;
  markPx: string | null;
  notionalUsdcRaw: string;
  unrealizedPnlUsdcRaw: string;
  liquidationPx: string | null;
  leverage: { type: string; value: number };
  marginUsedUsdcRaw: string;
  cumFundingUsdcRaw: string | null;
}
export interface PerpSnapshot {
  venue: "hyperliquid";
  master: string;
  capturedAt: string;
  accountValueUsdcRaw: string;
  withdrawableUsdcRaw: string;
  marginUsedUsdcRaw: string;
  maintenanceUsdcRaw: string;
  totalNotionalUsdcRaw: string;
  unrealizedPnlUsdcRaw: string;
  /** Account value minus positive unrealized PnL: what counts toward net worth. uPnL is never spendable. */
  realizedEquityUsdcRaw: string;
  positions: PerpPosition[];
}
export function parseClearinghouse(master: string, s: {
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: { position: { coin: string; szi: string; entryPx: string | null; positionValue: string; unrealizedPnl: string; liquidationPx: string | null; leverage: { type: string; value: number }; marginUsed: string; cumFunding?: { sinceOpen: string } } }[];
  time: number;
}): PerpSnapshot {
  const positions: PerpPosition[] = s.assetPositions.map(({ position: p }) => {
    const sz = toRaw(p.szi, 8);
    const val = toRaw(p.positionValue, 6, "up");
    const mark = sz !== 0n ? fromRaw((toRaw(p.positionValue, 8) * 10n ** 8n) / (sz < 0n ? -sz : sz), 8) : null;
    return {
      coin: p.coin,
      szi: p.szi,
      entryPx: p.entryPx,
      markPx: mark,
      notionalUsdcRaw: val.toString(),
      unrealizedPnlUsdcRaw: toRaw(p.unrealizedPnl, 6, "down").toString(),
      liquidationPx: p.liquidationPx,
      leverage: p.leverage,
      marginUsedUsdcRaw: toRaw(p.marginUsed, 6, "up").toString(),
      cumFundingUsdcRaw: p.cumFunding ? toRaw(p.cumFunding.sinceOpen, 6).toString() : null,
    };
  });
  const upnl = positions.reduce((n, p) => n + BigInt(p.unrealizedPnlUsdcRaw), 0n);
  const value = toRaw(s.marginSummary.accountValue, 6, "down");
  return {
    venue: "hyperliquid",
    master: master.toLowerCase(),
    capturedAt: new Date(s.time).toISOString(),
    accountValueUsdcRaw: value.toString(),
    withdrawableUsdcRaw: toRaw(s.withdrawable, 6, "down").toString(),
    marginUsedUsdcRaw: toRaw(s.marginSummary.totalMarginUsed, 6, "up").toString(),
    maintenanceUsdcRaw: toRaw(s.crossMaintenanceMarginUsed, 6, "up").toString(),
    totalNotionalUsdcRaw: toRaw(s.marginSummary.totalNtlPos, 6, "up").toString(),
    unrealizedPnlUsdcRaw: upnl.toString(),
    realizedEquityUsdcRaw: (upnl > 0n ? value - upnl : value).toString(),
    positions,
  };
}

/** Portfolio rows for capitalView(): margin is collateral (never spendable cash); positive uPnL is excluded. */
export function perpPortfolioPositions(s: PerpSnapshot, accountId: string) {
  if (BigInt(s.accountValueUsdcRaw) === 0n && !s.positions.length) return [];
  return [
    {
      id: `acct:${accountId}:hyperliquid:equity`,
      label: `Hyperliquid margin account (${s.positions.length} position${s.positions.length === 1 ? "" : "s"}; unrealized gains excluded)`,
      asset: "USDC",
      amount: fromRaw(BigInt(s.realizedEquityUsdcRaw), 6),
      rawAmount: s.realizedEquityUsdcRaw,
      decimals: 6,
      kind: "collateral" as const,
      chain: "arb" as const,
      venue: "hyperliquid",
      accountId: s.master,
      ownership: "owner" as const,
      source: "live" as const,
      capturedAt: s.capturedAt,
      availableAt: null,
    },
  ];
}

/* ───────────── checks under a mandate ───────────── */

export type PerpLimits = NonNullable<AgentMandate["perps"]>;
/** Conservative cross-margin estimate: maintenance = notional / (2 × maxLeverage) per asset. */
export function liquidationDistanceBps(accountValue: bigint, positions: { notional: bigint; maxLeverage: number }[]) {
  const notional = positions.reduce((n, p) => n + p.notional, 0n);
  if (notional === 0n) return null;
  const maint = positions.reduce((n, p) => n + p.notional / BigInt(2 * p.maxLeverage) + 1n, 0n);
  const cushion = accountValue - maint;
  return Number((cushion * 10000n) / notional);
}

export function checkPerpOrder(input: {
  mandate: AgentMandate;
  limits: PerpLimits | undefined;
  snapshot: PerpSnapshot;
  meta: AssetMeta[];
  midPx: string | null;
  intent: OrderIntent;
  leverage: number;
  todayNotionalUsdcRaw: string;
  realizedLossUsdcRaw: string;
  now: number;
  agentVerified: boolean;
}): { allowed: boolean; checks: MandateCheck[]; notionalUsdcRaw: string | null } {
  const { mandate: m, limits, snapshot: s, intent: i } = input;
  const checks: MandateCheck[] = [];
  const c = (id: string, ok: boolean | null, detail: string) => checks.push({ id, ok, detail });
  const a = input.meta.find((x) => x.name === i.coin);
  const reducing = i.reduceOnly;
  c("agent", input.agentVerified, input.agentVerified ? "Agent wallet approved by your master account (read from Hyperliquid)." : "No verified agent wallet.");
  c("mandate_state", m.state === "active" && !m.frozen, `Mandate ${m.state}${m.frozen ? " (frozen)" : ""}.`);
  c("mandate_scope", m.scope.actions.includes(reducing ? "perp_reduce" : "perp_order"), `Action ${reducing ? "perp_reduce" : "perp_order"}.`);
  c("perp_limits", !!limits, limits ? "Perp limits set." : "This mandate has no perp limits.");
  c("asset", !!a && !a.delisted && !!limits?.assets.includes(i.coin), a ? `${i.coin}${a.delisted ? " (delisted)" : ""}.` : `${i.coin} is not listed.`);
  const age = input.now - Date.parse(s.capturedAt);
  c("snapshot_fresh", age <= m.freshness.evidenceMaxAgeSec * 1000, `Account read ${Math.round(age / 1000)} s ago.`);
  c("mid_price", !!input.midPx, input.midPx ? `Mid ${input.midPx}.` : "No mid price.");
  let notional: bigint | null = null;
  if (a && input.midPx) {
    const px = i.kind === "limit" && i.price ? i.price : input.midPx;
    notional = (toRaw(i.size, 8) * toRaw(px, 8)) / 10n ** 10n; // 8+8 decimals → 6
  }
  const pos = s.positions.find((p) => p.coin === i.coin);
  if (reducing) {
    const sz = pos ? toRaw(pos.szi, 8) : 0n;
    const ok = sz !== 0n && (sz > 0n) !== i.isBuy && toRaw(i.size, 8) <= (sz < 0n ? -sz : sz);
    c("reduces_position", ok, ok ? "Reduces an open position." : "Reduce-only order doesn't reduce an open position by at most its size.");
  } else if (limits && a) {
    c("leverage", input.leverage >= 1 && input.leverage <= limits.maxLeverage && input.leverage <= a.maxLeverage, `Leverage ${input.leverage}× vs mandate ${limits.maxLeverage}× and ${i.coin} max ${a.maxLeverage}×.`);
    c("notional", notional === null ? null : notional <= BigInt(limits.maxNotionalUsdcRaw) && notional <= BigInt(m.limits.perActionUsdcRaw), notional === null ? "Notional unknown." : `Order ${fromRaw(notional, 6)} USDC vs per-order ${fromRaw(BigInt(limits.maxNotionalUsdcRaw), 6)}.`);
    c("daily", notional === null ? null : BigInt(input.todayNotionalUsdcRaw) + notional <= BigInt(m.limits.dailyUsdcRaw), "Today's opened notional vs daily limit.");
    const marginAfter = notional === null ? null : BigInt(s.marginUsedUsdcRaw) + notional / BigInt(Math.max(1, input.leverage));
    c("capital", marginAfter === null ? null : marginAfter <= BigInt(m.limits.capitalUsdcRaw), marginAfter === null ? "Margin unknown." : `Margin after ${fromRaw(marginAfter, 6)} vs capital limit ${fromRaw(BigInt(m.limits.capitalUsdcRaw), 6)}.`);
    const loss = BigInt(input.realizedLossUsdcRaw) + (BigInt(s.unrealizedPnlUsdcRaw) < 0n ? -BigInt(s.unrealizedPnlUsdcRaw) : 0n);
    c("strategy_loss", loss < BigInt(m.limits.maxStrategyLossUsdcRaw), `Loss ${fromRaw(loss, 6)} vs stop ${fromRaw(BigInt(m.limits.maxStrategyLossUsdcRaw), 6)}.`);
    if (notional !== null) {
      const after = s.positions.map((p) => ({ notional: BigInt(p.notionalUsdcRaw), maxLeverage: input.meta.find((x) => x.name === p.coin)?.maxLeverage ?? 1 }));
      after.push({ notional, maxLeverage: a.maxLeverage });
      const d = liquidationDistanceBps(BigInt(s.accountValueUsdcRaw), after);
      c("liquidation_distance", d === null ? null : d >= limits.minLiquidationDistanceBps, d === null ? "No exposure." : `Estimated cushion ${(d / 100).toFixed(1)}% of notional vs ${(limits.minLiquidationDistanceBps / 100).toFixed(1)}% (conservative: maintenance = notional ÷ 2×max leverage).`);
    }
  }
  c("slippage", m.limits.maxSlippageBps > 0 || i.kind === "limit", `Slippage bound ${m.limits.maxSlippageBps} bps.`);
  return { allowed: checks.every((x) => x.ok === true), checks, notionalUsdcRaw: notional?.toString() ?? null };
}

/* ───────────── protective deleveraging ───────────── */

/**
 * Reduce-only IOC orders that restore the liquidation cushion or stop losses. Halves the largest position when
 * the cushion is below the minimum; closes everything when the loss stop is reached. Deterministic.
 */
export function protectiveOrders(input: { snapshot: PerpSnapshot; meta: AssetMeta[]; limits: PerpLimits; maxLossUsdcRaw: string; realizedLossUsdcRaw: string; cloid: (coin: string) => string }) {
  const { snapshot: s, limits } = input;
  const open = s.positions.filter((p) => toRaw(p.szi, 8) !== 0n);
  if (!open.length) return { reason: null as string | null, orders: [] as OrderIntent[] };
  const loss = BigInt(input.realizedLossUsdcRaw) + (BigInt(s.unrealizedPnlUsdcRaw) < 0n ? -BigInt(s.unrealizedPnlUsdcRaw) : 0n);
  const close = (p: PerpPosition, part: bigint): OrderIntent => {
    const sz = toRaw(p.szi, 8);
    const abs = sz < 0n ? -sz : sz;
    return { coin: p.coin, isBuy: sz < 0n, size: fromRaw((abs * part) / 100n, 8), kind: "market", reduceOnly: true, cloid: input.cloid(p.coin) };
  };
  if (loss >= BigInt(input.maxLossUsdcRaw))
    return { reason: `Loss ${fromRaw(loss, 6)} USDC reached the stop; closing every position.`, orders: open.map((p) => close(p, 100n)) };
  const d = liquidationDistanceBps(BigInt(s.accountValueUsdcRaw), open.map((p) => ({ notional: BigInt(p.notionalUsdcRaw), maxLeverage: input.meta.find((x) => x.name === p.coin)?.maxLeverage ?? 1 })));
  if (d !== null && d < limits.minLiquidationDistanceBps) {
    const largest = [...open].sort((x, y) => (BigInt(y.notionalUsdcRaw) > BigInt(x.notionalUsdcRaw) ? 1 : -1))[0];
    return { reason: `Liquidation cushion ${(d / 100).toFixed(1)}% is below ${(limits.minLiquidationDistanceBps / 100).toFixed(1)}%; halving ${largest.coin}.`, orders: [close(largest, 50n)] };
  }
  return { reason: null, orders: [] };
}

/* ───────────── hedges with a leg on another venue ───────────── */

export interface HedgeLeg {
  venue: string;
  /** Signed base size this leg was meant to add (e.g. +100 NEAR spot, −100 NEAR-PERP). */
  targetRaw: string;
  /** Verified filled size so far; null = this venue can't be read right now. */
  filledRaw: string | null;
  state: "pending" | "filled" | "partial" | "failed" | "unknown";
}
/**
 * One leg filled and the other did not: never retry the missing leg at a new price automatically, and never
 * guess an unreachable venue's state. Known failure → unwind the excess on the filled leg (reduce-only).
 * Unreachable or unknown → freeze and alert; unwinding blind could create the opposite naked exposure.
 */
export function resolveHedge(legs: HedgeLeg[]): { action: "none" | "wait" | "unwind_excess" | "freeze"; venue?: string; excessRaw?: string; reason: string } {
  if (legs.some((l) => l.state === "unknown" || l.filledRaw === null))
    return { action: "freeze", reason: "A hedge leg's state can't be read. Nothing more runs until it is confirmed." };
  if (legs.some((l) => l.state === "pending")) return { action: "wait", reason: "A leg is still pending." };
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const sizes = legs.map((l) => abs(BigInt(l.filledRaw!)));
  const hedged = sizes.reduce((a, b) => (b < a ? b : a));
  const i = sizes.findIndex((x) => x > hedged);
  if (i === -1) return { action: "none", reason: "Legs match." };
  return { action: "unwind_excess", venue: legs[i].venue, excessRaw: (sizes[i] - hedged).toString(), reason: `${legs[i].venue} has ${(sizes[i] - hedged).toString()} unhedged; unwinding it reduce-only.` };
}

/* ───────────── reconciliation → ledger ───────────── */

export interface Fill { coin: string; px: string; sz: string; side: string; time: number; dir: string; closedPnl: string; hash: string; oid: number; fee: string; feeToken?: string; tid: number }
export interface FundingRow { time: number; hash: string; delta: { type: string; coin: string; usdc: string; szi: string; fundingRate: string } }
export interface NonFundingRow { time: number; hash: string; delta: { type: string; usdc?: string; fee?: string } }

const entry = (e: Omit<LedgerEntry, "source" | "txHashes" | "status" | "decimals" | "asset"> & { hash: string }): LedgerEntry => {
  const { hash, ...rest } = e;
  return { ...rest, asset: "USDC", decimals: 6, status: "confirmed", source: "live", txHashes: [hash] };
};
/** Fees, realized PnL, funding and transfers, each with a stable id (re-reading never duplicates). */
export function perpLedger(master: string, fills: Fill[], funding: FundingRow[], transfers: NonFundingRow[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const pos = `hyperliquid:${master.toLowerCase()}`;
  for (const f of fills) {
    const at = new Date(f.time).toISOString();
    const fee = toRaw(f.fee, 6, "up");
    if (fee !== 0n && (f.feeToken ?? "USDC") === "USDC")
      out.push(entry({ id: `hl:${f.tid}:fee`, at, kind: "fee", amountRaw: (fee < 0n ? -fee : fee).toString(), usdcRaw: (fee < 0n ? -fee : fee).toString(), netWorthEffectUsdcRaw: (-fee).toString(), liabilityEffectUsdcRaw: null, realized: true, basis: `Hyperliquid ${f.coin} ${f.dir} fill ${f.sz} @ ${f.px}: trading fee`, positionId: pos, hash: f.hash }));
    const pnl = toRaw(f.closedPnl, 6, "down");
    if (pnl !== 0n)
      out.push(entry({ id: `hl:${f.tid}:pnl`, at, kind: "valuation_change", amountRaw: (pnl < 0n ? -pnl : pnl).toString(), usdcRaw: pnl.toString(), netWorthEffectUsdcRaw: pnl.toString(), liabilityEffectUsdcRaw: null, realized: true, basis: `Hyperliquid ${f.coin} ${f.dir}: realized PnL before fees`, positionId: pos, hash: f.hash }));
  }
  for (const r of funding) {
    if (r.delta.type !== "funding") continue;
    const n = toRaw(r.delta.usdc, 6, "down");
    if (n === 0n) continue;
    out.push(entry({ id: `hl:funding:${r.hash}:${r.delta.coin}:${r.time}`, at: new Date(r.time).toISOString(), kind: n < 0n ? "interest" : "yield", amountRaw: (n < 0n ? -n : n).toString(), usdcRaw: (n < 0n ? -n : n).toString(), netWorthEffectUsdcRaw: n.toString(), liabilityEffectUsdcRaw: null, realized: true, basis: `Hyperliquid ${r.delta.coin} funding ${n < 0n ? "paid" : "received"} (rate ${r.delta.fundingRate}, size ${r.delta.szi})`, positionId: pos, hash: r.hash }));
  }
  for (const t of transfers) {
    const at = new Date(t.time).toISOString();
    if (t.delta.type === "deposit" && t.delta.usdc) {
      const n = toRaw(t.delta.usdc, 6);
      out.push(entry({ id: `hl:deposit:${t.hash}`, at, kind: "internal_transfer", amountRaw: n.toString(), usdcRaw: n.toString(), netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: null, realized: true, basis: "Deposit into Hyperliquid from your own Arbitrum address", positionId: pos, hash: t.hash }));
    } else if (t.delta.type === "withdraw" && t.delta.usdc) {
      const n = toRaw(t.delta.usdc, 6);
      const fee = toRaw(t.delta.fee ?? "0", 6, "up");
      out.push(entry({ id: `hl:withdraw:${t.hash}`, at, kind: "internal_transfer", amountRaw: n.toString(), usdcRaw: n.toString(), netWorthEffectUsdcRaw: "0", liabilityEffectUsdcRaw: null, realized: true, basis: "Withdrawal from Hyperliquid to your own Arbitrum address", positionId: pos, hash: t.hash }));
      if (fee > 0n) out.push(entry({ id: `hl:withdraw:${t.hash}:fee`, at, kind: "fee", amountRaw: fee.toString(), usdcRaw: fee.toString(), netWorthEffectUsdcRaw: (-fee).toString(), liabilityEffectUsdcRaw: null, realized: true, basis: "Hyperliquid withdrawal fee", positionId: pos, hash: t.hash }));
    }
  }
  return out;
}

/** Realized result of perps (fees, closed PnL, funding) from ledger entries; deposits/withdrawals excluded. */
export function realizedPerpResult(entries: LedgerEntry[]) {
  return entries.filter((e) => e.id.startsWith("hl:") && e.kind !== "internal_transfer").reduce((n, e) => n + BigInt(e.netWorthEffectUsdcRaw ?? "0"), 0n);
}

/* ───────────── perps mandate draft ───────────── */

/** A perps mandate names the exact agent wallet it trusts (part of the signed terms). Starts conservative. */
export function draftPerpMandate(input: { id: string; accountId: string; master: string; agent: { address: string; name: string; validUntil: number }; now: number; base: AgentMandate }): AgentMandate {
  const at = new Date(input.now).toISOString();
  const until = Math.min(input.agent.validUntil, input.now + 30 * 864e5);
  return {
    ...input.base,
    id: input.id,
    title: "Hyperliquid perpetuals (ETH, BTC)",
    validFrom: at,
    validUntil: new Date(until).toISOString(),
    scope: {
      accounts: ["near:" + input.accountId, "evm:" + input.master.toLowerCase()],
      assets: [{ asset: "ETH", chain: "hyperliquid" }, { asset: "BTC", chain: "hyperliquid" }],
      venues: ["hyperliquid"],
      methods: [{ receiver: "api.hyperliquid.xyz", method: "order" }, { receiver: "api.hyperliquid.xyz", method: "updateLeverage" }],
      recipients: ["$owner"],
      actions: ["perp_order", "perp_reduce"],
      strategies: [],
    },
    limits: { ...input.base.limits, capitalUsdcRaw: "50000000", perActionUsdcRaw: "100000000", dailyUsdcRaw: "200000000", cumulativeUsdcRaw: "2000000000", maxActionsPerDay: 6, maxSlippageBps: 50, maxStrategyLossUsdcRaw: "10000000" },
    perps: { assets: ["ETH", "BTC"], maxLeverage: 3, maxNotionalUsdcRaw: "100000000", minLiquidationDistanceBps: 2500 },
    authority: {
      kind: "hyperliquid_agent",
      status: "verified",
      bounds: [
        "The agent key can place, modify and cancel orders on your Hyperliquid account and nothing else.",
        "It cannot withdraw or transfer USDC; withdrawals need your master wallet's signature.",
        `It expires ${new Date(input.agent.validUntil).toISOString().slice(0, 10)}; revoking deletes the key from FlowVault.`,
      ],
      unbounded: [
        "Hyperliquid does not limit an agent's order size, leverage or losses: FlowVault's checks enforce this mandate's limits before every signature.",
        "At worst, losses are bounded by the USDC you keep on Hyperliquid.",
      ],
      custody: "Hyperliquid's bridge holds your deposited USDC for your master address; only your master wallet can withdraw.",
      upgradeAuthority: "Hyperliquid's validators and bridge; FlowVault has none.",
      delegate: { address: input.agent.address.toLowerCase(), chain: "evm", name: input.agent.name, validUntil: new Date(input.agent.validUntil).toISOString() },
    },
  };
}
