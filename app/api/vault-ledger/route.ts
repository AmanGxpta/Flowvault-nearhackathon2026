import {z} from "zod";
import {session,mutation,json,failure} from "@/lib/flowvault/store";
import {requireSalePermissionOwner} from "@/lib/flowvault/sale-policy-owner";
import {recordHolderVaultReceipt} from "@/lib/flowvault/holder-vault-ledger-live";
export async function POST(r:Request){try{mutation(r);const s=await session(r);requireSalePermissionOwner(s);const b=z.object({contractId:z.string().max(64),hash:z.string().max(64),signerId:z.string().max(64)}).strict().parse(await r.json());return json({entries:await recordHolderVaultReceipt(s.id,s.workspace,b.contractId,b.hash,b.signerId)},s.cookie);}catch(e){return failure(e);}}
