"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- EIP-5792 / EIP-1193 responses are wallet JSON */
// USDC network fees, browser side (owner: Stream A). Asks the wallet what it can do (EIP-5792
// wallet_getCapabilities), and only if it reports a paymaster service and smart-account batching for the chain:
// the owner signs one bounded USDC permit to Circle's paymaster, then the wallet sends the reviewed USDC transfer
// through wallet_sendCalls with FlowVault's ERC-7677 paymaster endpoint. Otherwise the caller pays gas in ETH.
import { evmProvider, type WalletSession } from "./wallets";
import { CHAIN_ID, USDC, transferData, usdcGasSupport, type GasNetwork } from "./gas-abstraction";

type Api = (path: string, body?: unknown, method?: string, scope?: "personal" | "example") => Promise<any>;
export const FUND_NETWORK: Record<string, GasNetwork> = { eth: "ethereum", base: "base", arb: "arbitrum" };
const hexId = (n: GasNetwork) => "0x" + CHAIN_ID[n].toString(16);

export async function detectUsdcGas(session: WalletSession, network: GasNetwork): Promise<{ supported: boolean; reasons: string[] }> {
  const p = session.chain === "evm" ? evmProvider(session.walletId) : null;
  if (!p) return { supported: false, reasons: ["WALLET_UNAVAILABLE"] };
  try {
    const caps = await p.request({ method: "wallet_getCapabilities", params: [session.address, [hexId(network)]] });
    return usdcGasSupport(network, caps?.[hexId(network)] ?? caps?.[CHAIN_ID[network]]);
  } catch {
    return { supported: false, reasons: ["WALLET_NO_CAPABILITIES: the wallet doesn't support EIP-5792"] };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends exactly `tx` (a plain USDC transfer to `depositAddress`) with its fee paid in USDC. Returns the bundle
 * transaction hash and the gas-op id (for the actual charge). Throws before anything is signed if the request
 * isn't the reviewed transfer or the wallet can't do it.
 */
export async function sendWithUsdcGas(session: WalletSession, network: GasNetwork, tx: { chainId: string; from: string; to: string; value: string; data: string }, depositAddress: string, amountRaw: string, api: Api): Promise<{ hash: string; gasId: string }> {
  const p = evmProvider(session.walletId);
  if (!p) throw new Error(session.walletName + " isn't available in this browser.");
  if (tx.from.toLowerCase() !== session.address.toLowerCase() || tx.to.toLowerCase() !== USDC[network] || tx.value !== "0x0" || tx.data.toLowerCase() !== transferData(depositAddress, amountRaw) || tx.chainId !== hexId(network))
    throw new Error("The prepared transfer doesn't match the quote. Nothing was sent.");
  const q = await api("/api/gas", { action: "quote", network, from: session.address, depositAddress, amountRaw }, "POST", "personal");
  if (!q.supported) throw new Error("The fee can't be paid in USDC right now: " + String(q.reason ?? "").replace(/^[A-Z_]+: /, "") + ".");
  const current: string = await p.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== hexId(network)) await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId(network) }] });
  const signature: string = await p.request({ method: "eth_signTypedData_v4", params: [session.address, JSON.stringify(q.typedData)] });
  const { paymasterService } = await api("/api/gas", { action: "permit", id: q.id, signature }, "POST", "personal");
  const sent = await p.request({
    method: "wallet_sendCalls",
    params: [{ version: "2.0.0", chainId: hexId(network), from: session.address, atomicRequired: true, calls: [{ to: tx.to, data: tx.data, value: "0x0" }], capabilities: { paymasterService } }],
  });
  const callsId: string = typeof sent === "string" ? sent : sent?.id;
  if (!callsId) throw new Error(session.walletName + " didn't return a call id.");
  for (let i = 0; i < 90; i++) {
    const st = await p.request({ method: "wallet_getCallsStatus", params: [callsId] }).catch(() => null);
    const code = st?.status;
    const hash = st?.receipts?.[0]?.transactionHash;
    if ((code === 200 || code === "CONFIRMED") && hash) {
      await api("/api/gas", { action: "submitted", id: q.id, callsId, txHash: hash }, "POST", "personal");
      return { hash, gasId: q.id };
    }
    if (code === 400 || code === 500 || code === 600) throw new Error("The wallet reports the operation failed (status " + code + "). Check its activity before sending again.");
    await sleep(2000);
  }
  throw new Error("The wallet hasn't confirmed the operation yet. Check its activity before sending again.");
}
