// Pure, shared by the server reader and the example data.
/** Assets FlowVault's planning, payment and credit code reasons about by symbol. A whole-wallet row for one of them
 * gets a network-qualified asset, so USDC on Polygon is never counted as cash FlowVault can move or plan with. */
const ENGINE_ASSETS = new Set(["USDC", "USDT", "ETH", "NEAR", "WNEAR", "SOL", "LINEAR", "RNEAR"]);
export const wholeWalletAsset = (symbol: string, network: string) => (ENGINE_ASSETS.has(symbol.toUpperCase()) ? `${symbol} (${network})` : symbol);
