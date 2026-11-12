// Read-only payment source inventory, independent of staking discovery and UI portfolio totals.
import { view, USDC, RHEA } from "./near.ts";
import { availableLiquidity } from "./withdraw.ts";
import { decimal } from "./money.ts";
export async function paymentInventory(accountId: string) {
  const wallet = await view<string>(USDC, "ft_balance_of", {
    account_id: accountId,
  });
  let rhea: string | null = null;
  let reason: string | null = null;
  try {
    const [assets, account, config, protocolCash] = await Promise.all([
      view<any[]>(RHEA, "get_assets_paged_detailed", {
        from_index: 0,
        limit: 100,
      }),
      view<any>(RHEA, "get_account_all_positions", { account_id: accountId }),
      view<any>(RHEA, "get_config"),
      view<string>(USDC, "ft_balance_of", { account_id: RHEA }),
    ]);
    const a = assets.data.find((x) => x.token_id === USDC);
    if (
      !a ||
      !Number.isInteger(a.config?.extra_decimals) ||
      a.config.extra_decimals < 0 ||
      a.config.extra_decimals > 24
    )
      throw new Error("Rhea USDC precision is unverified.");
    if (
      config.data.contract_mode !== "Running" ||
      a.config.can_withdraw !== true
    )
      throw new Error("Rhea withdrawals are disabled or not Running.");
    if (account.data?.is_locked !== false && account.data)
      throw new Error("Rhea account lock state is unverified or locked.");
    if (account.data) {
      if (!account.data.positions || !Array.isArray(account.data.supplied))
        throw new Error("Rhea account health is unverified.");
      const positions = Object.values(account.data.positions) as any[];
      if (
        positions.some(
          (x) =>
            !Array.isArray(x.collateral) ||
            !Array.isArray(x.borrowed) ||
            x.collateral.length ||
            x.borrowed.length,
        )
      )
        throw new Error(
          "Account collateral/debt requires Rhea management before a payment withdrawal.",
        );
      const row = account.data.supplied.find((x: any) => x.token_id === USDC);
      const scale = 10n ** BigInt(a.config.extra_decimals);
      const supplied = BigInt(row?.balance ?? "0") / scale;
      const available = availableLiquidity(a) / scale;
      const cash = BigInt(protocolCash.data);
      rhea = decimal(
        [supplied, available, cash].reduce((n, x) => (n < x ? n : x)),
      );
    } else rhea = "0";
  } catch (e) {
    reason = e instanceof Error ? e.message : "Rhea supply is unverified.";
  }
  return { wallet: decimal(BigInt(wallet.data)), rhea, reason };
}
