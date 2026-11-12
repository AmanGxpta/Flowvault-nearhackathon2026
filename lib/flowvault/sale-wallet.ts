import type {SalePreparation} from "./sale.ts";
import {calldata} from "./aave-abi.ts";
import {EVM_CHAINS,validEvm} from "./evm.ts";
import {validAccount} from "./near.ts";
import {LENDING_USDC} from "./lending.ts";
export function validateSaleWallet(p:SalePreparation){
  const q=p.sale?.quote,r=q?.request;
  if(!q||q.dry||Date.parse(p.expiresAt)<=Date.now()||p.accountId!==r.accountId||p.tokenId!==r.asset.id||p.decimals!==r.asset.decimals||p.asset!==r.asset.symbol||p.amountRaw!==q.inputRaw)throw new Error("Sale preparation does not match the reviewed asset/amount.");
  if(p.sale.evmTx){
    const chain=r.asset.chain as "eth"|"base"|"arb",tx=p.sale.evmTx,deposit=(q.evidence as any)?.quote?.depositAddress;
    if(q.venueId!=="1click"||!EVM_CHAINS[chain]||!validEvm(deposit)||tx.chainId!=="0x"+EVM_CHAINS[chain].chainId.toString(16)||tx.from!==p.accountId||tx.to!==p.tokenId||tx.value!=="0x0"||tx.data!==calldata("transfer(address,uint256)",deposit,BigInt(p.amountRaw))||p.transactions.length)throw new Error("Sale EVM transfer is not the reviewed deposit.");
    return;
  }
  if(r.asset.chain!=="near"||p.transactions.length!==1)throw new Error("Invalid NEAR sale transaction count.");
  const tx=p.transactions[0],c=tx.actions[0]?.params;
  if(tx.receiverId!==p.tokenId||tx.actions.length!==1||!c||c.deposit!=="1"||c.args.amount!==p.amountRaw)throw new Error("Invalid NEAR sale asset/amount.");
  if(q.venueId==="1click"){
    const deposit=(q.evidence as any)?.quote?.depositAddress;
    if(!validAccount(deposit)||c.methodName!=="ft_transfer"||c.gas!=="50000000000000"||JSON.stringify(c.args)!==JSON.stringify({receiver_id:deposit,amount:p.amountRaw}))throw new Error("Sale deposit changed.");
  }else if(q.venueId==="rhea-ref"){
    const pool=(q.evidence as {poolId:number}).poolId;
    const msg=JSON.stringify({force:0,actions:[{pool_id:pool,token_in:p.tokenId,token_out:LENDING_USDC,amount_in:p.amountRaw,min_amount_out:r.netUsdcRaw}]});
    if(c.methodName!=="ft_transfer_call"||c.gas!=="250000000000000"||JSON.stringify(c.args)!==JSON.stringify({receiver_id:"v2.ref-finance.near",amount:p.amountRaw,msg}))throw new Error("Rhea sale route changed.");
  }else throw new Error("Unknown sale venue.");
}
