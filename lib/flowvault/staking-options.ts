import { NEAR_READ_PROVIDERS } from "./rpc-endpoints.ts";
import { units, decimal, positive } from "./money.ts";
import type { Workspace } from "./types.ts";
export const STAKING_VENUES = {
  native: "native",
  linear: "linear-protocol.near",
  rnear: "lst.rhealab.near",
} as const;
const providers = NEAR_READ_PROVIDERS;
export function stakingFit(w: Workspace, epochMs: number, now = Date.now()) {
  const o = w.obligations
    .filter((o) => !["paid", "cancelled"].includes(o.status))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const days = w.mandate.leadDays ?? 3;
  const estimatedMs =
    Number.isFinite(epochMs) && epochMs > 0 ? 4 * epochMs : null;
  const earliest = estimatedMs === null ? null : now + estimatedMs;
  const deadline = o
    ? Date.parse(o.dueDate + "T23:59:59.999Z") - days * 86400000
    : null;
  return {
    obligationId: o?.id ?? null,
    dueDate: o?.dueDate ?? null,
    leadDays: days,
    minimumEpochs: 4,
    estimatedUnlockAt:
      earliest === null ? null : new Date(earliest).toISOString(),
    fits:
      deadline !== null && earliest !== null && earliest > deadline
        ? false
        : null,
    guaranteed: false,
    reason:
      deadline !== null && earliest !== null && earliest > deadline
        ? "EXIT_MISSES_DUE_DATE"
        : "EXIT_UPPER_BOUND_OR_LIQUIDITY_UNVERIFIED",
  };
}
export function normalizeStakeQuote(
  q: any,
  receiver: string,
  amountText: string,
) {
  const amount = positive(amountText, 24);
  for (const name of ["amount", "fee", "upfront", "reserve", "maxStakeable"])
    if (typeof q[name] !== "bigint" || q[name] < 0n)
      throw new Error("Staking quote " + name + " is unverified.");
  if (
    q.amount !== amount ||
    q.amount > q.maxStakeable ||
    q.reserve < units("0.5", 24)
  )
    throw new Error("Staking quote amount or exit reserve changed.");
  if (
    q.transactions?.length !== 1 ||
    q.transactions[0].receiverId !== receiver ||
    q.transactions[0].actions?.length !== 1
  )
    throw new Error("Staking quote receiver or actions changed.");
  const a = q.transactions[0].actions[0].functionCall;
  if (
    !a ||
    a.methodName !== "deposit_and_stake" ||
    JSON.stringify(a.args) !== "{}" ||
    BigInt(a.deposit) !== amount ||
    BigInt(a.gas) <= 0n ||
    BigInt(a.gas) > 300000000000000n
  )
    throw new Error("Staking quote payload changed.");
  return {
    amount: decimal(amount, 24),
    amountRaw: amount.toString(),
    networkFeeUpperBoundNear: decimal(q.fee, 24),
    upfrontGasHoldNear: decimal(q.upfront, 24),
    exitReserveNear: decimal(q.reserve, 24),
    maxStakeableNear: decimal(q.maxStakeable, 24),
    storageFeeNear:
      q.storageFee === undefined ? "0" : decimal(BigInt(q.storageFee), 24),
    shares: q.shares === undefined ? null : q.shares.toString(),
    unsignedTransactions: q.transactions.map((t: any) => ({
      receiverId: t.receiverId,
      actions: t.actions.map((x: any) => ({
        functionCall: {
          ...x.functionCall,
          gas: x.functionCall.gas.toString(),
          deposit: x.functionCall.deposit.toString(),
        },
      })),
    })),
    warnings: JSON.parse(
      JSON.stringify(q.warnings ?? [], (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ),
  };
}
async function modules(accountId: string) {
  const [{ NativeStakingProtocolNear }, { LiquidStakingProtocolNear }] =
    await Promise.all([
      import("@anywalletkit/protocol-staking-native-near"),
      import("@anywalletkit/protocol-staking-liquid-near"),
    ]);
  const account = {
    chain: "near:mainnet",
    getAddress: async () => accountId,
  } as any;
  return {
    native: new NativeStakingProtocolNear(account, {
      provider: providers,
      pools: "any",
      discover: false,
      reserve: units("0.5", 24),
      timeoutMs: 7000,
    }),
    liquid: (pool: "linear" | "rnear") =>
      new LiquidStakingProtocolNear(account, {
        pool,
        provider: providers,
        reserve: units("0.5", 24),
        timeoutMs: 7000,
      }),
  };
}
export async function stakingOptions(w: Workspace, pool?: string) {
  if (w.mode === "demo")
    return {
      source: "demo",
      fictional: true,
      readOnly: true,
      signable: false,
      options: (["native", "linear", "rnear"] as const).map((id) => ({
        id,
        venue: STAKING_VENUES[id],
        aprPercent: id === "native" ? "8.2" : "8.6",
        rateSource: "Fictional example rate",
        exit: stakingFit(w, 6.9 * 3600000),
        preparationSupported: "fictional-preview-only",
        codeHashVerified: false,
      })),
    };
  if (!w.accountId)
    throw new Error("Open a live NEAR account to read staking options.");
  const m = await modules(w.accountId);
  const rows = await Promise.allSettled(
    (["native", "linear", "rnear"] as const).map(async (id) => {
      if (id === "native") {
        const [info, epoch] = await Promise.all([
          pool ? m.native.getPool(pool) : Promise.resolve(null),
          m.native.getEpoch(),
        ]);
        return {
          id,
          venue: "native",
          pool: pool ?? null,
          aprPercent: info?.apr?.toString() ?? null,
          rateSource:
            info?.aprSource ?? "Select a validator for its verified rate",
          codeHashVerified: info?.codeHashKnown ?? false,
          eligible: info?.eligible ?? false,
          refusals: info?.refusals ?? ["VALIDATOR_REQUIRED"],
          exit: stakingFit(w, epoch.epochMs),
          preparationSupported: "unsigned-quote-only",
        };
      }
      const mod = m.liquid(id);
      const [info, epoch] = await Promise.all([
        mod.getPoolInfo(),
        mod.getEpoch(),
      ]);
      let apr: number | null = null;
      try {
        apr = await mod.getApr();
      } catch {
        /* no made-up rate */
      }
      return {
        id,
        venue: STAKING_VENUES[id],
        pool: info.contract,
        ...stakingRateVerdict(apr, info.codeHashKnown, info.paused),
        rateSource:
          apr === null || !Number.isFinite(apr)
            ? "Unavailable"
            : "Published SDK historical ft_price growth (variable estimate)",
        codeHashVerified: info.codeHashKnown,
        exit: stakingFit(w, epoch.epochMs),
        preparationSupported: "unsigned-quote-only",
      };
    }),
  );
  return {
    source: "live",
    readOnly: true,
    signable: false,
    capturedAt: new Date().toISOString(),
    options: rows.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            id: ["native", "linear", "rnear"][i],
            aprPercent: null,
            eligible: false,
            refusals: ["READ_FAILED"],
            error: String(r.reason),
          },
    ),
    note: "Rate observations and estimated exit epochs do not establish USD capacity or guaranteed withdrawal liquidity.",
  };
}
export async function unsignedStake(
  w: Workspace,
  kind: "native" | "linear" | "rnear",
  amount: string,
  pool?: string,
) {
  positive(amount, 24);
  if (w.mode === "demo")
    return {
      source: "demo",
      fictional: true,
      kind: "stake",
      readOnly: true,
      signable: false,
      amount,
      exitReserveNear: "0.5",
      unsignedTransactions: [],
      message:
        "Fictional staking preview. No transaction payload or wallet handoff.",
    };
  if (!w.accountId)
    throw new Error(
      "Open a live NEAR account before requesting a stake quote.",
    );
  const venue = STAKING_VENUES[kind];
  if (!w.policy?.venues.includes(venue))
    throw new Error(
      "Policy blocked: VENUE_NOT_ALLOWED: Staking venue is not approved.",
    );
  const rule = w.policy.assetRows?.find(
    (r) => r.asset === "NEAR" && (!r.chain || r.chain === "near"),
  );
  if (
    w.policy.protectedAssets.some((a) => a.toUpperCase() === "NEAR") ||
    (w.policy.assetRows && !rule?.uses.includes("stake"))
  )
    throw new Error(
      "Policy blocked: ASSET_USE_NOT_ALLOWED: NEAR cannot be staked.",
    );
  if (kind === "native" && !pool)
    throw new Error("Select a verified native validator.");
  const receiver = kind === "native" ? pool! : STAKING_VENUES[kind];
  if (
    !w.policy.methods.some(
      (m) => m.receiver === receiver && m.method === "deposit_and_stake",
    )
  )
    throw new Error(
      "Policy blocked: METHOD_NOT_ALLOWED: Staking method/receiver is not approved.",
    );
  const m = await modules(w.accountId);
  const q =
    kind === "native"
      ? await m.native.quoteStake({ pool, amount: positive(amount, 24) })
      : await m.liquid(kind).quoteStake({ amount: positive(amount, 24) });
  const normalized = normalizeStakeQuote(q, receiver, amount);
  return {
    verification: {
      source:
        kind === "native"
          ? "@anywalletkit/protocol-staking-native-near@0.2.0"
          : "@anywalletkit/protocol-staking-liquid-near@0.1.1",
      codeHashAndPauseCheckedBySdk: true,
      feeAndExitReserveCheckedBySdk: true,
      nativeCodeHash: "pool" in q ? q.pool.codeHash : null,
    },
    source: "live",
    kind: "stake",
    accountId: w.accountId,
    mandateVersion: w.mandate.version,
    readOnly: true,
    signable: false,
    preparesWalletAttempt: false,
    expiresAt: new Date(Date.now() + 180000).toISOString(),
    ...normalized,
    policy: {
      allowed: false,
      violations: [
        {
          code: "NEAR_USDC_VALUATION_UNVERIFIED",
          message:
            "USDC-denominated daily/action/cost caps require a verified NEAR valuation before any wallet handoff.",
        },
      ],
    },
    note: "Verified SDK unsigned quote only. No registered wallet attempt, authority or staking signer helper; owner execution support remains gated.",
  };
}

export function stakingRateVerdict(
  apr: number | null,
  codeKnown: boolean,
  paused: boolean,
) {
  const rateKnown = apr !== null && Number.isFinite(apr) && apr >= 0;
  const refusals = [
    ...(!codeKnown ? ["UNKNOWN_CODE_HASH"] : []),
    ...(paused ? ["PROTOCOL_PAUSED"] : []),
    ...(!rateKnown ? ["RATE_UNVERIFIED"] : []),
  ];
  return {
    aprPercent: rateKnown ? String(apr) : null,
    eligible: refusals.length === 0,
    refusals,
  };
}
export async function stakingValidators(w: Workspace) {
  if (w.mode === "demo")
    return {
      source: "demo",
      fictional: true,
      readOnly: true,
      signable: false,
      validators: [],
      refusals: ["FICTIONAL_EXAMPLE_NO_LIVE_VALIDATORS"],
    };
  if (!w.accountId)
    throw new Error("Open a live NEAR account to read staking validators.");
  const { native } = await modules(w.accountId);
  const candidates = await native.listPools();
  const ids = candidates.slice(0, 8).map((p) => p.id);
  const rows = await native.getPools(ids);
  const validators = rows
    .filter((p) => p.details && p.codeHashKnown === true && p.eligible)
    .map((p) => ({
      id: p.id,
      label: p.name ?? p.id,
      codeHash: p.codeHash,
      codeHashVerified: true,
      eligible: true,
      refusals: p.refusals,
      aprPercent: p.apr?.toString() ?? null,
      rateSource: p.aprSource,
      feePercent: p.feePercent,
    }));
  return {
    source: "live",
    readOnly: true,
    signable: false,
    capturedAt: new Date().toISOString(),
    validators,
    checkedCandidates: rows.length,
    coverage:
      "At most eight current/next factory pools by stake; not an exhaustive or recommended list.",
    refusals: validators.length ? [] : ["NO_VERIFIED_VALIDATORS_AVAILABLE"],
  };
}
