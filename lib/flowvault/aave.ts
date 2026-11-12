import type { LendingVenueAdapter, LendingVenueSnapshot, FundingChoice } from "./contracts.ts";
import type { Policy } from "./policy.ts";
import type { LendingPreparation, PrepareRequest } from "./lending.ts";
import type { AaveState, AaveReserve } from "./aave-live.ts";
import { readAaveState } from "./aave-live.ts";
import { AAVE_MARKETS, type AaveChain } from "./aave-markets.ts";
import { calldata, ceil } from "./aave-abi.ts";
import { EVM_CHAINS } from "./evm.ts";
import { stressCapacity } from "./credit.ts";
import { units, decimal, carry } from "./money.ts";

export interface AaveTx { chainId: string; from: string; to: string; value: "0x0"; data: string }
export interface AaveExecution {
  venueId: string; chain: AaveChain; eMode: number; blockHash: string; transactions: AaveTx[];
  workspaceRevision?: number; policyVersion?: number; gasBudgetWei: string;
}
export function isAave(p: unknown): p is LendingPreparation & { evm: AaveExecution } {
  return !!p && typeof p === "object" && "evm" in p && !!(p as { evm?: AaveExecution }).evm?.venueId?.startsWith("aave-v3:");
}
const bits = (c: bigint, offset: number, length: number) => Number(c >> BigInt(offset) & ((1n << BigInt(length)) - 1n));
const min = (...v: bigint[]) => v.reduce((a,b) => a < b ? a : b);
function risk(st: AaveState, r: AaveReserve) {
  let ltv = bits(r.config, 0, 16), threshold = bits(r.config, 16, 16), bonus = bits(r.config, 32, 16);
  const bit = 1n << BigInt(r.id), m = st.mode;
  if (m && (m.collateral & bit)) { ltv = m.ltv; threshold = m.threshold; bonus = m.bonus; }
  if (m && ((m.ltvZero & bit) || (m.isolated && !(m.collateral & bit)))) ltv = 0;
  return { ltv, threshold, bonus };
}
export function aaveRisk(st: AaveState, policy?: Policy, now = Date.now(), drawdown = true) {
  const m = AAVE_MARKETS[st.chain], debt = st.reserves.find(r => r.asset.id === m.debt.id)!;
  if (!debt) throw new Error("Native USDC reserve unavailable.");
  const value = (r: AaveReserve, raw: bigint, up = false) => {
    const num = raw * r.price * 1_000000n, den = 10n ** BigInt(r.asset.decimals) * debt.price;
    return up ? ceil(num, den) : num / den;
  };
  const debtRaw = st.reserves.reduce((sum, r) => sum + value(r, r.debt, true), 0n);
  const reasons: string[] = [];
  if (Math.abs(now - Date.parse(st.capturedAt)) > 180000 || !Number.isFinite(Date.parse(st.capturedAt))) reasons.push("STALE_AAVE_STATE");
  if (!policy) reasons.push("NO_CREDIT_POLICY");
  if (bits(debt.config,56,1) !== 1 || bits(debt.config,60,1) || bits(debt.config,57,1) || !bits(debt.config,58,1)) reasons.push("USDC_BORROW_DISABLED");
  if (st.mode && !(st.mode.borrowable & (1n << BigInt(debt.id)))) reasons.push("EMODE_USDC_NOT_BORROWABLE");
  // Old isolation/silo/debt-ceiling configuration must not silently inherit v3.7 semantics.
  if (st.reserves.some(r => (r.collateralEnabled || r.debt > 0n) && ((r.config >> 212n & ((1n << 40n)-1n)) || bits(r.config,62,1)))) reasons.push("LEGACY_ISOLATION_OR_SILO_UNSUPPORTED");
  let minHealth = 1_500000n, adj = 0n, stressedAdj = 0n;
  const assets = st.reserves.filter(r => r.collateralEnabled && r.supplied > 0n).map(r => {
    const row = policy?.creditRows?.find(x => x.assetId.toLowerCase() === r.asset.symbol.toLowerCase());
    const permission = policy?.assetRows?.find(x => x.asset.toLowerCase() === r.asset.symbol.toLowerCase() && x.chain === st.chain)
      ?? policy?.assetRows?.find(x => x.asset.toLowerCase() === r.asset.symbol.toLowerCase() && !x.chain);
    if (row && units(row.minHealth) > minHealth) minHealth = units(row.minHealth);
    const protectedAsset = policy?.protectedAssets.some(x => x.toLowerCase() === r.asset.symbol.toLowerCase());
    const known = m.collateral.some(x => x.id === r.asset.id);
    const allowed = !!row?.eligible && row.permissions.includes("pledge") && row.permissions.includes("borrow") && !protectedAsset && (!policy?.assetRows || (!!permission?.uses.includes("pledge") && permission.uses.includes("borrow")));
    const v = value(r, r.supplied), rr = risk(st,r), dd = row?.drawdownBps ?? 3000;
    adj += v * BigInt(rr.threshold) / 10000n;
    stressedAdj += v * BigInt(10000-dd) * BigInt(rr.threshold) / 10000n / 10000n;
    return { assetId: r.asset.symbol, collateralId: `${st.accountId}:${m.id}:${r.asset.id}`, value: decimal(v), drawdownBps: drawdown ? dd : 0,
      ltvCapBps: row?.ltvCapBps ?? 0, liquidationThresholdBps: rr.threshold, protocolLtvBps: rr.ltv,
      minHealth: decimal(minHealth), priority: row?.priority ?? "P3" as const, permissions: allowed ? ["pledge" as const,"borrow" as const] : [], eligible: allowed && known };
  });
  // Apply the strictest account policy to EVERY collateral row (not whichever happened to be read first).
  for (const a of assets) a.minHealth = decimal(minHealth);
  const capTokens = BigInt(bits(debt.config,80,36)) * 1_000000n;
  const remaining = capTokens === 0n ? debt.liquidity : capTokens > debt.totalDebt ? capTokens-debt.totalDebt : 0n;
  const c = stressCapacity([{ id: m.id, source: "live", capturedAt: st.capturedAt, existingDebt: decimal(debtRaw),
    protocolLimit: decimal(debtRaw+remaining), liquidity: decimal(debt.liquidity), assets }], now);
  let capacity = c.capacity === null || reasons.length ? null : min(units(c.capacity), units(policy!.perActionCap));
  // Oracle-price rounding and the pool's own available-borrow figure also bound the result.
  if (capacity !== null) capacity = min(capacity, st.accountData[2] * 1_000000n / debt.price);
  return { capacity, reasons: [...reasons,...(c.markets[0]?.reasons ?? [])], debtRaw, minHealth, debt, value,
    adj, stressedAdj, health: debtRaw === 0n ? "no debt" : decimal(adj * 1_000000n / debtRaw),
    stressedHealth: debtRaw === 0n ? "no debt" : decimal(stressedAdj * 1_000000n / debtRaw) };
}
export function inspectAave(st: AaveState, policy?: Policy, now = Date.now()): LendingVenueSnapshot {
  const m = AAVE_MARKETS[st.chain], r = aaveRisk(st,policy,now), current = aaveRisk(st,policy,now,false);
  return { venueId: m.id, accountId: st.accountId, source: "live", capturedAt: st.capturedAt, freshUntil: new Date(Date.parse(st.capturedAt)+180000).toISOString(),
    collateralAssets: m.collateral, debtAssets: [m.debt],
    positions: st.reserves.map(x => ({ asset: x.asset, suppliedRaw: x.supplied.toString(), collateralRaw: (x.collateralEnabled ? x.supplied : 0n).toString(), liabilityRaw: x.debt.toString(), walletRaw: x.wallet.toString(), valueUsdcRaw: r.value(x,x.supplied).toString() })),
    pricesAndRisk: st.reserves.map(x => { const rr = risk(st,x); return { assetId: x.asset.id, priceUsdcRaw: (x.price*1_000000n/r.debt.price).toString(), ltvBps: rr.ltv, liquidationThresholdBps: rr.threshold, liquidationBonusBps: rr.bonus-10000 }; }),
    liquidityUsdcRaw: r.debt.liquidity.toString(), currentCapacityUsdcRaw: current.capacity?.toString() ?? null, stressedCapacityUsdcRaw: r.capacity?.toString() ?? null,
    debtUsdcRaw: r.debtRaw.toString(), health: r.health, stressedHealth: r.stressedHealth, minHealth: decimal(r.minHealth), borrowApr: decimal(r.debt.aprRay,27),
    interest: { variable: true, accruedIncludedInLiability: true, basis: "Variable debt-token balance includes accrued interest; ray APR is an estimate, not a fixed repayment promise." },
    liquidation: { exposed: r.debtRaw > 0n, thresholdHealth: "1", reasons: r.reasons },
    exit: { instant: false, reasons: ["Fresh stressed-health and reserve-liquidity checks; owner signs every call. eMode " + st.eMode + ". Cross-chain funds are not cash on NEAR until independent delivery verification."] }, reasons: r.reasons };
}
export function prepareAave(st: AaveState, policy: Policy | undefined, req: PrepareRequest, now = Date.now()): LendingPreparation {
  const m = AAVE_MARKETS[st.chain], cap = aaveRisk(st,policy,now), snapshot = inspectAave(st,policy,now);
  if (cap.reasons.length || !policy) throw new Error(cap.reasons.join("; "));
  if (req.amountRaw <= 0n || req.amountRaw >= 1n << 256n) throw new Error("Invalid lending amount.");
  const r = st.reserves.find(x => x.asset.symbol === req.asset && (req.kind === "borrow" || req.kind === "repay" ? x.asset.id === m.debt.id : m.collateral.some(c => c.id === x.asset.id)));
  if (!r) throw new Error("Unsupported Aave collateral/debt asset.");
  if (bits(r.config,56,1) !== 1 || bits(r.config,60,1)) throw new Error("Reserve inactive/paused.");
  const txs: AaveTx[] = [];
  const push = (to: string, data: string) => txs.push({ chainId: "0x"+EVM_CHAINS[st.chain].chainId.toString(16), from: st.accountId, to, value: "0x0", data });
  const approval = () => { if (r.allowance < req.amountRaw) {
    if (r.allowance > 0n) throw new Error("Reset the existing token approval before a new exact approval.");
    push(r.asset.id,calldata("approve(address,uint256)",m.pool,req.amountRaw));
  } };
  const value = cap.value(r,req.amountRaw,true);
  let healthAfter = cap.health, stressAfter = cap.stressedHealth;
  if (req.kind === "borrow") {
    if (!req.approveNewDebt) throw new Error("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL");
    if (cap.capacity === null || req.amountRaw > cap.capacity) throw new Error("Borrow exceeds venue-local stressed capacity.");
    healthAfter = decimal(cap.adj*1_000000n/(cap.debtRaw+req.amountRaw));
    stressAfter = decimal(cap.stressedAdj*1_000000n/(cap.debtRaw+req.amountRaw));
    if (units(stressAfter) < cap.minHealth) throw new Error("Stressed health below minimum.");
    push(m.pool,calldata("borrow(address,uint256,uint256,uint16,address)",r.asset.id,req.amountRaw,2n,0n,st.accountId));
  } else if (req.kind === "repay") {
    if (r.debt <= 0n || req.amountRaw > r.debt || r.wallet < req.amountRaw) throw new Error("Repay must fit verified debt and wallet balance.");
    if (req.holdbackRaw === undefined || r.wallet-req.amountRaw < req.holdbackRaw) throw new Error("Repayment cannot protect reserved capital.");
    approval(); push(m.pool,calldata("repay(address,uint256,uint256,address)",r.asset.id,req.amountRaw,2n,st.accountId));
  } else if (req.kind === "collateral_add") {
    const row = policy.creditRows?.find(x => x.assetId.toLowerCase() === req.asset.toLowerCase());
    if (!row?.eligible || !row.permissions.includes("pledge") || !row.permissions.includes("borrow") || policy.protectedAssets.some(x => x.toLowerCase() === req.asset.toLowerCase())) throw new Error("Collateral policy denied.");
    if (r.wallet < req.amountRaw || bits(r.config,57,1) || !risk(st,r).ltv) throw new Error("Collateral unavailable/frozen/LTV zero.");
    const supplyCap = BigInt(bits(r.config,116,36));
    // Exact supply-cap enforcement is also checked by simulation at authorization.
    if (supplyCap && req.amountRaw > supplyCap*10n**BigInt(r.asset.decimals)) throw new Error("Supply cap exceeded.");
    if (r.supplied > 0n && !r.collateralEnabled) throw new Error("Enable the existing supplied asset as collateral in Aave first.");
    approval(); push(m.pool,calldata("supply(address,uint256,address,uint16)",r.asset.id,req.amountRaw,st.accountId,0n));
  } else {
    if (r.supplied < req.amountRaw || r.liquidity < req.amountRaw) throw new Error("Release exceeds supplied balance or liquid reserve.");
    const lost = r.collateralEnabled ? cap.value(r,req.amountRaw,true) * BigInt(risk(st,r).threshold) / 10000n : 0n;
    // Apply no haircut to what is removed: conservative against every policy drawdown.
    if (cap.debtRaw && (cap.stressedAdj < lost || (cap.stressedAdj-lost)*1_000000n/cap.debtRaw < cap.minHealth)) throw new Error("Release breaches stressed health.");
    push(m.pool,calldata("withdraw(address,uint256,address)",r.asset.id,req.amountRaw,st.accountId));
  }
  const gasBudget = (1_000_000n*st.gasPrice*2n + st.l1FeeUpperWei*2n)*BigInt(txs.length);
  if (st.gasPrice <= 0n || st.nativeBalance < gasBudget) throw new Error("Insufficient native ETH for conservative gas budget.");
  const eth = st.reserves.find(x => x.asset.symbol === "WETH");
  if (!eth) throw new Error("ETH fee valuation unavailable.");
  const fee = cap.value(eth,gasBudget,true);
  return { kind: req.kind, accountId: st.accountId, asset: r.asset.symbol, tokenId: r.asset.id, amount: decimal(req.amountRaw,r.asset.decimals), amountRaw: req.amountRaw.toString(), decimals: r.asset.decimals,
    usdcValueRaw: value.toString(), transactions: [], evm: { venueId: m.id, chain: st.chain, eMode: st.eMode, blockHash: st.blockHash, transactions: txs, gasBudgetWei: gasBudget.toString() },
    expiresAt: new Date(now+180000).toISOString(), healthBefore: cap.health, healthAfter, stressedHealthAfter: stressAfter,
    newDebt: req.kind === "borrow", approvedNewDebt: req.approveNewDebt === true,
    policyAction: { kind: req.kind === "collateral_add" ? "pledge" : req.kind === "collateral_release" ? "withdraw" : req.kind, asset: r.asset.symbol, amount: decimal(value), recipient: st.accountId, venue: m.pool,
      movingCost: decimal(fee), gasNear: "0", source: "live", accountId: st.accountId, chain: st.chain,
      methods: txs.map(t => ({ receiver: t.to, method: t.data.slice(0,10) })) },
    request: { asset: req.asset, amountRaw: req.amountRaw.toString(), approveNewDebt: req.approveNewDebt === true },
    debtBeforeUsdcRaw: cap.debtRaw.toString(), evidence: `${m.id} finalized ${st.blockNumber} ${st.blockHash}; eMode ${st.eMode}`, warning: "Owner-signed Aave operation. Variable interest and liquidation risk; funds stay on this chain until settlement is verified." };
}
export function aaveVenue(chain: AaveChain): LendingVenueAdapter<AaveState, PrepareRequest, LendingPreparation, Policy> {
  const m = AAVE_MARKETS[chain];
  return { id: m.id, chain, supportedCollateral: m.collateral, supportedDebt: [m.debt], read: account => readAaveState(chain,account), inspect: inspectAave, prepareOperation: prepareAave,
    fundingChoice(st,policy,amount,date,approved,now=Date.now()): FundingChoice {
      const cap = aaveRisk(st,policy,now), reasons = [...cap.reasons];
      if (!approved) reasons.push("NEW_DEBT_NEEDS_EXPLICIT_APPROVAL");
      if (cap.capacity === null || amount > cap.capacity) reasons.push("CAPACITY_SHORT");
      let interest: string | null = null;
      if (date) interest = carry(amount,decimal(cap.debt.aprRay,27),Math.max(1,Math.min(3650,Math.ceil((Date.parse(date+"T23:59:59Z")-now)/86400000)))).toString();
      // The funding mesh must append a priced, independently verified USDC settlement leg. Never
      // advertise EVM principal as directly spendable by a NEAR payment plan.
      reasons.push("CROSS_CHAIN_USDC_SETTLEMENT_REQUIRED");
      return { id: `${m.id}:${st.accountId}`, kind: "borrow", eligible: false, reasons, amountUsdcRaw: amount.toString(), costsUsdcRaw: null, foregoneUsdcRaw: "0", interestUsdcRaw: interest,
        healthAfter: cap.debtRaw+amount > 0n ? decimal(cap.stressedAdj*1_000000n/(cap.debtRaw+amount)) : "no debt", availableAt: null, steps: ["borrow","pay_quote","pay_deposit","verify_payout"], venueId: m.id, accountId: st.accountId, chain };
    },
    monitor(s) { if(s.reasons.length) return [{severity:"warn",reason:s.venueId+": risk unavailable"}];
      return s.stressedHealth && s.stressedHealth !== "no debt" && units(s.stressedHealth)<units(s.minHealth) ? [{severity:"urgent",reason:s.venueId+": stressed health below policy"}] : []; },
  };
}
