// Example vault for the example workspace only (owner: Stream A). Fictional accounts; every number is produced by
// the same model that mirrors the contract (deposits, an owner NAV report that mints the fee, queued requests), then
// expressed as the contract's own view shapes so the card renders example and live vaults through one path.
// Never shown in a personal workspace.
import { applyReport, emptyBook, nav, ppsE18, requestDeposit, requestRedemption, settle, type VaultBook } from "./vault.ts";
import { snapshotFrom, termsFromConfig, type AccountView, type ConfigView, type NavView, type OperatorView, type RequestView, type VaultSnapshot } from "./vault-contract.ts";

export const EXAMPLE_VAULT = "rhea-usdc.vaults.example";
export const EXAMPLE_HOLDER = "you.example";
export const EXAMPLE_CURATOR = "curator.example";
const OWNER = "owner.example";
const PLATFORM = "platform.example";
const H = 3_600_000;
const U = (usdc: number) => BigInt(Math.round(usdc * 1e6));

export function exampleVault(now = Date.now()): VaultSnapshot {
  const config: ConfigView = {
    owner_id: OWNER, curator_id: EXAMPLE_CURATOR, platform_id: PLATFORM, asset_id: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", asset_decimals: 6,
    share_name: "Example Rhea USDC", share_symbol: "fvUSDC-ex", performance_fee_bps: 1500, curator_fee_share_bps: 7000,
    capacity_raw: U(250_000).toString(), per_depositor_cap_raw: U(50_000).toString(), max_position_bps: 8000, max_protocol_bps: 8000, max_chain_bps: 10000, liquidity_target_bps: 2000,
    redemption_notice_ms: String(24 * H), max_nav_age_ms: "180000", single_depositor: null, rhea_id: "contract.main.burrow.near", rhea_extra_decimals: 12,
    disclosed_upgrade_keys: ["ed25519:ExampleOwnerKeyNotReal1111111111111111111"], share_decimals: 18, virtual_assets_raw: "1", virtual_shares_raw: "1000000000000", management_fee_bps: 0,
    queue_storage_yocto: "20000000000000000000000",
    upgrade_authority: "owner + contract full-access keys (owner-disclosed; verify actual keys through NEAR RPC)",
    nav_authority: "Owner/curator trusted valuation attestation; not independent proof of external assets",
  };
  const t = termsFromConfig(config, EXAMPLE_VAULT);
  const requests: RequestView[] = [];
  const req = (r: Partial<RequestView> & Pick<RequestView, "owner_id" | "kind" | "amount_raw" | "status">, at: number, notBefore = at): RequestView => {
    const v: RequestView = { id: String(requests.length), min_output_raw: "0", created_at_ms: String(at), not_before_ms: String(notBefore), claimable_raw: "0", shares_minted_raw: "0", shares_burned_raw: "0", ...r };
    requests.push(v);
    return v;
  };
  let b: VaultBook = emptyBook(t, now - 30 * 24 * H);
  b = applyReport(t, b, { positions: [], liabilitiesRaw: 0n, by: "owner", at: now - 30 * 24 * H }).book;
  for (const [who, usdc, ago] of [["alice.example", 40_000, 29], [EXAMPLE_HOLDER, 12_000, 20], ["bob.example", 20_000, 12]] as const) {
    const at = now - ago * 24 * H;
    const s = settle(t, requestDeposit(t, b, { id: String(requests.length), account: who, amountRaw: U(usdc), requestedAt: at }), at);
    req({ owner_id: who, kind: "deposit", amount_raw: U(usdc).toString(), status: "settled", shares_minted_raw: s.events[0].sharesRaw }, at);
    b = s.book;
  }
  // The curator supplied 50,000 USDC to Rhea; the owner's latest report values it at 51,200 (fee crystallizes).
  b = { ...b, idleRaw: b.idleRaw - U(50_000) };
  const position = { id: "rhea-usdc", protocol: "contract.main.burrow.near", chain: "near", assets_raw: U(51_200).toString(), liabilities_raw: "0" };
  b = applyReport(t, b, { positions: [{ positionId: position.id, usdcRaw: U(51_200), basis: "" }], liabilitiesRaw: 0n, by: "owner", at: now - 60_000 }).book;
  // Bob's redemption is due (waiting for anyone to run process_redemptions); yours is ahead of nothing but behind his.
  const bobShares = b.holders["bob.example"] / 4n;
  b = requestRedemption(t, b, { id: String(requests.length), account: "bob.example", amountRaw: bobShares, requestedAt: now - 30 * H });
  req({ owner_id: "bob.example", kind: "redemption", amount_raw: bobShares.toString(), status: "queued" }, now - 30 * H, now - 6 * H);
  const yourShares = b.holders[EXAMPLE_HOLDER] / 4n;
  b = requestRedemption(t, b, { id: String(requests.length), account: EXAMPLE_HOLDER, amountRaw: yourShares, requestedAt: now - 6 * H });
  const yourMin = ((yourShares * (nav(b).navRaw! + 1n)) / (b.totalShares + 1_000_000_000_000n) * 99n) / 100n;
  req({ owner_id: EXAMPLE_HOLDER, kind: "redemption", amount_raw: yourShares.toString(), status: "queued", min_output_raw: yourMin.toString() }, now - 6 * H, now + 18 * H);
  req({ owner_id: "carol.example", kind: "deposit", amount_raw: U(3_000).toString(), status: "queued", min_output_raw: "1" }, now - 20 * 60_000);
  const n = nav(b).navRaw!;
  const queuedShares = bobShares + yourShares;
  const navView: NavView = {
    nav_raw: n.toString(), gross_assets_raw: n.toString(), external_liabilities_raw: "0", liquid_assets_raw: b.idleRaw.toString(), pending_deposits_raw: U(3_000).toString(), claimable_raw: "0",
    total_shares: b.totalShares.toString(), queued_shares: queuedShares.toString(), pps_e18: ppsE18(t, n, b.totalShares).toString(), hwm_e18: b.hwmE18.toString(),
    report: { sequence: "3", observed_at_ms: String(now - 60_000), positions: [position], evidence_hash: "example-evidence-not-real" },
    report_by_owner: true, report_required: false, status: "running", busy: null, reasons: [],
  };
  const queuedOf = (a: string) => (a === "bob.example" ? bobShares : a === EXAMPLE_HOLDER ? yourShares : 0n);
  const accounts: AccountView[] = [EXAMPLE_HOLDER, EXAMPLE_CURATOR, OWNER, PLATFORM].map((a) => ({
    account_id: a, shares: ((b.holders[a] ?? 0n) - queuedOf(a)).toString(), queued_shares_raw: queuedOf(a).toString(), pending_deposits_raw: "0", claimable_raw: "0",
    request_storage_credit_yocto: a === EXAMPLE_HOLDER ? "20000000000000000000000" : "0",
  }));
  const operator: OperatorView = {
    policy: { account_id: "agent.example", valid_until_ms: String(now + 7 * 24 * H), max_per_action_raw: U(10_000).toString(), max_daily_raw: U(25_000).toString(), max_cumulative_raw: U(100_000).toString(), max_deployed_raw: U(80_000).toString(), min_idle_raw: U(10_000).toString(), paused: false },
    version: "2", usage_day: String(Math.floor(now / 86_400_000)), daily_used_raw: "0", cumulative_used_raw: U(50_000).toString(), deployed_raw: U(50_000).toString(),
    deployed_basis: "gross_resolved_supply_raw_without_withdrawal_recredit", liquid_sync_required: false,
  };
  return snapshotFrom({ contractId: EXAMPLE_VAULT, source: "example", config, nav: navView, requests, accounts, mine: [EXAMPLE_HOLDER, EXAMPLE_CURATOR], operator, fullAccessKeys: config.disclosed_upgrade_keys, now });
}
