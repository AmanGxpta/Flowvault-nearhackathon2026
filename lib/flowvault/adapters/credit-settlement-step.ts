import { legLedger } from "../funding-mesh";
import { outcomeOf } from "../funding-mesh-live";
import type { StepAdapter } from "../contracts";
import { stepContext } from "../step-adapters";
import { legGet } from "../funding-mesh-store";
import { evmRpc, hexQuantity } from "../evm";
import { EVM_NETWORK_CODE } from "../capabilities";
import { matchAaveTx } from "../aave-receipts";
import { verifyNearUsdcDelivery } from "../lending-venue-proof";
import { attemptsDb } from "../attempts";
/** Independent accounting gate after Stream A's transfer journal, before any payment can quote/deposit. */
export const creditSettlementAdapter:StepAdapter={
  kinds:["credit_settlement"],
  async prepare(){return {state:"submitted"};},
  async check(step,plan){
    const ctx=stepContext(plan),transfer=plan.steps.find(x=>x.kind==="fund_transfer" && x.expected.legId===step.expected.legId);
    if(!transfer?.attemptId || !plan.accountId) return {patch:{},ledger:[]};
    const found=await legGet(ctx.sessionId,transfer.attemptId),leg=found?.leg;
    if(!leg || leg.state!=="confirmed" || !leg.txHash || leg.tx.kind!=="evm" || !["ethereum","base","arbitrum"].includes(leg.network)) return {patch:{},ledger:[]};
    const chain=EVM_NETWORK_CODE[leg.network as "ethereum"|"base"|"arbitrum"];
    const [tx,receipt,final]=await Promise.all([evmRpc(chain,"eth_getTransactionByHash",[leg.txHash]),evmRpc(chain,"eth_getTransactionReceipt",[leg.txHash]),evmRpc(chain,"eth_getBlockByNumber",["finalized",false])]);
    if(!tx || !receipt || !matchAaveTx(tx,{...leg.tx,value:"0x0"}) || tx.hash!==leg.txHash || receipt.status!=="0x1" || receipt.transactionHash!==leg.txHash || !final?.number || hexQuantity(final.number)<hexQuantity(receipt.blockNumber)) return {patch:{state:"submitted"},ledger:[]};
    const block=await evmRpc(chain,"eth_getBlockByNumber",[receipt.blockNumber,false]);
    if(block?.hash!==receipt.blockHash || tx.blockHash!==receipt.blockHash || Number(hexQuantity(block.timestamp))*1000<Date.parse(leg.createdAt)-1000) throw new Error("Settlement source is not a canonical reviewed transfer.");
    if(!leg.deliveredRaw || BigInt(leg.deliveredRaw)<BigInt(step.expected.amountRaw??"0")) return {patch:{state:"partial"},ledger:[]};
    const proof=await verifyNearUsdcDelivery(leg.destinationHashes,plan.accountId,BigInt(leg.deliveredRaw),leg.createdAt);
    if(!proof)return {patch:{state:"submitted"},ledger:[]};
    const db=await attemptsDb(),claim="near-payout:"+proof.receiptId;
    await db.prepare("INSERT OR IGNORE INTO wallet_hashes(hash,attempt_id) VALUES (?,?)").bind(claim,step.id).run();
    const row=await db.prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?").bind(claim).first<{attempt_id:string}>();
    if(row?.attempt_id!==step.id) throw new Error("Settlement payout already claimed by another operation.");
    const funding=plan.alternatives.find(a=>a.id===plan.selectedChoiceId)?.creditSettlement?.leg;
    if(!funding) throw new Error("Credit settlement source lost.");
    return {patch:{state:"confirmed",actual:{amountRaw:proof.amountRaw,asset:"USDC",usdcRaw:proof.amountRaw,evidence:proof}},ledger:legLedger(outcomeOf(leg),funding,{legJournalId:leg.id,planId:plan.id,stepId:step.id,source:plan.source})};
  },
};
