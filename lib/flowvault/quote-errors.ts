import type { Chain } from "./types.ts";
export interface QuoteErrorContext {
  destination: Chain;
  stage: "quote" | "assets";
}
function providerMessage(raw: string): string {
  try {
    const body = JSON.parse(raw);
    const message = body?.message ?? body?.error ?? body?.detail;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.every((m) => typeof m === "string"))
      return message.join("; ");
    if (typeof message?.message === "string") return message.message;
  } catch {
    /* Plain-text/HTML upstream replies remain available in debug. */
  }
  return raw;
}
export function friendlyQuoteError(
  raw: string,
  status: number | null,
  context: QuoteErrorContext,
): string {
  const message = providerMessage(raw);
  const chain = {
    arb: "Arbitrum",
    base: "Base",
    near: "NEAR",
    bnb: "BNB Chain",
    eth: "Ethereum",
  }[context.destination];
  if (status === 429)
    return "The quote service is busy. Wait a moment and try again.";
  if (status !== null && status >= 500)
    return "The cross-chain quote service is temporarily unavailable. Try again shortly.";
  if (
    /timeout|timed out|aborted|fetch failed|network error|failed to fetch/i.test(
      message,
    )
  )
    return "The quote service could not be reached. Check your connection and try again.";
  if (context.stage === "assets")
    return "Supported cross-chain assets could not be loaded. Try again shortly.";
  if (
    /refund.*(?:not valid|invalid|unsupported)|invalid.*refund/i.test(message)
  )
    return "The quote service could not accept the NEAR refund account. Reconnect your source account and try again.";
  if (
    /recipient.*(?:not valid|invalid|unsupported|not supported)|invalid.*recipient/i.test(
      message,
    )
  )
    return `The quote service could not accept this ${chain} destination address. Use an address you control on ${chain} and try again.`;
  if (
    /amount.*(?:too small|too low|below|minimum|maximum|too large|too high)|minimum.*amount|maximum.*amount|swap.*(?:limit|minimum|maximum)/i.test(
      message,
    )
  )
    return "The requested amount is outside this route’s swap limits. Try a different amount.";
  if (
    /insufficient.*liquidity|no (?:available )?(?:quotes|routes)|no.*quote.*available|route.*not supported|unsupported.*(?:route|asset|token)/i.test(
      message,
    )
  )
    return "No quote is available for this route and amount right now. Try another amount or destination.";
  if (/slippage|price.*changed|quote.*expired/i.test(message))
    return "Market prices changed or the quote expired. Request a fresh quote.";
  if (status === 401 || status === 403)
    return "The quote service is not available for this request. Try again later.";
  return "A cross-chain quote is not available right now. Try again shortly.";
}
/** Friendly UI error plus exact upstream evidence for same-session network debugging. */
export class QuoteUpstreamError extends Error {
  readonly debug: {
    provider: "1Click";
    stage: "quote" | "assets";
    status: number | null;
    rawMessage: string;
    rawResponse: string;
  };
  constructor(
    rawResponse: string,
    status: number | null,
    context: QuoteErrorContext,
  ) {
    super(friendlyQuoteError(rawResponse, status, context));
    this.name = "QuoteUpstreamError";
    this.debug = {
      provider: "1Click",
      stage: context.stage,
      status,
      rawMessage: providerMessage(rawResponse),
      rawResponse,
    };
  }
}
