"use client";
/* eslint-disable @next/next/no-img-element -- tiny bundled logos and token-metadata icons have explicit dimensions and need no remote optimizer */
import { useState } from "react";
import { tokenMarks, networkMarks } from "./brand-marks";

/** Bundled token logos in public/assets/tokens, by symbol. */
const TOKEN_FILES: Record<string, string> = {
  USDC: "usdc.png", "USDC.E": "usdc.png", USDT: "usdt.png", "USDT.E": "usdt.png", DAI: "dai.png", ETH: "eth.png", WETH: "eth.png",
  NEAR: "near.jpg", WNEAR: "near.jpg", SOL: "sol.png", BTC: "btc.png", WBTC: "wbtc.png", NBTC: "btc.png", RHEA: "rhea.svg", REF: "rhea.svg",
  BNB: "bnb.png", AVAX: "avax.png", POL: "pol.png", MATIC: "pol.png", AURORA: "aurora.jpg", STNEAR: "stnear.svg", LINEAR: "linear.svg",
  BANAN: "banan.svg", BLACKDRAGON: "black.svg", BRRR: "brrr.svg", DUST: "dust.svg", FIN: "fin.svg", GLOW: "glow.svg", HONEY: "honey.svg",
  HOT: "hot.svg", JUMBO: "jumbo.svg", LONK: "lonk.svg", META: "meta.svg", MIRAGE: "mirage.svg", MOCHI: "mochi.svg", NEKO: "neko.svg",
  OCT: "oct.svg", PARAS: "paras.svg", PEM: "pem.svg", PULSAR: "pulsar.svg", SHARD: "shard.svg", SHIBA: "shiba.svg", STRAY: "stray.svg",
  SWEAT: "sweat.svg", VOID: "void.svg", YAK: "yak.svg",
};
/** Bundled network logos in public/assets/chains, by FlowVault / 1Click network id. */
const CHAIN_FILES: Record<string, [string, string]> = {
  near: ["NEAR", "/assets/tokens/near.jpg"], eth: ["Ethereum", "/assets/tokens/eth.png"], base: ["Base", "/assets/chains/base.png"],
  arb: ["Arbitrum", "/assets/chains/arbitrum.png"], solana: ["Solana", "/assets/chains/solana.png"], sol: ["Solana", "/assets/chains/solana.png"],
  bnb: ["BNB Chain", "/assets/chains/bnb.png"], bsc: ["BNB Chain", "/assets/chains/bnb.png"], btc: ["Bitcoin", "/assets/chains/bitcoin.png"],
  hyperliquid: ["Hyperliquid", "/assets/chains/hyperliquid.png"], hypercore: ["Hyperliquid", "/assets/chains/hyperliquid.png"], avax: ["Avalanche", "/assets/chains/avalanche.png"], pol: ["Polygon", "/assets/chains/polygon.png"],
  op: ["Optimism", "/assets/chains/optimism.png"], gnosis: ["Gnosis", "/assets/chains/gnosis.png"], tron: ["Tron", "/assets/chains/tron.png"],
  ton: ["TON", "/assets/chains/ton.png"], sui: ["Sui", "/assets/chains/sui.png"], aptos: ["Aptos", "/assets/chains/aptos.png"], doge: ["Dogecoin", "/assets/chains/doge.png"],
  xrp: ["XRP Ledger", "/assets/chains/xrp.png"], zec: ["Zcash", "/assets/chains/zec.png"], ltc: ["Litecoin", "/assets/chains/ltc.png"], bera: ["Berachain", "/assets/chains/bera.png"],
  cardano: ["Cardano", "/assets/chains/cardano.png"], stellar: ["Stellar", "/assets/chains/stellar.png"], starknet: ["Starknet", "/assets/chains/starknet.png"],
  monad: ["Monad", "/assets/chains/monad.png"], scroll: ["Scroll", "/assets/chains/scroll.png"], abstract: ["Abstract", "/assets/chains/abstract.png"],
  bch: ["Bitcoin Cash", "/assets/chains/bch.png"], dash: ["Dash", "/assets/chains/dash.png"], aleo: ["Aleo", "/assets/chains/aleo.png"],
  plasma: ["Plasma", "/assets/chains/plasma.png"], xlayer: ["X Layer", "/assets/chains/xlayer.jpg"], adi: ["ADI", "/assets/chains/adi.png"],
};
export function tokenLogo(symbol: string): string | undefined {
  const k = symbol.toUpperCase(); const f = TOKEN_FILES[k];
  return f ? "/assets/tokens/" + f : tokenMarks[k];
}
export function networkInfo(network: string): { name: string; image: string } | undefined {
  const c = CHAIN_FILES[network];
  return c ? { name: c[0], image: c[1] } : networkMarks[network];
}

/** `core` marks assets resolved by FlowVault's adapters or the curated catalog: their bundled logo wins over a
 * metadata icon. Other tokens use their on-chain metadata icon, then a bundled logo by symbol, then initials. */
export function TokenIcon({ symbol, network, core: trusted = false, size = 36, image }: { symbol: string; network?: string; core?: boolean; size?: number; image?: string }) {
  const [failed, setFailed] = useState(0);
  const sources = [trusted ? tokenLogo(symbol) : undefined, image, trusted ? undefined : tokenLogo(symbol)].filter((x): x is string => !!x);
  const src = sources[failed];
  const net = network ? networkInfo(network) : undefined;
  return <span className="fv-asset-icon" style={{ width: size, height: size }}>
    {src ? <img referrerPolicy="no-referrer" src={src} alt="" width={size} height={size} onError={() => setFailed(n => n + 1)} /> : <span aria-hidden>{symbol.slice(0, 2)}</span>}
    {net && <img className="fv-chain-badge" src={net.image} title={net.name} alt="" width={15} height={15} />}
  </span>;
}
export function NetworkLabel({ network, iconOnly = false }: { network: string; iconOnly?: boolean }) {
  const item = networkInfo(network);
  return <span className="fv-network">{item && <img src={item.image} alt="" width={16} height={16} />}{!iconOnly && (item?.name ?? network)}</span>;
}
