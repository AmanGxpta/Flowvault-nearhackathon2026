import { readPortfolio, validAccount } from "./near.ts";
import { readEvmUsdc } from "./evm.ts";
import { readStaking } from "./staking-reads.ts";
import { demoPortfolio } from "./seed.ts";
import { displayPosition } from "./accounts.ts";
import { decimal } from "./money.ts";
import type { Workspace, Portfolio, Position } from "./types";
import { READ_BUDGET, withDeadline } from "./deadline.ts";
/** R22: start a bounded read now and settle it later, so independent sections run in parallel. */
function started<T>(work: () => Promise<T>, label: string) {
  const run = (async () => work())();
  return withDeadline(run, READ_BUDGET.section, label).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
async function settled<T>(p: ReturnType<typeof started<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw r.error;
  return r.value;
}
export async function workspacePortfolio(
  w: Workspace,
  scope: {
    account?: string;
    base?: string;
    arb?: string;
    staking?: boolean;
    pools?: string[];
    watch?: boolean;
  } = {},
  adapters: {
    readPortfolio: typeof readPortfolio;
    readEvmUsdc: (chain: "base" | "arb", address: string) => Promise<Position>;
    readStaking: typeof readStaking;
  } = { readPortfolio, readEvmUsdc, readStaking },
) {
  if (w.mode === "demo") {
    if (scope.account || scope.base || scope.arb)
      throw new Error("Example and live portfolio sources cannot be mixed.");
    return {
      portfolio: demoPortfolio(),
      staking: {
        source: "demo",
        fictional: true,
        note: "Fictional lifecycle; see positions availability and valuation.",
      },
      watchedErrors: [] as string[],
    };
  }
  const account = scope.account ?? w.accountId;
  let p: Portfolio = {
    source: "live",
    accountId: account ?? null,
    capturedAt: new Date().toISOString(),
    positions: [],
    errors: [],
  };
  if (account && !validAccount(account))
    throw new Error("Enter a valid public NEAR account.");
  // R22: every independent section starts now; each is awaited (bounded) where it is merged.
  const nearRead = account ? started(() => adapters.readPortfolio(account), "NEAR portfolio read") : null;
  const evmRead = Object.fromEntries(
    (["base", "arb"] as const).map((chain) => {
      const address = scope[chain] ?? w.evmAddresses?.[chain];
      return [chain, address ? started(() => adapters.readEvmUsdc(chain, address), chain + " USDC read") : null];
    }),
  );
  const stakingRead =
    account && scope.staking !== false
      ? started(() => adapters.readStaking(account, scope.pools ?? []), "Staking read")
      : null;
  const watchReads =
    scope.watch !== false
      ? (w.watchedAccounts ?? []).map((watch) =>
          started(
            async () =>
              watch.chain === "near"
                ? (await readPortfolio(watch.address)).positions
                : [await readEvmUsdc(watch.chain, watch.address)],
            "Watched account read",
          ),
        )
      : [];
  if (account) {
    try {
      p = await settled(nearRead!);
    } catch (e) {
      p.sections = [
        {
          id: "near",
          status: "unavailable",
          capturedAt: p.capturedAt,
          reasons: [String(e)],
          positionIds: [],
          affects: [
            "netWorth",
            "cashNow",
            "withdrawableByDate",
            "committedCapital",
            "borrowingHeadroom",
          ],
        },
      ];
    }
  } else
    p.sections = [
      {
        id: "near",
        status: "not-configured",
        capturedAt: p.capturedAt,
        reasons: ["NEAR source account not configured."],
        positionIds: [],
        affects: [
          "netWorth",
          "cashNow",
          "withdrawableByDate",
          "committedCapital",
          "borrowingHeadroom",
        ],
      },
    ];
  p.sections ??= [];
  const recordSection = (
    id: string,
    status: "observed" | "unavailable" | "not-configured",
    reasons: string[],
    positionIds: string[],
    affects: NonNullable<Portfolio["sections"]>[number]["affects"],
  ) =>
    p.sections!.push({
      id,
      status,
      reasons,
      positionIds,
      affects,
      capturedAt: new Date().toISOString(),
    });
  await Promise.all(
    (["base", "arb"] as const).map(async (chain) => {
      const address = scope[chain] ?? w.evmAddresses?.[chain];
      if (address)
        try {
          const row = await settled(evmRead[chain]!);
          p.positions.push(row);
          recordSection(
            chain + "-usdc",
            "observed",
            [],
            [row.id],
            ["netWorth", "cashNow", "withdrawableByDate"],
          );
        } catch (e) {
          recordSection(
            chain + "-usdc",
            "unavailable",
            [String(e)],
            [],
            ["netWorth", "cashNow", "withdrawableByDate"],
          );
        }
      else
        recordSection(
          chain + "-usdc",
          "not-configured",
          ["No " + chain + " address configured."],
          [],
          ["netWorth", "cashNow", "withdrawableByDate"],
        );
    }),
  );
  let staking: any = null;
  if (account && scope.staking !== false) {
    try {
      staking = await settled(stakingRead!);
      recordSection(
        "native-staking",
        staking.native.status === "unknown" ? "unavailable" : "observed",
        staking.native.status === "unknown"
          ? [staking.native.error ?? "Native staking discovery unavailable."]
          : [],
        [],
        ["netWorth", "committedCapital"],
      );
      if (staking.native.status === "unknown") {
        /* independently unavailable */
      } else
        for (const x of staking.native.positions) {
          if (BigInt(x.staked) > 0n)
            p.positions.push({
              id: "native-stake-" + x.pool,
              label: x.pool + " staked NEAR",
              asset: "NEAR",
              amount: decimal(BigInt(x.staked), 24),
              kind: "staking",
              chain: "near",
              venue: x.pool,
              availableAt: null,
            });
          if (BigInt(x.unstaked) > 0n)
            p.positions.push({
              id: "native-unstaking-" + x.pool,
              label:
                x.pool +
                (x.canWithdraw ? " withdrawable NEAR" : " unstaking NEAR"),
              asset: "NEAR",
              amount: decimal(BigInt(x.unstaked), 24),
              kind: "staking",
              chain: "near",
              venue: x.pool,
              availableAt: x.canWithdraw ? staking.capturedAt : null,
              availabilityIsEstimate: !x.canWithdraw,
            });
        }
      for (const x of staking.liquid) {
        if (x.status === "unknown") {
          recordSection(
            x.pool + "-staking",
            "unavailable",
            [x.error ?? x.pool + " staking read unavailable."],
            [],
            ["netWorth", "committedCapital"],
          );
          continue;
        }
        recordSection(
          x.pool + "-staking",
          "observed",
          [],
          [x.pool + "-shares", x.pool + "-unstaking"],
          ["netWorth", "committedCapital"],
        );
        if (x.pool === "linear")
          p.positions = p.positions.filter((p) => p.id !== "linear-wallet");
        p.positions.push({
          id: x.pool + "-shares",
          label: x.pool === "linear" ? "LiNEAR" : "rNEAR",
          asset: x.pool === "linear" ? "LiNEAR" : "rNEAR",
          amount: decimal(BigInt(x.details.shares), 24),
          kind: "staking",
          chain: "near",
          venue: x.info.contract,
          availableAt: null,
        });
        if (BigInt(x.details.unstaked) > 0n)
          p.positions.push({
            id: x.pool + "-unstaking",
            label: x.pool + " unstaking NEAR",
            asset: "NEAR",
            amount: decimal(BigInt(x.details.unstaked), 24),
            kind: "staking",
            chain: "near",
            venue: x.info.contract,
            availableAt: x.details.canWithdraw ? staking.capturedAt : null,
          });
      }
    } catch (e) {
      staking = {
        source: "live",
        capturedAt: new Date().toISOString(),
        native: { status: "unknown", error: String(e) },
        liquid: [],
      };
      recordSection(
        "staking",
        "unavailable",
        [String(e)],
        [],
        ["netWorth", "committedCapital"],
      );
    }
  }
  const watchedErrors: string[] = [];
  if (scope.watch !== false)
    await Promise.all(
      (w.watchedAccounts ?? []).map(async (watch, i) => {
        try {
          const rows = await settled(watchReads[i]);
          p.positions.push(
            ...rows.map((x) => ({
              ...x,
              id: "watch:" + watch.id + ":" + x.id,
              ownership: "watched" as const,
              accountId: watch.address,
              label: watch.label + " · " + x.label,
            })),
          );
        } catch (e) {
          watchedErrors.push(watch.id + ": " + String(e));
          p.positions.push({
            id: "watch:" + watch.id,
            label: watch.label + " · read unavailable",
            asset: "UNKNOWN",
            amount: "unknown",
            kind: "wallet",
            chain: watch.chain,
            ownership: "watched",
            valuation: null,
            accountId: watch.address,
          });
        }
      }),
    );
  p.positions = p.positions.map((x) =>
    displayPosition(x, "live", p.capturedAt),
  );
  return { portfolio: p, staking, watchedErrors };
}
