use super::*;
#[near]
impl Vault {
    #[payable]
    pub fn cancel_deposit(&mut self, id: U64) {
        assert_one_yocto();
        self.idle();
        let mut r = self
            .requests
            .get(&id.0)
            .cloned()
            .expect("REQUEST_NOT_FOUND");
        assert_eq!(
            r.owner_id,
            env::predecessor_account_id(),
            "REQUEST_OWNER_ONLY"
        );
        assert_eq!(r.kind, RequestKind::Deposit, "NOT_DEPOSIT");
        assert_eq!(r.status, RequestStatus::Queued, "REQUEST_NOT_QUEUED");
        self.pending_deposits -= r.amount_raw.0;
        self.claimable = add(self.claimable, r.amount_raw.0);
        r.claimable_raw = r.amount_raw;
        r.status = RequestStatus::Claimable;
        self.requests.insert(id.0, r.clone());
        self.flow();
        emit(
            "deposit_cancelled",
            json!({"id":id,"owner_id":r.owner_id,"claimable_raw":r.claimable_raw}),
        );
    }
    #[payable]
    pub fn request_redeem(&mut self, shares: U128, min_assets: U128) -> U64 {
        self.idle();
        assert!(shares.0 > 0, "ZERO_REDEMPTION");
        let paid = env::attached_deposit().as_yoctonear();
        assert!(paid >= QUEUE_STORAGE, "QUEUE_STORAGE_PAYMENT_REQUIRED");
        let owner = env::predecessor_account_id();
        assert!(
            self.token.ft_balance_of(owner.clone()).0 >= shares.0,
            "INSUFFICIENT_SHARES"
        );
        let id = self.next_request();
        self.token.internal_transfer(
            &owner,
            &env::current_account_id(),
            shares.0,
            Some("queued redemption".into()),
        );
        self.queued_shares = add(self.queued_shares, shares.0);
        let end = now()
            .checked_add(self.config.redemption_notice_ms.0)
            .expect("TIME_OVERFLOW");
        self.requests.insert(
            id,
            Request {
                id: U64(id),
                owner_id: owner.clone(),
                kind: RequestKind::Redemption,
                amount_raw: shares,
                min_output_raw: min_assets,
                created_at_ms: U64(now()),
                not_before_ms: U64(end),
                status: RequestStatus::Queued,
                claimable_raw: U128(0),
                shares_minted_raw: U128(0),
                shares_burned_raw: U128(0),
            },
        );
        self.flow();
        if paid > QUEUE_STORAGE {
            let _ = Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(paid - QUEUE_STORAGE));
        }
        emit(
            "redemption_requested",
            json!({"id":id.to_string(),"owner_id":owner,"shares_raw":shares,"min_assets_raw":min_assets,"not_before_ms":end.to_string(),"storage_yocto":QUEUE_STORAGE.to_string()}),
        );
        U64(id)
    }
    #[payable]
    pub fn cancel_redemption(&mut self, id: U64) {
        assert_one_yocto();
        self.idle();
        let mut r = self
            .requests
            .get(&id.0)
            .cloned()
            .expect("REQUEST_NOT_FOUND");
        assert_eq!(
            r.owner_id,
            env::predecessor_account_id(),
            "REQUEST_OWNER_ONLY"
        );
        assert_eq!(r.kind, RequestKind::Redemption, "NOT_REDEMPTION");
        assert_eq!(r.status, RequestStatus::Queued, "REQUEST_NOT_QUEUED");
        self.token.internal_transfer(
            &env::current_account_id(),
            &r.owner_id,
            r.amount_raw.0,
            Some("redemption cancelled".into()),
        );
        self.queued_shares -= r.amount_raw.0;
        r.status = RequestStatus::Cancelled;
        self.requests.insert(id.0, r.clone());
        self.flow();
        emit(
            "redemption_cancelled",
            json!({"id":id,"owner_id":r.owner_id,"shares_raw":r.amount_raw}),
        );
    }
    #[payable]
    pub fn amend_redemption(&mut self, id: U64, min_assets: U128) {
        assert_one_yocto();
        self.idle();
        let r = self.requests.get_mut(&id.0).expect("REQUEST_NOT_FOUND");
        assert_eq!(
            r.owner_id,
            env::predecessor_account_id(),
            "REQUEST_OWNER_ONLY"
        );
        assert_eq!(r.kind, RequestKind::Redemption, "NOT_REDEMPTION");
        assert_eq!(r.status, RequestStatus::Queued, "REQUEST_NOT_QUEUED");
        r.min_output_raw = min_assets;
        emit(
            "redemption_amended",
            json!({"id":id,"owner_id":r.owner_id,"min_assets_raw":min_assets}),
        );
    }
    pub fn process_redemptions(&mut self, limit: u32) -> u32 {
        self.idle();
        assert!(limit > 0 && limit <= 20, "PROCESS_LIMIT");
        // While an external operation is unresolved, exits settle at the owner's post-sync exit NAV and only
        // from verified liquid USDC (the per-request `assets > self.liquid` stop below).
        let mut nav = if self.unresolved.is_some() {
            self.exit_nav().expect("EXIT_NAV_UNAVAILABLE")
        } else {
            self.fresh_nav()
        };
        let mut processed = 0;
        for _ in 0..limit {
            let next = self
                .requests
                .values()
                .find(|r| r.kind == RequestKind::Redemption && r.status == RequestStatus::Queued)
                .cloned();
            let Some(mut r) = next else { break };
            if now() < r.not_before_ms.0 {
                break;
            }
            let assets = assets_for(r.amount_raw.0, nav, self.token.total_supply);
            if assets == 0 || assets < r.min_output_raw.0 || assets > self.liquid {
                break;
            }
            assert!(assets <= nav, "NAV_ACCOUNTING");
            self.token
                .internal_withdraw(&env::current_account_id(), r.amount_raw.0);
            FtBurn {
                owner_id: &env::current_account_id(),
                amount: r.amount_raw,
                memo: Some("redemption settled into fixed claim"),
            }
            .emit();
            self.queued_shares -= r.amount_raw.0;
            self.liquid -= assets;
            self.claimable = add(self.claimable, assets);
            nav -= assets;
            r.status = RequestStatus::Claimable;
            r.claimable_raw = U128(assets);
            r.shares_burned_raw = r.amount_raw;
            self.requests.insert(r.id.0, r.clone());
            self.flow();
            processed += 1;
            emit(
                "redemption_settled",
                json!({"id":r.id,"owner_id":r.owner_id,"shares_burned_raw":r.shares_burned_raw,"claimable_assets_raw":r.claimable_raw}),
            );
        }
        processed
    }
    pub fn claim(&mut self, id: U64) -> Promise {
        self.idle();
        assert!(!self.escrow_shortfall, "ESCROW_UNDERCOLLATERALIZED");
        assert!(
            env::prepaid_gas().as_gas() >= 60_000_000_000_000,
            "CLAIM_GAS_REQUIRED"
        );
        self.native_budget(1);
        let mut r = self
            .requests
            .get(&id.0)
            .cloned()
            .expect("REQUEST_NOT_FOUND");
        assert_eq!(r.status, RequestStatus::Claimable, "REQUEST_NOT_CLAIMABLE");
        assert!(r.claimable_raw.0 > 0, "ZERO_CLAIM");
        let op = self.begin_operation("claim", r.claimable_raw.0);
        r.status = RequestStatus::Claiming;
        self.requests.insert(id.0, r.clone());
        emit(
            "claim_started",
            json!({"id":id,"operation_id":op,"owner_id":r.owner_id,"assets_raw":r.claimable_raw}),
        );
        Promise::new(self.config.asset_id.clone()).function_call("ft_transfer".to_owned(),json!({"receiver_id":r.owner_id,"amount":r.claimable_raw,"memo":format!("FlowVault claim {}",id.0)}).to_string().into_bytes(),NearToken::from_yoctonear(1),Gas::from_tgas(25))
            .then(Promise::new(env::current_account_id()).function_call("on_claim".to_owned(),json!({"id":id,"operation_id":op}).to_string().into_bytes(),NearToken::from_yoctonear(0),Gas::from_tgas(20)))
    }
    #[private]
    pub fn on_claim(&mut self, id: U64, operation_id: U64) -> bool {
        self.callback("claim", operation_id);
        let mut r = self
            .requests
            .get(&id.0)
            .cloned()
            .expect("REQUEST_NOT_FOUND");
        assert_eq!(r.status, RequestStatus::Claiming, "CLAIM_REPLAY");
        let op = self.busy.as_ref().unwrap();
        assert_eq!(op.amount_raw, r.claimable_raw, "CLAIM_AMOUNT_CHANGED");
        let success = match env::promise_result_checked(0, 128) {
            Ok(_) => true,
            Err(near_sdk::PromiseError::Failed) => false,
            Err(_) => {
                emit(
                    "claim_unknown",
                    json!({"id":id,"operation_id":operation_id,"reason":"oversized callback result; claim remains locked"}),
                );
                return false;
            }
        };
        if success {
            self.claimable -= r.claimable_raw.0;
            let amount = r.claimable_raw;
            r.claimable_raw = U128(0);
            r.status = if r.kind == RequestKind::Deposit {
                RequestStatus::Cancelled
            } else {
                RequestStatus::Completed
            };
            emit(
                "claim_completed",
                json!({"id":id,"operation_id":operation_id,"owner_id":r.owner_id,"assets_raw":amount}),
            );
        } else {
            r.status = RequestStatus::Claimable;
            emit(
                "claim_failed",
                json!({"id":id,"operation_id":operation_id,"owner_id":r.owner_id,"claimable_raw":r.claimable_raw}),
            );
        }
        self.requests.insert(id.0, r);
        self.busy = None;
        self.flow();
        success
    }
    #[payable]
    pub fn set_status(&mut self, status: Status) {
        self.owner();
        assert_one_yocto();
        assert!(
            self.status != Status::Shutdown || status == Status::Shutdown,
            "SHUTDOWN_IRREVERSIBLE"
        );
        let old = self.status.clone();
        self.status = status.clone();
        emit("status_changed", json!({"previous":old,"status":status}));
    }
    #[payable]
    pub fn set_limits(
        &mut self,
        capacity_raw: U128,
        per_depositor_cap_raw: U128,
        max_position_bps: u16,
        max_protocol_bps: u16,
        max_chain_bps: u16,
        liquidity_target_bps: u16,
    ) {
        self.owner();
        assert_one_yocto();
        self.idle();
        Self::validate_limits(
            capacity_raw.0,
            per_depositor_cap_raw.0,
            max_position_bps,
            max_protocol_bps,
            max_chain_bps,
            liquidity_target_bps,
        );
        self.config.capacity_raw = capacity_raw;
        self.config.per_depositor_cap_raw = per_depositor_cap_raw;
        self.config.max_position_bps = max_position_bps;
        self.config.max_protocol_bps = max_protocol_bps;
        self.config.max_chain_bps = max_chain_bps;
        self.config.liquidity_target_bps = liquidity_target_bps;
        emit(
            "limits_changed",
            json!({"capacity_raw":capacity_raw,"per_depositor_cap_raw":per_depositor_cap_raw,"max_position_bps":max_position_bps,"max_protocol_bps":max_protocol_bps,"max_chain_bps":max_chain_bps,"liquidity_target_bps":liquidity_target_bps}),
        );
    }
    #[payable]
    pub fn prune_requests(&mut self, ids: Vec<U64>) {
        self.owner();
        assert_one_yocto();
        assert!(ids.len() <= 100, "PRUNE_LIMIT");
        for id in ids {
            let r = self.requests.get(&id.0).expect("REQUEST_NOT_FOUND");
            assert!(
                matches!(
                    r.status,
                    RequestStatus::Settled | RequestStatus::Completed | RequestStatus::Cancelled
                ) && r.claimable_raw.0 == 0,
                "PENDING_REQUEST_CANNOT_BE_PRUNED"
            );
            self.requests.remove(&id.0);
        }
    }
}
impl Vault {
    pub(super) fn held_shares(&self, account: &AccountId) -> u128 {
        let mut shares = self.token.ft_balance_of(account.clone()).0;
        for r in self.requests.values().filter(|r| {
            r.owner_id == *account
                && r.kind == RequestKind::Redemption
                && r.status == RequestStatus::Queued
        }) {
            shares = add(shares, r.amount_raw.0);
        }
        shares
    }
    pub(super) fn begin_operation(&mut self, kind: &str, amount: u128) -> U64 {
        self.idle();
        let id = self.next_operation;
        self.next_operation = self
            .next_operation
            .checked_add(1)
            .expect("OPERATION_OVERFLOW");
        self.flow();
        self.busy = Some(Operation {
            id: U64(id),
            kind: kind.into(),
            amount_raw: U128(amount),
            flow_nonce: U64(self.flow_nonce),
        });
        U64(id)
    }
    pub(super) fn callback(&self, kind: &str, id: U64) {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "PRIVATE_CALLBACK_ONLY"
        );
        assert_eq!(env::promise_results_count(), 1, "CALLBACK_RESULT_REQUIRED");
        let op = self.busy.as_ref().expect("NO_OPERATION");
        assert!(
            op.id == id && op.kind == kind,
            "OPERATION_REPLAY_OR_MISMATCH"
        );
    }
    pub(super) fn native_budget(&self, deposit: u128) {
        let locked = env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(env::storage_usage() as u128)
            .expect("STORAGE_OVERFLOW");
        assert!(
            env::account_balance().as_yoctonear() >= add(locked, deposit),
            "OPERATIONAL_NEAR_REQUIRED"
        );
    }
}
