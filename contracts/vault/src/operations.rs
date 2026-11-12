use super::*;
#[near]
impl Vault {
    pub fn get_operator(&self) -> Value {
        json!({"policy":self.operator,"version":self.operator_version.to_string(),"usage_day":self.usage_day.to_string(),"daily_used_raw":if self.usage_day==now()/86_400_000{self.usage_daily}else{0}.to_string(),"cumulative_used_raw":self.usage_cumulative.to_string(),"deployed_raw":self.deployed.to_string(),"deployed_basis":"gross_resolved_supply_raw_without_withdrawal_recredit","liquid_sync_required":self.sync_required})
    }
    #[payable]
    pub fn set_operator(&mut self, policy: OperatorPolicy) {
        self.owner();
        assert_one_yocto();
        self.idle();
        assert!(
            policy.valid_until_ms.0 > now()
                && policy.valid_until_ms.0
                    <= now().checked_add(90 * 86_400_000).expect("TIME_OVERFLOW"),
            "OPERATOR_VALIDITY"
        );
        assert!(
            policy.max_per_action_raw.0 > 0
                && policy.max_daily_raw.0 >= policy.max_per_action_raw.0
                && policy.max_cumulative_raw.0 >= policy.max_daily_raw.0
                && policy.max_deployed_raw.0 <= self.config.capacity_raw.0
                && policy.min_idle_raw.0 <= self.config.capacity_raw.0,
            "OPERATOR_LIMITS"
        );
        self.roll_day();
        self.operator = Some(policy.clone());
        self.operator_version = self
            .operator_version
            .checked_add(1)
            .expect("VERSION_OVERFLOW");
        emit(
            "operator_changed",
            json!({"policy":policy,"version":self.operator_version.to_string(),"daily_used_raw":self.usage_daily.to_string(),"cumulative_used_raw":self.usage_cumulative.to_string()}),
        );
    }
    /// All arguments affecting custody are constructed here. The delegate can choose only a raw USDC amount.
    pub fn curator_supply(&mut self, amount: U128) -> Promise {
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            0,
            "NO_ATTACHED_DEPOSIT"
        );
        self.idle();
        assert_eq!(self.status, Status::Running, "DEPLOYMENT_PAUSED");
        let nav = self.fresh_nav();
        let policy = self.operator.clone().expect("OPERATOR_LIMITS_REQUIRED");
        self.operator_caller(&policy, false);
        assert!(amount.0 > 0, "ZERO_OPERATION");
        assert!(
            env::prepaid_gas().as_gas() >= 280_000_000_000_000,
            "SUPPLY_GAS_REQUIRED"
        );
        self.native_budget(1);
        self.roll_day();
        assert!(amount.0 <= policy.max_per_action_raw.0, "PER_ACTION_CAP");
        assert!(
            add(self.usage_daily, amount.0) <= policy.max_daily_raw.0,
            "DAILY_CAP"
        );
        assert!(
            add(self.usage_cumulative, amount.0) <= policy.max_cumulative_raw.0,
            "CUMULATIVE_CAP"
        );
        assert!(
            add(self.deployed, amount.0) <= policy.max_deployed_raw.0,
            "DEPLOYED_CAP"
        );
        assert!(self.liquid >= amount.0, "LIQUIDITY");
        let queue_reserve = mul_div(
            self.queued_shares,
            add(nav, VIRTUAL_ASSETS),
            add(self.token.total_supply, VIRTUAL_SHARES),
            true,
        );
        let idle_floor = policy.min_idle_raw.0.max(mul_div(
            nav,
            self.config.liquidity_target_bps as u128,
            10000,
            true,
        ));
        assert!(
            self.liquid - amount.0 >= add(idle_floor, queue_reserve),
            "RESERVE_OR_QUEUE_PROTECTION"
        );
        self.allocation_caps(nav, amount.0);
        self.usage_daily = add(self.usage_daily, amount.0);
        self.usage_cumulative = add(self.usage_cumulative, amount.0);
        self.liquid -= amount.0;
        self.deployed = add(self.deployed, amount.0);
        let op = self.begin_operation("supply", amount.0);
        emit(
            "curator_started",
            json!({"operation_id":op,"kind":"supply","assets_raw":amount,"operator_version":self.operator_version.to_string(),"receiver_id":self.config.rhea_id}),
        );
        Promise::new(self.config.asset_id.clone())
            .function_call(
                "ft_transfer_call",
                json!({"receiver_id":self.config.rhea_id,"amount":amount,"msg":""})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(220),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_supply",
                json!({"operation_id":op}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(40),
            ))
    }
    #[private]
    pub fn on_supply(&mut self, operation_id: U64) -> bool {
        self.callback("supply", operation_id);
        let amount = self.busy.as_ref().unwrap().amount_raw.0;
        let used = env::promise_result_checked(0, 128)
            .ok()
            .and_then(|data| serde_json::from_slice::<U128>(&data).ok())
            .map(|v| v.0)
            .filter(|v| *v <= amount);
        self.report_required = true;
        if let Some(used) = used {
            let returned = amount - used;
            self.liquid = add(self.liquid, returned);
            self.deployed -= returned;
            self.busy = None;
            self.flow();
            emit(
                "curator_result",
                json!({"operation_id":operation_id,"kind":"supply","status":"resolved","used_raw":used.to_string(),"returned_raw":returned.to_string(),"report_required":true}),
            );
            true
        } else {
            emit(
                "curator_result",
                json!({"operation_id":operation_id,"kind":"supply","status":"unknown","reason":"Token resolver did not prove used/refunded amount; operation remains locked"}),
            );
            false
        }
    }
    pub fn curator_withdraw(&mut self, amount: U128) -> Promise {
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            0,
            "NO_ATTACHED_DEPOSIT"
        );
        self.idle();
        assert!(!self.sync_required, "LIQUID_SYNC_REQUIRED");
        let caller = env::predecessor_account_id();
        if caller != self.config.owner_id && caller != self.config.curator_id {
            let policy = self.operator.as_ref().expect("OPERATOR_LIMITS_REQUIRED");
            self.operator_caller(policy, true);
        }
        // A fixed-beneficiary exit may include reported yield above historic supplied raw units.
        // It never replenishes supply authority or credits idle cash before sync + a fresh report.
        let reported_rhea = self
            .report
            .as_ref()
            .map(|r| {
                r.positions
                    .iter()
                    .filter(|p| p.protocol == self.config.rhea_id.as_str())
                    .fold(0u128, |sum, p| add(sum, p.assets_raw.0))
            })
            .unwrap_or(0);
        assert!(
            amount.0 > 0 && amount.0 <= self.deployed.max(reported_rhea),
            "WITHDRAW_EXCEEDS_REPORTED_POSITION"
        );
        assert!(
            env::prepaid_gas().as_gas() >= 280_000_000_000_000,
            "WITHDRAW_GAS_REQUIRED"
        );
        self.native_budget(1);
        let inner = amount
            .0
            .checked_mul(10u128.pow(self.config.rhea_extra_decimals as u32))
            .expect("INNER_PRECISION_OVERFLOW");
        let op = self.begin_operation("withdraw", amount.0);
        emit(
            "curator_started",
            json!({"operation_id":op,"kind":"withdraw","assets_raw":amount,"receiver_id":self.config.rhea_id,"beneficiary":env::current_account_id()}),
        );
        Promise::new(self.config.rhea_id.clone()).function_call("execute",json!({"actions":[{"Withdraw":{"token_id":self.config.asset_id,"max_amount":inner.to_string()}}]}).to_string().into_bytes(),NearToken::from_yoctonear(1),Gas::from_tgas(250))
          .then(Promise::new(env::current_account_id()).function_call("on_withdraw",json!({"operation_id":op}).to_string().into_bytes(),NearToken::from_yoctonear(0),Gas::from_tgas(25)))
    }
    #[private]
    pub fn on_withdraw(&mut self, operation_id: U64) -> bool {
        self.callback("withdraw", operation_id);
        self.report_required = true;
        self.sync_required = true;
        match env::promise_result_checked(0, 1024) {
            Ok(_) => {
                self.busy = None;
                self.flow();
                emit(
                    "curator_result",
                    json!({"operation_id":operation_id,"kind":"withdraw","status":"payout_unverified","liquid_sync_required":true,"report_required":true}),
                );
                true
            }
            Err(_) => {
                emit(
                    "curator_result",
                    json!({"operation_id":operation_id,"kind":"withdraw","status":"unknown","reason":"Unverified external outcome; operation remains locked"}),
                );
                false
            }
        }
    }
    #[payable]
    pub fn sync_liquid(&mut self) -> Promise {
        self.reporter();
        assert_one_yocto();
        self.idle();
        assert!(
            env::prepaid_gas().as_gas() >= 50_000_000_000_000,
            "SYNC_GAS_REQUIRED"
        );
        self.report_required = true;
        self.sync_required = true;
        let op = self.begin_operation("sync", 0);
        Promise::new(self.config.asset_id.clone())
            .function_call(
                "ft_balance_of",
                json!({"account_id":env::current_account_id()})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_sync_liquid",
                json!({"operation_id":op}).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(25),
            ))
    }
    #[private]
    pub fn on_sync_liquid(&mut self, operation_id: U64) -> bool {
        self.callback("sync", operation_id);
        let op = self.busy.as_ref().unwrap();
        let result = env::promise_result_checked(0, 128)
            .ok()
            .and_then(|data| serde_json::from_slice::<U128>(&data).ok());
        if op.flow_nonce.0 != self.flow_nonce || result.is_none() {
            self.busy = None;
            emit(
                "liquid_sync_failed",
                json!({"operation_id":operation_id,"reason":"Concurrent token flow or unavailable balance; retry read, NAV stays unavailable"}),
            );
            return false;
        }
        let actual = result.unwrap().0;
        let outside = add(self.pending_deposits, self.claimable);
        if actual < outside {
            self.escrow_shortfall = true;
            self.busy = None;
            emit(
                "liquid_sync_failed",
                json!({"operation_id":operation_id,"reason":"Underlying balance is below pending deposits and claims; claims frozen","actual_raw":actual.to_string(),"escrow_raw":outside.to_string()}),
            );
            return false;
        }
        self.liquid = actual - outside;
        self.busy = None;
        self.sync_required = false;
        self.escrow_shortfall = false;
        self.flow();
        emit(
            "liquid_synced",
            json!({"operation_id":operation_id,"actual_raw":actual.to_string(),"liquid_assets_raw":self.liquid.to_string(),"pending_deposits_raw":self.pending_deposits.to_string(),"claimable_raw":self.claimable.to_string(),"report_required":true}),
        );
        true
    }
    #[payable]
    pub fn upgrade(&mut self, code: Base64VecU8) -> Promise {
        self.owner();
        assert_one_yocto();
        self.idle();
        assert!(
            !code.0.is_empty() && code.0.len() <= 4 * 1024 * 1024,
            "INVALID_WASM_SIZE"
        );
        emit(
            "upgrade_requested",
            json!({"owner_id":self.config.owner_id,"wasm_sha256":env::sha256(&code.0).iter().map(|b|format!("{b:02x}")).collect::<String>(),"disclosed_upgrade_keys":self.config.disclosed_upgrade_keys}),
        );
        Promise::new(env::current_account_id()).deploy_contract(code.0)
    }
}
impl Vault {
    fn roll_day(&mut self) {
        let day = now() / 86_400_000;
        assert!(day >= self.usage_day, "CLOCK_REWIND");
        if day != self.usage_day {
            self.usage_day = day;
            self.usage_daily = 0;
        }
    }
    fn operator_caller(&self, policy: &OperatorPolicy, reduce: bool) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.config.owner_id
                || caller == self.config.curator_id
                || caller == policy.account_id,
            "OPERATOR_ONLY"
        );
        assert!(now() < policy.valid_until_ms.0, "OPERATOR_EXPIRED");
        assert!(reduce || !policy.paused, "OPERATOR_PAUSED");
    }
    fn allocation_caps(&self, nav: u128, amount: u128) {
        let mut protocol = 0;
        let mut chain = 0;
        if let Some(report) = &self.report {
            for p in &report.positions {
                if p.protocol == self.config.rhea_id.as_str() {
                    protocol = add(protocol, p.assets_raw.0);
                }
                if p.chain == "near" {
                    chain = add(chain, p.assets_raw.0);
                }
            }
        }
        let position = add(protocol, amount);
        assert!(
            position <= mul_div(nav, self.config.max_position_bps as u128, 10000, false),
            "POSITION_CONCENTRATION"
        );
        assert!(
            position <= mul_div(nav, self.config.max_protocol_bps as u128, 10000, false),
            "PROTOCOL_CONCENTRATION"
        );
        assert!(
            add(chain, amount) <= mul_div(nav, self.config.max_chain_bps as u128, 10000, false),
            "CHAIN_CONCENTRATION"
        );
    }
}
