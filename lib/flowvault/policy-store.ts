import{database}from'./store';import{units,decimal}from'./money';import{evaluatePolicy}from'./policy';import type{Policy,PolicyAction,LedgerEntry}from'./policy';
async function db(){const d=await database();await d.prepare('CREATE TABLE IF NOT EXISTS policy_ledger (session_id TEXT, operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL)').run();await d.prepare('CREATE TABLE IF NOT EXISTS policy_budgets (id TEXT PRIMARY KEY,total TEXT NOT NULL,nonce TEXT NOT NULL)').run();return d;}
export async function readLedger(sessionId:string):Promise<LedgerEntry[]>{const d=await db();const r=await d.prepare('SELECT payload FROM policy_ledger WHERE session_id=?').bind(sessionId).all<{payload:string}>();return r.results.map(x=>JSON.parse(x.payload));}
export async function checkPolicy(sessionId:string,action:PolicyAction,policy:Policy){const result=evaluatePolicy(action,policy,await readLedger(sessionId));if(!result.allowed)throw new Error('Policy blocked: '+result.violations.map(x=>x.code+': '+x.message).join('; '));return result;}
/** Atomic budget CAS + journal insert prevents simultaneous handoffs overspending a daily cap. */
export async function reservePolicy(sessionId:string,action:PolicyAction,policy:Policy,expectedRevision:number){if(!action.id)throw new Error('Policy reservation requires an operation ID.');const d=await db();const day=new Date().toISOString().slice(0,10);const budget=JSON.stringify([sessionId,action.accountId,action.source,day]);
 for(let i=0;i<5;i++){
  const existing=await d.prepare('SELECT payload FROM policy_ledger WHERE operation_id=? AND session_id=?').bind(action.id,sessionId).first<{payload:string}>();if(existing){const old=JSON.parse(existing.payload);if(old.amount!==action.amount||old.accountId!==action.accountId)throw new Error('Policy operation identity conflict.');return;}
  await checkPolicy(sessionId,action,policy);
  await d.prepare("INSERT OR IGNORE INTO policy_budgets(id,total,nonce) VALUES (?,'0','initial')").bind(budget).run();
  const row=await d.prepare('SELECT total FROM policy_budgets WHERE id=?').bind(budget).first<{total:string}>();if(!row)throw new Error('Daily budget unavailable.');const next=BigInt(row.total)+units(action.amount);if(next>units(policy.dailyCap))throw new Error('Policy blocked: DAILY_CAP: Amount exceeds your remaining daily cap.');
  const nonce=crypto.randomUUID();const entry:LedgerEntry={operationId:action.id,amount:action.amount,source:action.source,accountId:action.accountId,createdAt:new Date().toISOString(),state:'authorized'};
  const result=await d.batch([d.prepare('UPDATE policy_budgets SET total=?,nonce=? WHERE id=? AND total=? AND NOT EXISTS(SELECT 1 FROM policy_ledger WHERE operation_id=?) AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND revision=?)').bind(next.toString(),nonce,budget,row.total,action.id,sessionId,expectedRevision),d.prepare('INSERT INTO policy_ledger(session_id,operation_id,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM policy_budgets WHERE id=? AND nonce=?)').bind(sessionId,action.id,JSON.stringify(entry),budget,nonce)]);
  if(result[0].meta.changes===1&&result[1].meta.changes===1)return;
 }
 throw new Error('Policy budget changed concurrently. Refresh and try again.');
}
