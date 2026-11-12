// Engines: live price and conversion evidence for the valuation layer. Read-only public views only;
// no keys, no sender, nothing signable. The pure maths lives in valuation.ts.
import { view, RHEA, USDC, dryCashQuote } from "./near.ts";
import { snapshot } from "./snapshot-cache.ts";
import { units } from "./money.ts";
import type { Obligation, Workspace } from "./types.ts";

/** Rhea's own price path: get_config.enable_pyth_oracle with pyth_oracle_account_id (aggregate-oracle.near),
 * token → price_identifier from get_all_token_pyth_infos, LSTs priced as NEAR × the token's own ft_price. */
export const LST_CONTRACTS = {
  LiNEAR: "linear-protocol.near",
  rNEAR: "lst.rhealab.near",
} as const;
export const PRICE_TOKENS = {
  NEAR: "wrap.near",
  USDC,
  USDT: "usdt.tether-token.near",
} as const;
export type PricedAsset = keyof typeof PRICE_TOKENS;
/** Observed prices older than this are not used for any decision. */
export const PRICE_MAX_AGE_MS = 180_000;

export interface OraclePrice {
  /** USD per whole token, 12-decimal fixed point, as decimal strings. */
  usdE12: string;
  confE12: string;
  publishedAt: string;
  priceIdentifier: string;
}
export interface PriceEvidence {
  source: "live" | "demo";
  oracle: string;
  basis: string;
  blockHeight: number | null;
  capturedAt: string;
  /** Oldest publish time + PRICE_MAX_AGE_MS. */
  freshUntil: string;
  prices: Partial<Record<PricedAsset, OraclePrice>>;
  /** yoctoNEAR per 1 whole LST (ft_price, 10^24 = 1:1). */
  lstNearPerToken: Partial<Record<keyof typeof LST_CONTRACTS, string>>;
  unavailable: string[];
}
/** One fresh 1Click dry EXACT_OUTPUT quote for an obligation's payout. */
export interface ConversionQuote {
  obligationId: string;
  /** USDC raw the route asks for (amountIn) and its refundable floor (minAmountIn). */
  amountInRaw: string;
  minAmountInRaw: string;
  /** Price-based USDC value of the exact output, when the route reported prices. */
  outputValueRaw: string | null;
  capturedAt: string;
  validUntil: string;
  basis: string;
}
export interface ValuationEvidence {
  prices: PriceEvidence | null;
  quotes: ConversionQuote[];
  errors: string[];
}

/** Pyth price {price, conf, expo} → 12-decimal fixed point. Throws on anything unexpected. */
export function pythToE12(p: {
  price: unknown;
  conf: unknown;
  expo: unknown;
}): { usdE12: bigint; confE12: bigint } {
  if (
    typeof p.price !== "string" ||
    !/^\d+$/.test(p.price) ||
    typeof p.conf !== "string" ||
    !/^\d+$/.test(p.conf) ||
    typeof p.expo !== "number" ||
    !Number.isInteger(p.expo) ||
    p.expo > 0 ||
    p.expo < -18
  )
    throw new Error("Oracle price shape is unverified.");
  const shift = 12 + p.expo;
  const scale = (n: bigint) =>
    shift >= 0 ? n * 10n ** BigInt(shift) : n / 10n ** BigInt(-shift);
  const usdE12 = scale(BigInt(p.price));
  if (usdE12 <= 0n) throw new Error("Oracle price is zero.");
  return { usdE12, confE12: scale(BigInt(p.conf)) };
}

async function fetchPriceEvidence(now = Date.now()): Promise<PriceEvidence> {
  const [config, infos] = await Promise.all([
    view<any>(RHEA, "get_config"),
    view<Record<string, any>>(RHEA, "get_all_token_pyth_infos"),
  ]);
  if (config.data?.contract_mode !== "Running")
    throw new Error("Rhea is not Running; its oracle path is unverified.");
  if (config.data?.enable_pyth_oracle !== true)
    throw new Error("Rhea's Pyth oracle path is not enabled.");
  const oracle = String(config.data.pyth_oracle_account_id ?? "");
  if (!/^[a-z\d._-]+\.near$/.test(oracle))
    throw new Error("Rhea oracle account is unverified.");
  const unavailable: string[] = [];
  const prices: PriceEvidence["prices"] = {};
  let oldest = Infinity;
  await Promise.all(
    (Object.keys(PRICE_TOKENS) as PricedAsset[]).map(async (asset) => {
      try {
        const info = infos.data?.[PRICE_TOKENS[asset]];
        const id = info?.price_identifier;
        if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id) || /^0+$/.test(id))
          throw new Error("no Pyth identifier in Rhea config");
        const r = await view<any>(oracle, "get_price", { price_identifier: id });
        if (!r.data) throw new Error("oracle returned no current price");
        const publishedMs = Number(r.data.publish_time) * 1000;
        if (!Number.isFinite(publishedMs) || now - publishedMs > PRICE_MAX_AGE_MS)
          throw new Error("oracle price is stale");
        const { usdE12, confE12 } = pythToE12(r.data);
        oldest = Math.min(oldest, publishedMs);
        prices[asset] = {
          usdE12: usdE12.toString(),
          confE12: confE12.toString(),
          publishedAt: new Date(publishedMs).toISOString(),
          priceIdentifier: id,
        };
      } catch (e) {
        unavailable.push(asset + ": " + (e as Error).message);
      }
    }),
  );
  const lstNearPerToken: PriceEvidence["lstNearPerToken"] = {};
  await Promise.all(
    (Object.keys(LST_CONTRACTS) as (keyof typeof LST_CONTRACTS)[]).map(
      async (lst) => {
        try {
          const contract = LST_CONTRACTS[lst];
          if (infos.data?.[contract]?.extra_call !== "ft_price")
            throw new Error("Rhea does not price it via ft_price");
          const r = await view<string>(contract, "ft_price");
          if (typeof r.data !== "string" || !/^\d+$/.test(r.data) || BigInt(r.data) <= 0n)
            throw new Error("ft_price unverified");
          lstNearPerToken[lst] = r.data;
        } catch (e) {
          unavailable.push(lst + ": " + (e as Error).message);
        }
      },
    ),
  );
  return {
    source: "live",
    oracle,
    basis: `Rhea Pyth prices (${oracle}) and LST ft_price, finalized block ${config.blockHeight}`,
    blockHeight: config.blockHeight,
    capturedAt: new Date(now).toISOString(),
    freshUntil: new Date(
      (Number.isFinite(oldest) ? oldest : now) + PRICE_MAX_AGE_MS,
    ).toISOString(),
    prices,
    lstNearPerToken,
    unavailable,
  };
}

export async function readPriceEvidence(): Promise<PriceEvidence> {
  // A degraded last-good snapshot keeps its original freshUntil, so it simply goes stale.
  return snapshot("engines:price-evidence", () => fetchPriceEvidence(), (old, error) => ({
    ...old,
    unavailable: [...old.unavailable, "Refresh failed: " + error],
  }));
}

/** Live non-USDC obligations that could use a 1Click dry quote (recipient on file). */
function quotable(o: Obligation) {
  return o.token !== "USDC" && o.recipient.trim() !== "" && !["paid", "cancelled"].includes(o.status);
}

export async function readConversionQuote(
  accountId: string,
  o: Obligation,
): Promise<ConversionQuote> {
  if (o.token === "NEAR") throw new Error("1Click payout quotes cover USDC/USDT only.");
  const decimals = 6;
  const q = await dryCashQuote(
    accountId,
    o.recipient,
    o.destination,
    units(o.amount, decimals).toString(),
    o.token,
  );
  return {
    obligationId: o.id,
    amountInRaw: units(q.maxInput).toString(),
    minAmountInRaw: units(q.minInput).toString(),
    outputValueRaw: q.valuation ? units(q.valuation.outputValueUsdc).toString() : null,
    capturedAt: q.capturedAt,
    validUntil: q.validUntil,
    basis: `1Click dry EXACT_OUTPUT quote to ${o.destination} ${o.token}`,
  };
}

/** Gathers evidence for capitalView/reserveFor. Example workspaces never read live sources. */
export async function readValuationEvidence(
  w: Workspace,
  options: { quotes?: boolean } = {},
  readers = { readPriceEvidence, readConversionQuote },
): Promise<ValuationEvidence> {
  if (w.mode === "demo") return { prices: null, quotes: [], errors: [] };
  const errors: string[] = [];
  let prices: PriceEvidence | null = null;
  try {
    prices = await readers.readPriceEvidence();
  } catch (e) {
    errors.push("Price evidence unavailable: " + (e as Error).message);
  }
  const quotes: ConversionQuote[] = [];
  if (options.quotes && w.accountId)
    await Promise.all(
      w.obligations.filter(quotable).filter((o) => o.token !== "NEAR").map(async (o) => {
        try {
          quotes.push(await readers.readConversionQuote(w.accountId!, o));
        } catch (e) {
          errors.push(o.id + ": conversion quote unavailable: " + (e as Error).message);
        }
      }),
    );
  return { prices, quotes, errors };
}

/** Routes call this right after loading the session (live only; prices are cached 15 s): non-USDC obligations get evidence-backed
 * reservations attached to the mandate, so every holdback path uses reserveFor(). Fails closed: if the
 * evidence read fails, nothing is attached and holdback() keeps refusing. */
export async function withCapitalEvidence(
  w: Workspace,
  options: { quotes?: boolean } = {},
): Promise<ValuationEvidence | null> {
  if (w.mode !== "live") return null;
  const { attachReservations } = await import("./valuation.ts");
  const evidence = await readValuationEvidence(w, options);
  attachReservations(w, evidence);
  return evidence;
}

/** Live USDC valuation of a NEAR/LST amount for policy caps (Positions consumes this). Never throws. */
export async function readActionValuation(raw: bigint, asset: "NEAR" | "LiNEAR" | "rNEAR") {
  const { actionValuation } = await import("./valuation.ts");
  try {
    return actionValuation(raw, asset, await readPriceEvidence());
  } catch (e) {
    return actionValuation(raw, asset, null);
  }
}
