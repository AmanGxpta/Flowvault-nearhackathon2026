// Published NearAnyStake modules (Apache-2.0), already pinned/attributed in THIRD_PARTY.md.
// Quote/read methods only: no SDK stake/requestWithdrawal/claimWithdrawals send method is called.
import type { StepKind, Position } from "./contracts.ts";
import { stakingReadProvider } from "./staking-rpc.ts";
import { positive, decimal } from "./money.ts";
import { validAccount } from "./near.ts";
export type StakingStepKind = Extract<
  StepKind,
  "stake" | "unstake" | "withdraw_unstaked"
>;
export const LINEAR_CONTRACT = "linear-protocol.near";
export const RNEAR_CONTRACT = "lst.rhealab.near";
export type LiquidVenue = "linear" | "rnear";
export const liquidContract = (venue:LiquidVenue) => venue === "rnear" ? RNEAR_CONTRACT : LINEAR_CONTRACT;
export const liquidSymbol = (venue:LiquidVenue) => venue === "rnear" ? "rNEAR" : "LiNEAR";
const raw = (value: unknown, name: string): bigint => {
  if (typeof value !== "bigint" || value < 0n)
    throw new Error("Staking " + name + " is unverified.");
  return value;
};
export function normalizeLifecycleQuote(
  kind: StakingStepKind,
  q: any,
  requestedRaw: string,
  venue: LiquidVenue = "linear",
) {
  if (!/^[1-9]\d*$/.test(requestedRaw))
    throw new Error("Use a positive decimal base-unit staking amount.");
  const requested = positive(decimal(BigInt(requestedRaw), 24), 24),
    near = raw(q.amount, "amount"),
    fee = raw(q.fee, "fee"),
    upfront = raw(q.upfront, "upfront");
  if (near <= 0n) throw new Error("Staking amount or fee bounds changed.");
  const storageFee = raw(q.storageFee ?? 0n, "storageFee");
  if(kind === "stake" && storageFee >= near) throw new Error("Staking registration fee exceeds the deposit.");
  if (kind === "stake") {
    if (
      near !== requested ||
      raw(q.maxStakeable, "maxStakeable") < requested ||
      raw(q.reserve, "reserve") < 500000000000000000000000n ||
      raw(q.shares, "shares") === 0n ||
      raw(q.price, "price") === 0n
    )
      throw new Error("Staking amount, shares or exit reserve changed.");
  } else if (kind === "unstake") {
    if (
      raw(q.shares, "shares") !== requested ||
      raw(q.withdrawsFirst, "withdrawsFirst") !== 0n ||
      raw(q.relocks, "relocks") !== 0n ||
      q.resetsTimer !== false
    )
      throw new Error(
        "Withdraw existing exit first; timer reset and relock are not approved.",
      );
  } else if (near !== requested)
    throw new Error("Claim amount changed. Review the full unlocked balance.");
  if (
    q.transactions?.length !== 1 ||
    q.transactions[0].receiverId !== liquidContract(venue) ||
    q.transactions[0].actions?.length !== 1
  )
    throw new Error("Staking receiver or compound actions changed.");
  const a = q.transactions[0].actions[0].functionCall;
  const expected =
    kind === "stake"
      ? "deposit_and_stake"
      : kind === "withdraw_unstaked"
        ? "withdraw_all"
        : a?.methodName === "unstake_all"
          ? "unstake_all"
          : "unstake";
  const args = expected === "unstake" ? { amount: near.toString() } : {};
  if (
    !a ||
    a.methodName !== expected ||
    JSON.stringify(a.args) !== JSON.stringify(args) ||
    BigInt(a.deposit) !== (kind === "stake" ? near : 0n) ||
    BigInt(a.gas) <= 0n ||
    BigInt(a.gas) > 300000000000000n
  )
    throw new Error("Staking method, amount, deposit or gas changed.");
  return {
    kind,
    protocol: venue,
    receiverId: liquidContract(venue),
    amountRaw: requested.toString(),
    nearAmountRaw: near.toString(),
    sharesRaw:
      kind === "withdraw_unstaked" ? null : raw(q.shares, "shares").toString(),
    networkFeeNearRaw: fee.toString(),
    upfrontNearRaw: upfront.toString(),
    storageFeeNearRaw: storageFee.toString(),
    exitReserveNearRaw:
      kind === "stake" ? q.reserve.toString() : "500000000000000000000000",
    transactions: [
      {
        receiverId: liquidContract(venue),
        actions: [
          {
            type: "FunctionCall" as const,
            params: {
              methodName: a.methodName,
              args: a.args,
              gas: a.gas.toString(),
              deposit: a.deposit.toString(),
            },
          },
        ],
      },
    ],
    unlock:
      kind === "unstake"
        ? JSON.parse(
            JSON.stringify(q.unlock, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
          )
        : null,
    readOnly: true,
    signable: false,
    preparesWalletAttempt: false,
    instant: {
      supported: false,
      venue: "Ref LiNEAR/wNEAR StableSwap",
      fee: null,
      reason:
        "A separate executable swap quote, liquidity, slippage and fee checks are required; delayed unstake is not instant.",
    },
  };
}
async function linearReader(accountId: string, venue: LiquidVenue = "linear") {
  if (!validAccount(accountId))
    throw new Error("Enter a valid live NEAR staking account.");
  const { LiquidStakingProtocolNear } = await import(
    "@anywalletkit/protocol-staking-liquid-near"
  );
  const account = {
    chain: "near:mainnet",
    getAddress: async () => accountId,
  } as any;
  return new LiquidStakingProtocolNear(account, {
    pool: venue,
    provider: stakingReadProvider(),
    reserve: 500000000000000000000000n,
    timeoutMs: 7000,
  });
}
export async function linearLifecycleQuote(
  accountId: string,
  kind: StakingStepKind,
  amountRaw: string,
  venue: LiquidVenue = "linear",
) {
  const n = positive(decimal(BigInt(amountRaw), 24), 24),
    m = await linearReader(accountId, venue);
  const q =
    kind === "stake"
      ? await m.quoteStake({ amount: n })
      : kind === "unstake"
        ? await m.quoteRequestWithdrawal({
            amount: n,
            allowRelock: false,
            allowTimerReset: false,
          })
        : await m.quoteClaimWithdrawals();
  return {
    accountId,
    capturedAt: new Date().toISOString(),
    ...normalizeLifecycleQuote(kind, q, n.toString(), venue),
  };
}
export function linearExitObservation(
  accountId: string,
  details: any,
  info: any,
  epoch: any,
  capturedAt = new Date().toISOString(),
  venue: LiquidVenue = "linear",
) {
  const shares = raw(details.shares, "shares"),
    price = raw(info.price, "price"),
    unstaked = raw(details.unstaked, "unstaked"),
    unlock = raw(details.unlockEpoch, "unlockEpoch"),
    height = raw(epoch.height, "epoch");
  if (
    !info.codeHashKnown ||
    info.contract !== liquidContract(venue) ||
    price === 0n ||
    typeof details.canWithdraw !== "boolean"
  )
    throw new Error("LiNEAR position evidence is unverified.");
  const payable =
    details.canWithdraw &&
    !info.paused &&
    height >= unlock &&
    raw(info.liquidity, "liquidity") >= unstaked + raw(info.kept, "kept");
  const positions: Position[] = [
    {
      id: venue + "-shares",
      label: liquidSymbol(venue),
      asset: liquidSymbol(venue),
      amount: decimal(shares, 24),
      rawAmount: shares.toString(),
      decimals: 24,
      kind: "staking",
      chain: "near",
      venue: liquidContract(venue),
      accountId,
      source: "live",
      capturedAt,
      availableAt: null,
      valuation: null,
    },
  ];
  if (unstaked > 0n)
    positions.push({
      id: venue + "-unstaking",
      label: payable
        ? `${liquidSymbol(venue)} exit: withdrawable NEAR`
        : `${liquidSymbol(venue)} exit: pending NEAR`,
      asset: "NEAR",
      amount: decimal(unstaked, 24),
      rawAmount: unstaked.toString(),
      decimals: 24,
      kind: "staking",
      chain: "near",
      venue: liquidContract(venue),
      accountId,
      source: "live",
      capturedAt,
      availableAt: payable ? capturedAt : null,
      valuation: null,
    });
  return {
    source: "live",
    readOnly: true,
    signable: false,
    capturedAt,
    positions,
    exchangeRateRaw: price.toString(),
    registered: details.registered === true,
    underlying: {
      asset: "NEAR",
      quantityRaw: ((shares * price) / 10n ** 24n).toString(),
      decimals: 24,
    },
    pendingExit:
      unstaked > 0n
        ? {
            amountRaw: unstaked.toString(),
            unlockEpoch: unlock.toString(),
            epochsRemaining: (unlock > height
              ? unlock - height
              : 0n
            ).toString(),
            availableAt: payable ? capturedAt : null,
            claimable: payable,
            availabilityIsEstimate: false,
            reason: payable
              ? null
              : height < unlock
                ? "EPOCH_WAIT"
                : "LIQUIDITY_OR_PAUSE",
          }
        : null,
  };
}
export async function observeLinearLifecycle(accountId: string, venue: LiquidVenue = "linear") {
  const m = await linearReader(accountId, venue);
  const [details, info, epoch] = await Promise.all([
    m.getAccountDetails(),
    m.getPoolInfo(),
    m.getEpoch(),
  ]);
  return linearExitObservation(accountId, details, info, epoch, undefined, venue);
}
