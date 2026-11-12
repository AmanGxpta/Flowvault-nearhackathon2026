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
    Vault::new(config())
}
fn report(v: &mut Vault, seq: u64, external: u128) {
    context("curator.near", 1, 1_000 + seq);
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
        v.ft_on_transfer(account("owner.near"), U128(1), "{}".into());
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
