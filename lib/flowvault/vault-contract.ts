// Vault contract adapter (owner: Stream A). Pure: turns the v1 vault contract's views (docs/handoff/vault-interface.md)
// into FlowVault's vault model, reconciles the two, reads a deployed wasm's exports, and states who controls the vault.
// The contract is the truth: where the model and the views differ the difference is reported, never smoothed over.
import { CONTRACT_V1, holderView, nav, ppsE18, vaultAlerts, type HolderView, type VaultAlert, type VaultBook, type VaultTerms } from "./vault.ts";

export interface ConfigView {
  owner_id: string;
  curator_id: string;
  platform_id: string;
  asset_id: string;
  asset_decimals: number;
  share_name: string;
  share_symbol: string;
  performance_fee_bps: number;
  curator_fee_share_bps: number;
  capacity_raw: string;
  per_depositor_cap_raw: string;
  max_position_bps: number;
  max_protocol_bps: number;
  max_chain_bps: number;
  liquidity_target_bps: number;
  redemption_notice_ms: string;
  max_nav_age_ms: string;
  single_depositor: string | null;
  rhea_id: string;
  rhea_extra_decimals: number;
  disclosed_upgrade_keys: string[];
  share_decimals: number;
  virtual_assets_raw: string;
  virtual_shares_raw: string;
  management_fee_bps: number;
  queue_storage_yocto: string;
  upgrade_authority?: string;
  nav_authority?: string;
  /** v1.5: the contract's cap on max_nav_age_ms, and how settlement timing works (permissionless inside the window). */
  max_nav_age_limit_ms?: string;
  settlement_timing?: string;
}
export interface ReportView {
  sequence: string;
  observed_at_ms: string;
  positions: { id: string; protocol: string; chain: string; assets_raw: string; liabilities_raw: string }[];
  evidence_hash: string;
}
export interface NavView {
  nav_raw: string | null;
  gross_assets_raw: string | null;
  external_liabilities_raw: string;
  liquid_assets_raw: string;
  pending_deposits_raw: string;
  claimable_raw: string;
  total_shares: string;
  queued_shares: string;
  pps_e18: string | null;
  hwm_e18: string;
  report: ReportView | null;
  /** v1.3: the current report was filed by the owner (only those crystallize fees). Absent on older code = false. */
  report_by_owner?: boolean;
  report_required: boolean;
  status: "running" | "paused" | "shutdown";
  busy: { kind?: string; amount_raw?: string; operation_id?: string } | null;
  /** v1.4: an external supply/withdrawal whose outcome is unknown. Deposits stop; exits continue at exit_nav_raw. */
  unresolved?: { operation: { kind?: string; amount_raw?: string; operation_id?: string } & Record<string, unknown>; since_ms: string } | null;
  /** v1.4: exit-only NAV (synced liquid + owner report after the sync); null unless available. */
  exit_nav_raw?: string | null;
  reasons: string[];
}
export interface RequestView {
  id: string;
  owner_id: string;
  kind: "deposit" | "redemption";
  amount_raw: string;
  min_output_raw: string;
  created_at_ms: string;
  not_before_ms: string;
  status: "queued" | "settled" | "claimable" | "claiming" | "completed" | "cancelled";
  claimable_raw: string;
  shares_minted_raw: string;
  shares_burned_raw: string;
}
export interface AccountView {
  account_id: string;
  shares: string;
  queued_shares_raw: string;
  pending_deposits_raw: string;
  claimable_raw: string;
  request_storage_credit_yocto: string;
}
export interface OperatorView {
  policy: { account_id: string; valid_until_ms: string; max_per_action_raw: string; max_daily_raw: string; max_cumulative_raw: string; max_deployed_raw: string; min_idle_raw: string; paused: boolean } | null;
  version: string;
  usage_day: string;
  daily_used_raw: string;
  cumulative_used_raw: string;
  deployed_raw: string;
  deployed_basis: string;
  liquid_sync_required: boolean;
}

const B = (s: string | null | undefined) => BigInt(s ?? "0");
/** Contract-supplied text, ending with a full stop so the next sentence reads correctly. */
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : t.trim() + ".");

/** The deployed configuration as reviewed terms (notice ms → s; the curator's fee split is the rest to the platform). */
export function termsFromConfig(c: ConfigView, id: string): VaultTerms {
  return {
    id, specId: "", specVersion: 0, asset: "USDC", assetDecimals: 6, shareDecimals: c.share_decimals,
    virtualShares: B(c.virtual_shares_raw), virtualAssets: B(c.virtual_assets_raw),
    mode: c.single_depositor ? "single_depositor" : "pooled",
    fees: { managementBps: c.management_fee_bps, performanceBps: c.performance_fee_bps, curatorShareBps: c.curator_fee_share_bps, platformShareBps: 10_000 - c.curator_fee_share_bps },
    capacityRaw: B(c.capacity_raw), perDepositorCapRaw: B(c.per_depositor_cap_raw), maxPositionBps: c.max_position_bps,
    redemption: { noticeSeconds: Number(B(c.redemption_notice_ms) / 1000n), liquidityTargetBps: c.liquidity_target_bps },
    admin: {
      owner: c.owner_id, curator: c.curator_id, pauseGuardian: c.owner_id,
      upgradeAuthority: c.upgrade_authority ?? "owner + contract full-access keys",
      feeRecipients: { curator: c.curator_id, platform: c.platform_id },
    },
  };
}

/**
 * The model book from the contract's views. Holders are only the accounts whose views were read (the caller's own,
 * the curator and the platform); totals come from the contract. Escrowed redemption shares stay with their owner
 * (as the contract counts them for caps); pending deposits and claims stay outside NAV.
 */
export function bookFromViews(n: NavView, requests: RequestView[], accounts: AccountView[]): VaultBook {
  const holders: Record<string, bigint> = {};
  for (const a of accounts) holders[a.account_id] = B(a.shares) + B(a.queued_shares_raw);
  const queued = (k: RequestView["kind"]) => requests.filter((r) => r.kind === k && r.status === "queued").sort((a, b) => (B(a.id) < B(b.id) ? -1 : 1));
  const claimable: Record<string, bigint> = {};
  for (const r of requests) if (r.status === "claimable" || r.status === "claiming") claimable[r.owner_id] = (claimable[r.owner_id] ?? 0n) + B(r.claimable_raw);
  const toReq = (r: RequestView) => ({ id: r.id, account: r.owner_id, amountRaw: B(r.amount_raw), requestedAt: Number(r.created_at_ms), notBefore: Number(r.not_before_ms), minOutputRaw: B(r.min_output_raw) });
  const positions = (n.report?.positions ?? []).map((p) => ({ positionId: p.id, usdcRaw: B(p.assets_raw), basis: `${p.protocol} on ${p.chain}, attested in NAV report #${n.report!.sequence}` }));
  return {
    totalShares: B(n.total_shares), holders, idleRaw: B(n.liquid_assets_raw), positions,
    liabilitiesRaw: (n.report?.positions ?? []).reduce((s, p) => s + B(p.liabilities_raw), 0n),
    pendingDeposits: queued("deposit").map(toReq), pendingRedemptions: queued("redemption").map(toReq), claimable,
    hwmE18: B(n.hwm_e18), lastFeeAt: Number(n.report?.observed_at_ms ?? 0), paused: n.status === "paused", shutdown: n.status === "shutdown",
    reportByOwner: n.report_by_owner ?? false,
    navUnavailable: n.nav_raw === null ? (n.reasons.length ? n.reasons : ["NAV_UNAVAILABLE"]) : undefined,
  };
}

/** Where the model and the contract disagree. Any entry means the model is wrong; the contract's numbers are shown. */
export function reconcile(t: VaultTerms, book: VaultBook, n: NavView, accounts: AccountView[]): string[] {
  const d: string[] = [];
  const m = nav(book);
  const navMine = m.navRaw?.toString() ?? null;
  if (navMine !== n.nav_raw) d.push(`NAV: contract ${n.nav_raw ?? "unavailable"}, model ${navMine ?? "unavailable"}`);
  const pps = m.navRaw === null ? null : ppsE18(t, m.navRaw, book.totalShares).toString();
  if (n.pps_e18 !== null && pps !== n.pps_e18) d.push(`Price per share: contract ${n.pps_e18}, model ${pps ?? "unavailable"}`);
  if (B(n.pending_deposits_raw) !== book.pendingDeposits.reduce((s, r) => s + r.amountRaw, 0n)) d.push("Pending deposits differ from the retained request records (older records may have been pruned).");
  if (B(n.queued_shares) !== book.pendingRedemptions.reduce((s, r) => s + r.amountRaw, 0n)) d.push("Queued redemption shares differ from the retained request records.");
  if (t.virtualShares !== CONTRACT_V1.virtualShares || t.virtualAssets !== CONTRACT_V1.virtualAssets) d.push("The contract uses a different share offset than FlowVault's v1 model.");
  if (t.fees.managementBps !== 0) d.push("The contract reports a management fee; FlowVault's v1 model has none.");
  for (const a of accounts) if (!/^\d+$/.test(a.shares)) d.push(`Share balance for ${a.account_id} isn't a number.`);
  return d;
}

/** Function names a wasm module exports (export section, kind 0 = function). Throws on a malformed module. */
export function wasmExports(bytes: Uint8Array): string[] {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error("Not a wasm module.");
  let i = 8;
  const leb = () => {
    let r = 0, shift = 0, b: number;
    do {
      if (i >= bytes.length) throw new Error("Truncated wasm module.");
      b = bytes[i++];
      r += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return r;
  };
  const out: string[] = [];
  while (i < bytes.length) {
    const id = bytes[i++];
    const size = leb();
    const end = i + size;
    if (end > bytes.length) throw new Error("Truncated wasm section.");
    if (id === 7) {
      const count = leb();
      for (let k = 0; k < count; k++) {
        const len = leb();
        const name = new TextDecoder().decode(bytes.subarray(i, i + len));
        i += len;
        const kind = bytes[i++];
        leb();
        if (kind === 0) out.push(name);
      }
    }
    i = end;
  }
  return out;
}

export interface Disclosure {
  label: string;
  value: string;
  risk: "info" | "warn" | "urgent";
}
/**
 * Who can do what to the money, stated from the deployed config and live reads: owner, curator, fee recipients,
 * code upgrade keys (disclosed vs actual), the trusted NAV attestation, fee minting, queue and exit limits.
 */
export function disclosures(c: ConfigView, n: NavView, actualFullAccessKeys: string[] | null, now: number): Disclosure[] {
  const d: Disclosure[] = [];
  const ageMs = n.report ? now - Number(n.report.observed_at_ms) : null;
  d.push({ label: "Owner", value: `${c.owner_id}: sets status (pause, irreversible shutdown), limits and the operator, reports NAV, can upgrade the code.`, risk: "info" });
  d.push({ label: "Curator", value: `${c.curator_id}: reports NAV and moves vault USDC into and out of Rhea within the limits. Receives ${c.curator_fee_share_bps / 100}% of fee shares.`, risk: "info" });
  d.push({ label: "Platform", value: `${c.platform_id} receives ${(10_000 - c.curator_fee_share_bps) / 100}% of fee shares.`, risk: "info" });
  d.push({
    label: "NAV is attested, not proven",
    value: `${sentence(c.nav_authority ?? "The owner or curator reports the value of positions outside the vault.")} Reports expire after ${Number(B(c.max_nav_age_ms) / 1000n)} s. ${n.report ? `Last report #${n.report.sequence}${n.report_by_owner === undefined ? "" : n.report_by_owner ? " by the owner" : " by the curator"}${ageMs !== null ? `, ${Math.max(0, Math.round(ageMs / 1000))} s ago` : ""}, evidence ${n.report.evidence_hash}.` : "No report yet: deposits aren't priced."} An inflated or wrong report misprices every deposit and redemption.`,
    risk: "warn",
  });
  d.push({
    label: "Performance fee",
    value: c.performance_fee_bps
      ? `${c.performance_fee_bps / 100}% of gains above the high-water mark, minted as new shares only when the owner reports NAV (a curator report never mints fees), so the fee is only as honest as the owner's report. While the current report is a curator's and the price is above the mark, new deposits wait for an owner report. Someone who redeems between owner reports above the mark leaves without paying the not-yet-minted fee (a loss to the curator and platform, not to other holders).`
      : "None.",
    risk: c.performance_fee_bps ? "warn" : "info",
  });
  const disclosed = c.disclosed_upgrade_keys ?? [];
  if (actualFullAccessKeys === null) d.push({ label: "Code upgrade keys", value: `Disclosed: ${disclosed.length ? disclosed.join(", ") : "none"}. FlowVault couldn't read the account's actual keys, so this is unverified.`, risk: "warn" });
  else {
    const hidden = actualFullAccessKeys.filter((k) => !disclosed.includes(k));
    d.push({
      label: "Code upgrade keys",
      value: hidden.length
        ? `Undisclosed full-access keys can replace the contract code: ${hidden.join(", ")}.`
        : actualFullAccessKeys.length
          ? `${actualFullAccessKeys.length} full-access key${actualFullAccessKeys.length === 1 ? "" : "s"}, all disclosed: whoever holds them can replace the code and therefore move the money.`
          : "No full-access keys on the contract account; the owner's upgrade method remains.",
      risk: hidden.length ? "urgent" : actualFullAccessKeys.length ? "warn" : "info",
    });
  }
  d.push({ label: "Upgrade method", value: `${c.upgrade_authority ?? "The owner can upgrade the code."} There is no claim of immutable custody, and no security audit has been done.`, risk: "warn" });
  if (n.busy) d.push({ label: "Operation in flight", value: "An external operation is waiting for its callback; vault calls wait until it returns.", risk: "warn" });
  if (n.unresolved)
    d.push({
      label: "Operation unresolved",
      value: `The outcome of an external ${n.unresolved.operation?.kind ? n.unresolved.operation.kind + " " : ""}operation has been unknown since ${new Date(Number(n.unresolved.since_ms)).toISOString()}. New deposits are refunded, deposits don't settle into shares, the curator can't move USDC and no fee crystallizes. Exits continue: due redemptions settle at an exit-only NAV, paid only from USDC the vault holds, once the owner has synced the vault's USDC and then filed an owner report younger than ${Number(B(c.max_nav_age_ms) / 1000n)} s (a curator report never opens exit pricing)${n.exit_nav_raw ? "; that price is available now" : "; that price isn't available yet"}. Claims work as usual. The owner closes it with resolve_operation and evidence; spending budgets are never reset.`,
      risk: "urgent",
    });
  if (c.settlement_timing) d.push({ label: "Settlement timing", value: `${sentence(c.settlement_timing)} Reports expire after ${Number(B(c.max_nav_age_ms) / 1000n)} s (the contract allows at most ${Number(B(c.max_nav_age_limit_ms ?? "900000") / 1000n)} s).`, risk: "info" });
  if (c.single_depositor) d.push({ label: "Custody mode", value: `Single depositor (${c.single_depositor}): only the owner deposits, shares can't be transferred, no fees.`, risk: "info" });
  return d;
}

export interface QueueSpot {
  requestId: string;
  sharesRaw: string;
  notBefore: number;
  ahead: number;
  sharesAheadRaw: string;
  minAssetsRaw: string;
}
/** Each of the account's queued redemptions with how many requests (and shares) are ahead of it, by FIFO id. */
export function queueSpots(requests: RequestView[], account: string): QueueSpot[] {
  const q = requests.filter((r) => r.kind === "redemption" && r.status === "queued").sort((a, b) => (B(a.id) < B(b.id) ? -1 : 1));
  let ahead = 0n;
  const out: QueueSpot[] = [];
  q.forEach((r, i) => {
    if (r.owner_id === account) out.push({ requestId: r.id, sharesRaw: r.amount_raw, notBefore: Number(r.not_before_ms), ahead: i, sharesAheadRaw: ahead.toString(), minAssetsRaw: r.min_output_raw });
    ahead += B(r.amount_raw);
  });
  return out;
}

export interface VaultSnapshot {
  contractId: string;
  source: "live" | "example";
  config: ConfigView;
  nav: NavView;
  /** The deployed configuration as terms, bigints as decimal strings (JSON-safe). */
  terms: Record<string, unknown>;
  holders: (HolderView & { queue: QueueSpot[]; accountView: AccountView | null })[];
  roles: { account: string; role: "owner" | "curator" }[];
  requests: RequestView[];
  operator: OperatorView | null;
  disclosures: Disclosure[];
  differences: string[];
  alerts: VaultAlert[];
  readAt: number;
}

/** Everything the vault card shows, from one consistent set of views. */
export function snapshotFrom(i: {
  contractId: string;
  source: "live" | "example";
  config: ConfigView;
  nav: NavView;
  requests: RequestView[];
  accounts: AccountView[];
  mine: string[];
  operator: OperatorView | null;
  fullAccessKeys: string[] | null;
  now: number;
}): VaultSnapshot {
  const terms = termsFromConfig(i.config, i.contractId);
  const book = bookFromViews(i.nav, i.requests, i.accounts);
  return {
    contractId: i.contractId,
    source: i.source,
    config: i.config,
    nav: i.nav,
    terms: JSON.parse(JSON.stringify(terms, (_, x) => (typeof x === "bigint" ? x.toString() : x))),
    holders: i.mine.map((a) => ({ ...holderView(terms, book, a, i.now), queue: queueSpots(i.requests, a), accountView: i.accounts.find((x) => x.account_id === a) ?? null })),
    roles: i.mine.flatMap((a) => [...(a === i.config.owner_id ? [{ account: a, role: "owner" as const }] : []), ...(a === i.config.curator_id ? [{ account: a, role: "curator" as const }] : [])]),
    requests: i.requests,
    operator: i.operator,
    disclosures: disclosures(i.config, i.nav, i.fullAccessKeys, i.now),
    differences: reconcile(terms, book, i.nav, i.accounts),
    alerts: vaultAlerts(terms, book, i.now),
    readAt: i.now,
  };
}
