/** Simplified token and network marks authored for FlowVault as inline SVG. They identify an asset or network
 * (nominative use); they are not copies of any project's artwork files. Unknown assets fall back to initials. */
const svg = (body: string, bg: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${bg}"/>${body}</svg>`);

const marks = {
  usdc: svg(`<path d="M16 6.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="7 3"/><text x="16" y="21" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="13" fill="#fff">$</text>`, "#2775CA"),
  usdt: svg(`<path d="M9 9.5h14v3h-5.5v2.1c3.2.2 5.6.9 5.6 1.7s-2.4 1.5-5.6 1.7V24h-3v-6c-3.2-.2-5.6-.9-5.6-1.7s2.4-1.5 5.6-1.7v-2.1H9Z" fill="#fff"/>`, "#26A17B"),
  eth: svg(`<path d="m16 5 6.5 11L16 20l-6.5-4Z" fill="#fff" opacity=".95"/><path d="m16 21.3 6.5-4L16 27l-6.5-9.7Z" fill="#fff" opacity=".75"/>`, "#627EEA"),
  near: svg(`<path d="M10 23V9h1.6l8.4 10.4V9H22v14h-1.6L12 12.6V23Z" fill="#fff"/>`, "#111"),
  btc: svg(`<text x="16.5" y="22" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#fff" transform="rotate(12 16 16)">₿</text>`, "#F7931A"),
  sol: svg(`<path d="M10 11h11l-2 2H8Zm0 4h11l-2 2H8Zm2 4h11l-2 2H10Z" fill="#fff"/>`, "#1B1B2F"),
  rhea: svg(`<path d="M9 22c2-7 5-10 7-12 2 2 5 5 7 12-3-2-5-3-7-3s-4 1-7 3Z" fill="#fff"/>`, "#0D7C66"),
  bnb: svg(`<path d="m16 7 3 3-3 3-3-3Zm-6 6 3 3-3 3-3-3Zm12 0 3 3-3 3-3-3Zm-6 6 3 3-3 3-3-3Zm0-6 3 3-3 3-3-3Z" fill="#fff"/>`, "#F0B90B"),
  base: svg(`<path d="M16 25a9 9 0 1 0-8.9-10.3h11.8v2.6H7.1A9 9 0 0 0 16 25Z" fill="#fff"/>`, "#0052FF"),
  arb: svg(`<path d="M16 6.5 24.5 11v10L16 25.5 7.5 21V11Z" fill="none" stroke="#9DCCED" stroke-width="1.6"/><path d="m13 20 4-10h2l-4 10Zm4 0 2.4-6 1.6 4-1 2Z" fill="#fff"/>`, "#213147"),
  hyperliquid: svg(`<path d="M8 17c2-6 4-6 6-1s4 5 6 0 3-4 4-1c-1 6-4 7-6 2s-4-5-6 0-3 4-4 0Z" fill="#0B2E2B"/>`, "#97FCE4"),
} as const;

export const tokenMarks: Record<string, string> = {
  USDC: marks.usdc, "USDC.E": marks.usdc, USDT: marks.usdt, "USDT.E": marks.usdt, ETH: marks.eth, WETH: marks.eth,
  NEAR: marks.near, WNEAR: marks.near, SOL: marks.sol, BTC: marks.btc, WBTC: marks.btc, NBTC: marks.btc, RHEA: marks.rhea, BNB: marks.bnb,
};
export const networkMarks: Record<string, { name: string; image: string }> = {
  near: { name: "NEAR", image: marks.near }, base: { name: "Base", image: marks.base }, arb: { name: "Arbitrum", image: marks.arb },
  eth: { name: "Ethereum", image: marks.eth }, solana: { name: "Solana", image: marks.sol }, sol: { name: "Solana", image: marks.sol },
  bnb: { name: "BNB Chain", image: marks.bnb }, bsc: { name: "BNB Chain", image: marks.bnb }, btc: { name: "Bitcoin", image: marks.btc },
  hyperliquid: { name: "Hyperliquid", image: marks.hyperliquid },
};
