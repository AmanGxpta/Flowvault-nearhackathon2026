import {networkRpc,validAccount} from "./near";
import {vaultConfig} from "./vault-live";
import {ledgerOutbox} from "./plans-store";
import {holderVaultLedger} from "./holder-vault-ledger";
import type {Workspace} from "./types";
/** Safe to retry: canonical receipt/log/account identities use the existing insert-once outbox. */
export async function recordHolderVaultReceipt(sessionId:string,w:Workspace,contractId:string,hash:string,signerId:string){
 if(w.mode!=="live"||!w.accountId||!validAccount(contractId)||!validAccount(signerId)||! /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))throw new Error("Choose a live NEAR vault receipt and signer.");
 const [c,r]=await Promise.all([vaultConfig(contractId),networkRpc("EXPERIMENTAL_tx_status",{tx_hash:hash,sender_account_id:signerId,wait_until:"FINAL"})]);
 if(r.transaction?.hash!==hash||r.transaction?.signer_id!==signerId)throw new Error("Vault receipt identity mismatch.");
 const b=await networkRpc("block",{block_id:r.transaction_outcome?.block_hash});
 const at=new Date(Number(BigInt(b.header.timestamp_nanosec??b.header.timestamp)/1_000_000n)).toISOString();
 const entries=holderVaultLedger(r,contractId,w.accountId,c,at);
 await ledgerOutbox(sessionId,`vault:${contractId}`,entries);
 return entries;
}
