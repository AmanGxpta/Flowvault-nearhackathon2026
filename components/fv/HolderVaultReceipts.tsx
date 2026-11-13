"use client";
import {useState} from "react";
import {api,type Scope} from "./live";
export function HolderVaultReceipts({scope}:{scope:Scope}){
 const [contractId,setContract]=useState(""),[hash,setHash]=useState(""),[signerId,setSigner]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 if(scope==="example")return null;
 return <details style={{marginTop:16}}><summary>Recover vault holder entries from a receipt</summary><p>Import finalized deposits, share issuance, redemptions, claims and fee shares into this Statement. Vault-owned Rhea operations are not personal positions. Recipient fee shares are exact; holder dilution and historical USDC value require acquisition evidence and remain unpriced.</p><fieldset disabled={busy}><label>Vault account <input value={contractId} onChange={e=>setContract(e.target.value)}/></label><label>Transaction hash <input value={hash} onChange={e=>setHash(e.target.value)}/></label><label>Transaction signer <input value={signerId} onChange={e=>setSigner(e.target.value)}/></label><button onClick={async()=>{setBusy(true);try{const r=await api("/api/vault-ledger",{contractId,hash,signerId},"POST",scope);setMessage(`${r.entries.length} verified entries recorded. Refresh Statement to view them.`);window.dispatchEvent(new Event("fv:plans-refresh"));}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>Verify receipt and record entries</button></fieldset><p role="status">{message}</p></details>;
}
