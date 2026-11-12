// Aave extends the existing wallet_attempts + policy budget journal. No second signing state machine.
import { attemptsDb, readAttempt, saveAttempt } from "./attempts";
import { reservePolicy, checkPolicy } from "./policy-store";
import { defaultPolicy, preparationAction } from "./policy";
import { session } from "./store";
import { mayRead } from "./account-registry";
import { appendStep } from "./timeline";
import { isAave, aaveVenue } from "./aave";
import { verifyAaveReceipt } from "./aave-receipts";
import { evmRpc, hexQuantity, EVM_CHAINS } from "./evm";
import { assertSignable, sameTransactions } from "./execution";
import { withCapitalEvidence, readValuationEvidence } from "./valuation-evidence";
import { workspacePortfolio } from "./portfolio-service";
import { capitalView } from "./valuation";
import type { Workspace } from "./types";
import type { LendingPreparation } from "./lending";
export async function aaveHoldback(w: Workspace) {
  await withCapitalEvidence(w);
  const [{portfolio},e] = await Promise.all([workspacePortfolio(w),readValuationEvidence(w)]);
  const c=capitalView(w,portfolio,e);
  if(c.holdbackUsdcRaw===null) throw new Error("Reserved capital unknown.");
  return BigInt(c.holdbackUsdcRaw);
}
export function assertAaveContext(p: LendingPreparation,w: Workspace,revision:number) {
  if(!isAave(p) || w.mode!=="live" || !mayRead(w,"evm",p.accountId) || p.evm.workspaceRevision!==revision || p.evm.policyVersion!==(w.policy?.version??1)) throw new Error("Aave account, workspace or policy changed. Prepare again.");
}
export async function aaveJournalAction(request: Request,id:string,action:string,hashes:string[]=[]) {
  const s=await session(request), {attempt:a,previous}=await readAttempt(s.id,id), p=a.preparation;
  if(!isAave(p) || s.workspace.mode!=="live" || !mayRead(s.workspace,"evm",a.accountId)) throw new Error("Aave attempt not available in this live workspace.");
  let revision:number|undefined;
  if(action==="authorize") {
    assertAaveContext(p,s.workspace,s.revision);
    assertSignable(a,a.accountId,s.workspace.mode,s.workspace.mandate.version);
    const venue=aaveVenue(p.evm.chain),st=await venue.read(a.accountId);
    const fresh=venue.prepareOperation(st,s.workspace.policy,{kind:p.kind,asset:p.asset,amountRaw:BigInt(p.amountRaw),approveNewDebt:p.approvedNewDebt,holdbackRaw:p.kind==="repay"?await aaveHoldback(s.workspace):undefined});
    if(!sameTransactions(p,fresh)) throw new Error("Aave calls changed; review a fresh preparation.");
    // Simulate the first executable call. Approval-dependent principal is simulated after approval
    // when possible; pool guards remain on-chain and finalized events are always required.
    const first=p.evm.transactions[0];
    await evmRpc(p.evm.chain,"eth_estimateGas",[{from:first.from,to:first.to,data:first.data,value:first.value}]);
    const current=await session(request);
    assertAaveContext(p,current.workspace,current.revision);
    await checkPolicy(s.id,preparationAction(fresh,a.kind,a.id),current.workspace.policy??defaultPolicy());
    await reservePolicy(s.id,preparationAction(fresh,a.kind,a.id),current.workspace.policy??defaultPolicy(),current.revision);
    revision=current.revision; a.state="awaiting_wallet";a.message="Owner wallet requested. Each transaction needs approval; check this attempt before retrying.";
  } else if(action==="uncertain") {
    if(a.state==="awaiting_wallet") {a.state="unknown";a.message="Wallet result uncertain. Recover hashes from wallet history; do not resubmit.";}
  } else {
    if(a.state==="prepared") throw new Error("Attempt has not reached the wallet.");
    const all=[...new Set([...a.hashes,...hashes])];
    if(all.length>p.evm.transactions.length || all.some(h=>!/^0x[0-9a-fA-F]{64}$/.test(h))) throw new Error("Invalid EVM hash set.");
    if(hexQuantity(await evmRpc(p.evm.chain,"eth_chainId",[]))!==EVM_CHAINS[p.evm.chain].chainId) throw new Error("Wrong receipt chain.");
    const final=await evmRpc(p.evm.chain,"eth_getBlockByNumber",["finalized",false]);
    if(!final?.number) throw new Error("Finalized EVM block unavailable.");
    const proofs: import("./aave-receipts").AaveReceiptProof[]=[];
    for(const hash of all) {
      const [tx,receipt]=await Promise.all([evmRpc(p.evm.chain,"eth_getTransactionByHash",[hash]),evmRpc(p.evm.chain,"eth_getTransactionReceipt",[hash])]);
      if(!tx || !receipt || hexQuantity(receipt.blockNumber)>hexQuantity(final.number)) continue;
      const block=await evmRpc(p.evm.chain,"eth_getBlockByNumber",[receipt.blockNumber,false]);
      if(block?.hash!==receipt.blockHash || tx.blockHash!==receipt.blockHash || Number(hexQuantity(block.timestamp))*1000<Date.parse(a.createdAt)-1000) throw new Error("Receipt not canonical or predates request.");
      const proof=verifyAaveReceipt(tx,receipt,p);
      if(proofs.some(x=>x.index===proof.index)) throw new Error("Duplicate Aave step proof.");
      const db=await attemptsDb(), claimKey=p.evm.chain+":"+hash.toLowerCase();
      await db.prepare("INSERT OR IGNORE INTO wallet_hashes(hash,attempt_id) VALUES (?,?)").bind(claimKey,a.id).run();
      const claimed=await db.prepare("SELECT attempt_id FROM wallet_hashes WHERE hash=?").bind(claimKey).first<{attempt_id:string}>();
      if(claimed?.attempt_id!==a.id) throw new Error("Hash already belongs to another attempt.");
      proofs.push(proof);
      appendStep(a,"receipt:"+hash,proof.state,proof.message,{explorerLinks:[EVM_CHAINS[p.evm.chain].explorer+"/tx/"+hash],fees:[{unit:"weiETH",amount:proof.gasWei??null,verified:!!proof.gasWei}],evidence:proof});
    }
    a.hashes=all; a.verificationEvidence=proofs;
    const done=proofs.filter(x=>x.state==="confirmed").length;
    a.state=done===p.evm.transactions.length?"confirmed":proofs.some(x=>x.state==="failed")?(done?"partial":"failed"):done?"partial":all.length?"submitted":a.state;
    a.message=a.state==="confirmed"?"Aave operation finalized on "+p.evm.chain+". Principal is on this chain; any payment settlement is a separate verified step.":"Keep this attempt: approval/principal may be incomplete. Attach all wallet hashes and check again; never blindly retry.";
  }
  await saveAttempt(s.id,a,previous,revision);
  return a;
}
