// Optional runtime transport. No key is generated/provisioned here; owner supplies a scoped key separately.
import {KeyPair} from "@near-js/crypto";
import {actionCreators,createTransaction,SignedTransaction,Signature} from "@near-js/transactions";
import {sha256} from "@noble/hashes/sha2";
import {base58Decode,base58Encode,b64} from "./account-proof";
import {serverSetting} from "./server-setting";
import {networkRpc} from "./near";
import type {CustodyBinding,CustodyCall} from "./custody-authority";
export async function signCustodyCall(b:CustodyBinding,call:CustodyCall,nonce:string,blockHash:string){
 if(call.receiverId!==b.contractId||!["curator_supply","curator_withdraw"].includes(call.methodName)||call.deposit!=="0"||call.gas!=="300000000000000"||!/^\d+$/.test(call.args.amount)||BigInt(call.args.amount)<=0n)throw new Error("Refused non-custody transaction.");
 const setting=await serverSetting("FLOWVAULT_CUSTODY_SIGNERS");
 if(!setting)throw new Error("Custody runtime is unavailable: the owner must separately provision a scoped key and server signer setting. Nothing was sent.");
 let secret:string;try{secret=JSON.parse(setting)[b.operatorId]?.[b.publicKey];if(typeof secret!=="string")throw new Error();}catch{throw new Error("No runtime signer is configured for this custody binding. Nothing was sent.");}
 let key:KeyPair;try{key=KeyPair.fromString(secret as `ed25519:${string}`);}catch{throw new Error("Custody runtime key is invalid. Nothing was sent.");}
 if(key.getPublicKey().toString()!==b.publicKey)throw new Error("Custody runtime key does not match the signed authority.");
 const tx=createTransaction(b.operatorId,key.getPublicKey(),b.contractId,BigInt(nonce)+1n,[actionCreators.functionCall(call.methodName,call.args,BigInt(call.gas),0n)],base58Decode(blockHash));
 const hash=sha256(tx.encode());const signed=key.sign(hash);
 return {nonce:(BigInt(nonce)+1n).toString(),hash:base58Encode(hash),bytes:b64.encode(new SignedTransaction({transaction:tx,signature:new Signature({keyType:key.getPublicKey().keyType,data:signed.signature})}).encode())};
}
export async function broadcastCustody(bytes:string){return networkRpc("broadcast_tx_commit",{signed_tx_base64:bytes});}
