import { view, RHEA, USDC } from "@/lib/flowvault/near";
import { session, json, failure } from "@/lib/flowvault/store";
export async function GET(request: Request) {
  try {
    const s = await session(request);
    if (s.workspace.mode === "demo")
      return json(
        {
          source: "demo",
          fictional: true,
          readOnly: true,
          capturedAt: new Date().toISOString(),
          venue: RHEA,
          debtAsset: USDC,
          debtRiskBps: 8000,
          assets: [
            ...["linear-protocol.near", "lst.rhealab.near"].map((assetId) => ({
              assetId,
              config: {
                can_use_as_collateral: true,
                can_borrow: true,
                volatility_ratio: 7000,
                extra_decimals: 0,
              },
              eligibilityEvidence:
                "Rhea public config checked 2026-11-12; values, debt liquidity/limits and stress in example remain illustrative",
            })),
            {
              assetId: USDC,
              config: {
                extra_decimals: 12,
                can_borrow: true,
                volatility_ratio: 8000,
                borrowed_limit: "50000000000000000000000",
              },
            },
          ],
          valuation: null,
          borrowExecution: false,
          note: "Fictional protocol controls for a scenario, not current Rhea evidence.",
        },
        s.cookie,
      );
    const r = await view<any[]>(RHEA, "get_assets_paged_detailed", {
      from_index: 0,
      limit: 100,
    });
    return json({
      source: "live",
      capturedAt: new Date().toISOString(),
      blockHeight: r.blockHeight,
      venue: RHEA,
      debtAsset: USDC,
      debtRiskBps:
        r.data.find((x) => x.token_id === USDC)?.config?.volatility_ratio ??
        null,
      assets: r.data.map((x) => ({
        assetId: x.token_id,
        config: x.config,
        supplied: x.supplied,
        borrowed: x.borrowed,
        marginDebt: x.margin_debt,
        pendingMarginDebt: x.margin_pending_debt,
        reserved: x.reserved,
        protocolFee: x.prot_fee,
      })),
      valuation: null,
      borrowExecution: false,
      note: "Raw live Rhea controls; volatility_ratio is not silently treated as a general-purpose LTV. Independent valuation and full market/account health are required.",
    });
  } catch (e) {
    return failure(e);
  }
}
