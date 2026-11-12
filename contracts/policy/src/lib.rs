//! Single-owner policy coordination. No FT receiver, lending call, swap, approval or custody.
//! Owner methods require/refund one authentication yocto; execution remains in the owner's wallet.
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, assert_one_yocto, env, near};
use std::collections::{BTreeMap, BTreeSet};
const DAY_MS: u64 = 86_400_000;
const MAX_PROPOSALS: usize = 1_000;
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Obligation {
    pub id: String,
    pub net_amount: U128,
    pub due_at_ms: U64,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct MethodRule {
    pub receiver: AccountId,
    pub method: String,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Plan {
    pub asset_id: AccountId,
    pub version: U64,
    pub reserve_floor: U128,
    pub obligations: Vec<Obligation>,
    pub per_action_cap: U128,
    pub daily_cap: U128,
    pub max_moving_cost: U128,
    pub max_gas_yocto: U128,
    pub venues: Vec<String>,
    pub recipients: Vec<String>,
    pub methods: Vec<MethodRule>,
    pub protected_assets: Vec<AccountId>,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Supply,
    Withdraw,
    Pay,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Action {
    pub kind: Kind,
    pub asset_id: AccountId,
    pub venue: String,
    pub receiver: AccountId,
    pub method: String,
    pub amount: U128,
    pub recipient: String,
    pub moving_cost: U128,
    pub gas_yocto: U128,
    pub reason: String,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Approved,
    Rejected,
    Recorded,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Outcome {
    pub tx_hashes: Vec<String>,
    pub summary_hash: String,
    pub reported_result: String,
    pub verification: String,
    pub at_ms: U64,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: U64,
    pub owner: AccountId,
    pub agent: AccountId,
    pub plan_version: U64,
    pub action: Action,
    pub status: Status,
    pub created_at_ms: U64,
    pub expires_at_ms: U64,
    pub day: U64,
    pub outcome: Option<Outcome>,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PolicyContract {
    owner_id: AccountId,
    plan: Option<Plan>,
    agents: BTreeSet<AccountId>,
    proposals: BTreeMap<u64, Proposal>,
    next_id: u64,
    budget_day: u64,
    budget_used: u128,
}
fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"flowvault_policy","version":"1.0.0","event":name,"data":[data]})
    ));
}
fn now() -> u64 {
    env::block_timestamp_ms()
}
fn bounded(s: &str, max: usize) {
    assert!(!s.is_empty() && s.len() <= max, "INVALID_TEXT");
}
fn valid_hash(h: &str) -> bool {
    (h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        || (h.starts_with("0x") && h.len() == 66 && h[2..].bytes().all(|b| b.is_ascii_hexdigit()))
        || ((h.len() == 43 || h.len() == 44)
            && h.bytes().all(|b| {
                b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(&b)
            }))
}
#[near]
impl PolicyContract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "CONTRACT_KEY_ONLY_INIT"
        );
        Self {
            owner_id,
            plan: None,
            agents: BTreeSet::new(),
            proposals: BTreeMap::new(),
            next_id: 1,
            budget_day: now() / DAY_MS,
            budget_used: 0,
        }
    }
    fn owner_auth(&self) {
        assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.owner_id, "OWNER_ONLY");
    }
    fn refund_auth(&self) {
        let _ = Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(1));
    }
    #[payable]
    pub fn set_plan(&mut self, plan: Plan) {
        self.owner_auth();
        let old = self.plan.as_ref().map(|p| p.version.0).unwrap_or(0);
        assert_eq!(
            plan.version.0,
            old.checked_add(1).expect("VERSION_OVERFLOW"),
            "PLAN_VERSION"
        );
        assert!(
            plan.per_action_cap.0 > 0 && plan.daily_cap.0 >= plan.per_action_cap.0,
            "INVALID_CAPS"
        );
        assert!(
            plan.obligations.len() <= 50
                && plan.venues.len() <= 30
                && plan.recipients.len() <= 50
                && plan.methods.len() <= 50
                && plan.protected_assets.len() <= 50,
            "PLAN_SIZE"
        );
        let mut ids = BTreeSet::new();
        for o in &plan.obligations {
            bounded(&o.id, 64);
            assert!(
                o.net_amount.0 > 0 && ids.insert(o.id.clone()),
                "INVALID_OBLIGATION"
            );
        }
        for s in plan.venues.iter().chain(plan.recipients.iter()) {
            bounded(s, 100);
        }
        for m in &plan.methods {
            bounded(&m.method, 64);
        }
        if let Some(previous) = &self.plan {
            assert_eq!(
                plan.asset_id, previous.asset_id,
                "SETTLEMENT_ASSET_IMMUTABLE"
            );
        }
        let version = plan.version;
        self.plan = Some(plan);
        event(
            "plan_set",
            json!({"owner":self.owner_id,"version":version,"reserve_checked_onchain":false}),
        );
        self.refund_auth();
    }
    #[payable]
    pub fn add_agent(&mut self, agent_id: AccountId) {
        self.owner_auth();
        assert!(
            self.agents.contains(&agent_id) || self.agents.len() < 20,
            "AGENT_LIMIT"
        );
        self.agents.insert(agent_id.clone());
        event(
            "agent_added",
            json!({"owner":self.owner_id,"agent":agent_id}),
        );
        self.refund_auth();
    }
    #[payable]
    pub fn remove_agent(&mut self, agent_id: AccountId) {
        self.owner_auth();
        self.agents.remove(&agent_id);
        event(
            "agent_removed",
            json!({"owner":self.owner_id,"agent":agent_id}),
        );
        self.refund_auth();
    }
    fn validate_action(&self, action: &Action, version: u64, used: u128) {
        let p = self.plan.as_ref().expect("PLAN_MISSING");
        assert_eq!(p.version.0, version, "PLAN_VERSION");
        assert_eq!(action.asset_id, p.asset_id, "ASSET_NOT_ALLOWED");
        bounded(&action.reason, 512);
        bounded(&action.method, 64);
        bounded(&action.venue, 100);
        bounded(&action.recipient, 100);
        assert!(action.amount.0 > 0, "INVALID_AMOUNT");
        assert!(action.amount.0 <= p.per_action_cap.0, "PER_ACTION_CAP");
        assert!(
            used.checked_add(action.amount.0).expect("AMOUNT_OVERFLOW") <= p.daily_cap.0,
            "DAILY_CAP"
        );
        assert!(p.venues.contains(&action.venue), "VENUE_NOT_ALLOWED");
        assert!(
            p.recipients.contains(&action.recipient) || action.recipient == self.owner_id.as_str(),
            "RECIPIENT_NOT_ALLOWED"
        );
        assert!(
            p.methods
                .iter()
                .any(|m| m.receiver == action.receiver && m.method == action.method),
            "METHOD_NOT_ALLOWED"
        );
        assert!(
            action.kind == Kind::Withdraw || !p.protected_assets.contains(&action.asset_id),
            "PROTECTED_ASSET"
        );
        assert!(
            action.moving_cost.0 <= p.max_moving_cost.0,
            "MOVING_COST_CAP"
        );
        assert!(action.gas_yocto.0 <= p.max_gas_yocto.0, "GAS_CAP");
    }
    pub fn propose(
        &mut self,
        owner: AccountId,
        plan_version: U64,
        action: Action,
        expires_at_ms: U64,
    ) -> Proposal {
        assert_eq!(owner, self.owner_id, "OWNER_MISMATCH");
        let agent = env::predecessor_account_id();
        assert!(self.agents.contains(&agent), "AGENT_NOT_ALLOWED");
        assert!(
            self.proposals.len() < MAX_PROPOSALS,
            "PROPOSAL_STORAGE_LIMIT"
        );
        let t = now();
        assert!(
            expires_at_ms.0 > t && expires_at_ms.0 <= t.checked_add(DAY_MS).expect("TIME_OVERFLOW"),
            "PROPOSAL_EXPIRY"
        );
        let day = t / DAY_MS;
        let used = if day == self.budget_day {
            self.budget_used
        } else {
            0
        };
        self.validate_action(&action, plan_version.0, used);
        let id = self.next_id;
        let next = id.checked_add(1).expect("ID_OVERFLOW");
        let total = used.checked_add(action.amount.0).expect("AMOUNT_OVERFLOW");
        let proposal = Proposal {
            id: U64(id),
            owner: self.owner_id.clone(),
            agent,
            plan_version,
            action,
            status: Status::Pending,
            created_at_ms: U64(t),
            expires_at_ms,
            day: U64(day),
            outcome: None,
        };
        self.proposals.insert(id, proposal.clone());
        self.next_id = next;
        self.budget_day = day;
        self.budget_used = total;
        event(
            "proposal_created",
            json!({"proposal":proposal,"execution_authorized":false}),
        );
        proposal
    }
    #[payable]
    pub fn approve(&mut self, op_id: U64) -> Proposal {
        self.owner_auth();
        let mut p = self
            .proposals
            .get(&op_id.0)
            .expect("PROPOSAL_NOT_FOUND")
            .clone();
        assert_eq!(p.status, Status::Pending, "PROPOSAL_NOT_PENDING");
        assert!(self.agents.contains(&p.agent), "AGENT_REVOKED");
        assert!(
            now() < p.expires_at_ms.0 && now() / DAY_MS == p.day.0,
            "PROPOSAL_EXPIRED"
        );
        self.validate_action(
            &p.action,
            p.plan_version.0,
            self.budget_used
                .checked_sub(p.action.amount.0)
                .expect("BUDGET_UNVERIFIED"),
        );
        p.status = Status::Approved;
        self.proposals.insert(op_id.0, p.clone());
        event(
            "proposal_approved",
            json!({"proposal":p,"wallet_execution_required":true}),
        );
        self.refund_auth();
        p
    }
    #[payable]
    pub fn reject(&mut self, op_id: U64) -> Proposal {
        self.owner_auth();
        let mut p = self
            .proposals
            .get(&op_id.0)
            .expect("PROPOSAL_NOT_FOUND")
            .clone();
        assert_eq!(p.status, Status::Pending, "PROPOSAL_NOT_PENDING");
        if self.budget_day == p.day.0 {
            self.budget_used = self
                .budget_used
                .checked_sub(p.action.amount.0)
                .expect("BUDGET_UNVERIFIED");
        }
        p.status = Status::Rejected;
        self.proposals.insert(op_id.0, p.clone());
        event("proposal_rejected", json!({"proposal":p}));
        self.refund_auth();
        p
    }
    pub fn record_outcome(
        &mut self,
        op_id: U64,
        tx_hashes: Vec<String>,
        summary_hash: String,
        reported_result: String,
    ) -> Proposal {
        let mut p = self
            .proposals
            .get(&op_id.0)
            .expect("PROPOSAL_NOT_FOUND")
            .clone();
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.owner_id || (caller == p.agent && self.agents.contains(&caller)),
            "OUTCOME_CALLER"
        );
        assert_eq!(p.status, Status::Approved, "PROPOSAL_NOT_APPROVED");
        assert!(
            !tx_hashes.is_empty()
                && tx_hashes.len() <= 10
                && tx_hashes.iter().all(|h| valid_hash(h)),
            "INVALID_HASHES"
        );
        assert!(
            summary_hash.len() == 64 && summary_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "INVALID_SUMMARY_HASH"
        );
        assert!(
            ["success", "refunded", "failed", "partial"].contains(&reported_result.as_str()),
            "INVALID_REPORTED_RESULT"
        );
        p.outcome = Some(Outcome {
            tx_hashes,
            summary_hash,
            reported_result,
            verification: "unverified_record".into(),
            at_ms: U64(now()),
        });
        p.status = Status::Recorded;
        self.proposals.insert(op_id.0, p.clone());
        event(
            "outcome_recorded",
            json!({"proposal":p,"verification":"unverified_record"}),
        );
        p
    }
    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }
    pub fn get_plan(&self) -> Option<Plan> {
        self.plan.clone()
    }
    pub fn get_agents(&self) -> Vec<AccountId> {
        self.agents.iter().cloned().collect()
    }
    pub fn get_proposal(&self, op_id: U64) -> Option<Proposal> {
        self.proposals.get(&op_id.0).cloned()
    }
    pub fn get_budget(&self) -> Value {
        let day = now() / DAY_MS;
        json!({"day":U64(day),"reserved_or_approved":U128(if day==self.budget_day{self.budget_used}else{0})})
    }
    pub fn list_proposals(&self, from_id: U64, limit: u32) -> Vec<Proposal> {
        assert!(limit <= 50, "PAGE_LIMIT");
        self.proposals
            .range(from_id.0..)
            .take(limit as usize)
            .map(|(_, p)| p.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
    use near_sdk::testing_env;
    use std::panic::{AssertUnwindSafe, catch_unwind};
    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }
    fn agent() -> AccountId {
        "agent.testnet".parse().unwrap()
    }
    fn receiver() -> AccountId {
        "usdc.testnet".parse().unwrap()
    }
    fn context(caller: AccountId, deposit: u128, ms: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("policy.testnet".parse().unwrap())
            .predecessor_account_id(caller.clone())
            .signer_account_id(caller)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ms * 1_000_000)
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    fn plan() -> Plan {
        Plan {
            asset_id: receiver(),
            version: U64(1),
            reserve_floor: U128(5_000_000),
            obligations: vec![Obligation {
                id: "rent".into(),
                net_amount: U128(10_000_000),
                due_at_ms: U64(DAY_MS),
            }],
            per_action_cap: U128(100_000_000),
            daily_cap: U128(150_000_000),
            max_moving_cost: U128(2_000_000),
            max_gas_yocto: U128(250_000_000_000_000_000_000_000),
            venues: vec!["rhea".into()],
            recipients: vec![],
            methods: vec![MethodRule {
                receiver: receiver(),
                method: "execute".into(),
            }],
            protected_assets: vec![],
        }
    }
    fn action() -> Action {
        Action {
            kind: Kind::Withdraw,
            asset_id: receiver(),
            venue: "rhea".into(),
            receiver: receiver(),
            method: "execute".into(),
            amount: U128(50_000_000),
            recipient: owner().to_string(),
            moving_cost: U128(0),
            gas_yocto: U128(100),
            reason: "Restore reserve before rent".into(),
        }
    }
    fn contract() -> PolicyContract {
        context("policy.testnet".parse().unwrap(), 0, 1_000);
        let mut c = PolicyContract::new(owner());
        context(owner(), 1, 1_000);
        c.set_plan(plan());
        c.add_agent(agent());
        c
    }
    fn propose(c: &mut PolicyContract, a: Action) -> Proposal {
        context(agent(), 0, 1_000);
        c.propose(owner(), U64(1), a, U64(60_000))
    }
    fn fails(f: impl FnOnce()) {
        assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
    }
    #[test]
    fn valid_lifecycle_emits_nep297_and_reports_unverified_outcome() {
        let mut c = contract();
        let p = propose(&mut c, action());
        assert_eq!(p.status, Status::Pending);
        let e: Value = near_sdk::serde_json::from_str(
            get_logs()
                .last()
                .unwrap()
                .strip_prefix("EVENT_JSON:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(e["standard"], "flowvault_policy");
        assert_eq!(e["version"], "1.0.0");
        assert_eq!(e["event"], "proposal_created");
        assert_eq!(e["data"][0]["execution_authorized"], false);
        context(owner(), 1, 2_000);
        assert_eq!(c.approve(p.id).status, Status::Approved);
        assert_eq!(get_created_receipts().len(), 1);
        context(agent(), 0, 3_000);
        let p = c.record_outcome(p.id, vec!["1".repeat(43)], "a".repeat(64), "success".into());
        assert_eq!(p.status, Status::Recorded);
        assert_eq!(p.outcome.unwrap().verification, "unverified_record");
        assert_eq!(c.get_budget()["reserved_or_approved"], "50000000");
    }
    #[test]
    fn owner_methods_need_owner_and_one_yocto() {
        let mut c = contract();
        for amount in [0, 2] {
            context(owner(), amount, 1000);
            fails(|| c.set_plan(plan()));
        }
        context(agent(), 1, 1000);
        fails(|| c.add_agent("other.testnet".parse().unwrap()));
        fails(|| c.remove_agent(agent()));
        fails(|| c.set_plan(plan()));
    }
    #[test]
    fn initialization_requires_contract_key() {
        context(agent(), 0, 1000);
        fails(|| {
            PolicyContract::new(owner());
        });
    }
    #[test]
    fn cap_and_all_rule_violations_refuse_without_mutating_budget() {
        let mut c = contract();
        let mutations: Vec<Box<dyn Fn(&mut Action)>> = vec![
            Box::new(|a| a.amount = U128(0)),
            Box::new(|a| a.asset_id = "other.testnet".parse().unwrap()),
            Box::new(|a| a.amount = U128(100_000_001)),
            Box::new(|a| a.venue = "unapproved".into()),
            Box::new(|a| a.recipient = "stranger.testnet".into()),
            Box::new(|a| a.receiver = "other.testnet".parse().unwrap()),
            Box::new(|a| a.method = "borrow".into()),
            Box::new(|a| a.moving_cost = U128(2_000_001)),
            Box::new(|a| a.gas_yocto = U128(u128::MAX)),
            Box::new(|a| a.reason = "".into()),
        ];
        for m in mutations {
            let mut a = action();
            m(&mut a);
            fails(|| {
                propose(&mut c, a);
            });
            assert_eq!(c.get_budget()["reserved_or_approved"], "0");
            assert_eq!(c.list_proposals(U64(0), 50).len(), 0);
        }
    }
    #[test]
    fn daily_cap_counts_pending_and_approved_and_resists_plan_updates() {
        let mut c = contract();
        for _ in 0..3 {
            propose(&mut c, action());
        }
        fails(|| {
            propose(&mut c, action());
        });
        context(owner(), 1, 2_000);
        let mut p = plan();
        p.version = U64(2);
        c.set_plan(p);
        assert_eq!(c.get_budget()["reserved_or_approved"], "150000000");
        context(agent(), 0, 3_000);
        fails(|| {
            c.propose(owner(), U64(2), action(), U64(60_000));
        });
    }
    #[test]
    fn reject_releases_only_pending_reservation_and_cannot_repeat() {
        let mut c = contract();
        let p = propose(&mut c, action());
        context(owner(), 1, 2000);
        c.reject(p.id);
        assert_eq!(c.get_budget()["reserved_or_approved"], "0");
        fails(|| {
            c.reject(p.id);
        });
        fails(|| {
            c.approve(p.id);
        });
    }
    #[test]
    fn stale_plan_version_blocks_proposal_and_approval() {
        let mut c = contract();
        let p = propose(&mut c, action());
        context(owner(), 1, 2000);
        let mut next = plan();
        next.version = U64(2);
        c.set_plan(next);
        fails(|| {
            c.approve(p.id);
        });
        context(agent(), 0, 3000);
        fails(|| {
            c.propose(owner(), U64(1), action(), U64(60_000));
        });
    }
    #[test]
    fn revocation_blocks_proposals_approvals_and_agent_outcome_records() {
        let mut c = contract();
        let p = propose(&mut c, action());
        context(owner(), 1, 2000);
        c.remove_agent(agent());
        fails(|| {
            c.approve(p.id);
        });
        fails(|| {
            propose(&mut c, action());
        });
        context(owner(), 1, 3000);
        c.add_agent(agent());
        c.approve(p.id);
        c.remove_agent(agent());
        context(agent(), 0, 4000);
        fails(|| {
            c.record_outcome(p.id, vec!["1".repeat(43)], "a".repeat(64), "success".into());
        });
    }
    #[test]
    fn expiry_day_boundary_and_version_sequence_fail_closed() {
        let mut c = contract();
        context(owner(), 1, 1000);
        fails(|| c.set_plan(plan()));
        context(agent(), 0, 1000);
        for expiry in [1000, 1000 + DAY_MS + 1] {
            fails(|| {
                c.propose(owner(), U64(1), action(), U64(expiry));
            });
        }
        let p = c.propose(owner(), U64(1), action(), U64(DAY_MS + 500));
        context(owner(), 1, DAY_MS + 1);
        fails(|| {
            c.approve(p.id);
        });
        context(agent(), 0, DAY_MS + 1);
        c.propose(owner(), U64(1), action(), U64(DAY_MS + 60_000));
        assert_eq!(c.get_budget()["reserved_or_approved"], "50000000");
        context(owner(), 1, DAY_MS + 2);
        c.reject(p.id);
        assert_eq!(c.get_budget()["reserved_or_approved"], "50000000");
    }
    #[test]
    fn protected_assets_cannot_be_spent_but_can_be_withdrawn() {
        let mut c = contract();
        context(owner(), 1, 1000);
        let mut p = plan();
        p.version = U64(2);
        p.protected_assets.push(receiver());
        c.set_plan(p);
        context(agent(), 0, 1000);
        let mut a = action();
        a.kind = Kind::Pay;
        fails(|| {
            c.propose(owner(), U64(2), a, U64(60000));
        });
        c.propose(owner(), U64(2), action(), U64(60000));
    }
    #[test]
    fn record_cannot_approve_or_fake_verified_proof() {
        let mut c = contract();
        let p = propose(&mut c, action());
        context(agent(), 0, 1000);
        fails(|| {
            c.record_outcome(p.id, vec!["1".repeat(43)], "a".repeat(64), "success".into());
        });
        context(owner(), 1, 1000);
        c.approve(p.id);
        context(agent(), 0, 1000);
        for hashes in [vec![], vec!["bad".into()]] {
            fails(|| {
                c.record_outcome(p.id, hashes, "a".repeat(64), "success".into());
            });
        }
        fails(|| {
            c.record_outcome(p.id, vec!["1".repeat(43)], "bad".into(), "success".into());
        });
        fails(|| {
            c.record_outcome(
                p.id,
                vec!["1".repeat(43)],
                "a".repeat(64),
                "verified".into(),
            );
        });
        context("stranger.testnet".parse().unwrap(), 0, 1000);
        fails(|| {
            c.record_outcome(p.id, vec!["1".repeat(43)], "a".repeat(64), "success".into());
        });
    }
    #[test]
    fn settlement_asset_cannot_change_daily_units() {
        let mut c = contract();
        context(owner(), 1, 1000);
        let mut p = plan();
        p.version = U64(2);
        p.asset_id = "other.testnet".parse().unwrap();
        fails(|| c.set_plan(p));
    }
    #[test]
    fn resource_bounds_and_read_pagination_are_explicit() {
        let mut c = contract();
        context(owner(), 1, 1000);
        for i in 0..19 {
            c.add_agent(format!("agent{i}.testnet").parse().unwrap());
        }
        fails(|| c.add_agent("overflow.testnet".parse().unwrap()));
        fails(|| {
            c.list_proposals(U64(0), 51);
        });
        let mut p = plan();
        p.version = U64(2);
        p.obligations.push(p.obligations[0].clone());
        fails(|| c.set_plan(p));
    }
}
