import { NEAR_READ_PROVIDERS } from "./rpc-endpoints.ts";
import { NativeStakingProtocolNear } from "@anywalletkit/protocol-staking-native-near";
import { LiquidStakingProtocolNear } from "@anywalletkit/protocol-staking-liquid-near";
import { decimal } from "./money.ts";
import { validAccount } from "./near.ts";
import { READ_BUDGET, withDeadline } from "./deadline.ts";
const providers = NEAR_READ_PROVIDERS;
export function serializeRead(value: unknown): any {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
export async function readStaking(accountId: string, pools: string[] = []) {
  if (
    !validAccount(accountId) ||
    pools.some((p) => !validAccount(p)) ||
    pools.length > 12
  )
    throw new Error("Invalid staking read scope.");
  // Published SDK read methods need only identity and the explicit RPC. No sender/key is supplied.
  const account = {
    chain: "near:mainnet",
    getAddress: async () => accountId,
  } as unknown as ConstructorParameters<typeof NativeStakingProtocolNear>[0];
  const native = new NativeStakingProtocolNear(account, {
    provider: providers,
    network: "mainnet",
    pools: "any",
    discover: "fastnear",
    timeoutMs: 8000,
  });
  const capturedAt = new Date().toISOString();
  // R22: each SDK section is bounded so one slow discovery can't hold the others or the caller.
  const bound = <T,>(work: Promise<T>, label: string) => withDeadline(work, READ_BUDGET.section, label);
  const result = await Promise.allSettled([
    bound((async () => {
      const positions = await native.listPositions({ pools });
      const epoch = await native.getEpoch();
      return {
        positions: positions.map((p) => ({
          ...serializeRead(p),
          epochsRemaining: p.unlock
            ? (p.unlock.epoch ??
                p.unlock.latestEpoch ??
                p.unlock.earliestEpoch) > epoch.height
              ? (
                  (p.unlock.epoch ??
                    p.unlock.latestEpoch ??
                    p.unlock.earliestEpoch) - epoch.height
                ).toString()
              : "0"
            : "0",
          countdownExact: !!p.unlock && p.unlock.epoch !== null,
          availabilityIsEstimate: !p.canWithdraw,
        })),
        epoch: serializeRead(epoch),
      };
    })(), "Native staking read"),
    ...(["linear", "rnear"] as const).map((pool) => bound((async () => {
      const m = new LiquidStakingProtocolNear(account, {
        pool,
        provider: providers,
        timeoutMs: 8000,
      });
      const [details, info, epoch] = await Promise.all([
        m.getAccountDetails(),
        m.getPoolInfo(),
        m.getEpoch(),
      ]);
      return {
        pool,
        details: serializeRead(details),
        info: serializeRead(info),
        epoch: serializeRead(epoch),
        epochsRemaining:
          details.unlockEpoch > epoch.height
            ? (details.unlockEpoch - epoch.height).toString()
            : "0",
      };
    })(), pool + " staking read")),
  ]);
  return {
    source: "live" as const,
    capturedAt,
    exitReserveNear: "0.25",
    exitReserveBasis:
      "Conservative read-only reserve; no stake/exit payload is prepared here. SDK costOf/GasPricer are available for future exact write quotes.",
    native:
      result[0].status === "fulfilled"
        ? { status: "observed", ...result[0].value }
        : { status: "unknown", error: String(result[0].reason) },
    liquid: result.slice(1).map((r, i) =>
      r.status === "fulfilled"
        ? { status: "observed", ...r.value }
        : {
            status: "unknown",
            pool: i === 0 ? "linear" : "rnear",
            error: String(r.reason),
          },
    ),
  };
}
