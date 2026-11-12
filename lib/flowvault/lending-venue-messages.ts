/** User-facing venue explanations; raw diagnostic codes remain in API evidence. */
const messages:Record<string,string>={
  NO_ACCOUNT:"Connect and prove your NEAR wallet to read its lending positions.",
  EXAMPLE_WORKSPACE_NO_LIVE_CREDIT:"Example mode has no live lending positions or borrowing capacity.",
  NO_CREDIT_POLICY:"Set collateral permissions and credit limits in Policy before borrowing.",
  CREDIT_UNAVAILABLE:"Lending evidence is unavailable. Refresh the market before continuing.",
  CREDIT_READ_FAILED:"The lending market could not be read. Refresh and try again.",
  CAPACITY_UNVERIFIED:"Borrowing capacity cannot be verified from the current evidence.",
  CAPACITY_UNKNOWN:"Borrowing capacity is not available yet.",
  CAPACITY_SHORT:"This market cannot safely lend the requested amount under your limits.",
  PRICE_EVIDENCE_UNAVAILABLE:"Verified market prices are unavailable.",
  STALE_LENDING_STATE:"The lending snapshot has expired. Refresh it before continuing.",
  STALE_AAVE_STATE:"The Aave snapshot has expired. Refresh it before continuing.",
  STALE_MARKET:"This market snapshot has expired. Refresh it before continuing.",
  RHEA_NOT_RUNNING:"Rhea is not currently accepting these operations.",
  RHEA_ORACLE_MODE_UNVERIFIED:"Rhea's price configuration could not be verified.",
  USDC_BORROW_DISABLED:"USDC borrowing is paused, frozen or unavailable in this market.",
  EMODE_USDC_NOT_BORROWABLE:"Your current Aave efficiency mode does not allow USDC borrowing.",
  LEGACY_ISOLATION_OR_SILO_UNSUPPORTED:"This account uses a lending mode FlowVault cannot safely execute yet.",
  NEW_DEBT_NEEDS_EXPLICIT_APPROVAL:"Approve the new debt explicitly in the review plan before preparing a borrow.",
  CROSS_CHAIN_USDC_SETTLEMENT_REQUIRED:"Borrowed USDC must be delivered and verified in your NEAR account before it can fund this payment.",
  PROTECTED_ASSET:"This asset is protected by your policy.",
  SALE_PERMISSION_REQUIRED:"Explicitly allow this asset to be sold in Policy first.",
  SALE_IDENTITY_OR_LIMITS_UNVERIFIED:"Save this token's identity, precision and sale limits before continuing.",
  NO_APPROVED_SALE_ASSETS:"No asset has a verified sale permission and route yet.",
  UNKNOWN_DEBT_LIMIT_OR_LIQUIDITY:"The market's debt, limits or available liquidity could not be verified.",
  UNKNOWN_VALUATION_OR_PROTOCOL_RULES:"The collateral price or protocol risk settings could not be verified.",
};
export function explainVenueReason(reason:string):string {
  const text=reason.trim();
  if(messages[text])return messages[text];
  return text.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g,code=>messages[code]??"Some required market evidence is unavailable. Refresh and review before continuing.");
}
