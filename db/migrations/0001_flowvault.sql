-- Idempotent bootstrap for a new, owner-created Cloudflare D1 database.
-- No local sessions, owner accounts or financial records are copied.
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS wallet_attempts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallet_hashes (hash TEXT PRIMARY KEY, attempt_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_ledger (session_id TEXT, operation_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_budgets (id TEXT PRIMARY KEY, total TEXT NOT NULL, nonce TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_plans (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, obligation_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS destination_claims (proof_id TEXT PRIMARY KEY, payment_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_locks (session_id TEXT, obligation_id TEXT, payment_id TEXT, PRIMARY KEY(session_id, obligation_id));
CREATE INDEX IF NOT EXISTS wallet_attempts_session ON wallet_attempts(session_id);
CREATE INDEX IF NOT EXISTS payment_plans_session ON payment_plans(session_id);
CREATE INDEX IF NOT EXISTS policy_ledger_session ON policy_ledger(session_id);
