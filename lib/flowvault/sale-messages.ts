import {explainVenueReason} from "./lending-venue-messages.ts";
/** The API may return a serialized validation issue array; never render its structure. */
export function explainSaleError(message:string):string {
  try {
    const issues:unknown=JSON.parse(message);
    if(Array.isArray(issues)) {
      if(issues.some(i=>typeof i?.message==="string"&&i.message.includes("Invalid policy USDC amount")))
        return "Enter a valid USDC limit with at most six decimal places.";
      return "Check the sale quantity, USDC limit and slippage limit, then try again.";
    }
  } catch { /* Ordinary API sentences and diagnostic codes use the existing mapper. */ }
  return explainVenueReason(message);
}
