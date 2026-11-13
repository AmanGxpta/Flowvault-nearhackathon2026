import {watched} from "./vault-store";
import {readVault} from "./vault-live";
import type {Workspace} from "./types";
export async function monitoredHolderVaults(sessionId:string,w:Workspace){
 if(w.mode!=="live"||!w.accountId)return [];
 const ids=await watched(sessionId);
 // A partial read is not an all-clear. Preserve the group until all watched vaults can be evaluated.
 return Promise.all(ids.map(id=>readVault(id,[w.accountId!])));
}
