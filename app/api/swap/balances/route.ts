import { session, json, failure } from "@/lib/flowvault/store";
import { mayRead } from "@/lib/flowvault/account-registry";
import { evmRpc, hexQuantity, EVM_CHAINS } from "@/lib/flowvault/evm";

/** Current (latest-block) native and USDC balances of one proven EVM wallet, for the swap form. The portfolio
 * deliberately reads finalized blocks for planning (Ethereum finalizes ~13–15 minutes behind), which is too stale
 * to size a swap right after another one. Read-only; only wallets proven to this workspace. */
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const q = new URL(r.url).searchParams;
    const chain = q.get("chain") as "eth" | "base" | "arb", address = q.get("address") ?? "";
    if (!["eth", "base", "arb"].includes(chain) || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Choose a supported network and address.");
    if (s.workspace.mode !== "live" || !mayRead(s.workspace, "evm", address)) throw new Error("FlowVault reads only wallets you have connected.");
    const usdc = EVM_CHAINS[chain].usdc;
    const [native, token] = await Promise.all([
      evmRpc(chain, "eth_getBalance", [address, "latest"]).then(hexQuantity),
      evmRpc(chain, "eth_call", [{ to: usdc, data: "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0") }, "latest"]).then(hexQuantity),
    ]);
    return json({ chain, address, nativeRaw: native.toString(), usdcRaw: token.toString(), usdc, block: "latest", capturedAt: new Date().toISOString() }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
