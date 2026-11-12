import { positive, decimal } from "./money.ts";
import { SUPPLY_RHEA as RHEA, SUPPLY_USDC as USDC } from "./supply.ts";
export const WITHDRAW_RHEA = RHEA;
export const WITHDRAW_USDC = USDC;
const U128_MAX = (1n << 128n) - 1n;
export interface WithdrawState {
  accountId: string;
  mode: string;
  canWithdraw: boolean;
  decimals: number;
  extraDecimals: number | null;
  /** All lending amounts here use inner units (6 + extraDecimals). */
  suppliedUsdc: string;
  availableLiquidity: string;
  collateral: { token_id: string; balance: string }[];
  borrowed: { token_id: string; balance: string }[];
  usdcRegistered: boolean;
  nativeAmount: string;
  storageUsage: number;
  isLocked?: boolean;
}
export function rawBalance(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error(`${label} is unavailable or invalid.`);
  const n = BigInt(value);
  if (n > U128_MAX) throw new Error(`${label} exceeds protocol precision.`);
  return n;
}
/** Protocol formula at the pinned ref-finance/burrowland revision. No missing field defaults to zero. */
export function availableLiquidity(asset: {
  supplied: { balance: string };
  borrowed: { balance: string };
  reserved: string;
  prot_fee: string;
  margin_debt: { balance: string };
  margin_pending_debt: string;
}): bigint {
  const available =
    rawBalance(asset?.supplied?.balance, "Protocol supplied balance") +
    rawBalance(asset?.reserved, "Protocol reserves") +
    rawBalance(asset?.prot_fee, "Protocol fees") -
    rawBalance(asset?.borrowed?.balance, "Protocol borrowed balance") -
    rawBalance(asset?.margin_debt?.balance, "Protocol margin debt") -
    rawBalance(asset?.margin_pending_debt, "Protocol pending margin debt");
  if (available < 0n || available > U128_MAX)
    throw new Error("Protocol available liquidity is invalid.");
  return available;
}
/** Builds one unsigned, non-collateral withdrawal. Never signs, submits or auto-registers. */
export function prepareWithdraw(state: WithdrawState, amountText: string) {
  const amount = positive(amountText);
  if (!/^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(state.accountId))
    throw new Error("Enter a valid NEAR withdrawal account.");
  if (state.mode !== "Running")
    throw new Error("The lending protocol is not currently Running.");
  if (state.canWithdraw !== true)
    throw new Error("USDC withdrawals are not enabled.");
  if (state.decimals !== 6)
    throw new Error("USDC precision does not match this adapter.");
  if (
    !Number.isInteger(state.extraDecimals) ||
    state.extraDecimals === null ||
    state.extraDecimals < 0 ||
    state.extraDecimals > 32
  )
    throw new Error("USDC extra_decimals is unavailable or invalid.");
  const inner = amount * 10n ** BigInt(state.extraDecimals);
  if (inner > U128_MAX)
    throw new Error("Withdrawal exceeds protocol precision.");
  if (!Array.isArray(state.collateral) || !Array.isArray(state.borrowed))
    throw new Error(
      "Account health is unverified. Manage this position on Rhea.",
    );
  if (state.collateral.length || state.borrowed.length)
    throw new Error(
      "This account has collateral or debt; health is unverified. Manage this position on Rhea.",
    );
  if (state.isLocked)
    throw new Error(
      "The Rhea account is locked. Manage this position on Rhea.",
    );
  if (rawBalance(state.suppliedUsdc, "Supplied USDC balance") < inner)
    throw new Error("Supplied USDC is below the requested withdrawal amount.");
  if (
    rawBalance(state.availableLiquidity, "Protocol available liquidity") < inner
  )
    throw new Error("Withdrawal exceeds protocol available liquidity.");
  if (state.usdcRegistered !== true)
    throw new Error(
      "Your account has no USDC storage registration. Register on Rhea before withdrawing.",
    );
  if (!Number.isSafeInteger(state.storageUsage) || state.storageUsage < 0)
    throw new Error("Account storage usage is unavailable or invalid.");
  const usable =
    rawBalance(state.nativeAmount, "Native NEAR balance") -
    BigInt(state.storageUsage) * 10n ** 19n;
  if (usable < 250000000000000000000000n + 1n)
    throw new Error(
      "Insufficient spendable NEAR for withdrawal gas and one yocto deposit.",
    );
  return {
    kind: "withdraw" as const,
    accountId: state.accountId,
    asset: "USDC",
    amount: decimal(amount),
    amountNative: amount.toString(),
    amountInner: inner.toString(),
    extraDecimals: state.extraDecimals,
    collateral: false,
    registrationNear: "0",
    transactions: [
      {
        receiverId: RHEA,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "execute",
              args: {
                actions: [
                  {
                    Withdraw: { token_id: USDC, max_amount: inner.toString() },
                  },
                ],
              },
              deposit: "1",
              gas: "250000000000000",
            },
          },
        ],
      },
    ],
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    warning:
      "Unsigned withdrawal only. Nothing submitted. Liquidity and account state may change before wallet approval; exact native-USDC payout must be verified from finalized receipts.",
  };
}
export type WithdrawPreparation = ReturnType<typeof prepareWithdraw>;
