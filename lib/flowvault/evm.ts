import { decimal } from "./money.ts";
export const EVM_CHAINS = {
  base: {
    rpc: "https://mainnet.base.org",
    fallback: "https://base-rpc.publicnode.com",
    chainId: 8453n,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org",
  },
  arb: {
    rpc: "https://arb1.arbitrum.io/rpc",
    fallback: "https://arbitrum-one-rpc.publicnode.com",
    chainId: 42161n,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    explorer: "https://arbiscan.io",
  },
  bnb: {
    rpc: "https://bsc-dataseed.bnbchain.org",
    fallback: "https://bsc-rpc.publicnode.com",
    chainId: 56n,
    usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    explorer: "https://bscscan.com",
  },
  eth: {
    rpc: "https://ethereum-rpc.publicnode.com",
    fallback: "https://eth.drpc.org",
    chainId: 1n,
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    explorer: "https://etherscan.io",
  },
} as const;
export type PayoutChain = keyof typeof EVM_CHAINS;
/** Chains FlowVault reads and takes swap deposits from: the payout chains plus Polygon (not a payout destination). */
export const ORIGIN_CHAINS = { ...EVM_CHAINS, pol: { rpc: "https://polygon-rpc.com", fallback: "https://polygon-bor-rpc.publicnode.com", chainId: 137n, usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", explorer: "https://polygonscan.com" } } as const;
export type OriginChain = keyof typeof ORIGIN_CHAINS;
/** The RPC key for a swap-catalog network id (the catalog says "bsc", the RPC table "bnb"). */
export function rpcChain(network: string): OriginChain {
  const c = ({ eth: "eth", base: "base", arb: "arb", bsc: "bnb", bnb: "bnb", pol: "pol" } as Record<string, OriginChain>)[network];
  if (!c) throw new Error("No RPC for network " + network + ".");
  return c;
}
export function payoutAsset(chain: string, token: string = "USDC") {
  if (
    !["base", "arb", "bnb", "eth"].includes(chain) ||
    !(
      (["USDC"].includes(token) && chain !== "bnb") ||
      (token === "USDT" && ["bnb", "eth"].includes(chain))
    )
  )
    throw new Error("Unsupported payout chain/token.");
  const address =
    token === "USDT"
      ? chain === "bnb"
        ? "0x55d398326f99059ff775485246999027b3197955"
        : "0xdac17f958d2ee523a2206206994597c13d831ec7"
      : EVM_CHAINS[chain as PayoutChain].usdc;
  return {
    chain: chain as PayoutChain,
    token: token as "USDC" | "USDT",
    address,
    decimals: chain === "bnb" ? 18 : 6,
    blockchain: chain === "bnb" ? "bsc" : chain,
    assetId:
      "nep141:" +
      chain +
      "-" +
      address.toLowerCase() +
      "." +
      (chain === "bnb" ? "omdep.near" : "omft.near"),
  };
}
export function payoutSupported(chain: string, token: string) {
  try {
    payoutAsset(chain, token);
    return true;
  } catch {
    return false;
  }
}
export function matchPayoutToken(tokens: any[], chain: string, token: string) {
  const r = payoutAsset(chain, token);
  const t = tokens.find(
    (t) =>
      t.assetId === r.assetId &&
      t.symbol === r.token &&
      t.blockchain === r.blockchain &&
      t.decimals === r.decimals &&
      String(t.contractAddress).toLowerCase() === r.address.toLowerCase(),
  );
  if (!t)
    throw new Error(
      "Configured destination token is unavailable or metadata changed.",
    );
  return t;
}
export function validEvm(address: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address);
}
export function hexQuantity(v: unknown) {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v))
    throw new Error("Invalid EVM RPC quantity.");
  return BigInt(v);
}
export async function evmRpc(
  chain: OriginChain,
  method: string,
  params: unknown[],
) {
  const c = ORIGIN_CHAINS[chain];
  let error = "EVM RPC unavailable.";
  for (const url of [c.rpc, c.fallback]) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "flowvault",
          method,
          params,
        }),
        signal: AbortSignal.timeout(7000),
      });
      const body = (await r.json()) as any;
      if (!r.ok || body.error || !("result" in body))
        throw new Error(body.error?.message ?? "HTTP " + r.status);
      return body.result;
    } catch (e) {
      error = String(e);
    }
  }
  throw new Error("EVM RPC read unavailable: " + error);
}

export async function readEvmUsdc(chain: "base" | "arb", address: string) {
  if (!validEvm(address)) throw new Error("Enter a valid EVM account address.");
  const c = EVM_CHAINS[chain];
  if (hexQuantity(await evmRpc(chain, "eth_chainId", [])) !== c.chainId)
    throw new Error("EVM RPC returned the wrong chain.");
  const block = await evmRpc(chain, "eth_getBlockByNumber", [
    "finalized",
    false,
  ]);
  if (!block?.number || !block.hash)
    throw new Error("Finalized EVM block unavailable.");
  const [precision, balance] = await Promise.all([
    evmRpc(chain, "eth_call", [
      { to: c.usdc, data: "0x313ce567" },
      block.number,
    ]),
    evmRpc(chain, "eth_call", [
      { to: c.usdc, data: "0x70a08231" + address.slice(2).padStart(64, "0") },
      block.number,
    ]),
  ]);
  if (hexQuantity(precision) !== 6n)
    throw new Error("USDC precision does not match this adapter.");
  const raw = hexQuantity(balance);
  return {
    id: `${chain}-usdc-${address.toLowerCase()}`,
    label: `${chain === "base" ? "Base" : "Arbitrum"} wallet USDC`,
    asset: "USDC",
    amount: decimal(raw),
    rawAmount: raw.toString(),
    decimals: 6,
    kind: "wallet" as const,
    chain,
    venue: "wallet",
    accountId: address.toLowerCase(),
    source: "live" as const,
    capturedAt: new Date().toISOString(),
    blockHeight: hexQuantity(block.number).toString(),
    blockHash: block.hash,
    availableAt: new Date().toISOString(),
  };
}

export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export function verifyDestinationReceipt(
  chain: PayoutChain,
  receipt: any,
  canonicalBlock: any,
  finalBlock: any,
  recipient: string,
  amountRaw: string,
  createdAt: string,
  token: "USDC" | "USDT" = "USDC",
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(receipt?.transactionHash ?? ""))
    throw new Error("Invalid destination receipt hash.");
  const c = EVM_CHAINS[chain];
  const asset = payoutAsset(chain, token);
  if (receipt?.status !== "0x1")
    throw new Error("Destination transaction is not successful.");
  if (!validEvm(recipient)) throw new Error("Invalid destination recipient.");
  if (
    !receipt.blockHash ||
    receipt.blockHash !== canonicalBlock?.hash ||
    receipt.blockNumber !== canonicalBlock.number ||
    hexQuantity(finalBlock?.number) < hexQuantity(receipt.blockNumber)
  )
    throw new Error("Destination proof is not canonical and finalized.");
  if (
    hexQuantity(canonicalBlock.timestamp) * 1000n <
    BigInt(Math.floor(Date.parse(createdAt) / 1000) * 1000)
  )
    throw new Error("Destination transfer predates this payment.");
  const matches = (receipt.logs ?? []).filter(
    (l: any) =>
      l.removed !== true &&
      l.address?.toLowerCase() === asset.address.toLowerCase() &&
      l.transactionHash === receipt.transactionHash &&
      l.blockHash === receipt.blockHash &&
      l.topics?.length === 3 &&
      /^0x[0-9a-fA-F]{64}$/.test(l.topics[1] ?? "") &&
      /^0x[0-9a-fA-F]{64}$/.test(l.data ?? "") &&
      l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      l.topics[2]?.toLowerCase() ===
        "0x" + recipient.slice(2).toLowerCase().padStart(64, "0") &&
      hexQuantity(l.data) === BigInt(amountRaw),
  );
  if (matches.length === 1) hexQuantity(matches[0].logIndex);
  if (matches.length !== 1)
    throw new Error(
      "Exact destination token transfer could not be uniquely verified.",
    );
  return {
    chain,
    transactionHash: receipt.transactionHash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber,
    logIndex: hexQuantity(matches[0].logIndex).toString(),
    recipient: recipient.toLowerCase(),
    amountRaw,
    token: asset.address,
    tokenSymbol: token,
    decimals: asset.decimals,
    finalized: true,
    explorerUrl: c.explorer + "/tx/" + receipt.transactionHash,
  };
}
export async function destinationProof(
  chain: PayoutChain,
  hash: string,
  recipient: string,
  amountRaw: string,
  createdAt: string,
  token: "USDC" | "USDT" = "USDC",
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error("Invalid destination transaction hash.");
  if (
    hexQuantity(await evmRpc(chain, "eth_chainId", [])) !==
    EVM_CHAINS[chain].chainId
  )
    throw new Error("Destination RPC returned the wrong chain.");
  const receipt = await evmRpc(chain, "eth_getTransactionReceipt", [hash]);
  if (!receipt) throw new Error("Destination receipt is not available yet.");
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase())
    throw new Error("Destination receipt hash mismatch.");
  const [block, final, precision] = await Promise.all([
    evmRpc(chain, "eth_getBlockByNumber", [receipt.blockNumber, false]),
    evmRpc(chain, "eth_getBlockByNumber", ["finalized", false]),
    evmRpc(chain, "eth_call", [
      { to: payoutAsset(chain, token).address, data: "0x313ce567" },
      receipt.blockNumber,
    ]),
  ]);
  if (hexQuantity(precision) !== BigInt(payoutAsset(chain, token).decimals))
    throw new Error("Destination token decimals changed.");
  return verifyDestinationReceipt(
    chain,
    receipt,
    block,
    final,
    recipient,
    amountRaw,
    createdAt,
    token,
  );
}
