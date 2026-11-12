import { payoutAsset } from "../lib/flowvault/evm.ts";
// Public dry quotes only. Never requests a deposit address, reads a key, signs or sends funds.
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import {
  paymentRequest,
  nativePaymentAsset,
} from "../lib/flowvault/payments.ts";
import { units, decimal } from "../lib/flowvault/money.ts";
const { values } = parseArgs({
  options: {
    account: { type: "string" },
    recipient: { type: "string" },
    report: { type: "string" },
    grid: { type: "boolean" },
    amount: { type: "string" },
    chain: { type: "string", default: "base" },
    token: { type: "string", default: "USDC" },
  },
});
if (!values.account || !values.recipient)
  throw Error(
    "Supply --account <your.near> --recipient <your Base address>. Only dry quotes are requested.",
  );
const route = payoutAsset(values.chain, values.token);
const trials = [];
async function probe(raw) {
  const amount = decimal(raw, route.decimals);
  const o = {
    id: "dry-probe",
    label: "Dry-only threshold probe",
    recipient: values.recipient,
    destination: route.chain,
    token: route.token,
    amount,
    dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    status: "pending",
  };
  const request = {
    ...paymentRequest(
      values.account,
      o,
      nativePaymentAsset(route.chain, route.token),
    ),
    dry: true,
  };
  const r = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.json();
  let result;
  if (r.ok && body.quote) {
    const q = body.quote;
    if (
      body.quoteRequest?.dry !== true ||
      q.depositAddress ||
      q.amountOut !== raw.toString() ||
      q.minAmountOut !== raw.toString()
    )
      throw Error("Unsafe dry response; no action taken.");
    for (const f of [
      "originAsset",
      "destinationAsset",
      "swapType",
      "refundTo",
      "recipient",
    ])
      if (
        String(body.quoteRequest[f]).toLowerCase() !==
        String(request[f]).toLowerCase()
      )
        throw Error("Dry response echo mismatch: " + f);
    if (
      !/^\d+$/.test(q.amountIn) ||
      !/^\d+$/.test(q.minAmountIn) ||
      BigInt(q.amountIn) < BigInt(q.minAmountIn)
    )
      throw Error("Invalid dry funding bounds.");
    result = {
      amountOut: amount,
      accepted: true,
      capturedAt: body.timestamp,
      minimumInput: decimal(BigInt(q.minAmountIn)),
      maximumInput: decimal(BigInt(q.amountIn)),
      refundableBuffer: decimal(BigInt(q.amountIn) - BigInt(q.minAmountIn)),
      inputMinusPayoutUpperBound:
        route.token === "USDC" ? decimal(BigInt(q.amountIn) - raw) : null,
      providerFeeBps: (body.quoteRequest.appFees ?? []).reduce(
        (n, f) => n + Number(f.fee),
        0,
      ),
      actualRealizedFee: null,
      timeEstimateSeconds: q.timeEstimate,
      depositAddressGenerated: false,
    };
  } else {
    const message =
      typeof body.message === "string"
        ? body.message
        : JSON.stringify(body).slice(0, 500);
    result = {
      amountOut: amount,
      accepted: false,
      httpStatus: r.status,
      message,
      minimumRefusal:
        /amount.*(?:low|small|minimum)|(?:minimum|minamount|less than|at least)|too (?:low|small)/i.test(
          message,
        ),
    };
  }
  trials.push(result);
  console.log(JSON.stringify(result));
  return result;
}
const amounts = values.amount
  ? [values.amount]
  : values.grid
    ? ["0.000001", "0.01", "0.05", "0.1", "0.5", "1", "2", "5"]
    : ["0.000001", "0.01", "0.1", "1", "2", "5"];
let low = 0n,
  high = null;
for (const amount of amounts) {
  const raw = units(amount, route.decimals);
  const r = await probe(raw);
  if (r.accepted) {
    high = raw;
    break;
  }
  if (!r.minimumRefusal)
    throw Error(
      "Probe failed for a non-minimum reason; no minimum can be inferred.",
    );
  low = raw;
  await new Promise((r) => setTimeout(r, 300));
}
if (high === null)
  throw Error(
    "No accepted probe up to 5 USDC. Inspect route availability and repeat.",
  );
if (!values.grid && !values.amount) {
  while (high - low > 1n) {
    const mid = (high + low) / 2n;
    const r = await probe(mid);
    if (r.accepted) high = mid;
    else if (r.minimumRefusal) low = mid;
    else throw Error("Non-minimum error interrupted threshold search.");
    await new Promise((r) => setTimeout(r, 300));
  }
}
const accepted = await probe(high);
if (!accepted.accepted)
  throw Error("Boundary changed during recheck; no stable observed minimum.");
if (low > 0n) {
  const refused = await probe(low);
  if (refused.accepted)
    throw Error("Boundary changed during recheck; repeat before use.");
}
const report = {
  checkedAt: new Date().toISOString(),
  source: "live-dry-quotes",
  route: "NEAR native USDC -> " + route.chain + " " + route.token,
  destinationDecimals: route.decimals,
  addressScope: "Caller-provided addresses intentionally omitted from report",
  dry: true,
  noFundsMoved: true,
  observedAcceptedAmount: decimal(high, route.decimals),
  observedRefusedAmount: low > 0n ? decimal(low, route.decimals) : null,
  smallestPositiveNativeUnit: high === 1n,
  atomicBoundaryRechecked: low > 0n && high - low === 1n,
  accepted,
  trials,
  limitations:
    "Observed route/recipient/time-specific threshold, not a permanent protocol minimum or executable quote. Request fresh owner-specific dry and non-dry quotes before funding. Maximum input includes refundable buffer; actual realized fees remain unknown.",
};
if (values.report)
  await writeFile(values.report, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    observedAcceptedAmount: report.observedAcceptedAmount,
    observedRefusedAmount: report.observedRefusedAmount,
    atomicBoundaryRechecked: report.atomicBoundaryRechecked,
    report: values.report ?? null,
  }),
);
