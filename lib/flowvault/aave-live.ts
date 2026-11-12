import { EVM_CHAINS, evmRpc, hexQuantity, validEvm } from "./evm.ts";
import { AAVE_MARKETS, type AaveChain } from "./aave-markets.ts";
import { address, calldata, words } from "./aave-abi.ts";
import type { VenueAsset } from "./contracts.ts";
export interface AaveReserve {
  asset: VenueAsset; id: number; config: bigint; aToken: string; debtToken: string;
  price: bigint; supplied: bigint; debt: bigint; wallet: bigint; liquidity: bigint;
  totalDebt: bigint; aprRay: bigint; collateralEnabled: boolean; allowance: bigint;
}
export interface AaveState {
  chain: AaveChain; accountId: string; capturedAt: string; blockNumber: string; blockHash: string;
  nativeBalance: bigint; gasPrice: bigint; l1FeeUpperWei: bigint; userConfig: bigint; accountData: bigint[];
  reserves: AaveReserve[]; eMode: number;
  mode: { ltv: number; threshold: number; bonus: number; collateral: bigint; borrowable: bigint; ltvZero: bigint; isolated: boolean } | null;
}
export async function readAaveState(chain: AaveChain, accountId: string): Promise<AaveState> {
  if (!validEvm(accountId)) throw new Error("Invalid EVM account.");
  const m = AAVE_MARKETS[chain];
  if (!m) throw new Error("Unsupported Aave market.");
  if (hexQuantity(await evmRpc(chain, "eth_chainId", [])) !== EVM_CHAINS[chain].chainId) throw new Error("Wrong chain.");
  const block = await evmRpc(chain, "eth_getBlockByNumber", ["finalized", false]);
  if (!block?.hash || !block.number || Math.abs(Date.now() - Number(hexQuantity(block.timestamp)) * 1000) > 1_200_000) throw new Error("Finalized Aave block unavailable/stale.");
  const tag = block.number;
  const call = async (to: string, sig: string, ...args: (string | bigint)[]) => words(await evmRpc(chain, "eth_call", [{ to, data: calldata(sig, ...args) }, tag]));
  const [pool, oracle, base, conf, em, accountData, balance, gas] = await Promise.all([
    call(m.provider, "getPool()"), call(m.provider, "getPriceOracle()"), call(m.oracle, "BASE_CURRENCY_UNIT()"),
    call(m.pool, "getUserConfiguration(address)", accountId), call(m.pool, "getUserEMode(address)", accountId),
    call(m.pool, "getUserAccountData(address)", accountId), evmRpc(chain, "eth_getBalance", [accountId, tag]), evmRpc(chain, "eth_gasPrice", []),
  ]);
  if (address(pool[0]) !== m.pool || address(oracle[0]) !== m.oracle || base[0] !== 100_000000n || accountData.length !== 6) throw new Error("Aave market identity or base currency changed.");
  if (em[0] > 255n) throw new Error("Unknown eMode.");
  const l1FeeUpperWei = chain === "base" ? (await call("0x420000000000000000000000000000000000000f", "getL1FeeUpperBound(uint256)", 1024n))[0] : 0n;
  const eMode = Number(em[0]);
  let mode: AaveState["mode"] = null;
  if (eMode) {
    const [risk, coll, borrow, zero, isolated] = await Promise.all([
      call(m.pool, "getEModeCategoryCollateralConfig(uint8)", em[0]), call(m.pool, "getEModeCategoryCollateralBitmap(uint8)", em[0]),
      call(m.pool, "getEModeCategoryBorrowableBitmap(uint8)", em[0]), call(m.pool, "getEModeCategoryLtvzeroBitmap(uint8)", em[0]), call(m.pool, "getIsEModeCategoryIsolated(uint8)", em[0]),
    ]);
    if (risk.length !== 3 || risk[0] > 10000n || risk[1] > 10000n || risk[2] < 10000n) throw new Error("Invalid eMode risk configuration.");
    mode = { ltv: Number(risk[0]), threshold: Number(risk[1]), bonus: Number(risk[2]), collateral: coll[0], borrowable: borrow[0], ltvZero: zero[0], isolated: isolated[0] === 1n };
  }
  // Resolve EVERY position the protocol counts, including assets outside the execution allowlist.
  const active: number[] = [];
  for (let i = 0; i < 128; i++) if ((conf[0] >> BigInt(i * 2) & 3n) !== 0n) active.push(i);
  if (active.length > 30) throw new Error("Aave account exceeds verified position read bound.");
  const held = await Promise.all(active.map(i => call(m.pool, "getReserveAddressById(uint16)", BigInt(i)).then(x => address(x[0]))));
  const ids = [...new Set([...m.collateral.map(x => x.id), m.debt.id, ...held])];
  const reserves = await Promise.all(ids.map(async id => {
    const data = await call(m.pool, "getReserveData(address)", id);
    if (data.length < 15) throw new Error("Unverified Aave reserve ABI.");
    const config = data[0], precision = Number(config >> 48n & 255n), reserveId = Number(data[7]);
    if (precision > 36 || reserveId > 127) throw new Error("Reserve precision/id unavailable.");
    const known = [...m.collateral, m.debt].find(x => x.id === id);
    if (known && precision !== known.decimals) throw new Error("Aave asset decimals changed.");
    const aToken = address(data[8]), debtToken = address(data[10]);
    const [price, supplied, debt, wallet, liquidity, totalDebt, decimals, allowance, virtual] = await Promise.all([
      call(m.oracle, "getAssetPrice(address)", id), call(aToken, "balanceOf(address)", accountId), call(debtToken, "balanceOf(address)", accountId),
      call(id, "balanceOf(address)", accountId), call(id, "balanceOf(address)", aToken), call(debtToken, "totalSupply()"), call(id, "decimals()"), call(id, "allowance(address,address)", accountId, m.pool), call(m.pool, "getVirtualUnderlyingBalance(address)", id),
    ]);
    if (decimals[0] !== BigInt(precision) || price[0] <= 0n) throw new Error("Unverified Aave token identity/price.");
    return { asset: known ?? { id, symbol: id, decimals: precision, chain }, id: reserveId, config, aToken, debtToken,
      price: price[0], supplied: supplied[0], debt: debt[0], wallet: wallet[0], liquidity: liquidity[0] < virtual[0] ? liquidity[0] : virtual[0], totalDebt: totalDebt[0], aprRay: data[4],
      collateralEnabled: (conf[0] >> BigInt(reserveId * 2 + 1) & 1n) === 1n, allowance: allowance[0] };
  }));
  const observedDebt = reserves.reduce((n,r) => n + r.debt*r.price/10n**BigInt(r.asset.decimals),0n);
  if (observedDebt > accountData[1]+BigInt(reserves.length*2) || accountData[1] > observedDebt+BigInt(reserves.length*2)) throw new Error("Aave liability coverage incomplete.");
  // A mixed-fork RPC snapshot cannot become risk evidence.
  const again = await evmRpc(chain, "eth_getBlockByNumber", [tag, false]);
  if (again?.hash !== block.hash) throw new Error("Aave snapshot block changed.");
  return { chain, accountId: accountId.toLowerCase(), capturedAt: new Date().toISOString(), blockNumber: tag, blockHash: block.hash,
    nativeBalance: hexQuantity(balance), gasPrice: hexQuantity(gas), l1FeeUpperWei, userConfig: conf[0], accountData, reserves, eMode, mode };
}
