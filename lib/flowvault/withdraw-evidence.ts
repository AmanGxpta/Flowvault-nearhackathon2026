import { z } from "zod";
import { availableLiquidity, rawBalance } from "./withdraw.ts";
import type { WithdrawState } from "./withdraw.ts";
import { SUPPLY_USDC as USDC } from "./supply.ts";
const raw = z.string().regex(/^(0|[1-9]\d*)$/);
const balance = z.object({ token_id: z.string(), balance: raw });
const accountSchema = z.object({
  account_id: z.string(),
  supplied: z.array(balance),
  positions: z.record(
    z.object({ collateral: z.array(balance), borrowed: z.array(balance) }),
  ),
  is_locked: z.boolean(),
});
const assetSchema = z.object({
  token_id: z.literal(USDC),
  supplied: z.object({ balance: raw }),
  borrowed: z.object({ balance: raw }),
  reserved: raw,
  prot_fee: raw,
  margin_debt: z.object({ balance: raw }),
  margin_pending_debt: raw,
  config: z.object({
    can_withdraw: z.boolean(),
    extra_decimals: z.number().int().min(0).max(32),
  }),
});
const storageSchema = z
  .object({ total: raw, available: raw })
  .refine(
    (s) => BigInt(s.total) > 0n && BigInt(s.available) <= BigInt(s.total),
  );
export interface WithdrawEvidence {
  accountId: string;
  native: unknown;
  account: unknown;
  assets: unknown;
  metadata: unknown;
  config: unknown;
  storage: unknown;
  tokenCash: unknown;
}
export function withdrawStateFromEvidence(e: WithdrawEvidence): WithdrawState {
  const native = z
    .object({
      amount: raw,
      storage_usage: z.number().int().nonnegative().safe(),
    })
    .safeParse(e.native);
  if (!native.success)
    throw new Error("Native NEAR account evidence is unavailable or invalid.");
  const list = z.array(z.unknown()).safeParse(e.assets);
  if (!list.success)
    throw new Error("The native USDC withdrawal market was not returned.");
  const candidate = list.data.find(
    (a) => (a as { token_id?: unknown })?.token_id === USDC,
  );
  const asset = assetSchema.safeParse(candidate);
  if (!asset.success)
    throw new Error(
      "USDC withdrawal config or protocol liquidity is unavailable or invalid.",
    );
  const acc = accountSchema.nullable().safeParse(e.account);
  if (!acc.success)
    throw new Error(
      "All-position account health is unverified. Manage this position on Rhea.",
    );
  if (acc.data && acc.data.account_id !== e.accountId)
    throw new Error("Rhea returned a different account.");
  const metadata = z.object({ decimals: z.number() }).safeParse(e.metadata);
  if (!metadata.success)
    throw new Error("USDC precision does not match this adapter.");
  const config = z.object({ contract_mode: z.string() }).safeParse(e.config);
  if (!config.success)
    throw new Error("The lending protocol mode is unavailable.");
  const scale = 10n ** BigInt(asset.data.config.extra_decimals);
  const computed = availableLiquidity(asset.data);
  const cash = rawBalance(e.tokenCash, "Protocol USDC token cash") * scale;
  return {
    accountId: e.accountId,
    mode: config.data.contract_mode,
    canWithdraw: asset.data.config.can_withdraw,
    decimals: metadata.data.decimals,
    extraDecimals: asset.data.config.extra_decimals,
    suppliedUsdc:
      acc.data?.supplied.find((b) => b.token_id === USDC)?.balance ?? "0",
    availableLiquidity: (computed < cash ? computed : cash).toString(),
    collateral: Object.values(acc.data?.positions ?? {}).flatMap(
      (p) => p.collateral,
    ),
    borrowed: Object.values(acc.data?.positions ?? {}).flatMap(
      (p) => p.borrowed,
    ),
    isLocked: acc.data?.is_locked,
    usdcRegistered: storageSchema.safeParse(e.storage).success,
    nativeAmount: native.data.amount,
    storageUsage: native.data.storage_usage,
  };
}
