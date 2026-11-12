// Solana USDC transfer (owner: Stream A), built with Anza's @solana/kit and the official SPL Token / Memo program
// clients. Pure (no RPC): the server builds it and the browser rebuilds it byte for byte before any wallet sees it.
// One legacy transaction, fee payer and only signer = your address:
//   [CreateAssociatedTokenIdempotent for the deposit address — only when it has no USDC account yet]
//   TransferChecked(your USDC account → the deposit's USDC account, exact amount, mint and 6 decimals checked)
//   [Memo — only when 1Click asks for one]
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { LEGACY_MEMO_PROGRAM_ADDRESS_V3, getAddMemoInstruction } from "@solana-program/memo";

export const SOL = {
  /** Circle's USDC mint on Solana mainnet (also what 1Click's catalog lists). */
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  tokenProgram: TOKEN_PROGRAM_ADDRESS as string,
  ataProgram: ASSOCIATED_TOKEN_PROGRAM_ADDRESS as string,
  /** The canonical SPL Memo program (v2 "MemoSq4g…"), which indexers and deposit watchers recognize; the package default is a newer deployment. */
  memoProgram: LEGACY_MEMO_PROGRAM_ADDRESS_V3 as string,
  genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  /** Rent-exempt minimum for a 165-byte token account; read live at prepare, this is the bound if the read fails. */
  tokenAccountRent: 2_039_280n,
  /** 5,000 lamports per signature, plus headroom for a priority fee the wallet may add. */
  feeBound: 105_000n,
};

/** The associated USDC token account of `owner` (classic Token program). */
export async function usdcAta(owner: string): Promise<string> {
  const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: address(SOL.usdcMint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export interface UsdcTransfer {
  from: string;
  depositAddress: string;
  amountRaw: string;
  memo: string | null;
  createDepositAta: boolean;
  blockhash: string;
  lastValidBlockHeight: string;
}

/** Wire bytes (one empty signature slot) for one USDC transfer. Deterministic for the same inputs. */
export async function usdcTransferTransaction(t: UsdcTransfer): Promise<Uint8Array> {
  const amount = BigInt(t.amountRaw);
  if (amount <= 0n) throw new Error("Nothing to transfer.");
  if (t.from === t.depositAddress) throw new Error("The deposit address can't be your own address.");
  if (t.memo !== null && (t.memo.length === 0 || t.memo.length > 256)) throw new Error("Invalid deposit memo.");
  const payer = createNoopSigner(address(t.from));
  const mint = address(SOL.usdcMint);
  const [source, destination] = await Promise.all([usdcAta(t.from), usdcAta(t.depositAddress)]);
  const instructions = [
    ...(t.createDepositAta ? [getCreateAssociatedTokenIdempotentInstruction({ payer, ata: address(destination), owner: address(t.depositAddress), mint })] : []),
    getTransferCheckedInstruction({ source: address(source), mint, destination: address(destination), authority: payer, amount, decimals: 6 }),
    ...(t.memo ? [getAddMemoInstruction({ memo: t.memo }, { programAddress: LEGACY_MEMO_PROGRAM_ADDRESS_V3 })] : []),
  ];
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: t.blockhash as Blockhash, lastValidBlockHeight: BigInt(t.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Decoded view of a wire transaction: fee payer, programs and accounts per instruction, data (tests + checks). */
export function describeTransaction(wire: Uint8Array) {
  const tx = getTransactionDecoder().decode(wire);
  // Legacy/v0 compiled shape (this module only builds legacy messages).
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
    staticAccounts: string[];
    lifetimeToken: string;
    instructions?: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[];
  };
  const keys = msg.staticAccounts.map(String);
  return {
    signers: Object.keys(tx.signatures),
    feePayer: keys[0],
    blockhash: msg.lifetimeToken,
    instructions: (msg.instructions ?? []).map((ix) => ({ program: keys[ix.programAddressIndex], accounts: (ix.accountIndices ?? []).map((i) => keys[i]), data: new Uint8Array(ix.data ?? []) })),
  };
}

export const toBase64 = (b: Uint8Array) => getBase64Decoder().decode(b);
export const fromBase64 = (s: string) => new Uint8Array(getBase64Encoder().encode(s));
export const signatureText = (sig: Uint8Array) => getBase58Decoder().decode(sig);

export interface PreparedSolanaTransfer {
  kind: "solana";
  from: string;
  mint: string;
  depositAddress: string;
  amountRaw: string;
  memo: string | null;
  createRecipientAta: boolean;
  sourceAta: string;
  transactionBase64: string;
  blockhash: string;
  lastValidBlockHeight: string;
}

/**
 * The browser's check before any Solana wallet is asked: the prepared transfer must be exactly the reviewed one
 * (this address, USDC, this deposit address and amount), and its bytes must equal a local rebuild from those
 * fields. Returns the wire bytes to sign. Throws (nothing sent) on any difference.
 */
export async function verifyPreparedTransfer(owner: string, tx: PreparedSolanaTransfer, depositAddress: string, amountRaw: string): Promise<Uint8Array> {
  if (tx.kind !== "solana" || tx.from !== owner || tx.mint !== SOL.usdcMint || tx.depositAddress !== depositAddress || tx.amountRaw !== amountRaw)
    throw new Error("The prepared transfer doesn't match the quote. Nothing was sent.");
  if (tx.sourceAta !== (await usdcAta(tx.from))) throw new Error("The prepared transfer spends from an unexpected account. Nothing was sent.");
  const expected = await usdcTransferTransaction({ from: tx.from, depositAddress: tx.depositAddress, amountRaw: tx.amountRaw, memo: tx.memo, createDepositAta: tx.createRecipientAta, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight });
  if (toBase64(expected) !== tx.transactionBase64) throw new Error("The prepared Solana transaction isn't the transfer you reviewed. Nothing was sent.");
  const d = describeTransaction(expected);
  if (d.feePayer !== owner || d.signers.length !== 1) throw new Error("Unexpected signer in the prepared transaction. Nothing was sent.");
  return expected;
}

/** Expired only past the last valid height plus ~1 minute (time for 1Click to see a deposit that did land), and
 * never on an implausible height (a read that jumps millions of blocks is wrong, not proof of expiry). */
export const EXPIRY_MARGIN_BLOCKS = 150n;
export function expiredAt(height: bigint, lastValid: bigint) {
  if (height > lastValid + 1_000_000n) return false;
  return height > lastValid + EXPIRY_MARGIN_BLOCKS;
}
