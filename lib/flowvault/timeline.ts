export interface ExecutionStep {
  id: string;
  sequence: number;
  at: string;
  phase: string;
  status: string;
  message: string;
  explorerLinks: string[];
  fees: { unit: string; amount: string | null; verified: boolean }[];
  refund: unknown | null;
  evidence: unknown | null;
}
export interface HasTimeline {
  timeline?: ExecutionStep[];
  state: string;
  message: string;
  hashes: string[];
  createdAt: string;
  updatedAt: string;
}
export function appendStep<T extends HasTimeline>(
  a: T,
  phase: string,
  status: string,
  message: string,
  details: Partial<
    Pick<ExecutionStep, "explorerLinks" | "fees" | "refund" | "evidence">
  > = {},
  now = Date.now(),
): T {
  const timeline = a.timeline ?? [];
  const last = timeline.at(-1);
  if (
    last?.phase === phase &&
    last.status === status &&
    last.message === message &&
    JSON.stringify(last.evidence) ===
      JSON.stringify(details.evidence ?? null) &&
    JSON.stringify(last.fees) === JSON.stringify(details.fees ?? []) &&
    JSON.stringify(last.refund) === JSON.stringify(details.refund ?? null) &&
    JSON.stringify(last.explorerLinks) ===
      JSON.stringify(details.explorerLinks ?? [])
  )
    return a;
  if (timeline.length >= 1000)
    throw new Error(
      "Execution timeline limit reached; export and investigate this operation.",
    );
  const at = new Date(now).toISOString();
  a.timeline = [
    ...timeline,
    {
      id: crypto.randomUUID(),
      sequence: timeline.length + 1,
      at,
      phase,
      status,
      message,
      explorerLinks: details.explorerLinks ?? [],
      fees: details.fees ?? [],
      refund: details.refund ?? null,
      evidence: details.evidence ?? null,
    },
  ];
  return a;
}
export function outcomeFee(result: any) {
  const outcomes = [
    result.transaction_outcome?.outcome,
    ...(result.receipts_outcome ?? []).map((x: any) => x.outcome),
  ];
  const complete =
    outcomes.length > 0 &&
    outcomes.every(
      (x) =>
        typeof x?.tokens_burnt === "string" && /^\d+$/.test(x.tokens_burnt),
    );
  return {
    unit: "yoctoNEAR",
    amount: complete
      ? outcomes
          .reduce((n: bigint, x: any) => n + BigInt(x.tokens_burnt), 0n)
          .toString()
      : null,
    verified: complete && result.final_execution_status === "FINAL",
  };
}
export function syncTimeline<T extends HasTimeline>(
  a: T,
  previous?: HasTimeline,
): T {
  if (!a.timeline?.length)
    appendStep(
      a,
      "preparation",
      "prepared",
      "Unsigned payload prepared; nothing submitted.",
      {},
      Date.parse(a.createdAt),
    );
  if (
    !previous ||
    a.state !== previous.state ||
    JSON.stringify(a.hashes) !== JSON.stringify(previous.hashes)
  )
    appendStep(a, a.state, a.state, a.message, {
      explorerLinks: a.hashes.map((h) => "https://nearblocks.io/txns/" + h),
    });
  return a;
}
