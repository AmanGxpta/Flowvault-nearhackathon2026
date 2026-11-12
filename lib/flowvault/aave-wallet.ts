import type { LendingPreparation } from "./lending.ts";
import { isAave } from "./aave.ts";
import { AAVE_MARKETS } from "./aave-markets.ts";
import { EVM_CHAINS } from "./evm.ts";
import { calldata } from "./aave-abi.ts";
/** Browser allowlist: no arbitrary EVM calls or unlimited approvals can reach the wallet. */
export function validateAaveWallet(p:LendingPreparation) {
  if(!isAave(p) || !/^\d+$/.test(p.amountRaw) || BigInt(p.amountRaw)<=0n) throw new Error("Invalid Aave preparation.");
  const m=AAVE_MARKETS[p.evm.chain],r=[...m.collateral,m.debt].find(x=>x.id===p.tokenId && x.symbol===p.asset && x.decimals===p.decimals);
  if(!r) throw new Error("Unrecognized Aave token identity.");
  const n=BigInt(p.amountRaw),owner=p.accountId;
  const call=p.kind==="borrow"?calldata("borrow(address,uint256,uint256,uint16,address)",r.id,n,2n,0n,owner):p.kind==="repay"?calldata("repay(address,uint256,uint256,address)",r.id,n,2n,owner):p.kind==="collateral_add"?calldata("supply(address,uint256,address,uint16)",r.id,n,owner,0n):calldata("withdraw(address,uint256,address)",r.id,n,owner);
  const txs=p.evm.transactions;
  if(txs.length<1 || txs.length>2 || (p.kind==="borrow" && !p.approvedNewDebt)) throw new Error("Invalid Aave wallet call sequence.");
  txs.forEach((t,i)=>{
    const approval=i<txs.length-1;
    if(t.chainId !== "0x"+EVM_CHAINS[p.evm.chain].chainId.toString(16) || t.from!==owner || t.value!=="0x0" || t.to!==(approval?r.id:m.pool) || t.data!==(approval?calldata("approve(address,uint256)",m.pool,n):call) || (approval && !["collateral_add","repay"].includes(p.kind))) throw new Error("Aave payload does not match reviewed operation.");
  });
  return p.evm;
}
