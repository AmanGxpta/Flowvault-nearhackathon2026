//! FlowVault custody/share vault. Undeployed. NAV is a trusted, stale-bounded curator attestation;
//! it is NOT cryptographic evidence of external assets. Never route arbitrary delegate calldata.
mod math;
mod operations;
mod redemptions;
#[cfg(test)]
use math::E18;
use math::{VIRTUAL_ASSETS, VIRTUAL_SHARES, add, assets_for, fee_shares, mul_div, pps, shares_for};
use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::{
    FungibleToken,
    core::FungibleTokenCore,
    metadata::{FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider},
    receiver::FungibleTokenReceiver,
    resolver::FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
#[cfg(test)]
use near_sdk::PromiseResult;
use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, assert_one_yocto, env, near,
};
use std::collections::{BTreeMap, BTreeSet};
const QUEUE_STORAGE: u128 = 20_000_000_000_000_000_000_000;
const MAX_REQUESTS: usize = 1000;
const MAX_POSITIONS: usize = 30;
const USDC: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const RHEA: &str = "contract.main.burrow.near";
fn now() -> u64 {
    env::block_timestamp_ms()
}
fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"flowvault_vault","version":"1.0.0","event":event,"data":[data]})
    ));
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub owner_id: AccountId,
    pub curator_id: AccountId,
    pub platform_id: AccountId,
    pub asset_id: AccountId,
    pub asset_decimals: u8,
    pub share_name: String,
    pub share_symbol: String,
    pub performance_fee_bps: u16,
    pub curator_fee_share_bps: u16,
    pub capacity_raw: U128,
    pub per_depositor_cap_raw: U128,
    pub max_position_bps: u16,
    pub max_protocol_bps: u16,
    pub max_chain_bps: u16,
    pub liquidity_target_bps: u16,
    pub redemption_notice_ms: U64,
    pub max_nav_age_ms: U64,
    pub single_depositor: Option<AccountId>,
    pub rhea_id: AccountId,
    pub rhea_extra_decimals: u8,
    pub disclosed_upgrade_keys: Vec<String>,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    Paused,
    Shutdown,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Position {
    pub id: String,
    pub protocol: String,
    pub chain: String,
    pub assets_raw: U128,
    pub liabilities_raw: U128,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct NavReport {
    pub sequence: U64,
    pub observed_at_ms: U64,
    pub positions: Vec<Position>,
    pub evidence_hash: String,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    Deposit,
    Redemption,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RequestStatus {
    Queued,
    Settled,
    Claimable,
    Claiming,
    Completed,
    Cancelled,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Request {
    pub id: U64,
    pub owner_id: AccountId,
    pub kind: RequestKind,
    pub amount_raw: U128,
    pub min_output_raw: U128,
    pub created_at_ms: U64,
    pub not_before_ms: U64,
    pub status: RequestStatus,
    pub claimable_raw: U128,
    pub shares_minted_raw: U128,
    pub shares_burned_raw: U128,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct OperatorPolicy {
    pub account_id: AccountId,
    pub valid_until_ms: U64,
    pub max_per_action_raw: U128,
    pub max_daily_raw: U128,
    pub max_cumulative_raw: U128,
    pub max_deployed_raw: U128,
    pub min_idle_raw: U128,
    pub paused: bool,
}
#[near(serializers=[borsh,json])]
#[derive(Clone, Debug)]
pub struct Operation {
    pub id: U64,
    pub kind: String,
    pub amount_raw: U128,
    pub flow_nonce: U64,
}
#[near(serializers=[json])]
pub struct NavView {
    pub nav_raw: Option<U128>,
    pub gross_assets_raw: Option<U128>,
    pub external_liabilities_raw: U128,
    pub liquid_assets_raw: U128,
    pub pending_deposits_raw: U128,
    pub claimable_raw: U128,
    pub total_shares: U128,
    pub queued_shares: U128,
    pub pps_e18: Option<U128>,
    pub hwm_e18: U128,
    pub report: Option<NavReport>,
    /// Additive (v1.3): only owner-filed reports crystallize performance fees.
    pub report_by_owner: bool,
    pub report_required: bool,
    pub status: Status,
    pub busy: Option<Operation>,
    pub reasons: Vec<String>,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    config: Config,
    token: FungibleToken,
    status: Status,
    report: Option<NavReport>,
    /// True when the current report was filed by the owner (the only reports that crystallize fees).
    report_by_owner: bool,
    report_required: bool,
    sync_required: bool,
    escrow_shortfall: bool,
    operator_version: u64,
    liquid: u128,
    pending_deposits: u128,
    claimable: u128,
    queued_shares: u128,
    hwm: u128,
    request_credits: BTreeMap<AccountId, u128>,
    requests: BTreeMap<u64, Request>,
    next_id: u64,
    flow_nonce: u64,
    busy: Option<Operation>,
    next_operation: u64,
    operator: Option<OperatorPolicy>,
    usage_day: u64,
    usage_daily: u128,
    usage_cumulative: u128,
    deployed: u128,
}
#[near]
impl Vault {
    #[init]
    pub fn new(config: Config) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "ATOMIC_DEPLOY_INITIALIZATION_REQUIRED"
        );
        assert_eq!(config.asset_id.as_str(), USDC, "UNSUPPORTED_UNDERLYING");
        assert_eq!(config.asset_decimals, 6, "ASSET_PRECISION");
        assert_eq!(config.rhea_id.as_str(), RHEA, "UNSUPPORTED_LENDING_VENUE");
        assert_eq!(config.rhea_extra_decimals, 12, "RHEA_PRECISION");
        assert!(
            !config.share_name.is_empty()
                && config.share_name.len() <= 80
                && !config.share_symbol.is_empty()
                && config.share_symbol.len() <= 16,
            "INVALID_METADATA"
        );
        assert!(
            config.performance_fee_bps <= 3000 && config.curator_fee_share_bps <= 10000,
            "FEE_LIMIT"
        );
        assert!(
            config.max_nav_age_ms.0 >= 10_000
                && config.max_nav_age_ms.0 <= 3_600_000
                && config.redemption_notice_ms.0 <= 30 * 86_400_000,
            "INVALID_TIME_LIMIT"
        );
        assert!(
            config.disclosed_upgrade_keys.len() <= 10
                && config
                    .disclosed_upgrade_keys
                    .iter()
                    .all(|k| k.len() <= 128 && k.parse::<near_sdk::PublicKey>().is_ok()),
            "INVALID_UPGRADE_KEY_DISCLOSURE"
        );
        if let Some(owner) = &config.single_depositor {
            assert_eq!(owner, &config.owner_id, "SINGLE_DEPOSITOR_MUST_BE_OWNER");
            assert_eq!(config.performance_fee_bps, 0, "CUSTODY_MODE_NO_FEES");
        }
        Self::validate_limits(
            config.capacity_raw.0,
            config.per_depositor_cap_raw.0,
            config.max_position_bps,
            config.max_protocol_bps,
            config.max_chain_bps,
            config.liquidity_target_bps,
        );
        let mut token = FungibleToken::new(b"shares".to_vec());
        for account in [
            env::current_account_id(),
            config.owner_id.clone(),
            config.curator_id.clone(),
            config.platform_id.clone(),
        ] {
            if token.accounts.get(&account).is_none() {
                token.internal_register_account(&account);
            }
        }
        Self {
            config,
            token,
            status: Status::Running,
            report: None,
            report_by_owner: false,
            report_required: true,
            sync_required: false,
            escrow_shortfall: false,
            operator_version: 0,
            liquid: 0,
            pending_deposits: 0,
            claimable: 0,
            queued_shares: 0,
            hwm: pps(0, 0, true),
            request_credits: BTreeMap::new(),
            requests: BTreeMap::new(),
            next_id: 0,
            flow_nonce: 0,
            busy: None,
            next_operation: 0,
            operator: None,
            usage_day: now() / 86_400_000,
            usage_daily: 0,
            usage_cumulative: 0,
            deployed: 0,
        }
    }
    pub fn get_config(&self) -> Value {
        let mut v = serde_json::to_value(&self.config).unwrap();
        let o = v.as_object_mut().unwrap();
        o.insert("share_decimals".into(), json!(18));
        o.insert(
            "virtual_assets_raw".into(),
            json!(VIRTUAL_ASSETS.to_string()),
        );
        o.insert(
            "virtual_shares_raw".into(),
            json!(VIRTUAL_SHARES.to_string()),
        );
        o.insert("management_fee_bps".into(), json!(0));
        o.insert(
            "queue_storage_yocto".into(),
            json!(QUEUE_STORAGE.to_string()),
        );
        o.insert("upgrade_authority".into(),json!("owner + contract full-access keys (owner-disclosed; verify actual keys through NEAR RPC)"));
        o.insert("nav_authority".into(),json!("Owner/curator trusted valuation attestation; not independent proof of external assets. Only owner reports crystallize performance fees."));
        v
    }
    pub fn get_nav(&self) -> NavView {
        let (gross, liabilities) = self.gross_liabilities();
        let mut reasons = vec![];
        if self.sync_required {
            reasons.push("LIQUID_SYNC_REQUIRED".into());
        }
        if self.escrow_shortfall {
            reasons.push("ESCROW_UNDERCOLLATERALIZED".into());
        }
        if self.report_required {
            reasons.push("NAV_REPORT_REQUIRED".into());
        }
        if self.report.as_ref().is_none_or(|r| {
            now() < r.observed_at_ms.0 || now() - r.observed_at_ms.0 > self.config.max_nav_age_ms.0
        }) {
            reasons.push("NAV_REPORT_STALE_OR_MISSING".into());
        }
        if self.busy.is_some() {
            reasons.push("EXTERNAL_OPERATION_UNRESOLVED".into());
        }
        if liabilities > gross {
            reasons.push("NAV_INSOLVENT".into());
        }
        let nav = if reasons.is_empty() {
            Some(gross - liabilities)
        } else {
            None
        };
        NavView {
            nav_raw: nav.map(U128),
            gross_assets_raw: Some(U128(gross)),
            external_liabilities_raw: U128(liabilities),
            liquid_assets_raw: U128(self.liquid),
            pending_deposits_raw: U128(self.pending_deposits),
            claimable_raw: U128(self.claimable),
            total_shares: U128(self.token.total_supply),
            queued_shares: U128(self.queued_shares),
            pps_e18: nav.map(|n| U128(pps(n, self.token.total_supply, false))),
            hwm_e18: U128(self.hwm),
            report: self.report.clone(),
            report_by_owner: self.report_by_owner,
            report_required: self.report_required,
            status: self.status.clone(),
            busy: self.busy.clone(),
            reasons,
        }
    }
    pub fn get_account(&self, account_id: AccountId) -> Value {
        let mut queued = 0;
        let mut pending = 0;
        let mut claimable = 0;
        for r in self.requests.values().filter(|r| r.owner_id == account_id) {
            if r.status == RequestStatus::Queued {
                match r.kind {
                    RequestKind::Deposit => pending = add(pending, r.amount_raw.0),
                    RequestKind::Redemption => queued = add(queued, r.amount_raw.0),
                }
            }
            claimable = add(claimable, r.claimable_raw.0);
        }
        json!({"account_id":account_id,"shares":self.token.ft_balance_of(account_id.clone()),"queued_shares_raw":queued.to_string(),"pending_deposits_raw":pending.to_string(),"claimable_raw":claimable.to_string(),"request_storage_credit_yocto":self.request_credits.get(&account_id).unwrap_or(&0).to_string()})
    }
    #[payable]
    pub fn fund_request_storage(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        assert!(
            self.token.accounts.get(&account).is_some(),
            "REGISTER_SHARES_FIRST"
        );
        let paid = env::attached_deposit().as_yoctonear();
        assert!(paid >= QUEUE_STORAGE, "REQUEST_STORAGE_PAYMENT_REQUIRED");
        assert!(
            self.request_credits.contains_key(&account) || self.request_credits.len() < 1000,
            "STORAGE_CREDIT_ACCOUNT_LIMIT"
        );
        let credit = add(*self.request_credits.get(&account).unwrap_or(&0), paid);
        self.request_credits.insert(account.clone(), credit);
        emit(
            "request_storage_funded",
            json!({"owner_id":account,"paid_yocto":paid.to_string(),"credit_yocto":credit.to_string()}),
        );
        U128(credit)
    }
    pub fn get_request(&self, id: U64) -> Option<Request> {
        self.requests.get(&id.0).cloned()
    }
    pub fn get_requests(&self, from_index: U64, limit: u32) -> Vec<Request> {
        assert!(limit <= 100, "PAGE_LIMIT");
        self.requests
            .range(from_index.0..)
            .take(limit as usize)
            .map(|(_, r)| r.clone())
            .collect()
    }
    pub fn preview_deposit(&self, amount: U128) -> Option<U128> {
        let nav = self.get_nav().nav_raw?.0;
        Some(U128(shares_for(amount.0, nav, self.token.total_supply)))
    }
    pub fn preview_redeem(&self, shares: U128) -> Option<U128> {
        let nav = self.get_nav().nav_raw?.0;
        Some(U128(assets_for(shares.0, nav, self.token.total_supply)))
    }
    #[payable]
    pub fn report_nav(&mut self, report: NavReport) {
        self.reporter();
        assert_one_yocto();
        self.idle();
        assert!(
            !self.sync_required && !self.escrow_shortfall,
            "LIQUID_SYNC_REQUIRED"
        );
        assert!(report.positions.len() <= MAX_POSITIONS, "POSITION_LIMIT");
        assert!(
            report.observed_at_ms.0 <= now()
                && now() - report.observed_at_ms.0 <= self.config.max_nav_age_ms.0,
            "STALE_REPORT"
        );
        assert!(
            !report.evidence_hash.is_empty() && report.evidence_hash.len() <= 128,
            "EVIDENCE_HASH_REQUIRED"
        );
        let mut ids = BTreeSet::new();
        for p in &report.positions {
            assert!(
                !p.id.is_empty()
                    && p.id.len() <= 100
                    && !p.protocol.is_empty()
                    && p.protocol.len() <= 100
                    && !p.chain.is_empty()
                    && p.chain.len() <= 30
                    && ids.insert(p.id.clone()),
                "INVALID_POSITION_IDENTITY"
            );
        }
        if let Some(old) = &self.report {
            assert!(
                report.sequence.0 > old.sequence.0
                    && report.observed_at_ms.0 >= old.observed_at_ms.0,
                "REPORT_REPLAY"
            );
        }
        let by_owner = env::predecessor_account_id() == self.config.owner_id;
        self.report = Some(report.clone());
        self.report_by_owner = by_owner;
        self.report_required = false;
        let (g, l) = self.gross_liabilities();
        // A valuation attestation cannot replenish a delegate's raw supply allowance.
        // This counter is conservative gross resolved supply, not a portfolio valuation.
        // Returning capital is observed in liquid/NAV; owner-approved policy changes
        // may raise future limits, while daily/lifetime consumption always persists.
        if g >= l && by_owner {
            self.crystallize(g - l);
        }
        emit(
            "nav_reported",
            json!({"sequence":report.sequence,"observed_at_ms":report.observed_at_ms,"evidence_hash":report.evidence_hash,"gross_assets_raw":g.to_string(),"liabilities_raw":l.to_string(),"fee_authorized":by_owner}),
        );
    }
    pub fn settle_deposit(&mut self, id: U64) {
        self.idle();
        assert_eq!(self.status, Status::Running, "DEPOSITS_PAUSED");
        let nav = self.fresh_nav();
        assert!(
            self.token.total_supply == 0 || nav > 0,
            "ZERO_NAV_WITH_SHARES"
        );
        let mut r = self
            .requests
            .get(&id.0)
            .cloned()
            .expect("REQUEST_NOT_FOUND");
        assert_eq!(r.kind, RequestKind::Deposit, "NOT_DEPOSIT");
        assert_eq!(r.status, RequestStatus::Queued, "REQUEST_NOT_QUEUED");
        assert!(
            add(nav, r.amount_raw.0) <= self.config.capacity_raw.0,
            "CAPACITY"
        );
        // A curator report cannot crystallize fees. Above the high-water mark, a new depositor would later pay
        // a performance fee on gains made before it joined, so it settles only after an owner report.
        assert!(
            self.config.performance_fee_bps == 0
                || self.report_by_owner
                || pps(nav, self.token.total_supply, false) <= self.hwm,
            "OWNER_REPORT_REQUIRED_ABOVE_HWM"
        );
        let shares = shares_for(r.amount_raw.0, nav, self.token.total_supply);
        assert!(shares > 0 && shares >= r.min_output_raw.0, "MIN_SHARES");
        let held = assets_for(self.held_shares(&r.owner_id), nav, self.token.total_supply);
        assert!(
            add(held, r.amount_raw.0) <= self.config.per_depositor_cap_raw.0,
            "DEPOSITOR_CAP"
        );
        self.pending_deposits -= r.amount_raw.0;
        self.liquid = add(self.liquid, r.amount_raw.0);
        self.mint(&r.owner_id, shares, "deposit");
        r.status = RequestStatus::Settled;
        r.shares_minted_raw = U128(shares);
        self.flow();
        self.requests.insert(id.0, r.clone());
        emit(
            "deposit_settled",
            json!({"id":id,"owner_id":r.owner_id,"assets_raw":r.amount_raw,"shares_raw":shares.to_string()}),
        );
    }
}
impl Vault {
    fn owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.config.owner_id,
            "OWNER_ONLY"
        );
    }
    fn reporter(&self) {
        let p = env::predecessor_account_id();
        assert!(
            p == self.config.owner_id || p == self.config.curator_id,
            "REPORTER_ONLY"
        );
    }
    fn idle(&self) {
        assert!(self.busy.is_none(), "EXTERNAL_OPERATION_UNRESOLVED");
    }
    fn flow(&mut self) {
        self.flow_nonce = self.flow_nonce.checked_add(1).expect("NONCE_OVERFLOW");
    }
    fn fresh_nav(&self) -> u128 {
        self.get_nav().nav_raw.expect("NAV_UNAVAILABLE").0
    }
    fn gross_liabilities(&self) -> (u128, u128) {
        let mut assets = self.liquid;
        let mut liabilities = 0;
        if let Some(r) = &self.report {
            for p in &r.positions {
                assets = add(assets, p.assets_raw.0);
                liabilities = add(liabilities, p.liabilities_raw.0);
            }
        }
        (assets, liabilities)
    }
    fn validate_limits(
        cap: u128,
        personal: u128,
        pos: u16,
        protocol: u16,
        chain: u16,
        liquid: u16,
    ) {
        assert!(
            cap > 0 && personal > 0 && personal <= cap && cap < u128::MAX / 2,
            "INVALID_CAPACITY"
        );
        assert!(
            [pos, protocol, chain].iter().all(|x| *x > 0 && *x <= 10000) && liquid <= 10000,
            "INVALID_CONCENTRATION"
        );
    }
    fn mint(&mut self, account: &AccountId, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.token.internal_deposit(account, amount);
        FtMint {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }
    fn crystallize(&mut self, nav: u128) {
        let (fee, minted) = fee_shares(
            nav,
            self.token.total_supply,
            self.hwm,
            self.config.performance_fee_bps,
        );
        if minted > 0 {
            let curator = mul_div(
                minted,
                self.config.curator_fee_share_bps as u128,
                10000,
                false,
            );
            let platform = minted - curator;
            self.mint(&self.config.curator_id.clone(), curator, "performance fee");
            self.mint(
                &self.config.platform_id.clone(),
                platform,
                "performance fee",
            );
            self.hwm = self.hwm.max(pps(nav, self.token.total_supply, true));
            emit(
                "fee_minted",
                json!({"fee_assets_raw":fee.to_string(),"curator_shares_raw":curator.to_string(),"platform_shares_raw":platform.to_string(),"hwm_e18":self.hwm.to_string()}),
            );
        }
    }
    fn next_request(&mut self) -> u64 {
        assert!(
            self.requests.len() < MAX_REQUESTS,
            "REQUEST_RETENTION_LIMIT"
        );
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1).expect("ID_OVERFLOW");
        id
    }
}
#[near]
impl FungibleTokenReceiver for Vault {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_eq!(
            env::predecessor_account_id(),
            self.config.asset_id,
            "UNDERLYING_ONLY"
        );
        self.flow();
        let args = serde_json::from_str::<Value>(&msg).ok();
        let min = args
            .as_ref()
            .and_then(|v| v.get("min_shares"))
            .and_then(Value::as_str)
            .and_then(|v| v.parse::<u128>().ok());
        let action = args
            .as_ref()
            .and_then(|v| v.get("action"))
            .and_then(Value::as_str);
        let nav = self.get_nav().nav_raw;
        let permitted = self
            .config
            .single_depositor
            .as_ref()
            .is_none_or(|a| a == &sender_id);
        if action != Some("deposit")
            || min.is_none()
            || amount.0 == 0
            || self.status != Status::Running
            || self.busy.is_some()
            || nav.is_none()
            || !permitted
            || self.token.accounts.get(&sender_id).is_none()
            || self.requests.len() >= MAX_REQUESTS
            || self.request_credits.get(&sender_id).copied().unwrap_or(0) < QUEUE_STORAGE
        {
            return PromiseOrValue::Value(amount);
        }
        let nav = nav.unwrap().0;
        if self.token.total_supply > 0 && nav == 0 {
            return PromiseOrValue::Value(amount);
        }
        let existing = self
            .requests
            .values()
            .filter(|r| {
                r.kind == RequestKind::Deposit
                    && r.status == RequestStatus::Queued
                    && r.owner_id == sender_id
            })
            .fold(0, |n, r| add(n, r.amount_raw.0));
        let owned = assets_for(self.held_shares(&sender_id), nav, self.token.total_supply);
        if add(add(nav, self.pending_deposits), amount.0) > self.config.capacity_raw.0
            || add(add(owned, existing), amount.0) > self.config.per_depositor_cap_raw.0
        {
            return PromiseOrValue::Value(amount);
        }
        *self.request_credits.get_mut(&sender_id).unwrap() -= QUEUE_STORAGE;
        let id = self.next_request();
        let r = Request {
            id: U64(id),
            owner_id: sender_id.clone(),
            kind: RequestKind::Deposit,
            amount_raw: amount,
            min_output_raw: U128(min.unwrap()),
            created_at_ms: U64(now()),
            not_before_ms: U64(now()),
            status: RequestStatus::Queued,
            claimable_raw: U128(0),
            shares_minted_raw: U128(0),
            shares_burned_raw: U128(0),
        };
        self.requests.insert(id, r);
        self.pending_deposits = add(self.pending_deposits, amount.0);
        emit(
            "deposit_queued",
            json!({"id":id.to_string(),"owner_id":sender_id,"assets_raw":amount,"min_shares":min.unwrap().to_string()}),
        );
        PromiseOrValue::Value(U128(0))
    }
}
#[near]
impl FungibleTokenCore for Vault {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert!(
            self.config.single_depositor.is_none(),
            "CUSTODY_SHARES_NONTRANSFERABLE"
        );
        self.token.ft_transfer(receiver_id, amount, memo);
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert!(
            self.config.single_depositor.is_none(),
            "CUSTODY_SHARES_NONTRANSFERABLE"
        );
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenResolver for Vault {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}
#[near]
impl StorageManagement for Vault {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let p = env::predecessor_account_id();
        assert!(
            p != env::current_account_id()
                && p != self.config.curator_id
                && p != self.config.platform_id,
            "SYSTEM_ACCOUNT_STORAGE_REQUIRED"
        );
        assert!(
            !self.requests.values().any(|r| r.owner_id == p
                && matches!(
                    r.status,
                    RequestStatus::Queued | RequestStatus::Claimable | RequestStatus::Claiming
                )),
            "PENDING_REQUEST_STORAGE_REQUIRED"
        );
        self.token.storage_unregister(force)
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
#[near]
impl FungibleTokenMetadataProvider for Vault {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.into(),
            name: self.config.share_name.clone(),
            symbol: self.config.share_symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }
}

#[cfg(test)]
mod tests;
