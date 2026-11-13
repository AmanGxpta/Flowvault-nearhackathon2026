// Shape of a prepared Solana transaction (LI.FI route): who pays, how many signers, which programs it calls.
// Pure and shared by the server check and the browser check before the wallet opens.
import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

export function solanaTxShape(base64: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  return {
    feePayer: String(msg.staticAccounts[0]),
    signers: msg.header.numSignerAccounts,
    // Legacy and v0 messages list instructions; anything newer is refused by the version check below.
    programs: "instructions" in msg ? [...new Set((msg.instructions as { programAddressIndex: number }[]).map(i => String(msg.staticAccounts[i.programAddressIndex])))] : null,
    version: msg.version,
  };
}
/** The owner pays and is the only signer: nobody else's authority is in the transaction. */
export function assertOwnerOnly(base64: string, owner: string) {
  const s = solanaTxShape(base64);
  if (s.feePayer !== owner) throw new Error("The route's transaction is paid by another account.");
  if (s.signers !== 1) throw new Error("The route's transaction needs another signer.");
  if (s.version !== "legacy" && s.version !== 0) throw new Error("Unsupported Solana transaction version.");
  return s;
}
