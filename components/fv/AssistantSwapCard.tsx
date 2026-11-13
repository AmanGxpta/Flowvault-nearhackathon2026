"use client";
import { ArrowDownUp, ShieldCheck } from "lucide-react";
import { useTokenCatalog, coreIdentity } from "./useTokenCatalog";
import { TokenIcon } from "./AssetIdentity";

const SWAP = /\b(?:swap|sell|convert|trade|exchange)\s+([\d.]+|half|all)\s*(?:of\s+)?(?:my\s+)?\$?([a-z][a-z0-9.]{1,11})\s+(?:to|for|into)\s+\$?([a-z][a-z0-9.]{1,11})\b/i;
const BUY = /\bbuy\s+(?:([\d.]+)\s*(?:usdc|\$|dollars?)\s+(?:of|worth\s+of)\s+)?\$?([a-z][a-z0-9.]{1,11})\b/i;

/** When a question reads like a swap on NEAR, offer to open it prefilled. It only fills the swap screen: the
 * route comparison, limits check and wallet approval all still happen there. */
export function AssistantSwapCard({ text, open }: { text: string; open: (prefill: string) => void }) {
  const { tokens } = useTokenCatalog();
  const s = SWAP.exec(text), b = s ? null : BUY.exec(text);
  if ((!s && !b) || !tokens.length) return null;
  const find = (sym: string) => { const x = sym.toLowerCase(), near = tokens.filter(t => t.network === "near" && t.symbol.toLowerCase() === x); return near.find(t => t.contract === "native") ?? near.find(t => coreIdentity(t)) ?? near.find(t => t.assetId) ?? near[0]; };
  const from = s ? find(s[2]) : find("USDC"), to = s ? find(s[3]) : find(b![2]);
  const amount = s ? (/^[\d.]+$/.test(s[1]) ? s[1] : "") : b![1] ?? "";
  if (!from || !to || from.id === to.id) return null;
  return <div className="fv-asst-swap">
    <div className="fv-asst-swap-pair"><TokenIcon symbol={from.symbol} network="near" core={coreIdentity(from)} image={from.icon} size={26} /><ArrowDownUp size={14} /><TokenIcon symbol={to.symbol} network="near" core={coreIdentity(to)} image={to.icon} size={26} />
      <span><strong>{amount ? amount + " " : ""}{from.symbol} → {to.symbol}</strong><small><ShieldCheck size={11} /> Best route, checked against your limits{s && !amount ? " · you choose the amount" : ""}</small></span></div>
    <button type="button" className="fv-button fv-primary" onClick={() => open(`${from.id}|${to.id}|${amount}`)}>Open swap</button>
  </div>;
}
