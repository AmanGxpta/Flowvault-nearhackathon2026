import { prepareWithdraw } from "./withdraw.ts";
import { withdrawStateFromEvidence } from "./withdraw-evidence.ts";
import { RHEA, USDC, view, rpc, networkRpc } from "./near.ts";
import { prepareSupply } from "./supply.ts";
export async function freshSupply(
  accountId: string,
  reserve: string,
  amount: string,
) {
  const [native, balance, storage, bounds, assets, metadata, config] =
    await Promise.all([
      rpc({ request_type: "view_account", account_id: accountId }),
      view<string>(USDC, "ft_balance_of", { account_id: accountId }),
      view<unknown>(RHEA, "storage_balance_of", { account_id: accountId }),
      view<{ min: string }>(RHEA, "storage_balance_bounds"),
      view<{ token_id: string; config: { can_deposit: boolean } }[]>(
        RHEA,
        "get_assets_paged_detailed",
        { from_index: 0, limit: 100 },
      ),
      view<{ decimals: number }>(USDC, "ft_metadata"),
      view<{ contract_mode: string }>(RHEA, "get_config"),
    ]);
  const preparation = prepareSupply(
    {
      accountId,
      mode: config.data.contract_mode,
      canDeposit:
        assets.data.find(
          (x: { token_id: string; config: { can_deposit: boolean } }) =>
            x.token_id === USDC,
        )?.config.can_deposit ?? false,
      decimals: metadata.data.decimals,
      walletUsdc: balance.data,
      nativeAmount: native.amount,
      storageUsage: native.storage_usage,
      registered: !!storage.data,
      registrationMinimum: bounds.data.min,
      reserve: reserve,
    },
    amount,
  );
  return {
    ...preparation,
    exitEstimate: {
      exitDays: null,
      liquidity: null,
      exitCost: null,
      canWithdraw:
        (
          assets.data.find((x) => x.token_id === USDC)?.config as
            | { can_withdraw?: boolean }
            | undefined
        )?.can_withdraw ?? null,
      guaranteed: false,
      note: "Rhea withdrawal requires live available liquidity, token registration, gas and no encumbered positions. Timing and all-in exit cost are unverified; inspect the withdrawal preflight before moving funds.",
    },
  };
}

// Read every position, not just the regular position exposed by get_account.
export async function freshWithdraw(accountId: string, amount: string) {
  const native = await rpc({
    request_type: "view_account",
    account_id: accountId,
  });
  // Every withdrawal view uses this finalized block, so account and liquidity evidence is coherent.
  async function atBlock(
    account_id: string,
    method_name: string,
    args: Record<string, unknown> = {},
  ) {
    const r = await networkRpc("query", {
      block_id: native.block_height,
      request_type: "call_function",
      account_id,
      method_name,
      args_base64: btoa(JSON.stringify(args)),
    });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
  }
  const [account, assets, metadata, config, storage, tokenCash] =
    await Promise.all([
      atBlock(RHEA, "get_account_all_positions", { account_id: accountId }),
      atBlock(RHEA, "get_assets_paged_detailed", { from_index: 0, limit: 100 }),
      atBlock(USDC, "ft_metadata"),
      atBlock(RHEA, "get_config"),
      atBlock(USDC, "storage_balance_of", { account_id: accountId }),
      atBlock(USDC, "ft_balance_of", { account_id: RHEA }),
    ]);
  return prepareWithdraw(
    withdrawStateFromEvidence({
      accountId,
      native,
      account,
      assets,
      metadata,
      config,
      storage,
      tokenCash,
    }),
    amount,
  );
}
