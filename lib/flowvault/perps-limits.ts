// Human decimal form values become signed bigint mandate terms; never mutate a live mandate in place.
import {z} from "zod";
import {units,decimal} from "./money.ts";
import type {AgentMandate} from "./contracts.ts";
const usdc=z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/);
export const perpLimitTermsSchema=z.object({maxLeverage:z.number().int().min(1).max(20),maxNotional:usdc.refine(x=>units(x)>0n),minLiquidationDistanceBps:z.number().int().min(500).max(10000)}).partial().strict();
export function applyPerpLimitTerms(m:AgentMandate,t:z.infer<typeof perpLimitTermsSchema>|undefined){
  if(t===undefined)return m.perps;
  if(m.authority.kind!=="hyperliquid_agent"||!m.perps)throw new Error("Perpetual limits require an existing Hyperliquid mandate.");
  const v=perpLimitTermsSchema.parse(t);
  return {...m.perps,maxLeverage:v.maxLeverage??m.perps.maxLeverage,maxNotionalUsdcRaw:v.maxNotional===undefined?m.perps.maxNotionalUsdcRaw:units(v.maxNotional).toString(),minLiquidationDistanceBps:v.minLiquidationDistanceBps??m.perps.minLiquidationDistanceBps};
}
export function perpLimitForm(m:Pick<AgentMandate,"perps"|"limits">){if(!m.perps)throw new Error("Perpetual limits unavailable.");return {leverage:String(m.perps.maxLeverage),notional:decimal(BigInt(m.perps.maxNotionalUsdcRaw)),daily:decimal(BigInt(m.limits.dailyUsdcRaw)),margin:decimal(BigInt(m.limits.capitalUsdcRaw)),loss:decimal(BigInt(m.limits.maxStrategyLossUsdcRaw))};}
export function perpLimitUpdate(v:ReturnType<typeof perpLimitForm>){
  const leverage=Number(v.leverage);if(!/^\d+$/.test(v.leverage))throw new Error("Leverage must be a whole number.");
  const perps=perpLimitTermsSchema.parse({maxLeverage:leverage,maxNotional:v.notional});
  for(const x of [v.daily,v.margin,v.loss])usdc.parse(x);
  if(units(v.daily)<units(v.notional))throw new Error("Daily notional must cover the per-order notional limit.");
  if(units(v.margin)<=0n)throw new Error("Margin limit must be above zero.");
  return {perps,perAction:v.notional,daily:v.daily,capital:v.margin,maxLoss:v.loss};
}
