// Fictional connected wallets for the example workspace: what someone sees after connecting several wallets of
// their own. The mix mirrors what real wallets hold (majors and memecoins across a dozen chains, dust,
// LP legs, a loan, staking, locked tokens, rewards, NFTs); every address, amount and value is
// made up.
import type { NftHolding, Position } from "./types.ts";
import { wholeWalletAsset } from "./asset-scope.ts";

export const EXAMPLE_WALLETS = {
  main: { address: "0x71c9b3e4f0a2d5c8e1b7f3a6d9c2e5b8f1a4a9e2", label: "Main EVM" },
  defi: { address: "0x4b2e8d1f6a3c9e5b7d2f0a8c4e6b1d3f5a7c7f10", label: "DeFi wallet" },
  alt: { address: "0x9d51c7a2e4b6f8d0c3a5e7b9d1f2a4c6e8b03a0c", label: "Alt-chain wallet" },
  sol: { address: "7Hq2mVx9cPz4LwT8bN3fRk6YdJ1sAeGu5oQiXnBkR4p", label: "Solana wallet" },
} as const;

type W = keyof typeof EXAMPLE_WALLETS;
const LEGACY: Record<string, Position["chain"]> = { Ethereum: "eth", Base: "base", Arbitrum: "arb", "BNB Chain": "bnb", Solana: "solana" };
// [wallet, network, symbol, amount, usd (null = no market price), kind, protocol, group]
type Row = [W, string, string, string, string | null, Position["kind"]?, string?, string?];
const ROWS: Row[] = [
  // DeFi wallet: Ethereum-heavy, L2 gas, memecoins, dust, and most of the DeFi.
  ["defi", "Ethereum", "ETH", "0.42", "1354.50"],
  ["defi", "Ethereum", "ZRO", "180", "286.20"],
  ["defi", "Ethereum", "LDO", "95", "171.00"],
  ["defi", "Ethereum", "PEPE", "18000000", "180.00"],
  ["defi", "Ethereum", "SHIB", "3500000", "84.00"],
  ["defi", "Ethereum", "STG", "520", "70.20"],
  ["defi", "Ethereum", "MOG", "400000000", "52.00"],
  ["defi", "Ethereum", "USDT", "240", "240.00"],
  ["defi", "Ethereum", "KAON", "353546", "0.42"],
  ["defi", "Ethereum", "TPU", "17074", "0.18"],
  ["defi", "Ethereum", "QQQ", "110732", "0.07"],
  ["defi", "Optimism", "ETH", "0.03", "96.75"],
  ["defi", "zkSync Era", "ETH", "0.0015", "4.84"],
  ["defi", "Ethereum", "USDC", "410", "410.00", "supplied", "Uniswap V2", "uni-usdc-eth"],
  ["defi", "Ethereum", "ETH", "0.128", "412.80", "supplied", "Uniswap V2", "uni-usdc-eth"],
  ["defi", "Ethereum", "USDC", "1200", "1200.00", "supplied", "Aave V3"],
  ["defi", "Ethereum", "USDT", "350", "350.00", "debt", "Aave V3"],
  ["defi", "Ethereum", "stETH", "0.75", "2418.75", "staking", "Lido"],
  ["defi", "Ethereum", "ATH", "6000", "26.40", "staking", "Aethir"],
  ["defi", "Ethereum", "BUBBLE", "90000", "1.82", "staking", "Imaginary Ones"],
  ["defi", "Ethereum", "SHIFU", "9200000", "25.50", "staking", "SHIFU"],
  // Alt-chain wallet: Polygon, BNB Chain, Avalanche, Arbitrum, Base, Gnosis.
  ["alt", "Polygon", "WEFI", "38000", "190.00"],
  ["alt", "Polygon", "POL", "120", "28.80"],
  ["alt", "Polygon", "CATHEON", "3404", "0.24"],
  ["alt", "Polygon", "WEFI", "9000", "45.00", "supplied", "WeFi"],
  ["alt", "BNB Chain", "BNB", "0.42", "260.40"],
  ["alt", "BNB Chain", "CAKE", "85", "210.80"],
  ["alt", "BNB Chain", "UNCX", "1.2", "22.10"],
  ["alt", "BNB Chain", "MINION", "7777777", "0.01"],
  ["alt", "Ethereum", "DAO", "4200", "77.70", "staking", "DAO Maker"],
  ["alt", "BNB Chain", "CAT", "190217", "1.02", "staking", "DAO Maker"],
  ["alt", "BNB Chain", "FINC", "942", "0.29", "staking", "DAO Maker"],
  ["alt", "Avalanche", "AVAX", "6.2", "180.40"],
  ["alt", "Avalanche", "JOE", "300", "90.00"],
  ["alt", "Arbitrum", "ARB", "410", "139.40"],
  ["alt", "Arbitrum", "CARV", "25", "9.25", "staking", "CARV"],
  ["alt", "Base", "AERO", "220", "184.80"],
  ["alt", "Base", "BRETT", "1500", "109.50"],
  ["alt", "Base", "DEGEN", "9000", "30.60"],
  ["alt", "Base", "toby", "591549294", "0.96"],
  ["alt", "Gnosis", "XDAI", "12", "12.00"],
  // Solana wallet.
  ["sol", "Solana", "SOL", "3.4", "561.00"],
  ["sol", "Solana", "JUP", "420", "302.40"],
  ["sol", "Solana", "BONK", "12000000", "240.00"],
  ["sol", "Solana", "USDC", "85", "85.00"],
  ["sol", "Solana", "JitoSOL", "1.1", "204.60", "staking", "Jito"],
];

export function exampleWalletPositions(valuation: (usd: string) => Position["valuation"], capturedAt: string): Position[] {
  return ROWS.map(([w, network, asset, amount, usd, kind = "wallet", venue, groupId], i) => {
    const wallet = EXAMPLE_WALLETS[w];
    return {
      id: `example:${w}:${i}`,
      label: venue ? `${venue} · ${asset} · fictional` : `${asset} on ${network} · fictional`,
      asset: wholeWalletAsset(asset, network),
      displayAsset: asset,
      amount,
      kind,
      chain: LEGACY[network],
      network,
      venue: venue ?? "wallet",
      groupId,
      accountId: wallet.address,
      accountLabel: wallet.label,
      source: "demo",
      capturedAt,
      fictional: true,
      ownership: "owner",
      availableAt: kind === "wallet" ? capturedAt : null,
      availabilityIsEstimate: kind !== "wallet",
      valuation: usd === null ? null : valuation(usd),
    } as Position;
  });
}

/** Public-domain (CC0) Nouns artwork bundled in public/assets/example-nfts, one per fictional NFT (see NOTICE). */
const ART = [7, 18, 25, 40, 52, 64, 77, 91, 108, 123, 140, 166, 199, 233, 260, 301, 344].map((n) => `/assets/example-nfts/noun-${n}.png`);
// [wallet, network, name, collection, floor usd]
const NFTS: [W, string, string, string, number | null][] = [
  ["defi", "Ethereum", "Lunaria Imaginator", "Particle Packs", 62.1],
  ["defi", "Ethereum", "Crystalia Noblebright", "Particle Packs", 62.1],
  ["defi", "Ethereum", "Noctilume Farmer", "Particle Packs", 62.1],
  ["defi", "Ethereum", "Orbit Pass #318", "Orbit Pass", 118.4],
  ["defi", "Ethereum", "Orbit Pass #902", "Orbit Pass", 118.4],
  ["defi", "Ethereum", "Tidal Key #77", "Tidal Keys", 24.3],
  ["defi", "Ethereum", "Verified Human #49085", "World ID Badge", null],
  ["main", "Base", "Base Day One", "Base Day One", 3.2],
  ["main", "Base", "Pixel Grove #12", "Pixel Grove", 9.5],
  ["main", "Base", "Pixel Grove #418", "Pixel Grove", 9.5],
  ["main", "Arbitrum", "Chain Walker #6", "Chain Walkers", 41],
  ["alt", "Polygon", "Handle #2041", "Handles", 14],
  ["alt", "Polygon", "Gaming Mint Pass", "Mint Pass Originals", 7.8],
  ["alt", "BNB Chain", "Loot Crate #2210", "Loot Crates", 6],
  ["alt", "Optimism", "Quest Badge", "Optimism Quests", null],
  ["sol", "Solana", "Night Fox #4410", "Night Foxes", 88],
  ["sol", "Solana", "Clay Egg #88", "Clay Eggs", 21.5],
];
export function exampleNfts(): NftHolding[] {
  return NFTS.map(([w, network, name, collection, floor], i) => ({
    id: `example-nft:${w}:${i}`,
    name,
    collection,
    network,
    amount: "1",
    floorUsd: floor,
    image: ART[i % ART.length],
    accountId: EXAMPLE_WALLETS[w].address,
  }));
}

/** The fictional NEAR account the example workspace pays from and receives into. */
export const EXAMPLE_NEAR_ACCOUNT = "example-account.near";
const CATALOG_NETWORK: Record<string, string> = { Ethereum: "eth", Base: "base", Arbitrum: "arb", "BNB Chain": "bsc", Polygon: "pol", Solana: "sol", Optimism: "op", Avalanche: "avax", Gnosis: "gnosis" };
/** Spendable wallet balances of the example workspace, for Demo Mode flows: every fictional wallet token on a
 * network the swap catalog knows, plus the example NEAR account's NEAR and USDC. Amounts and values are made up. */
export function exampleWalletHoldings(): { network: string; symbol: string; amount: string; usd: string; account: string }[] {
  const out = ROWS.filter(([, , , , usd, kind]) => (kind ?? "wallet") === "wallet" && usd !== null)
    .filter(([, network]) => CATALOG_NETWORK[network])
    .map(([w, network, symbol, amount, usd]) => ({ network: CATALOG_NETWORK[network], symbol, amount, usd: usd!, account: EXAMPLE_WALLETS[w].address }));
  return [...out, { network: "near", symbol: "NEAR", amount: "42", usd: "134.72", account: EXAMPLE_NEAR_ACCOUNT }, { network: "near", symbol: "USDC", amount: "4", usd: "4.00", account: EXAMPLE_NEAR_ACCOUNT }];
}
