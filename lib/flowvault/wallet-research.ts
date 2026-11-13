/** Indexed public observations, never ownership, spendable balance or execution evidence. */
import { decimal } from "./money.ts";
export interface TokenMetadata { symbol: string; name: string; decimals: number; icon?: string }
export interface WatchedHolding { contract: string; symbol: string; name: string; raw: string; amount: string | null; decimals: number | null; icon?: string; usd: string | null; share: number | null; block: number | null }
const record = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
export function safeTokenIcon(x: unknown): string | undefined {
  if (typeof x !== "string" || x.length > 100000) return;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x)) return x;
  try { const u = new URL(x); if (u.protocol === "https:" && !u.username && !u.password) return u.href; } catch {}
}
export function tokenMetadata(raw: unknown): Record<string, TokenMetadata> {
  const out: Record<string, TokenMetadata> = {};
  for (const [id, value] of Object.entries(record(raw))) {
    const m = record(value);
    if (!Number.isInteger(m.decimals) || Number(m.decimals) < 0 || Number(m.decimals) > 36 || typeof m.symbol !== "string") continue;
    out[id] = { symbol: m.symbol.slice(0,32), name: String(m.name ?? m.symbol).slice(0,100), decimals: Number(m.decimals), icon: safeTokenIcon(m.icon) };
  }
  return out;
}
/** Prices resolved by exact contract and matching decimals; no ticker-based valuation. */
export function pricedValue(raw: string, decimals: number, price: unknown): bigint | null {
  const p = record(price);
  if (p.decimal !== decimals || typeof p.price !== "string" || !/^\d+(\.\d+)?$/.test(p.price) || p.price.length > 512) return null;
  const [whole, fraction = ""] = p.price.split(".");
  const scaled = BigInt(whole) * 10n ** 12n + BigInt(fraction.slice(0,12).padEnd(12,"0"));
  if (scaled <= 0n) return null;
  return BigInt(raw) * scaled / 10n ** BigInt(decimals);
}
export function indexedHoldings(raw: unknown, metadata: Record<string, TokenMetadata>, prices: unknown, address: string) {
  const source = record(raw);
  if (source.account_id !== address || !Array.isArray(source.tokens)) throw new Error("Wallet inventory did not match the requested account.");
  const all = new Map<string, {raw: string; block: number | null}>();
  const state = record(source.state);
  if (typeof state.balance === "string" && /^\d{1,80}$/.test(state.balance)) all.set("native", {raw:state.balance,block:null});
  for (const input of source.tokens.slice(0,1000)) {
    const t = record(input);
    if (typeof t.contract_id !== "string" || !/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(t.contract_id) || typeof t.balance !== "string" || !/^\d{1,80}$/.test(t.balance) || BigInt(t.balance) === 0n) continue;
    all.set(t.contract_id, {raw:t.balance,block:Number.isSafeInteger(t.last_update_block_height) ? Number(t.last_update_block_height) : null});
  }
  const priceMap = record(prices);
  const entries = [...all].filter(([,v]) => BigInt(v.raw)>0n).map(([contract,v]) => {
    const m = contract === "native" ? {symbol:"NEAR",name:"NEAR Protocol",decimals:24,icon:undefined} : metadata[contract];
    const usdRaw = m ? pricedValue(v.raw,m.decimals,priceMap[contract === "native" ? "wrap.near" : contract]) : null;
    return {contract,...v,symbol:m?.symbol || contract.slice(0,12),name:m?.name || "Unknown token · check contract",decimals:m?.decimals ?? null,amount:m ? decimal(BigInt(v.raw),m.decimals) : null,icon:m?.icon,usdRaw};
  });
  const total = entries.reduce((n,e)=>n+(e.usdRaw ?? 0n),0n);
  const holdings: WatchedHolding[] = entries.sort((a,b)=>a.usdRaw === b.usdRaw ? a.contract.localeCompare(b.contract) : (a.usdRaw ?? -1n) > (b.usdRaw ?? -1n) ? -1 : 1).map(({usdRaw,...h})=>({...h,usd:usdRaw===null?null:decimal(usdRaw,12),share:usdRaw!==null && total>0n ? Number(usdRaw*10000n/total)/100 : null}));
  const pools = Array.isArray(source.pools) ? source.pools.map(p=>record(p).pool_id).filter((p):p is string=>typeof p==="string" && /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(p)).slice(0,30) : [];
  return {holdings,pricedTotal:decimal(total,12),unpriced:holdings.filter(h=>h.usd===null).length,pools,inventoryTruncated:source.tokens.length>1000};
}
export interface WatchedTransaction { hash: string; at: number | null; from: string; to: string; actions: string[]; status: string; tokens: {contract:string;symbol:string;amount:string | null;direction:string}[] }
export function walletActivity(raw: unknown, transfers: unknown, metadata: Record<string,TokenMetadata>, address: string): WatchedTransaction[] {
  const txns = record(raw).txns;
  if (!Array.isArray(txns)) throw new Error("Transaction history unavailable.");
  const ft = record(transfers).txns;
  const unique = new Map<string,WatchedTransaction>();
  for (const input of txns.slice(0,100)) {
    const t=record(input), hash=t.transaction_hash;
    if (typeof hash!=="string" || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)) continue;
    const actions = Array.isArray(t.actions) ? t.actions.map(x=>{const a=record(x);return String(a.method || a.action || "Transaction").slice(0,60);}) : [];
    const old=unique.get(hash);
    if (old) {old.actions=[...new Set([...old.actions,...actions])];if(t.predecessor_account_id===address){old.from=address;old.to=String(t.receiver_account_id ?? "Unknown");}continue;}
    const ts=typeof t.block_timestamp==="string" && /^\d{10,22}$/.test(t.block_timestamp) ? Number(BigInt(t.block_timestamp)/1000000n) : null;
    const ok=record(t.outcomes).status ?? record(t.receipt_outcome).status;
    const legs = Array.isArray(ft) ? ft.filter(x=>record(x).transaction_hash===hash).flatMap(x=>{
      const f=record(x), c=record(f.ft).contract ?? f.contract_account_id;
      const contract=typeof c==="string" ? c : typeof f.contract_account_id==="string" ? f.contract_account_id : "";
      const meta=metadata[contract], delta=f.delta_amount;
      if (!contract) return [];
      const amount=meta && typeof delta==="string" && /^-?\d{1,80}$/.test(delta) ? decimal(BigInt(delta)<0n?-BigInt(delta):BigInt(delta),meta.decimals) : null;
      return [{contract,symbol:meta?.symbol || contract,amount,direction:f.affected_account_id===address && typeof delta==="string" ? delta.startsWith("-")?"Out":"In" : "Transfer"}];
    }) : [];
    unique.set(hash,{hash,at:ts,from:String(t.predecessor_account_id ?? "Unknown"),to:String(t.receiver_account_id ?? "Unknown"),actions,status:ok===true?"Succeeded":ok===false?"Failed":"Unknown",tokens:legs});
  }
  return [...unique.values()].sort((a,b)=>(b.at??0)-(a.at??0));
}
