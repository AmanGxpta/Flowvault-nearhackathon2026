import { AAVE_MARKETS } from "./aave-markets.ts";
import { hashText, word, words } from "./aave-abi.ts";
import { isAave, type AaveTx } from "./aave.ts";
import type { LendingPreparation } from "./lending.ts";
export interface AaveReceiptProof { index: number; state: "pending" | "confirmed" | "failed"; message: string; amountRaw?: string; gasWei?: string; blockHash?: string; hash?: string }
const eq = (a: unknown,b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
export function matchAaveTx(tx: any, expected: AaveTx) {
  return eq(tx?.from,expected.from) && eq(tx?.to,expected.to) && eq(tx?.input ?? tx?.data,expected.data) && BigInt(tx?.value ?? "-1") === 0n && BigInt(tx?.chainId ?? "-1") === BigInt(expected.chainId);
}
/** RPC caller establishes canonical finalized block and request time. This verifies reviewed calldata
 * and protocol + underlying events independently; a wallet hash/success bit is insufficient. */
export function verifyAaveReceipt(tx: any, receipt: any, prep: LendingPreparation): AaveReceiptProof {
  if (!isAave(prep)) throw new Error("Not an Aave preparation.");
  const index = prep.evm.transactions.findIndex(t => matchAaveTx(tx,t));
  if (index < 0 || !eq(receipt?.transactionHash,tx.hash) || !eq(receipt?.from,prep.accountId) || !eq(receipt?.to,prep.evm.transactions[index].to)) throw new Error("Receipt/transaction does not match the reviewed Aave call.");
  const base = { index, hash: tx.hash, blockHash: receipt.blockHash };
  if (!receipt.blockHash) return { ...base,state:"pending",message:"Waiting for mined receipt." };
  const gasWei = prep.evm.chain === "base" && typeof receipt.l1Fee !== "string" ? undefined : (BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)+BigInt(receipt.l1Fee??"0x0")).toString();
  if (BigInt(receipt.status) === 0n) return { ...base,gasWei,state:"failed",message:"Aave call reverted. Earlier approvals may remain; inspect before retrying." };
  if (BigInt(receipt.status) !== 1n || !Array.isArray(receipt.logs)) return { ...base,state:"pending",message:"Receipt status/logs unavailable." };
  const owner = "0x"+word(prep.accountId), token = "0x"+word(prep.tokenId), pool = AAVE_MARKETS[prep.evm.chain].pool;
  const logs = receipt.logs.filter((l:any) => !l.removed && eq(l.transactionHash,tx.hash) && eq(l.blockHash,receipt.blockHash));
  const find = (addr: string,sig: string) => logs.filter((l:any) => eq(l.address,addr) && eq(l.topics?.[0],"0x"+hashText(sig)));
  if (index < prep.evm.transactions.length-1) {
    const approval = find(prep.tokenId,"Approval(address,address,uint256)").filter((l:any) => eq(l.topics[1],owner) && eq(l.topics[2],"0x"+word(pool)) && words(l.data)[0] === BigInt(prep.amountRaw));
    return { ...base,gasWei,state:approval.length===1?"confirmed":"pending",message:approval.length===1?"Exact token approval finalized; principal has not moved.":"Approval event unverified." };
  }
  const spec = prep.kind === "borrow" ? "Borrow(address,address,address,uint256,uint8,uint256,uint16)" : prep.kind === "repay" ? "Repay(address,address,address,uint256,bool)" : prep.kind === "collateral_add" ? "Supply(address,address,address,uint256,uint16)" : "Withdraw(address,address,address,uint256)";
  const matches = find(pool,spec).filter((l:any) => eq(l.topics[1],token) && eq(l.topics[2],owner));
  if (matches.length!==1) return { ...base,gasWei,state:"pending",message:"Exact Aave economic event unavailable; do not retry." };
  const e = matches[0], data = words(e.data);
  let amount: bigint;
  if (prep.kind === "borrow" || prep.kind === "collateral_add") {
    if (data[0] !== BigInt(prep.accountId) || (prep.kind === "borrow" && data[2] !== 2n)) throw new Error("Aave owner/rate mode mismatch.");
    amount=data[1];
  } else { if (!eq(e.topics[3],owner)) throw new Error("Aave beneficiary mismatch."); amount=data[0]; }
  if (amount<=0n || (prep.kind === "repay" ? amount>BigInt(prep.amountRaw) : amount!==BigInt(prep.amountRaw))) throw new Error("Aave event amount mismatch.");
  if (prep.kind === "repay" && data[1] !== 0n) throw new Error("Unexpected aToken repayment.");
  const incoming = prep.kind === "borrow" || prep.kind === "collateral_release";
  const transfer = find(prep.tokenId,"Transfer(address,address,uint256)").filter((l:any) => eq(l.topics[incoming?2:1],owner) && words(l.data)[0]===amount);
  if (transfer.length!==1) return {...base,gasWei,state:"pending",message:"Underlying token movement unverified."};
  return { ...base,gasWei,state:"confirmed",amountRaw:amount.toString(),message:"Aave principal, beneficiary and underlying token movement verified in canonical finalized receipt." };
}
