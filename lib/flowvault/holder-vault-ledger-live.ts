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


/** Statement refresh bridge for Stream A's standard wallet journal; no changes to its vault files. */
export async function syncHolderVaultAttempts(sessionId:string,w:Workspace,attempts:import("./execution").WalletAttempt[],outbox:import("./contracts").LedgerEntry[],errors:string[]){
 if(w.mode!=="live"||!w.accountId)return;
 const jobs=attempts.filter(a=>a.accountId===w.accountId&&["confirmed","partial"].includes(a.state)&&!!(a.preparation as any).vault?.contractId).flatMap(a=>a.hashes.map(hash=>({a,hash,contractId:(a.preparation as any).vault.contractId as string}))).filter(j=>!outbox.some(e=>e.positionId===`vault:${j.contractId}:${w.accountId}`&&e.txHashes.includes(j.hash)));
 if(jobs.length>12)errors.push("Older vault receipt history may be incomplete; import remaining receipts through Statement recovery.");
 const results=await Promise.allSettled(jobs.slice(-12).map(j=>recordHolderVaultReceipt(sessionId,w,j.contractId,j.hash,j.a.accountId)));
 for(const r of results)if(r.status==="fulfilled")outbox.push(...r.value);else errors.push("Vault holder receipt could not be recorded: "+String(r.reason?.message??r.reason));
}
