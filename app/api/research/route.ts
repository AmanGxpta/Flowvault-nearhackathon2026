import { researchAddress } from "@/lib/flowvault/research";
import { readWatchedNear } from "@/lib/flowvault/research-service";
import { readEvmUsdc } from "@/lib/flowvault/evm";

/** Public, read-only research. Does not create a session, register ownership, or touch financial plans. */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const network = q.get("network") ?? "near";
    const address = researchAddress(network, q.get("address") ?? "");
    if (network === "eth") return Response.json({ researchOnly: true, address, network, positions: [], unavailable: true, coverage: "In-app Ethereum research balances are not supported yet. Open the address in its explorer." });
    const view = network === "near" ? await readWatchedNear(address) : null;
    const evm = view ? null : await readEvmUsdc(network as "base" | "arb", address);
    const result = view ?? { capturedAt: evm!.capturedAt, incomplete: false, warnings: [], positions: [{ label: evm!.label, asset: evm!.asset, amount: evm!.amount, kind: evm!.kind }] };
    return Response.json({ researchOnly: true, address, network, ...result, coverage: view?.coverage ?? "Native USDC only. Other tokens and native gas balances are not included." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ researchOnly: true, error: (e as Error).message }, { status: 400 });
  }
}
