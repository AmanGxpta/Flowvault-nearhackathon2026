import { payoutAsset, matchPayoutToken } from "./evm.ts";
import { payoutValuation } from "./payout-valuation.ts";
import { readRpc } from "./rpc-transport.ts";
import { snapshot } from "./snapshot-cache.ts";
import { READ_BUDGET } from "./deadline.ts";
import { QuoteUpstreamError } from "./quote-errors.ts";
import type { QuoteErrorContext } from "./quote-errors.ts";
import { decimal, innerToNative } from "./money.ts";
import type {
  MarketSnapshot,
  Portfolio,
  Position,
  CashQuote,
  Chain,
} from "./types";
export const USDC =
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const RHEA = "contract.main.burrow.near";
export function validAccount(s: string) {
  return /^(?=.{2,64}$)[a-z\d]+(?:[._-][a-z\d]+)*$/.test(s);
}
export async function networkRpc(
  method: string,
  params: Record<string, unknown>,
) {
  return readRpc(method, params);
}

export async function rpc(params: Record<string, unknown>) {
  return networkRpc("query", { finality: "final", ...params });
}
export async function view<T>(
  accountId: string,
  methodName: string,
  args: Record<string, unknown> = {},
): Promise<{ data: T; blockHeight: number }> {
  const r = await rpc({
    request_type: "call_function",
    account_id: accountId,
    method_name: methodName,
    args_base64: btoa(JSON.stringify(args)),
  });
  return {
    data: JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T,
    blockHeight: r.block_height,
  };
}
type Asset = {
  token_id: string;
  supply_apr: string;
  borrow_apr: string;
  config: {
    extra_decimals: number;
    can_deposit: boolean;
    can_borrow: boolean;
    can_withdraw: boolean;
  };
};
type Balance = { token_id: string; balance: string };
type LendingAccount = {
  supplied: Balance[];
  collateral: Balance[];
  borrowed?: Balance[];
  positions?: Record<string, { collateral: Balance[]; borrowed: Balance[] }>;
} | null;
async function fetchLiveMarket(): Promise<MarketSnapshot> {
  const r = await view<Asset[]>(RHEA, "get_assets_paged_detailed", {
    from_index: 0,
    limit: 100,
  });
  const usd = r.data.find((a) => a.token_id === USDC);
  if (!usd) throw new Error("The native USDC market was not returned.");
  return {
    source: "live",
    capturedAt: new Date().toISOString(),
    blockHeight: r.blockHeight,
    warnings: ["APR is variable. Withdrawal depends on available liquidity."],
    markets: [
      {
        id: "rhea-usdc",
        name: "Rhea Lending",
        token: "USDC",
        asset: "USDC",
        family: "lending",
        apr: usd.supply_apr,
        borrowApr: usd.borrow_apr,
        exitDays: null,
        exitLabel: "Liquidity-dependent; timing unverified",
        available: usd.config.can_deposit,
        note: `Finalized NEAR view · block ${r.blockHeight}`,
      },
      {
        id: "usdc-vault",
        name: "USDC vaults",
        token: "USDC",
        asset: "USDC",
        family: "vault",
        apr: null,
        borrowApr: null,
        exitDays: null,
        exitLabel: "Strategy-specific redemption",
        available: false,
        note: "Receipt assets require verified rates, permissions and exit terms.",
      },
      {
        id: "linear",
        name: "LiNEAR",
        token: "LiNEAR",
        asset: "NEAR",
        family: "staking",
        apr: null,
        borrowApr: null,
        exitDays: null,
        exitLabel: "NEAR-denominated position",
        available: false,
        note: "Kept separate from the USDC mandate. Staking adapter is not enabled.",
      },
    ],
  };
}
function portfolioRaw(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error("Portfolio base-unit amount is unverified.");
  return BigInt(value);
}
export async function fetchPortfolio(accountId: string): Promise<Portfolio> {
  if (!validAccount(accountId))
    throw new Error("Enter a valid public NEAR account.");
  type Read = { positions: Position[]; reasons?: string[] };
  const jobs: {
    id: string;
    affects: NonNullable<Portfolio["sections"]>[number]["affects"];
    load: () => Promise<Read>;
  }[] = [
    {
      id: "near-native",
      affects: ["netWorth"],
      load: async () => {
        const native = await rpc({
          request_type: "view_account",
          account_id: accountId,
        });
        return {
          positions: [
            {
              id: "near-wallet",
              label: "NEAR wallet · before storage reserve",
              asset: "NEAR",
              amount: decimal(portfolioRaw(native.amount), 24),
              kind: "wallet",
            },
          ],
        };
      },
    },
    {
      id: "near-usdc",
      affects: ["netWorth", "cashNow", "withdrawableByDate"],
      load: async () => {
        const balance = await view<string>(USDC, "ft_balance_of", {
          account_id: accountId,
        });
        return {
          positions: [
            {
              id: "usdc-wallet",
              label: "Wallet USDC",
              asset: "USDC",
              amount: decimal(portfolioRaw(balance.data)),
              kind: "wallet",
            },
          ],
        };
      },
    },
    {
      id: "rhea",
      affects: [
        "netWorth",
        "withdrawableByDate",
        "committedCapital",
        "borrowingHeadroom",
      ],
      load: async () => {
        const [raw, assetRead] = await Promise.all([
          view<LendingAccount>(RHEA, "get_account_all_positions", {
            account_id: accountId,
          }),
          view<Asset[]>(RHEA, "get_assets_paged_detailed", {
            from_index: 0,
            limit: 100,
          }),
        ]);
        const account = raw.data;
        if (account && (!account.positions || !Array.isArray(account.supplied)))
          throw new Error("All Rhea positions could not be verified.");
        const positions: Position[] = [],
          reasons: string[] = [];
        const groups = account
          ? {
              supplied: account.supplied,
              collateral: Object.values(account.positions!).flatMap((x) => {
                if (!Array.isArray(x.collateral))
                  throw new Error("Rhea collateral coverage unverified.");
                return x.collateral;
              }),
              borrowed: Object.values(account.positions!).flatMap((x) => {
                if (!Array.isArray(x.borrowed))
                  throw new Error("Rhea debt coverage unverified.");
                return x.borrowed;
              }),
            }
          : { supplied: [], collateral: [], borrowed: [] };
        for (const [key, kind] of [
          ["supplied", "supplied"],
          ["collateral", "collateral"],
          ["borrowed", "debt"],
        ] as const)
          for (const [index, bal] of groups[key].entries()) {
            if (bal.token_id !== USDC) {
              if (portfolioRaw(bal.balance) > 0n)
                reasons.push(
                  "Non-USDC Rhea exposure exists; valuation and cross-asset health are unverified.",
                );
              continue;
            }
            const asset = assetRead.data.find((x) => x.token_id === USDC);
            if (!asset)
              throw new Error("USDC lending precision is unavailable.");
            positions.push({
              id: `rhea-${key}-${index}`,
              label: `Rhea ${kind === "debt" ? "borrowed" : kind} USDC`,
              asset: "USDC",
              amount: decimal(
                innerToNative(
                  portfolioRaw(bal.balance),
                  asset.config.extra_decimals,
                  kind === "debt",
                ),
              ),
              kind,
            });
          }
        return { positions, reasons };
      },
    },
    {
      id: "linear-balance",
      affects: ["netWorth", "committedCapital"],
      load: async () => {
        const balance = await view<string>(
          "linear-protocol.near",
          "ft_balance_of",
          { account_id: accountId },
        );
        return {
          positions: [
            {
              id: "linear-wallet",
              label: "LiNEAR token balance",
              asset: "LiNEAR",
              amount: decimal(portfolioRaw(balance.data), 24),
              kind: "staking",
            },
          ],
        };
      },
    },
  ];
  const results = await Promise.allSettled(jobs.map((j) => j.load()));
  const capturedAt = new Date().toISOString();
  return {
    accountId,
    source: "live",
    capturedAt,
    errors: [],
    positions: results.flatMap((r) =>
      r.status === "fulfilled" ? r.value.positions : [],
    ),
    sections: results.map((r, i) => ({
      id: jobs[i].id,
      status:
        r.status === "rejected"
          ? "unavailable"
          : r.value.reasons?.length
            ? "partial"
            : "observed",
      capturedAt,
      reasons:
        r.status === "rejected" ? [String(r.reason)] : (r.value.reasons ?? []),
      positionIds:
        r.status === "fulfilled" ? r.value.positions.map((p) => p.id) : [],
      affects: jobs[i].affects,
    })),
  };
}
async function fetchOneClick(
  url: string,
  options: RequestInit,
  context: QuoteErrorContext,
) {
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(READ_BUDGET.http),
    });
  } catch (e) {
    throw new QuoteUpstreamError(
      e instanceof Error ? e.message : String(e),
      null,
      context,
    );
  }
}
export async function dryCashQuote(
  accountId: string,
  recipient: string,
  destination: Chain,
  amountRaw: string,
  token: "USDC" | "USDT" = "USDC",
): Promise<CashQuote> {
  if (!validAccount(accountId))
    throw new Error("Use your public NEAR source account.");
  if (!recipient.trim())
    throw new Error("Enter your destination address to get a dry quote.");
  if (
    destination === "near"
      ? !validAccount(recipient)
      : !/^0x[0-9a-fA-F]{40}$/.test(recipient)
  )
    throw new Error(
      "The recipient format does not match the destination chain.",
    );
  if (/^0x0{39}[01]$/i.test(recipient))
    throw new Error(
      "Use your own recipient address, not a zero or research placeholder.",
    );
  await rpc({ request_type: "view_account", account_id: accountId });
  const tokensResponse = await fetchOneClick(
    "https://1click.chaindefuser.com/v0/tokens",
    { signal: AbortSignal.timeout(10000) },
    { destination, stage: "assets" },
  );
  const rawTokens = await tokensResponse.text();
  const assetsContext = { destination, stage: "assets" as const };
  if (!tokensResponse.ok)
    throw new QuoteUpstreamError(
      rawTokens,
      tokensResponse.status,
      assetsContext,
    );
  let tokens: {
    assetId: string;
    symbol: string;
    blockchain: string;
    decimals: number;
  }[];
  try {
    tokens = JSON.parse(rawTokens);
    if (!Array.isArray(tokens))
      throw new Error("Unsupported asset response shape");
  } catch {
    throw new QuoteUpstreamError(
      rawTokens,
      tokensResponse.status,
      assetsContext,
    );
  }
  const origin = tokens.find((t) => t?.assetId === "nep141:" + USDC);
  const route = payoutAsset(destination, token);
  const dest = matchPayoutToken(tokens, destination, token);
  if (!origin || origin.decimals !== 6)
    throw new Error("Source USDC route is unavailable.");
  const amountText = decimal(BigInt(amountRaw), route.decimals);
  const valuation =
    token === "USDT" ? payoutValuation(origin, dest, amountText) : undefined;
  const request = {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 50,
    originAsset: origin.assetId,
    destinationAsset: dest.assetId,
    amount: amountRaw,
    depositType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: accountId,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 180000).toISOString(),
  };
  const response = await fetchOneClick(
    "https://1click.chaindefuser.com/v0/quote",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15000),
    },
    { destination, stage: "quote" },
  );
  const rawResponse = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    throw new QuoteUpstreamError(rawResponse, response.status, {
      destination,
      stage: "quote",
    });
  }
  const body = parsed as {
    message?: string;
    quote?: {
      depositAddress?: string;
      amountIn: string;
      minAmountIn: string;
      amountOut: string;
      minAmountOut: string;
      timeEstimate: number;
    };
    quoteRequest?: { dry: boolean };
    timestamp?: string;
  };
  if (!response.ok || !body?.quote)
    throw new QuoteUpstreamError(rawResponse, response.status, {
      destination,
      stage: "quote",
    });
  const q = body.quote;
  if (
    body.quoteRequest?.dry !== true ||
    Object.entries(request).some(
      ([key, value]) =>
        key !== "deadline" &&
        (key === "recipient"
          ? String((body.quoteRequest as any)?.[key]).toLowerCase() !==
            String(value).toLowerCase()
          : (body.quoteRequest as any)?.[key] !== value),
    ) ||
    !Number.isFinite(Date.parse((body.quoteRequest as any)?.deadline)) ||
    Math.abs(
      Date.parse((body.quoteRequest as any)?.deadline) -
        Date.parse(request.deadline),
    ) > 1000 ||
    q.depositAddress ||
    q.amountOut !== amountRaw ||
    q.minAmountOut !== amountRaw
  )
    throw new Error(
      "The quote did not meet the exact-output preview requirements.",
    );
  if (BigInt(q.amountIn) < BigInt(q.minAmountIn))
    throw new Error("Invalid quote funding bounds.");
  const capturedAt = body.timestamp ?? new Date().toISOString();
  if (Math.abs(Date.now() - Date.parse(capturedAt)) > 180000)
    throw new Error("The quote returned a stale timestamp.");
  return {
    source: "live",
    capturedAt,
    validUntil: new Date(Date.parse(capturedAt) + 180000).toISOString(),
    amountOut: decimal(BigInt(q.amountOut), route.decimals),
    outputValueUsdc: valuation?.outputValueUsdc ?? amountText,
    valuation,
    destinationToken: token,
    minInput: decimal(BigInt(q.minAmountIn)),
    maxInput: decimal(BigInt(q.amountIn)),
    buffer: decimal(BigInt(q.amountIn) - BigInt(q.minAmountIn)),
    destination,
    seconds: q.timeEstimate,
    raw: body,
  };
}

export async function liveMarket(): Promise<MarketSnapshot> {
  return snapshot("near:rhea-markets", fetchLiveMarket, (old, error) => ({
    ...old,
    markets: old.markets.map((m) => ({ ...m, available: false })),
    warnings: [...old.warnings, "Stale last-good snapshot: " + error],
  }));
}
export async function readPortfolio(accountId: string): Promise<Portfolio> {
  return snapshot(
    "near:portfolio:" + accountId,
    () => fetchPortfolio(accountId),
    (old, error) => ({
      ...old,
      errors: [...old.errors, "Stale last-good snapshot: " + error],
      sections: old.sections?.map((s) => ({
        ...s,
        status: "unavailable" as const,
        reasons: [...s.reasons, "Stale last-good snapshot: " + error],
      })),
    }),
  );
}
