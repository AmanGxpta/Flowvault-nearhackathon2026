// Solana USDC funding (owner: Stream A). Slice 2 implements these; until then Solana is not a leg network
// (capabilities.ts LEG_NETWORKS), so nothing reaches them.
import type { LegQuote } from "./funding-mesh-quote";
import type { LegTransaction } from "./funding-mesh-store";

const off = () => new Error("Solana transfers aren't enabled yet. Nothing was prepared.");
export async function solanaUsdcBalance(address: string): Promise<bigint> {
  void address;
  throw off();
}
export async function assertSolFee(address: string): Promise<void> {
  void address;
  throw off();
}
export async function solanaLegTransaction(from: string, q: LegQuote): Promise<LegTransaction> {
  void from;
  void q;
  throw off();
}
export async function solanaTxOutcome(signature: string): Promise<{ failed: boolean; feeRaw: string | null } | null> {
  void signature;
  throw off();
}
