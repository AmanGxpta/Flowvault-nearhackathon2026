import {rpc,validAccount,networkRpc} from "./near";
import {readVault,codeExports,fullAccessKeys} from "./vault-live";
import {custodyProblems,checkCustodyKey,boundCustodyAuthority,custodyCall} from "./custody-authority";
import {canonicalJson,mandateDigest} from "./mandate";
import type {AgentMandate} from "./contracts";
import {sha256} from "@noble/hashes/sha2";
const digest=(v:unknown)=>Array.from(sha256(new TextEncoder().encode(canonicalJson(v))),b=>b.toString(16).padStart(2,"0")).join("");
export async function custodyEvidence(m:AgentMandate,contractId:string,operatorId:string,publicKey:string,now=Date.now()){
 if(!validAccount(contractId)||!validAccount(operatorId)||!publicKey.startsWith("ed25519:"))throw new Error("Choose a vault, operator account and scoped ed25519 public key.");
 const [snapshot,account,key,keys,exports]=await Promise.all([readVault(contractId,[m.accountId],now),rpc({request_type:"view_account",account_id:contractId}),rpc({request_type:"view_access_key",account_id:operatorId,public_key:publicKey}),fullAccessKeys(contractId),codeExports(contractId)]);
 const problems=custodyProblems(m,snapshot.config,snapshot.operator,now);
 if(snapshot.operator?.policy?.account_id!==operatorId)problems.push("The vault operator policy names another account.");
 if(!checkCustodyKey(key.permission,contractId))problems.push("The key must have a finite gas allowance, only curator_supply/curator_withdraw, and this vault as receiver. Full-access keys are refused.");
 if(!keys||keys.some(k=>!snapshot.config.disclosed_upgrade_keys.includes(k)))problems.push("Actual vault full-access keys must all be disclosed.");
 if(!["curator_supply","curator_withdraw","get_config","get_operator","get_nav","resolve_operation"].every(e=>exports.includes(e)))problems.push("The deployed vault lacks required custody or recovery methods.");
 if(snapshot.differences.length)problems.push("Vault views do not reconcile; refresh before binding authority.");
 if(problems.length)throw new Error(problems.join(" "));
 return {snapshot,key,binding:{contractId,operatorId,publicKey,operatorVersion:snapshot.operator!.version,codeHash:String(account.code_hash),configDigest:digest(snapshot.config)}};
}
export async function bindCustody(m:AgentMandate,contractId:string,operatorId:string,publicKey:string,now=Date.now()){
 if(!["draft","approved","paused"].includes(m.state))throw new Error("Pause the mandate before changing custody authority.");
 const e=await custodyEvidence(m,contractId,operatorId,publicKey,now);
 return {...m,version:m.version+1,state:"draft" as const,approval:null,updatedAt:new Date(now).toISOString(),authority:boundCustodyAuthority(e.binding,e.snapshot.config,now),scope:{...m.scope,methods:[...m.scope.methods.filter(x=>x.receiver!==contractId),{receiver:contractId,method:"curator_supply"},{receiver:contractId,method:"curator_withdraw"}]}};
}
export async function checkedCustody(m:AgentMandate,amount:string,reduce:boolean,now=Date.now()){
 if(m.state!=="active"||!m.approval||m.approval.digest!==mandateDigest(m)||m.frozen||now<Date.parse(m.validFrom)||now>=Date.parse(m.validUntil))throw new Error("Custody mandate is not active with matching signed terms.");
 const b=m.authority.custodyContract;if(!b)throw new Error("Bind custody authority first.");
 const e=await custodyEvidence(m,b.contractId,b.operatorId,b.publicKey,now);
 if(canonicalJson(e.binding)!==canonicalJson(b))throw new Error("Custody code, configuration, operator version or key changed. Review and re-sign.");
 return {...e,call:custodyCall(m,e.snapshot.operator!,e.snapshot.nav,amount,reduce,now)};
}
