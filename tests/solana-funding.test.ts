import test from "node:test";
import assert from "node:assert/strict";
import { SOL, describeTransaction, toBase64, usdcAta, usdcTransferTransaction, verifyPreparedTransfer, type PreparedSolanaTransfer } from "../lib/flowvault/solana-tx.ts";
import { usdcTokenAccount } from "../lib/flowvault/account-reads.ts";
import { checkLegQuote, legQuoteBody, resolveWnear } from "../lib/flowvault/funding-mesh-quote.ts";
import { LEG_NETWORKS, executionCapabilities } from "../lib/flowvault/capabilities.ts";

const FROM = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DEPOSIT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const HASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const base = { from: FROM, depositAddress: DEPOSIT, amountRaw: "25000000", memo: null, createDepositAta: false, blockhash: HASH, lastValidBlockHeight: "300000000" };

test("USDC token accounts: the SDK's derivation matches the account reader's", async () => {
  assert.equal(await usdcAta(FROM), usdcTokenAccount(FROM));
  assert.equal(await usdcAta(DEPOSIT), usdcTokenAccount(DEPOSIT));
});

test("the transfer is one TransferChecked of exactly the amount, USDC mint, 6 decimals, signed only by the owner", async () => {
  const d = describeTransaction(await usdcTransferTransaction(base));
  assert.deepEqual(d.signers, [FROM]);
  assert.equal(d.feePayer, FROM);
  assert.equal(d.blockhash, HASH);
  assert.equal(d.instructions.length, 1);
  const [t] = d.instructions;
  assert.equal(t.program, SOL.tokenProgram);
  assert.deepEqual(t.accounts, [await usdcAta(FROM), SOL.usdcMint, await usdcAta(DEPOSIT), FROM]);
  assert.equal(t.data[0], 12, "TransferChecked");
  assert.equal(new DataView(t.data.buffer, t.data.byteOffset + 1, 8).getBigUint64(0, true), 25_000000n);
  assert.equal(t.data[9], 6);
});

test("a deposit address without a USDC account gets an idempotent create first; a memo goes last on SPL Memo v2", async () => {
  const d = describeTransaction(await usdcTransferTransaction({ ...base, createDepositAta: true, memo: "deposit-42" }));
  assert.deepEqual(d.instructions.map((i) => i.program), [SOL.ataProgram, SOL.tokenProgram, "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"]);
  const [create, , memo] = d.instructions;
  assert.deepEqual([...create.data], [1], "CreateIdempotent");
  assert.deepEqual(create.accounts.slice(0, 4), [FROM, await usdcAta(DEPOSIT), DEPOSIT, SOL.usdcMint], "payer is the owner; the account belongs to the deposit address");
  assert.equal(new TextDecoder().decode(memo.data), "deposit-42");
});

test("builder refuses nonsense", async () => {
  await assert.rejects(usdcTransferTransaction({ ...base, amountRaw: "0" }), /Nothing to transfer/);
  await assert.rejects(usdcTransferTransaction({ ...base, depositAddress: FROM }), /your own address/);
  await assert.rejects(usdcTransferTransaction({ ...base, memo: "" }), /memo/);
});

async function prepared(over: Partial<PreparedSolanaTransfer> = {}): Promise<PreparedSolanaTransfer> {
  const wire = await usdcTransferTransaction(base);
  return { kind: "solana", from: FROM, mint: SOL.usdcMint, depositAddress: DEPOSIT, amountRaw: "25000000", memo: null, createRecipientAta: false, sourceAta: await usdcAta(FROM), transactionBase64: toBase64(wire), blockhash: HASH, lastValidBlockHeight: "300000000", ...over };
}

test("the browser hands the wallet only the exact reviewed transfer", async () => {
  const ok = await prepared();
  assert.equal(toBase64(await verifyPreparedTransfer(FROM, ok, DEPOSIT, "25000000")), ok.transactionBase64);
  await assert.rejects(verifyPreparedTransfer(FROM, ok, DEPOSIT, "26000000"), /doesn't match the quote/);
  await assert.rejects(verifyPreparedTransfer(DEPOSIT, ok, DEPOSIT, "25000000"), /doesn't match the quote/, "another session's address");
  await assert.rejects(verifyPreparedTransfer(FROM, await prepared({ sourceAta: DEPOSIT }), DEPOSIT, "25000000"), /unexpected account/);
  // Same fields, but the server-sent bytes carry something else (here: an added ATA create) → refused.
  const tampered = await prepared({ transactionBase64: toBase64(await usdcTransferTransaction({ ...base, createDepositAta: true })) });
  await assert.rejects(verifyPreparedTransfer(FROM, tampered, DEPOSIT, "25000000"), /isn't the transfer you reviewed/);
});

test("Solana USDC → wNEAR route: wNEAR from the catalog, no same-asset guard on a NEAR quote", () => {
  assert.equal(resolveWnear([{ assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", contractAddress: "wrap.near" }]).assetId, "nep141:wrap.near");
  assert.throws(() => resolveWnear([{ assetId: "nep141:wrap.near", decimals: 18, blockchain: "near", symbol: "wNEAR", contractAddress: "wrap.near" }]), /doesn't list wNEAR/);
  const r = { network: "solana" as const, from: FROM, to: "alice.near", amountRaw: "25000000", originAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", destinationAsset: "nep141:wrap.near" };
  const sent = legQuoteBody(r, false);
  const q = checkLegQuote(r, sent, { quote: { amountIn: "25000000", amountOut: "7285197871753809140996482", minAmountOut: "7248771882395040095291499", depositAddress: DEPOSIT, timeEstimate: 20 }, quoteRequest: sent });
  assert.equal(q.depositAddress, DEPOSIT);
  assert.throws(() => checkLegQuote(r, sent, { quote: { amountIn: "25000000", amountOut: "1", minAmountOut: "1", depositAddress: "0x9999999999999999999999999999999999999999" }, quoteRequest: sent }), /no valid deposit address for solana/);
  assert.throws(() => checkLegQuote(r, sent, { quote: { amountIn: "25000000", amountOut: "2", minAmountOut: "1", depositAddress: DEPOSIT }, quoteRequest: { ...sent, refundTo: FROM.toLowerCase() } }), /refunds a different/, "Solana addresses are case-sensitive");
});

test("Solana is now a funding-leg network: a funded, fee-covered Solana account can send", () => {
  assert.ok(LEG_NETWORKS.includes("solana"));
  const at = "2026-11-13T00:00:00.000Z";
  const caps = executionCapabilities({
    accounts: [{ id: "solana:" + FROM, chain: "solana", address: FROM, label: "sol", proof: { method: "siws", at }, networks: ["solana"], addedAt: at }],
    positions: [
      { id: "solana-usdc-" + FROM, chain: "solana", accountId: FROM, asset: "USDC", amount: "25", rawAmount: "25000000", decimals: 6, kind: "wallet", label: "u" },
      { id: "solana-sol-" + FROM, chain: "solana", accountId: FROM, asset: "SOL", amount: "0.01", rawAmount: "10000000", decimals: 9, kind: "wallet", label: "s" },
    ],
    reservations: [],
    source: "live",
  });
  assert.deepEqual(caps[0].operations, ["oneclick_deposit"]);
  const poor = executionCapabilities({
    accounts: [{ id: "solana:" + FROM, chain: "solana", address: FROM, label: "sol", proof: { method: "siws", at }, networks: ["solana"], addedAt: at }],
    positions: [{ id: "u", chain: "solana", accountId: FROM, asset: "USDC", amount: "25", rawAmount: "25000000", decimals: 6, kind: "wallet", label: "u" }],
    reservations: [],
    source: "live",
  });
  assert.deepEqual(poor[0].operations, []);
  assert.ok(poor[0].reasons.some((r) => r.startsWith("NO_GAS")), "no SOL → no Solana leg (no USDC-gas path on Solana)");
});

test("blockhash expiry: only past the last valid height plus a margin, never on an implausible height", async () => {
  const { expiredAt, EXPIRY_MARGIN_BLOCKS } = await import("../lib/flowvault/solana-tx.ts");
  assert.equal(expiredAt(1000n, 1000n), false);
  assert.equal(expiredAt(1000n + EXPIRY_MARGIN_BLOCKS, 1000n), false);
  assert.equal(expiredAt(1001n + EXPIRY_MARGIN_BLOCKS, 1000n), true);
  assert.equal(expiredAt(468653121n, 446668840n), false, "a slot misread as a block height is not proof of expiry");
});
