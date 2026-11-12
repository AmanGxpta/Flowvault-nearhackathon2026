import test from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  CIRCLE, ENTRYPOINT, MAX_PERMIT_RAW, USDC, checkSponsoredOp, decodeAccountCalls, paymasterData, permitDigest, permitSigner, permitTypedData, reconcileReceipt, transferData, usdcGasQuote, usdcGasSupport,
  type PermitFields,
} from "../lib/flowvault/gas-abstraction.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const w = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
const aw = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
const bytesArg = (h: string) => {
  const d = h.slice(2);
  return w(d.length / 2) + d.padEnd(Math.ceil(d.length / 64) * 64, "0");
};
const DEPOSIT = "0x9999999999999999999999999999999999999999";
const priv = keccak_256(new TextEncoder().encode("flowvault test key — never funded"));
const OWNER = "0x" + hex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(-20));

test("USDC gas is offered only when the wallet reports a paymaster service and smart-account batching on a Circle chain", () => {
  assert.equal(usdcGasSupport("base", { paymasterService: { supported: true }, atomic: { status: "ready" } }).supported, true);
  assert.equal(usdcGasSupport("base", { paymasterService: { supported: true }, atomicBatch: { supported: true } }).supported, true, "older capability name");
  assert.deepEqual(usdcGasSupport("base", { atomic: { status: "supported" } }).reasons.map((r) => r.split(":")[0]), ["WALLET_NO_PAYMASTER_SERVICE"]);
  assert.deepEqual(usdcGasSupport("base", { paymasterService: { supported: true }, atomic: { status: "unsupported" } }).reasons.map((r) => r.split(":")[0]), ["WALLET_NOT_SMART"]);
  assert.equal(usdcGasSupport("base", undefined).supported, false);
  assert.equal(usdcGasSupport("solana", { paymasterService: { supported: true }, atomic: { status: "ready" } }).supported, false);
  assert.deepEqual(CIRCLE.ethereum.map((p) => p.version), ["0.8"], "Ethereum has only the v0.8 paymaster");
});

test("quote splits principal, gas and Circle's 10%, with a bounded permit", () => {
  const q = usdcGasQuote({ network: "base", principalRaw: 25_000000n, gasPriceWei: 10_000_000n, usdcPerEthRaw: 3000_000000n })!;
  assert.equal(q.gasWei, String(500_000n * 10_000_000n));
  assert.equal(q.gasUsdcRaw, "15000"); // 0.005 ETH-gwei… = 5e12 wei × 3000 USDC/ETH = 0.015 USDC
  assert.equal(q.markupUsdcRaw, "1500");
  assert.equal(q.totalFeeUsdcRaw, "16500");
  assert.equal(q.maxChargeUsdcRaw, "250000", "floor of 0.25 USDC");
  assert.equal(q.principalRaw, "25000000");
  const pricey = usdcGasQuote({ network: "ethereum", principalRaw: 1n, gasPriceWei: 100_000_000_000n, usdcPerEthRaw: 3000_000000n });
  assert.equal(pricey, null, "a bound above the 5 USDC cap is never offered (native gas instead)");
  const mid = usdcGasQuote({ network: "ethereum", principalRaw: 1n, gasPriceWei: 1_000_000_000n, usdcPerEthRaw: 3000_000000n })!;
  assert.ok(BigInt(mid.maxChargeUsdcRaw) <= MAX_PERMIT_RAW);
});

test("permit: typed data uses max deadline, the signer is recovered, a tampered value isn't the owner's", () => {
  const p: PermitFields = { network: "base", tokenName: "USD Coin", tokenVersion: "2", owner: OWNER, spender: CIRCLE.base[0].paymaster, valueRaw: "250000", nonce: "0" };
  const td = permitTypedData(p);
  assert.equal(td.message.deadline, ((1n << 256n) - 1n).toString());
  assert.equal(td.domain.chainId, 8453);
  assert.equal(td.domain.verifyingContract, USDC.base);
  const sig = secp256k1.sign(permitDigest(p), priv);
  const signature = "0x" + hex(sig.toCompactRawBytes()) + (27 + sig.recovery).toString(16);
  assert.equal(permitSigner(p, signature), OWNER);
  assert.notEqual(permitSigner({ ...p, valueRaw: "5000000" }, signature), OWNER);
  assert.throws(() => permitSigner(p, "0x1234"), /length/);
});

test("paymasterData is Circle's packed layout", () => {
  const sig = "0x" + "11".repeat(65);
  const d = paymasterData("arbitrum", "250000", sig);
  assert.equal(d.length, 2 + 2 + 40 + 64 + 130);
  assert.equal(d.slice(2, 4), "00");
  assert.equal("0x" + d.slice(4, 44), USDC.arbitrum);
  assert.equal(BigInt("0x" + d.slice(44, 108)), 250000n);
  assert.equal(d.slice(108), "11".repeat(65));
});

const xfer = transferData(DEPOSIT, "25000000");
const execute = (target: string, data: string) => "0xb61d27f6" + aw(target) + w(0) + w(96) + bytesArg(data);
const executeBatch = (calls: [string, string][]) => {
  // executeBatch((address,uint256,bytes)[]) — array of dynamic tuples.
  let heads = "", tails = "";
  const sizes = calls.map(([, d]) => 32 * 3 + 32 + Math.ceil((d.length - 2) / 2 / 32) * 32);
  let off = 32 * calls.length;
  calls.forEach(([t, d], i) => {
    heads += w(off);
    off += sizes[i];
    tails += aw(t) + w(0) + w(96) + bytesArg(d);
  });
  return "0x34fcd5be" + w(32) + w(calls.length) + heads + tails;
};
const exec7579Single = (target: string, data: string) => {
  const packed = target.slice(2) + w(0) + data.slice(2);
  return "0xe9ae5c53" + "00".repeat(32) + w(64) + bytesArg("0x" + packed);
};

test("account call shapes: execute, executeBatch and ERC-7579 single all decode to the same call", () => {
  for (const cd of [execute(USDC.base, xfer), executeBatch([[USDC.base, xfer]]), exec7579Single(USDC.base, xfer)]) {
    const [c, ...rest] = decodeAccountCalls(cd);
    assert.equal(rest.length, 0);
    assert.equal(c.target, USDC.base);
    assert.equal(c.value, 0n);
    assert.equal(c.data, xfer);
  }
  assert.equal(decodeAccountCalls(executeBatch([[USDC.base, xfer], [USDC.base, transferData(OWNER, "1")]])).length, 2);
  assert.throws(() => decodeAccountCalls("0xdeadbeef" + w(0)), /isn't recognized/);
});

test("the paymaster endpoint answers only for the exact reviewed transfer from the permit's owner on a Circle EntryPoint", () => {
  const base = { network: "base" as const, owner: OWNER, depositAddress: DEPOSIT, amountRaw: "25000000", entryPoint: ENTRYPOINT["0.8"], chainId: "0x2105" };
  const op = (callData: string, sender = OWNER) => ({ sender, callData });
  assert.equal(checkSponsoredOp({ ...base, userOp: op(execute(USDC.base, xfer)) }).version, "0.8");
  assert.equal(checkSponsoredOp({ ...base, entryPoint: ENTRYPOINT["0.7"], userOp: op(execute(USDC.base, xfer)) }).version, "0.7");
  assert.throws(() => checkSponsoredOp({ ...base, network: "ethereum", chainId: 1, entryPoint: ENTRYPOINT["0.7"], userOp: op(execute(USDC.ethereum, xfer)) }), /EntryPoint/, "no v0.7 paymaster on Ethereum");
  assert.throws(() => checkSponsoredOp({ ...base, entryPoint: "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789", userOp: op(execute(USDC.base, xfer)) }), /EntryPoint/, "v0.6 (e.g. older smart wallets) refused");
  assert.throws(() => checkSponsoredOp({ ...base, chainId: 1, userOp: op(execute(USDC.base, xfer)) }), /Wrong chain/);
  assert.throws(() => checkSponsoredOp({ ...base, userOp: op(execute(USDC.base, xfer), DEPOSIT) }), /account isn't the address/);
  assert.throws(() => checkSponsoredOp({ ...base, userOp: op(execute(USDC.base, transferData(DEPOSIT, "25000001"))) }), /reviewed USDC transfer/);
  assert.throws(() => checkSponsoredOp({ ...base, userOp: op(executeBatch([[USDC.base, xfer], [USDC.base, transferData(OWNER, "1")]])) }), /reviewed USDC transfer/, "an extra call is refused");
});

test("reconciliation: USDC charged = sent to the paymaster minus refunds; principal must be exact", () => {
  const pm = CIRCLE.base[0].paymaster;
  const tr = (from: string, to: string, v: bigint, token = USDC.base) => ({ address: token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + aw(from), "0x" + aw(to)], data: "0x" + w(v) });
  const r = reconcileReceipt({ network: "base", owner: OWNER, paymaster: pm, depositAddress: DEPOSIT, amountRaw: "25000000", logs: [tr(OWNER, pm, 250000n), tr(OWNER, DEPOSIT, 25_000000n), tr(pm, OWNER, 231000n), tr(OWNER, pm, 999n, "0x1111111111111111111111111111111111111111")] });
  assert.equal(r.chargedUsdcRaw, 19000n);
  assert.equal(r.principalExact, true);
  assert.equal(reconcileReceipt({ network: "base", owner: OWNER, paymaster: pm, depositAddress: DEPOSIT, amountRaw: "25000000", logs: [tr(OWNER, DEPOSIT, 24_000000n)] }).principalExact, false);
});
