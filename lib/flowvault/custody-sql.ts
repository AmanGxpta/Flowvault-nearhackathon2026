// Atomic contract-level unknown lock across mandates and sessions; terminal results cannot be reopened.
export const CUSTODY_TABLE="CREATE TABLE IF NOT EXISTS custody_ops (id TEXT PRIMARY KEY,session_id TEXT NOT NULL,mandate_id TEXT NOT NULL,contract_id TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,state TEXT NOT NULL,payload TEXT NOT NULL)";
export const CUSTODY_START="INSERT OR IGNORE INTO custody_ops (id,session_id,mandate_id,contract_id,hash,state,payload) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM custody_ops WHERE contract_id=? AND state='unknown')";
export const CUSTODY_FINISH="UPDATE custody_ops SET state=?,payload=? WHERE id=? AND session_id=? AND state='unknown'";
// The same insert enforces the mandate's daily action count under concurrent runs. Reductions bypass it.
export const CUSTODY_START_BOUNDED=CUSTODY_START+" AND (? != 'curator_supply' OR (SELECT COUNT(*) FROM custody_ops WHERE session_id=? AND mandate_id=? AND json_extract(payload,'$.at')>=? AND json_extract(payload,'$.call.methodName')='curator_supply') < ?)";
