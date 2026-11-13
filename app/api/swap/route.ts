import { swapTokenCatalog as catalog } from "@/lib/flowvault/swap-catalog";
import { swapPreview, type SwapPreviewBody } from "@/lib/flowvault/swap-preview";
export async function GET(){try{return Response.json({tokens:await catalog(),capturedAt:new Date().toISOString(),coverage:"1Click listed assets and Ref metadata. A listing is not a safety endorsement or a guarantee of liquidity."},{headers:{"Cache-Control":"no-store"}});}catch(e){return Response.json({error:(e as Error).message},{status:503});}}
/** Dry public quotes only. Never generates a deposit address, signs, or alters personal policy. */
export async function POST(request:Request){try{
  return Response.json(await swapPreview(await request.json() as SwapPreviewBody),{headers:{"Cache-Control":"no-store"}});
}catch(e){return Response.json({error:(e as Error).message},{status:400});}}
