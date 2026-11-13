use super::*;
use near_sdk::{
    test_utils::{VMContextBuilder, get_logs},
    testing_env,
};
fn account(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn context(predecessor: &str, deposit: u128, ms: u64) {
    let mut c = VMContextBuilder::new();
    c.current_account_id(account("vault.near"))
        .predecessor_account_id(account(predecessor))
        .signer_account_id(account(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(ms * 1_000_000);
    testing_env!(c.build());
}
fn config() -> Config {
    Config {
        owner_id: account("owner.near"),
        curator_id: account("curator.near"),
        platform_id: account("platform.near"),
        asset_id: account(USDC),
        asset_decimals: 6,
        share_name: "Vault USDC".into(),
        share_symbol: "fvUSDC".into(),
        performance_fee_bps: 1500,
        curator_fee_share_bps: 7000,
        capacity_raw: U128(1_000_000_000_000),
        per_depositor_cap_raw: U128(100_000_000_000),
        max_position_bps: 8000,
        max_protocol_bps: 8000,
        max_chain_bps: 10000,
        liquidity_target_bps: 2000,
        redemption_notice_ms: U64(0),
        max_nav_age_ms: U64(180_000),
        single_depositor: None,
        rhea_id: account(RHEA),
        rhea_extra_decimals: 12,
        disclosed_upgrade_keys: vec![],
    }
}
fn vault() -> Vault {
    context("vault.near", 0, 1_000);
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    Vault::new(config())
}
fn report(v: &mut Vault, seq: u64, external: u128) {
    context("owner.near", 1, 1_000 + seq);
    v.report_nav(NavReport {
        sequence: U64(seq),
        observed_at_ms: U64(1_000 + seq),
        positions: if external == 0 {
            vec![]
        } else {
            vec![Position {
                id: "rhea".into(),
                protocol: RHEA.into(),
                chain: "near".into(),
                assets_raw: U128(external),
                liabilities_raw: U128(0),
            }]
        },
        evidence_hash: format!("finalized-evidence-{seq}"),
    });
}
fn credit(v: &mut Vault, owner: &str) {
    context(owner, QUEUE_STORAGE, 1_100);
    v.fund_request_storage();
}
fn deposit(v: &mut Vault, owner: &str, amount: u128) -> u64 {
    credit(v, owner);
    context(USDC, 0, 1_101);
    let id = v.next_id;
    let r = v.ft_on_transfer(
        account(owner),
        U128(amount),
        "{\"action\":\"deposit\",\"min_shares\":\"1\"}".into(),
    );
    assert!(matches!(r, PromiseOrValue::Value(U128(0))));
    id
}
fn settle_deposit(v: &mut Vault, id: u64) {
    context("keeper.near", 0, 1_102);
    v.settle_deposit(U64(id));
}
fn fails(f: impl FnOnce()) {
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err());
}
#[test]
fn no_cash_or_shares_from_queued_deposit() {
    let mut v = vault();
    report(&mut v, 1, 0);
    let id = deposit(&mut v, "owner.near", 10_000_000);
    assert_eq!(v.pending_deposits, 10_000_000);
    assert_eq!(v.liquid, 0);
    assert_eq!(v.ft_total_supply().0, 0);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 0);
    assert_eq!(
        v.get_request(U64(id)).unwrap().status,
        RequestStatus::Queued
    );
    settle_deposit(&mut v, id);
    assert_eq!(v.pending_deposits, 0);
    assert_eq!(v.liquid, 10_000_000);
    assert_eq!(v.ft_total_supply().0, 10 * E18);
    assert_eq!(v.ft_balance_of(account("owner.near")).0, 10 * E18);
    assert_eq!(
        v.get_request(U64(id)).unwrap().shares_minted_raw.0,
        10 * E18
    );
    assert!(get_logs().iter().any(|s| s.contains("deposit_settled")));
}
#[test]
fn missing_stale_or_unregistered_deposits_are_returned_not_minted() {
    let mut v = vault();
    credit(&mut v, "owner.near");
    context(USDC, 0, 1_101);
    let msg = "{\"action\":\"deposit\",\"min_shares\":\"1\"}";
    assert!(matches!(
        v.ft_on_transfer(account("owner.near"), U128(1_000_000), msg.into()),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    report(&mut v, 1, 0);
    context(USDC, 0, 200_000);
    assert!(matches!(
        v.ft_on_transfer(account("owner.near"), U128(1_000_000), msg.into()),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    assert_eq!(v.token.total_supply, 0);
    assert_eq!(v.pending_deposits, 0);
    assert_eq!(
        v.request_credits.get(&account("owner.near")).copied(),
        Some(QUEUE_STORAGE)
    );
}
#[test]
fn only_underlying_can_create_deposit() {
    let mut v = vault();
    report(&mut v, 1, 0);
    context("attacker.near", 0, 1_100);
    fails(|| {
        let _ = v.ft_on_transfer(account("owner.near"), U128(1), "{}".into());
    });
}
#[test]
fn capacity_refusal_does_not_consume_request_storage() {
    let mut v = vault();
    report(&mut v, 1, 0);
    credit(&mut v, "owner.near");
    context(USDC, 0, 1_101);
    let a = v.config.capacity_raw.0 + 1;
    assert!(
        matches!(v.ft_on_transfer(account("owner.near"),U128(a),"{\"action\":\"deposit\",\"min_shares\":\"1\"}".into()),PromiseOrValue::Value(U128(x)) if x==a)
    );
    assert_eq!(v.pending_deposits, 0);
    assert_eq!(v.request_credits[&account("owner.near")], QUEUE_STORAGE);
}
#[test]
fn fee_shares_split_and_loss_recovery_preserve_hwm() {
    let mut v = vault();
    report(&mut v, 1, 0);
    let id = deposit(&mut v, "owner.near", 100_000_000);
    settle_deposit(&mut v, id);
    report(&mut v, 2, 20_000_000);
    let first = v.token.total_supply;
    let curator = v.ft_balance_of(account("curator.near")).0;
    let platform = v.ft_balance_of(account("platform.near")).0;
    assert!(curator > 0 && platform > 0);
    assert_eq!(first, 100 * E18 + curator + platform);
    let hwm = v.hwm;
    report(&mut v, 3, 10_000_000);
    assert_eq!(v.token.total_supply, first);
    assert_eq!(v.hwm, hwm);
    report(&mut v, 4, 20_000_000);
    assert_eq!(v.token.total_supply, first);
    report(&mut v, 5, 30_000_000);
    assert!(v.token.total_supply > first);
    assert!(v.hwm > hwm);
}
#[test]
fn reports_are_authorized_monotonic_and_debt_is_not_silently_zero() {
    let mut v = vault();
    report(&mut v, 1, 0);
    context("owner.near", 1, 1_002);
    let r = NavReport {
        sequence: U64(2),
        observed_at_ms: U64(1_002),
        positions: vec![Position {
            id: "debt".into(),
            protocol: RHEA.into(),
            chain: "near".into(),
            assets_raw: U128(0),
            liabilities_raw: U128(1),
        }],
        evidence_hash: "proof".into(),
    };
    v.report_nav(r);
    assert!(v.get_nav().nav_raw.is_none());
    assert!(v.get_nav().reasons.contains(&"NAV_INSOLVENT".into()));
    let r = v.report.clone().unwrap();
    fails(|| v.report_nav(r));
}
#[test]
fn single_depositor_has_zero_fees_and_cannot_transfer_shares() {
    context("vault.near", 0, 1000);
    let mut c = config();
    c.single_depositor = Some(c.owner_id.clone());
    fails(|| {
        Vault::new(c.clone());
    });
    c.performance_fee_bps = 0;
    let mut v = Vault::new(c);
    report(&mut v, 1, 0);
    let id = deposit(&mut v, "owner.near", 1_000_000);
    settle_deposit(&mut v, id);
    context("owner.near", 1, 1_200);
    fails(|| v.ft_transfer(account("curator.near"), U128(1), None));
    assert_eq!(v.ft_metadata().decimals, 18);
}

fn callback_context(result: PromiseResult) {
    let mut c = VMContextBuilder::new();
    c.current_account_id(account("vault.near"))
        .predecessor_account_id(account("vault.near"))
        .signer_account_id(account("keeper.near"))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(2_000_000_000);
    #[allow(deprecated)]
    near_sdk::test_utils::testing_env_with_promise_results(c.build(), result);
}
fn redemption(v: &mut Vault, shares: u128, min: u128) -> U64 {
    context("owner.near", QUEUE_STORAGE, 1_200);
    v.request_redeem(U128(shares), U128(min))
}
fn funded() -> Vault {
    let mut v = vault();
    report(&mut v, 1, 0);
    let id = deposit(&mut v, "owner.near", 100_000_000);
    settle_deposit(&mut v, id);
    v
}
#[test]
fn redemption_escrows_then_burns_into_fixed_claim_not_wallet_cash() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 10_000_000);
    assert_eq!(v.token.total_supply, 100 * E18);
    assert_eq!(v.token.ft_balance_of(account("owner.near")).0, 90 * E18);
    assert_eq!(v.queued_shares, 10 * E18);
    context("keeper.near", 0, 1_201);
    assert_eq!(v.process_redemptions(20), 1);
    assert_eq!(v.token.total_supply, 90 * E18);
    assert_eq!(v.liquid, 90_000_000);
    assert_eq!(v.claimable, 10_000_000);
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Claimable);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 90_000_000);
    assert_eq!(
        v.get_account(account("owner.near"))["claimable_raw"],
        "10000000"
    );
}
#[test]
fn claim_failure_restores_same_claim_and_nonce_blocks_old_callback() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 0);
    context("keeper.near", 0, 1_201);
    v.process_redemptions(1);
    let _ = v.claim(id);
    let first = v.busy.as_ref().unwrap().id;
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Claiming);
    fails(|| {
        let _ = v.claim(id);
    });
    callback_context(PromiseResult::Failed);
    assert!(!v.on_claim(id, first));
    assert_eq!(v.claimable, 10_000_000);
    assert_eq!(v.token.total_supply, 90 * E18);
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Claimable);
    context("keeper.near", 0, 2_000);
    let _ = v.claim(id);
    let second = v.busy.as_ref().unwrap().id;
    assert_ne!(first, second);
    callback_context(PromiseResult::Successful(vec![]));
    fails(|| {
        v.on_claim(id, first);
    });
    assert!(v.on_claim(id, second));
    assert_eq!(v.claimable, 0);
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Completed);
    assert_eq!(v.token.total_supply, 90 * E18);
    fails(|| {
        v.on_claim(id, second);
    });
}
#[test]
fn fifo_notice_minimum_and_insufficient_liquidity_never_skip_a_holder() {
    let mut v = funded();
    v.config.redemption_notice_ms = U64(1000);
    let first = redemption(&mut v, 10 * E18, 11_000_000);
    let second = redemption(&mut v, 5 * E18, 0);
    context("keeper.near", 0, 1_201);
    assert_eq!(v.process_redemptions(20), 0);
    context("keeper.near", 0, 2_201);
    assert_eq!(v.process_redemptions(20), 0);
    assert_eq!(v.get_request(second).unwrap().status, RequestStatus::Queued);
    context("owner.near", 1, 2_201);
    v.amend_redemption(first, U128(0));
    v.liquid = 1_000_000;
    report(&mut v, 2, 99_000_000);
    context("keeper.near", 0, 2_202);
    assert_eq!(v.process_redemptions(20), 0);
    assert_eq!(v.token.total_supply, 100 * E18);
}
#[test]
fn cancel_deposit_returns_fixed_refund_and_cancel_redeem_returns_escrow() {
    let mut v = vault();
    report(&mut v, 1, 0);
    let id = deposit(&mut v, "owner.near", 10_000_000);
    context("owner.near", 1, 1_200);
    v.cancel_deposit(U64(id));
    assert_eq!(v.pending_deposits, 0);
    assert_eq!(v.claimable, 10_000_000);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 0);
    assert_eq!(v.token.total_supply, 0);
    context("keeper.near", 0, 1_201);
    let _ = v.claim(U64(id));
    let op = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Successful(vec![]));
    assert!(v.on_claim(U64(id), op));
    assert_eq!(
        v.get_request(U64(id)).unwrap().status,
        RequestStatus::Cancelled
    );
    let deposit_id = deposit(&mut v, "owner.near", 10_000_000);
    settle_deposit(&mut v, deposit_id);
    let rid = redemption(&mut v, 5 * E18, 0);
    context("owner.near", 1, 1_203);
    v.cancel_redemption(rid);
    assert_eq!(v.ft_balance_of(account("owner.near")).0, 10 * E18);
    assert_eq!(v.queued_shares, 0);
    assert_eq!(v.token.total_supply, 10 * E18);
}
#[test]
fn pause_shutdown_keep_exits_open_and_cannot_be_reversed() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 0);
    context("owner.near", 1, 1_201);
    v.set_status(Status::Paused);
    context("keeper.near", 0, 1_202);
    assert_eq!(v.process_redemptions(1), 1);
    context("owner.near", 1, 1_203);
    v.set_status(Status::Shutdown);
    fails(|| v.set_status(Status::Running));
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Claimable);
    context("keeper.near", 0, 1_204);
    let _ = v.claim(id);
}
#[test]
fn claim_callback_is_private_and_pending_requests_cannot_be_pruned() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 0);
    context("owner.near", 1, 1_201);
    fails(|| v.prune_requests(vec![id]));
    context("keeper.near", 0, 1_202);
    v.process_redemptions(1);
    let _ = v.claim(id);
    let op = v.busy.as_ref().unwrap().id;
    context("attacker.near", 0, 1_203);
    fails(|| {
        v.on_claim(id, op);
    });
    assert_eq!(v.get_request(id).unwrap().status, RequestStatus::Claiming);
}
#[test]
fn escrowed_shares_still_count_toward_personal_deposit_cap() {
    let mut v = funded();
    v.config.per_depositor_cap_raw = U128(100_000_000);
    let _ = redemption(&mut v, 10 * E18, 0);
    credit(&mut v, "owner.near");
    context(USDC, 0, 1_300);
    assert!(matches!(
        v.ft_on_transfer(
            account("owner.near"),
            U128(1_000_000),
            "{\"action\":\"deposit\",\"min_shares\":\"1\"}".into()
        ),
        PromiseOrValue::Value(U128(1_000_000))
    ));
    assert_eq!(v.pending_deposits, 0);
}

fn policy() -> OperatorPolicy {
    OperatorPolicy {
        account_id: account("operator.near"),
        valid_until_ms: U64(200_000_000),
        max_per_action_raw: U128(10_000_000),
        max_daily_raw: U128(20_000_000),
        max_cumulative_raw: U128(50_000_000),
        max_deployed_raw: U128(80_000_000),
        min_idle_raw: U128(10_000_000),
        paused: false,
    }
}
fn authorize(v: &mut Vault) {
    context("owner.near", 1, 1_200);
    v.set_operator(policy());
}
fn supply(v: &mut Vault, amount: u128) -> U64 {
    context("operator.near", 0, 1_201);
    let _ = v.curator_supply(U128(amount));
    v.busy.as_ref().unwrap().id
}
fn resolve_supply(v: &mut Vault, op: U64, used: u128) {
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(used)).unwrap(),
    ));
    assert!(v.on_supply(op));
}
fn report_at(v: &mut Vault, seq: u64, external: u128, at: u64) {
    context("curator.near", 1, at);
    v.report_nav(NavReport {
        sequence: U64(seq),
        observed_at_ms: U64(at),
        positions: vec![Position {
            id: "rhea".into(),
            protocol: RHEA.into(),
            chain: "near".into(),
            assets_raw: U128(external),
            liabilities_raw: U128(0),
        }],
        evidence_hash: format!("proof-{seq}"),
    });
}
#[test]
fn supply_builds_only_the_typed_exact_rhea_deposit() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    assert_eq!(v.liquid, 90_000_000);
    assert_eq!(v.deployed, 10_000_000);
    assert!(v.get_nav().nav_raw.is_none());
    let receipts = near_sdk::test_utils::get_created_receipts();
    let token = receipts
        .iter()
        .find(|r| r.receiver_id == account(USDC))
        .unwrap();
    let call = token
        .actions
        .iter()
        .find_map(|a| {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } = a
            {
                Some((method_name, args, attached_deposit))
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(call.0, b"ft_transfer_call");
    assert_eq!(call.2.as_yoctonear(), 1);
    let args: Value = serde_json::from_slice(call.1).unwrap();
    assert_eq!(
        args,
        json!({"receiver_id":RHEA,"amount":"10000000","msg":""})
    );
    resolve_supply(&mut v, op, 10_000_000);
    assert!(v.report_required);
    assert!(v.busy.is_none());
    report_at(&mut v, 2, 10_000_000, 2_001);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 100_000_000);
}
#[test]
fn actual_used_amount_restores_only_proven_unused_capital_and_preserves_usage() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 4_000_000);
    assert_eq!(v.liquid, 96_000_000);
    assert_eq!(v.deployed, 4_000_000);
    assert_eq!(v.usage_daily, 10_000_000);
    assert_eq!(v.usage_cumulative, 10_000_000);
    context("owner.near", 1, 2_001);
    let mut p = policy();
    p.account_id = account("replacement.near");
    v.set_operator(p);
    assert_eq!(v.usage_daily, 10_000_000);
    assert_eq!(v.usage_cumulative, 10_000_000);
    assert_eq!(v.operator_version, 2);
}
#[test]
fn malformed_external_result_never_unlocks_or_invents_refund() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    callback_context(PromiseResult::Successful(b"not-a-quantity".to_vec()));
    assert!(!v.on_supply(op));
    assert_eq!(v.liquid, 90_000_000);
    assert_eq!(v.deployed, 10_000_000);
    assert!(v.busy.is_none());
    assert_eq!(v.unresolved.as_ref().unwrap().operation.id, op);
    assert!(v.get_nav().nav_raw.is_none());
    assert!(v.get_nav().exit_nav_raw.is_none());
    context("operator.near", 0, 2_001);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    assert_eq!(v.usage_cumulative, 10_000_000);
}
#[test]
fn delegate_cannot_exceed_action_daily_or_lifetime_caps_and_day_roll_does_not_reset_lifetime() {
    let mut v = funded();
    authorize(&mut v);
    context("operator.near", 0, 1_201);
    fails(|| {
        let _ = v.curator_supply(U128(10_000_001));
    });
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 10_000_000, 2_001);
    context("owner.near", 1, 2_002);
    let mut p = policy();
    p.max_daily_raw = U128(10_000_000);
    v.set_operator(p);
    context("operator.near", 0, 2_003);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    report_at(&mut v, 3, 10_000_000, 86_402_000);
    context("operator.near", 0, 86_402_001);
    let _ = v.curator_supply(U128(1_000_000));
    assert_eq!(v.usage_daily, 1_000_000);
    assert_eq!(v.usage_cumulative, 11_000_000);
}
#[test]
fn queued_redemptions_and_liquidity_floor_are_protected_before_deployment() {
    let mut v = funded();
    let _ = redemption(&mut v, 85 * E18, 0);
    authorize(&mut v);
    context("operator.near", 0, 1_201);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    assert_eq!(v.liquid, 100_000_000);
    assert_eq!(v.usage_daily, 0);
}
#[test]
fn position_protocol_and_chain_concentration_are_independent_guards() {
    for (which, label) in [(0, "POSITION"), (1, "PROTOCOL"), (2, "CHAIN")] {
        let mut v = funded();
        authorize(&mut v);
        if which == 0 {
            v.config.max_position_bps = 500;
        } else if which == 1 {
            v.config.max_protocol_bps = 500;
        } else {
            v.config.max_chain_bps = 500;
        }
        context("operator.near", 0, 1_201);
        let error = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = v.curator_supply(U128(10_000_000));
        }));
        assert!(error.is_err(), "{label} cap must block");
        assert_eq!(v.liquid, 100_000_000);
        assert_eq!(v.usage_cumulative, 0);
    }
}
#[test]
fn operator_expiry_pause_unauthorized_caller_and_vault_shutdown_refuse_deployment() {
    let mut v = funded();
    authorize(&mut v);
    context("attacker.near", 0, 1_201);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    report_at(&mut v, 2, 0, 200_000_001);
    context("operator.near", 0, 200_000_002);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    context("owner.near", 1, 2_000);
    v.set_status(Status::Shutdown);
    context("operator.near", 0, 2_001);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
}
#[test]
fn withdrawal_never_becomes_cash_before_sync_and_fresh_report() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 10_000_000, 2_001);
    context("owner.near", 1, 2_002);
    v.set_status(Status::Shutdown);
    context("operator.near", 0, 2_003);
    let _ = v.curator_withdraw(U128(4_000_000));
    let withdraw_op = v.busy.as_ref().unwrap().id;
    let receipts = near_sdk::test_utils::get_created_receipts();
    let rhea = receipts
        .iter()
        .find(|r| r.receiver_id == account(RHEA))
        .unwrap();
    let args = rhea
        .actions
        .iter()
        .find_map(|a| {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name, args, ..
            } = a
            {
                assert_eq!(method_name, b"execute");
                Some(serde_json::from_slice::<Value>(args).unwrap())
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(
        args,
        json!({"actions":[{"Withdraw":{"token_id":USDC,"max_amount":"4000000000000000000"}}]})
    );
    callback_context(PromiseResult::Successful(vec![]));
    assert!(v.on_withdraw(withdraw_op));
    assert_eq!(v.liquid, 90_000_000);
    assert!(v.sync_required);
    assert!(v.get_nav().nav_raw.is_none());
    context("curator.near", 1, 2_100);
    let _ = v.sync_liquid();
    let sync = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(94_000_000)).unwrap(),
    ));
    assert!(v.on_sync_liquid(sync));
    assert_eq!(v.liquid, 94_000_000);
    assert!(v.get_nav().nav_raw.is_none());
    report_at(&mut v, 3, 6_000_000, 2_101);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 100_000_000);
}
#[test]
fn balance_sync_excludes_pending_deposits_and_fixed_claims() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 0);
    context("keeper.near", 0, 1_201);
    v.process_redemptions(1);
    let _ = deposit(&mut v, "owner.near", 5_000_000);
    context("curator.near", 1, 1_300);
    let _ = v.sync_liquid();
    let sync = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(105_000_000)).unwrap(),
    ));
    assert!(v.on_sync_liquid(sync));
    assert_eq!(v.liquid, 90_000_000);
    assert_eq!(v.pending_deposits, 5_000_000);
    assert_eq!(v.claimable, 10_000_000);
    assert_eq!(v.get_request(id).unwrap().claimable_raw.0, 10_000_000);
    assert!(v.get_nav().nav_raw.is_none());
}
#[test]
fn concurrent_flow_or_bad_read_cannot_publish_liquid_balance() {
    let mut v = funded();
    context("curator.near", 1, 1_300);
    let _ = v.sync_liquid();
    let sync = v.busy.as_ref().unwrap().id;
    v.flow();
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(200_000_000)).unwrap(),
    ));
    assert!(!v.on_sync_liquid(sync));
    assert_eq!(v.liquid, 100_000_000);
    assert!(v.sync_required);
    assert!(v.busy.is_none());
    context("curator.near", 1, 2_001);
    let _ = v.sync_liquid();
    let next = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Failed);
    assert!(!v.on_sync_liquid(next));
    assert_eq!(v.liquid, 100_000_000);
    assert!(v.get_nav().nav_raw.is_none());
}
#[test]
fn sync_detects_missing_escrow_and_freezes_claims() {
    let mut v = funded();
    let id = redemption(&mut v, 10 * E18, 0);
    context("keeper.near", 0, 1_201);
    v.process_redemptions(1);
    context("curator.near", 1, 1_300);
    let _ = v.sync_liquid();
    let sync = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(1)).unwrap(),
    ));
    assert!(!v.on_sync_liquid(sync));
    assert!(v.escrow_shortfall);
    context("keeper.near", 0, 2_001);
    fails(|| {
        let _ = v.claim(id);
    });
    assert_eq!(v.claimable, 10_000_000);
}
#[test]
fn operator_cannot_report_sync_change_policy_or_upgrade() {
    let mut v = funded();
    authorize(&mut v);
    context("operator.near", 1, 1_201);
    fails(|| {
        let _ = v.sync_liquid();
    });
    fails(|| v.set_operator(policy()));
    fails(|| {
        let _ = v.upgrade(Base64VecU8(vec![0, 97, 115, 109]));
    });
    let mut r = v.report.clone().unwrap();
    r.sequence = U64(2);
    fails(|| v.report_nav(r));
}

#[test]
fn nav_reports_cannot_replenish_raw_delegated_capital_allowance() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 0, 2_001);
    assert_eq!(v.deployed, 10_000_000);
    context("owner.near", 1, 2_002);
    let mut p = policy();
    p.max_deployed_raw = U128(10_000_000);
    v.set_operator(p);
    context("operator.near", 0, 2_003);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    assert_eq!(v.liquid, 90_000_000);
}
#[test]
fn lifetime_usage_survives_a_day_roll_and_new_policy() {
    let mut v = funded();
    context("owner.near", 1, 1_200);
    let mut p = policy();
    p.max_daily_raw = U128(10_000_000);
    p.max_cumulative_raw = U128(10_000_000);
    v.set_operator(p.clone());
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 10_000_000, 86_402_000);
    context("owner.near", 1, 86_402_001);
    v.set_operator(p);
    context("operator.near", 0, 86_402_002);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    assert_eq!(v.usage_cumulative, 10_000_000);
    assert_eq!(v.liquid, 90_000_000);
}

#[test]
fn risk_reducing_exit_can_include_yield_without_replenishing_supply_authority() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 11_000_000, 2_001);
    context("owner.near", 1, 2_002);
    v.set_status(Status::Shutdown);
    context("curator.near", 0, 2_003);
    let _ = v.curator_withdraw(U128(11_000_000));
    assert_eq!(v.deployed, 10_000_000);
    assert_eq!(v.liquid, 90_000_000);
    assert_eq!(v.busy.as_ref().unwrap().amount_raw.0, 11_000_000);
}

#[test]
fn curator_report_and_permissionless_settlement_cannot_mint_curator_fees() {
    let mut v = funded();
    let initial = v.token.total_supply;
    let mut r = v.report.clone().unwrap();
    r.sequence = U64(2);
    r.observed_at_ms = U64(1_002);
    r.positions = vec![Position {
        id: "rhea".into(),
        protocol: RHEA.into(),
        chain: "near".into(),
        assets_raw: U128(100_000_000),
        liabilities_raw: U128(0),
    }];
    context("curator.near", 1, 1_002);
    v.report_nav(r.clone());
    assert_eq!(v.token.total_supply, initial);
    assert_eq!(v.token.ft_balance_of(account("curator.near")).0, 0);
    let id = deposit(&mut v, "owner.near", 1_000_000);
    // Above the high-water mark after a curator-only report, a new deposit waits for an owner report.
    fails(|| settle_deposit(&mut v, id));
    let redemption = redemption(&mut v, E18, 0);
    context("keeper.near", 0, 1_201);
    assert_eq!(v.process_redemptions(1), 1);
    assert_eq!(
        v.get_request(redemption).unwrap().status,
        RequestStatus::Claimable
    );
    assert_eq!(v.token.ft_balance_of(account("curator.near")).0, 0);
    r.sequence = U64(3);
    r.observed_at_ms = U64(1_202);
    context("owner.near", 1, 1_202);
    v.report_nav(r);
    assert!(v.token.ft_balance_of(account("curator.near")).0 > 0);
}

#[test]
fn deposits_settle_above_hwm_only_after_owner_crystallization() {
    let mut v = funded();
    report(&mut v, 2, 20_000_000);
    let id = deposit(&mut v, "owner.near", 1_000_000);
    settle_deposit(&mut v, id);
    assert!(v.report_by_owner);
    assert_eq!(
        v.get_request(U64(id)).unwrap().status,
        RequestStatus::Settled
    );
}

fn owner_report_at(v: &mut Vault, seq: u64, external: u128, at: u64) {
    context("owner.near", 1, at);
    v.report_nav(NavReport {
        sequence: U64(seq),
        observed_at_ms: U64(at),
        positions: vec![Position {
            id: "rhea".into(),
            protocol: RHEA.into(),
            chain: "near".into(),
            assets_raw: U128(external),
            liabilities_raw: U128(0),
        }],
        evidence_hash: format!("owner-proof-{seq}"),
    });
}
fn unknown_supply(v: &mut Vault) -> U64 {
    authorize(v);
    let op = supply(v, 10_000_000);
    callback_context(PromiseResult::Successful(b"not-a-quantity".to_vec()));
    assert!(!v.on_supply(op));
    op
}
fn sync_to(v: &mut Vault, balance: u128, at: u64) {
    context("curator.near", 1, at);
    let _ = v.sync_liquid();
    let sync = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Successful(
        serde_json::to_vec(&U128(balance)).unwrap(),
    ));
    assert!(v.on_sync_liquid(sync));
}
#[test]
fn unknown_supply_blocks_deposits_and_deployment_but_not_exits_after_sync_and_owner_report() {
    let mut v = funded();
    let op = unknown_supply(&mut v);
    credit(&mut v, "owner.near");
    context(USDC, 0, 2_001);
    let r = v.ft_on_transfer(
        account("owner.near"),
        U128(5_000_000),
        "{\"action\":\"deposit\",\"min_shares\":\"1\"}".into(),
    );
    assert!(matches!(r, PromiseOrValue::Value(U128(5_000_000))));
    let id = redemption(&mut v, 10 * E18, 0);
    context("keeper.near", 0, 2_001);
    fails(|| {
        v.process_redemptions(1);
    });
    sync_to(&mut v, 90_000_000, 2_001);
    assert!(v.get_nav().exit_nav_raw.is_none());
    owner_report_at(&mut v, 2, 10_000_000, 2_002);
    let nav = v.get_nav();
    assert!(nav.nav_raw.is_none());
    assert_eq!(nav.exit_nav_raw.unwrap().0, 100_000_000);
    assert!(
        nav.reasons
            .contains(&"EXTERNAL_OPERATION_UNRESOLVED".to_string())
    );
    context(USDC, 0, 2_003);
    let r = v.ft_on_transfer(
        account("owner.near"),
        U128(5_000_000),
        "{\"action\":\"deposit\",\"min_shares\":\"1\"}".into(),
    );
    assert!(matches!(r, PromiseOrValue::Value(U128(5_000_000))));
    context("operator.near", 0, 2_003);
    fails(|| {
        let _ = v.curator_supply(U128(1));
    });
    context("keeper.near", 0, 2_003);
    assert_eq!(v.process_redemptions(1), 1);
    assert_eq!(v.get_request(id).unwrap().claimable_raw.0, 10_000_000);
    assert_eq!(v.liquid, 80_000_000);
    assert_eq!(v.unresolved.as_ref().unwrap().operation.id, op);
    assert_eq!(v.usage_cumulative, 10_000_000);
}
#[test]
fn curator_report_or_pre_sync_report_cannot_open_exit_nav_or_resolution() {
    let mut v = funded();
    let op = unknown_supply(&mut v);
    context("owner.near", 1, 2_001);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "rhea-state".into()));
    sync_to(&mut v, 90_000_000, 2_001);
    report_at(&mut v, 2, 10_000_000, 2_002);
    assert!(v.get_nav().exit_nav_raw.is_none());
    context("owner.near", 1, 2_003);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "rhea-state".into()));
    let _ = redemption(&mut v, 10 * E18, 0);
    context("keeper.near", 0, 2_003);
    fails(|| {
        v.process_redemptions(1);
    });
}
#[test]
fn resolve_operation_requires_owner_yocto_evidence_and_matching_id() {
    let mut v = funded();
    let op = unknown_supply(&mut v);
    sync_to(&mut v, 90_000_000, 2_001);
    owner_report_at(&mut v, 2, 10_000_000, 2_002);
    context("curator.near", 1, 2_003);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "x".into()));
    context("owner.near", 0, 2_003);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "x".into()));
    context("owner.near", 1, 2_003);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "".into()));
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "x".repeat(129)));
    fails(|| v.resolve_operation(U64(op.0 + 1), OperationOutcome::Applied, "x".into()));
    v.resolve_operation(op, OperationOutcome::Applied, "rhea-account-state".into());
    assert!(v.unresolved.is_none());
    assert_eq!(v.deployed, 10_000_000);
    assert!(v.get_nav().nav_raw.is_none());
    owner_report_at(&mut v, 3, 10_000_000, 2_004);
    assert_eq!(v.get_nav().nav_raw.unwrap().0, 100_000_000);
    fails(|| v.resolve_operation(op, OperationOutcome::Applied, "again".into()));
}
#[test]
fn reverted_supply_reduces_deployed_but_never_resets_budgets() {
    let mut v = funded();
    let op = unknown_supply(&mut v);
    sync_to(&mut v, 100_000_000, 2_001);
    assert_eq!(v.liquid, 100_000_000);
    owner_report_at(&mut v, 2, 0, 2_002);
    assert_eq!(v.get_nav().exit_nav_raw.unwrap().0, 100_000_000);
    context("owner.near", 1, 2_003);
    v.resolve_operation(op, OperationOutcome::Reverted, "refund-receipt".into());
    assert_eq!(v.deployed, 0);
    assert_eq!(v.usage_cumulative, 10_000_000);
    assert!(
        get_logs()
            .iter()
            .any(|l| l.contains("operation_resolved") && l.contains("\"budgets_reset\":false"))
    );
}
#[test]
fn unknown_withdraw_becomes_unresolved_and_releases_lock() {
    let mut v = funded();
    authorize(&mut v);
    let op = supply(&mut v, 10_000_000);
    resolve_supply(&mut v, op, 10_000_000);
    report_at(&mut v, 2, 10_000_000, 2_001);
    context("operator.near", 0, 2_003);
    let _ = v.curator_withdraw(U128(4_000_000));
    let w = v.busy.as_ref().unwrap().id;
    callback_context(PromiseResult::Failed);
    assert!(!v.on_withdraw(w));
    assert!(v.busy.is_none());
    assert_eq!(v.unresolved.as_ref().unwrap().operation.kind, "withdraw");
    context("operator.near", 0, 2_004);
    fails(|| {
        let _ = v.curator_withdraw(U128(1));
    });
}
