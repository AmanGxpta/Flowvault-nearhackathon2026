// Display formatting shared by the design logic and the live adapters. Floats are display-only.
const now = new Date();
/** Today at 00:00 UTC. */
export const TODAY = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const days = (d: string) => Math.round((Date.parse(d + "T00:00:00Z") - TODAY) / 864e5);
export const dlabel = (d: string) => {
  const x = new Date(d + "T00:00:00Z");
  return MON[x.getUTCMonth()] + " " + x.getUTCDate();
};
export const num = (n: number) =>
  (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n: number) => (n < 0 ? "−$" : "$") + num(Math.abs(n));
export const short = (s: string) => (s && s.length > 16 ? s.slice(0, 6) + "…" + s.slice(-4) : s);
export const iso = (n: number) => new Date(TODAY + n * 864e5).toISOString().slice(0, 10);
export const chainName = (c: string) => ({ near: "NEAR", arb: "Arbitrum", base: "Base", bnb: "BNB Chain", eth: "Ethereum" } as Record<string, string>)[c] ?? c;
export const chainId = (c: string) => ({ NEAR: "near", Arbitrum: "arb", Base: "base", "BNB Chain": "bnb", Ethereum: "eth" } as Record<string, string>)[c] ?? "";
/** Live payout routes the backend executes (BACKEND_API §7): USDC to Base, Arbitrum or Ethereum; USDT to BNB Chain or Ethereum. */
export const livePayoutSupported = (chain: string, token: string) =>
  token === "USDC" ? ["Base", "Arbitrum", "Ethereum"].includes(chain) : token === "USDT" ? ["BNB Chain", "Ethereum"].includes(chain) : false;
export const LIVE_ROUTES_TEXT = "USDC to Base, Arbitrum or Ethereum, or USDT to BNB Chain or Ethereum";
/** Decimal string from the API to a display number; null stays null. */
export const f = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));
/** Money from the API, or "Unavailable" when the API could not establish it. */
export const money = (s: string | null | undefined) => {
  const v = f(s);
  return v === null || !Number.isFinite(v) ? "Unavailable" : usd(v);
};
export const hhmm = (t: string | undefined) => {
  if (!t) return "";
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
};
export const whenLabel = (t: string) => {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return "";
  return MON[d.getMonth()] + " " + d.getDate() + ", " + hhmm(t);
};
