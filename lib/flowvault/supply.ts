import { positive, units, decimal } from "./money.ts";
export const SUPPLY_USDC =
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const SUPPLY_RHEA = "contract.main.burrow.near";
export interface SupplyState {
  accountId: string;
  mode: string;
  canDeposit: boolean;
  decimals: number;
  walletUsdc: string;
  nativeAmount: string;
  storageUsage: number;
  registered: boolean;
  registrationMinimum: string;
  reserve: string;
}
/** Builds owner-inspectable payloads, never signs or sends them. */
export function prepareSupply(state: SupplyState, amountText: string) {
  const amount = positive(amountText);
  if (state.mode !== "Running")
    throw new Error("The lending protocol is not currently Running.");
  if (state.decimals !== 6)
    throw new Error("USDC precision does not match this adapter.");
  if (!state.canDeposit) throw new Error("USDC deposits are not enabled.");
  const wallet = BigInt(state.walletUsdc);
  if (wallet < amount)
    throw new Error("Wallet USDC is below the requested supply amount.");
  if (wallet - amount < units(state.reserve))
    throw new Error(
      "This supply would breach your wallet USDC reserve floor (cash reserve plus planned cash need).",
    );
  const registration = state.registered
    ? 0n
    : BigInt(state.registrationMinimum);
  if (registration < 0n) throw new Error("Invalid registration requirement.");
  const usable =
    BigInt(state.nativeAmount) - BigInt(state.storageUsage) * 10n ** 19n;
  if (usable < registration + 250000000000000000000000n)
    throw new Error(
      "Insufficient spendable NEAR for registration and a conservative gas reserve.",
    );
  const transactions = [];
  if (registration > 0n)
    transactions.push({
      receiverId: SUPPLY_RHEA,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "storage_deposit",
            args: { account_id: state.accountId, registration_only: false },
            gas: "30000000000000",
            deposit: registration.toString(),
          },
        },
      ],
    });
  transactions.push({
    receiverId: SUPPLY_USDC,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "ft_transfer_call",
          args: {
            receiver_id: SUPPLY_RHEA,
            amount: amount.toString(),
            msg: "",
          },
          gas: "250000000000000",
          deposit: "1",
        },
      },
    ],
  });
  return {
    accountId: state.accountId,
    asset: "USDC",
    amount: decimal(amount),
    collateral: false,
    transactions,
    registrationNear: decimal(registration, 24),
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    warning:
      "Prepared transactions only. Nothing has been submitted. Review the amount, registration and gas, then approve in your connected wallet.",
  };
}
