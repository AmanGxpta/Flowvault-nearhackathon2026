use uint::construct_uint;
construct_uint! { pub struct U256(4); }
pub const E18: u128 = 1_000_000_000_000_000_000;
pub const VIRTUAL_SHARES: u128 = 1_000_000_000_000;
pub const VIRTUAL_ASSETS: u128 = 1;
pub fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).expect("AMOUNT_OVERFLOW")
}
pub fn mul_div(a: u128, b: u128, d: u128, up: bool) -> u128 {
    assert!(d > 0, "ZERO_DENOMINATOR");
    let n = U256::from(a) * U256::from(b);
    let den = U256::from(d);
    let q = if up {
        (n + den - U256::one()) / den
    } else {
        n / den
    };
    assert!(q <= U256::from(u128::MAX), "AMOUNT_OVERFLOW");
    q.as_u128()
}
pub fn shares_for(assets: u128, nav: u128, supply: u128) -> u128 {
    mul_div(
        assets,
        add(supply, VIRTUAL_SHARES),
        add(nav, VIRTUAL_ASSETS),
        false,
    )
}
pub fn assets_for(shares: u128, nav: u128, supply: u128) -> u128 {
    mul_div(
        shares,
        add(nav, VIRTUAL_ASSETS),
        add(supply, VIRTUAL_SHARES),
        false,
    )
}
pub fn pps(nav: u128, supply: u128, up: bool) -> u128 {
    mul_div(
        add(nav, VIRTUAL_ASSETS),
        E18,
        add(supply, VIRTUAL_SHARES),
        up,
    )
}
pub fn fee_shares(nav: u128, supply: u128, hwm: u128, bps: u16) -> (u128, u128) {
    if supply == 0 || bps == 0 {
        return (0, 0);
    }
    let price = pps(nav, supply, false);
    if price <= hwm {
        return (0, 0);
    }
    let profit = mul_div(price - hwm, supply, E18, false);
    let fee = mul_div(profit, bps as u128, 10_000, true);
    assert!(fee < nav, "FEE_EXCEEDS_NAV");
    (
        fee,
        mul_div(
            fee,
            add(supply, VIRTUAL_SHARES),
            add(nav - fee, VIRTUAL_ASSETS),
            true,
        ),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_width_and_rounding() {
        assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX, false), u128::MAX);
        assert_eq!(mul_div(10, 10, 3, false), 33);
        assert_eq!(mul_div(10, 10, 3, true), 34);
    }
    #[test]
    fn deposit_redeem_round_in_vault_favour() {
        let minted = shares_for(1_000_000, 0, 0);
        assert_eq!(minted, E18);
        assert_eq!(assets_for(minted, 1_000_000, minted), 1_000_000);
        for n in 1..100 {
            let s = shares_for(n, 1_000_003, E18);
            assert!(assets_for(s, 1_000_003, E18) <= n);
        }
    }
    #[test]
    fn hwm_loss_recovery() {
        let supply = 100 * E18;
        let high = pps(100_000_000, supply, true);
        assert_eq!(fee_shares(90_000_000, supply, high, 1500), (0, 0));
        assert_eq!(fee_shares(100_000_000, supply, high, 1500), (0, 0));
        let (fee, mint) = fee_shares(110_000_000, supply, high, 1500);
        assert!(fee > 1_499_900 && fee <= 1_500_000);
        assert!(mint > 0);
        assert!(pps(110_000_000, add(supply, mint), true) > high);
    }
}
