import test from "node:test";
import assert from "node:assert/strict";
import { accountReservations, executionCapabilities, withConnections } from "../lib/flowvault/capabilities.ts";
import { candidateSets, fundsLocation, legLedger, meshChoice, meshFunding, meshLabel, netOf, rateFromQuote, sendFor, wireLegSteps, type LegOutcome, type SourceTerms } from "../lib/flowvault/funding-mesh.ts";
import { checkLegQuote, legQuoteBody, readStatus, resolveUsdc } from "../lib/flowvault/funding-mesh-quote.ts";
import { review, settle, newPlan } from "../lib/flowvault/plans.ts";
import type { LinkedAccount, Position } from "../lib/flowvault/types.ts";
import type { FundingLeg, PlanStep } from "../lib/flowvault/contracts.ts";

const at = "2026-11-13T00:00:00.000Z";
const BASE = "0x1111111111111111111111111111111111111111";
const ARB = "0x2222222222222222222222222222222222222222";
const SOL = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const acct = (chain: LinkedAccount["chain"], address: string, networks: string[], extra: Partial<LinkedAccount> = {}): LinkedAccount => ({
  id: chain + ":" + (chain === "solana" ? address : address.toLowerCase()), chain, address: chain === "solana" ? address : address.toLowerCase(), label: address.slice(0, 6), proof: { method: chain === "near" ? "nep413" : chain === "evm" ? "siwe" : "siws", at }, networks, addedAt: at, ...extra,
});
const pos = (id: string, chain: Position["chain"], accountId: string, asset: string, raw: string, decimals: number, kind: Position["kind"] = "wallet"): Position => ({ id, chain, accountId, asset, amount: "0", rawAmount: raw, decimals, kind, label: id });

const accounts = [
  acct("near", "alice.near", ["near"], { primary: true }),
  acct("evm", BASE, ["ethereum", "base", "arbitrum"]),
  acct("solana", SOL, ["solana"]),
  { ...acct("evm", ARB, ["arbitrum"]), proof: null },
];
const positions: Position[] = [
  pos("usdc-wallet", "near", "alice.near", "USDC", "50000000", 6),
  pos("near-wallet", "near", "alice.near", "NEAR", "3000000000000000000000000", 24),
  pos(`base-usdc-${BASE}`, "base", BASE, "USDC", "400000000", 6),
  pos(`base-eth-${BASE}`, "base", BASE, "ETH", "1000000000000000", 18),
  pos(`arb-usdc-${BASE}`, "arb", BASE, "USDC", "300000000", 6),
  pos(`arb-eth-${BASE}`, "arb", BASE, "ETH", "0", 18),
  pos(`solana-usdc-${SOL}`, "solana", SOL, "USDC", "900000000", 6),
  pos(`solana-sol-${SOL}`, "solana", SOL, "SOL", "50000000", 9),
];
const gas = { base: { needRaw: "20000000000000", basis: "test" }, arbitrum: { needRaw: "20000000000000", basis: "test" }, ethereum: { needRaw: null, basis: "unavailable" } };

test("capabilities: one per proven account × network, never for unproven accounts, with honest reasons", () => {
  const caps = executionCapabilities({ accounts, positions, reservations: [], gas, source: "live", now: Date.parse(at) });
  assert.deepEqual(caps.map((c) => c.accountId + ":" + c.network), ["near:alice.near:near", `evm:${BASE}:ethereum`, `evm:${BASE}:base`, `evm:${BASE}:arbitrum`, `solana:${SOL}:solana`]);
  const near = caps[0];
  assert.equal(near.primary, true);
  assert.deepEqual(near.operations, ["hold"]);
  const base = caps.find((c) => c.network === "base")!;
  assert.deepEqual(base.operations, ["oneclick_deposit"]);
  assert.equal(base.signing, "eip1193");
  assert.equal(base.connected, null, "the server never claims a wallet is connected");
  assert.equal(base.gas.sufficient, true);
  const arb = caps.find((c) => c.network === "arbitrum")!;
  assert.deepEqual(arb.operations, []);
  assert.ok(arb.reasons.some((r) => r.startsWith("NO_GAS")));
  const eth = caps.find((c) => c.network === "ethereum")!;
  assert.ok(eth.reasons.includes("NO_USDC"));
  assert.ok(eth.reasons.some((r) => r.startsWith("GAS_UNKNOWN")));
  const sol = caps.find((c) => c.network === "solana")!;
  assert.equal(sol.signing, "wallet_standard");
  assert.equal(sol.gas.payableInUsdc, false);
});

test("capabilities: a failed read lists the account with no assets and no operations (never zero-filled)", () => {
  const sections = [{ id: `acct:evm:${BASE}:base`, status: "unavailable" as const, capturedAt: at, reasons: ["RPC down"], positionIds: [], affects: ["netWorth" as const] }];
  const base = executionCapabilities({ accounts, positions, sections, reservations: [], gas, source: "live" }).find((c) => c.network === "base")!;
  assert.deepEqual(base.assets, []);
  assert.deepEqual(base.operations, []);
  assert.equal(base.gas.balanceRaw, null);
  assert.ok(base.reasons[0].startsWith("READ_UNAVAILABLE"));
});

test("reservations: other plans' unfinished legs hold funds per account; finished or evaluated ones don't", () => {
  const leg = (id: string, amount: string): FundingLeg => ({ id, accountId: `evm:${BASE}`, network: "base", address: BASE, label: "b", asset: "USDC", operation: "oneclick_deposit", signer: `evm:${BASE}`, signing: "eip1193", amountRaw: amount, minNetRaw: amount, costsUsdcRaw: "0", gas: { asset: "ETH", amountRaw: "1", usdcRaw: "1" }, stepKind: "fund_transfer", rationale: "", eligible: true, reasons: [] });
  const step = (legId: string, state: PlanStep["state"]) => ({ id: "s-" + legId, expected: { legId }, state }) as PlanStep;
  const plans = [
    { id: "p1", state: "reviewed", steps: [step("a", "ready")], funding: { legs: [leg("a", "150000000")] } },
    { id: "p2", state: "executing", steps: [step("b", "submitted")], funding: { legs: [leg("b", "100000000")] } },
    { id: "p3", state: "superseded", steps: [step("c", "skipped")], funding: { legs: [leg("c", "999000000")] } },
    { id: "p4", state: "superseded", steps: [step("d", "unknown")], funding: { legs: [leg("d", "10000000")] } },
    { id: "p5", state: "evaluated", steps: [], funding: { legs: [leg("e", "777000000")] } },
    { id: "p6", state: "completed", steps: [step("f", "confirmed")], funding: { legs: [leg("f", "5000000")] } },
  ] as never[];
  const r = accountReservations(plans);
  assert.deepEqual(r.map((x) => [x.planId, x.state]), [["p1", "held"], ["p2", "in_flight"], ["p4", "in_flight"]]);
  assert.equal(accountReservations(plans, "p1").length, 2, "a plan never reserves against itself");
  const base = executionCapabilities({ accounts, positions, reservations: r, gas, source: "live" }).find((c) => c.network === "base")!;
  const usdc = base.assets.find((a) => a.asset === "USDC")!;
  assert.equal(usdc.reservedRaw, "260000000");
  assert.equal(usdc.availableRaw, "140000000");
});

test("connections overlay comes from the browser only", () => {
  const caps = withConnections(executionCapabilities({ accounts, positions, reservations: [], gas, source: "live" }), new Set([`evm:${BASE}`]), "alice.near");
  assert.equal(caps[0].connected, true);
  assert.equal(caps.find((c) => c.network === "base")!.connected, true);
  assert.equal(caps.find((c) => c.network === "solana")!.connected, false);
});

const terms = (network: SourceTerms["network"], address: string, available: bigint, rateBps: bigint | null, gasUsdc: bigint | null, reasons: string[] = []): SourceTerms => ({
  accountId: (network === "solana" ? "solana:" : "evm:") + address, network, address, label: address.slice(0, 6), signing: network === "solana" ? "wallet_standard" : "eip1193",
  availableRaw: available, rateBps, gasAsset: network === "solana" ? "SOL" : "ETH", gasRaw: 1n, gasUsdcRaw: gasUsdc, reasons, basis: "test",
});

test("leg math rounds against the owner: send rounds up, net rounds down", () => {
  assert.equal(rateFromQuote(100_000000n, 99_500000n), 50n);
  assert.equal(rateFromQuote(3n, 2n), 3334n);
  const send = sendFor(100_000000n, 50n);
  assert.ok(netOf(send, 50n) >= 100_000000n);
  assert.ok(netOf(send - 1n, 50n) < 100_000000n);
});

test("single vs mixed: the cheapest set after every known cost wins; ties prefer fewer legs", () => {
  const need = 500_000000n;
  const a = terms("base", BASE, 400_000000n, 10n, 10_000n); // cheap route, can't cover alone
  const b = terms("arbitrum", ARB, 300_000000n, 10n, 20_000n);
  const c = terms("solana", SOL, 900_000000n, 120n, 5_000n); // covers alone but 1.2% route
  const sets = candidateSets([a, b, c], need);
  const single = sets.filter((s) => s.mode === "single");
  assert.deepEqual(single.map((s) => s.eligible), [false, false, true]);
  assert.match(single[0].reasons[0], /^SOURCE_SHORT/);
  const mixed = sets.find((s) => s.mode === "mixed")!;
  assert.equal(mixed.eligible, true);
  assert.deepEqual(mixed.legs.map((l) => l.network), ["base", "arbitrum"]);
  assert.ok(mixed.costsUsdcRaw! < single[2].costsUsdcRaw!, "mixed is cheaper than the only single source");
  const net = mixed.legs.reduce((n, l) => n + BigInt(l.minNetRaw), 0n);
  assert.equal(net, need, "legs net exactly the need");
  for (const l of mixed.legs) assert.ok(BigInt(l.amountRaw) <= (l.network === "base" ? 400_000000n : 300_000000n), "never more than the source holds");
});

test("a single source that covers it cheaply beats a mixed set (fixed network fees count)", () => {
  const sets = candidateSets([terms("base", BASE, 900_000000n, 10n, 10_000n), terms("arbitrum", ARB, 900_000000n, 10n, 10_000n)], 200_000000n);
  const ranked = sets.filter((s) => s.eligible).sort((x, y) => Number(x.costsUsdcRaw! - y.costsUsdcRaw!) || x.legs.length - y.legs.length);
  assert.equal(ranked[0].mode, "single");
  assert.equal(sets.find((s) => s.mode === "mixed"), undefined, "no mixed set when one source covers it and a second leg would only add a fee");
});

test("unknown costs block: no route quote or no gas price means the source can't be used", () => {
  const sets = candidateSets([terms("base", BASE, 900_000000n, null, 10_000n, ["ROUTE_QUOTE_UNAVAILABLE: down"]), terms("arbitrum", ARB, 900_000000n, 10n, null)], 100_000000n);
  assert.ok(sets.every((s) => !s.eligible));
});

test("meshFunding explains the choice, uses idle NEAR first and never claims atomicity", () => {
  const { funding } = meshFunding({ target: "alice.near", requiredRaw: 550_000000n, idleRaw: 50_000000n, sources: [terms("base", BASE, 400_000000n, 10n, 10_000n), terms("arbitrum", ARB, 300_000000n, 10n, 20_000n), terms("solana", SOL, 900_000000n, 120n, 5_000n)], capturedAt: at });
  const f = funding["mesh:mixed"];
  assert.equal(f.atomic, false);
  assert.equal(f.legs[0].operation, "hold");
  assert.equal(f.legs[0].amountRaw, "50000000");
  assert.equal(BigInt(f.netToTargetRaw), 550_000000n);
  assert.match(f.explanation[0], /idle USDC goes first/);
  assert.ok(f.explanation.some((x) => /not all-or-nothing/.test(x)));
  assert.ok(f.explanation.some((x) => /vs .* from the best single source/.test(x)));
  assert.match(meshLabel("mesh:mixed", f), /^Mixed: Base 0x1111…1111 \+ Arbitrum 0x2222…2222$/);
});

test("review wires legs as independent wallet steps signed by their sources; settle waits for all", () => {
  const sets = candidateSets([terms("base", BASE, 400_000000n, 10n, 10_000n), terms("arbitrum", ARB, 300_000000n, 10n, 20_000n)], 500_000000n);
  const mixed = sets.find((s) => s.mode === "mixed")!;
  const choice = meshChoice(mixed, ["pay_quote", "pay_deposit", "verify_payout"]);
  assert.equal(choice.kind, "multi_source");
  const { funding } = meshFunding({ target: "alice.near", requiredRaw: 500_000000n, idleRaw: 0n, sources: [terms("base", BASE, 400_000000n, 10n, 10_000n), terms("arbitrum", ARB, 300_000000n, 10n, 20_000n)], capturedAt: at });
  const plan = newPlan({ id: "11111111-2222-3333-4444-555555555555", key: "k", source: "live", accountId: "alice.near", objective: "pay_obligation", createdBy: "assistant", request: {}, context: { workspaceRevision: 1, mandateVersion: 1, policyVersion: 1 }, alternatives: [choice] });
  review(plan, choice.id, choice.steps.map((kind) => ({ kind, expected: {} })));
  wireLegSteps(plan.steps, funding["mesh:mixed"]);
  const [l1, l2, quote] = plan.steps;
  assert.equal(l1.signer, `evm:${BASE}`);
  assert.equal(l2.signer, `evm:${ARB}`);
  assert.deepEqual([l1.state, l2.state, quote.state], ["ready", "ready", "pending"]);
  assert.deepEqual(quote.dependsOn, [l1.id, l2.id]);
  assert.equal(l1.expected.legId, funding["mesh:mixed"].legs[0].id);
  l1.state = "confirmed";
  settle(plan);
  assert.equal(quote.state, "pending", "one leg arriving is not enough");
  l2.state = "failed";
  settle(plan);
  assert.equal(plan.state, "partial", "a failed leg after another arrived is a partial plan, never completed");
});

const LEG: FundingLeg = { id: "leg-1-base-111111", accountId: `evm:${BASE}`, network: "base", address: BASE, label: "b", asset: "USDC", operation: "oneclick_deposit", signer: `evm:${BASE}`, signing: "eip1193", amountRaw: "100000000", minNetRaw: "99500000", costsUsdcRaw: "510000", gas: { asset: "ETH", amountRaw: "1", usdcRaw: "10000" }, stepKind: "fund_transfer", rationale: "", eligible: true, reasons: [] };
const outcome = (o: Partial<LegOutcome>): LegOutcome => ({ state: "prepared", amountInRaw: "100000000", depositAddress: "0x9999999999999999999999999999999999999999", deadline: "2026-11-13T01:00:00.000Z", txHash: null, provider: null, deliveredRaw: null, refundedRaw: null, destinationHashes: [], gasRaw: null, gasUsdcRaw: null, at, ...o });

test("leg ledger: principal is an internal transfer, costs are fees, nothing is booked twice or before confirmation", () => {
  const ids = { legJournalId: "leg:abc", planId: "p", stepId: "s", source: "live" as const };
  assert.deepEqual(legLedger(outcome({ state: "submitted" }), LEG, ids), []);
  const e = legLedger(outcome({ state: "confirmed", deliveredRaw: "99700000", txHash: "0x" + "a".repeat(64), gasRaw: "5000000000000", gasUsdcRaw: "15000", destinationHashes: ["Dest1111111111"] }), LEG, ids);
  assert.deepEqual(e.map((x) => [x.kind, x.asset, x.amountRaw, x.netWorthEffectUsdcRaw]), [
    ["internal_transfer", "USDC", "100000000", "0"],
    ["fee", "USDC", "300000", "-300000"],
    ["fee", "ETH", "5000000000000", "-15000"],
  ]);
  assert.equal(new Set(e.map((x) => x.id)).size, 3);
  assert.ok(e.every((x) => x.attemptId === "leg:abc" && x.chain === "base"));
  const unpriced = legLedger(outcome({ state: "confirmed", deliveredRaw: "100000000", gasRaw: "1", gasUsdcRaw: null }), LEG, ids);
  assert.equal(unpriced.length, 2, "no route fee when nothing was lost");
  assert.equal(unpriced[1].netWorthEffectUsdcRaw, null, "unpriced gas stays unpriced, never 0");
});

test("recovery: every leg says where its money is", () => {
  const now = Date.parse("2026-11-13T00:30:00.000Z");
  assert.equal(fundsLocation(LEG, { state: "ready" }, null, now).where, "source");
  assert.equal(fundsLocation(LEG, { state: "submitted" }, outcome({ state: "submitted", txHash: "0xh" }), now).where, "in_transit");
  assert.equal(fundsLocation(LEG, { state: "confirmed" }, outcome({ state: "confirmed", deliveredRaw: "99700000" }), now).amountRaw, "99700000");
  assert.equal(fundsLocation(LEG, { state: "failed" }, outcome({ state: "refunded", refundedRaw: "100000000" }), now).where, "refunded_to_source");
  assert.equal(fundsLocation(LEG, { state: "unknown" }, outcome({ state: "unknown" }), now).where, "unknown");
  const lateWallet = fundsLocation(LEG, { state: "awaiting_wallet" }, outcome({ state: "awaiting_wallet" }), Date.parse("2026-11-13T02:00:00.000Z"));
  assert.equal(lateWallet.where, "unknown");
  assert.match(lateWallet.detail, /refunds it/);
  const hold = { ...LEG, operation: "hold" as const };
  assert.equal(fundsLocation(hold, null, null).where, "target");
});

test("1Click routes come from the catalog and must be official USDC with 6 decimals", () => {
  const cat = [
    { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
    { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, blockchain: "sol", symbol: "USDC", contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { assetId: "nep141:fake.near", decimals: 6, blockchain: "arb", symbol: "USDC", contractAddress: "0xdeadbeef00000000000000000000000000000000" },
    { assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6, blockchain: "near", symbol: "USDC", contractAddress: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" },
  ];
  assert.match(resolveUsdc(cat, "base").assetId, /^nep141:base-0x8335/);
  assert.match(resolveUsdc(cat, "solana").assetId, /^nep141:sol-/);
  assert.throws(() => resolveUsdc(cat, "arbitrum"), /doesn't list official USDC/);
  assert.throws(() => resolveUsdc([{ ...cat[1], contractAddress: "epjfwdd5aufqssqem2qn1xzybapc8g4wegGkZwyTDt1v" }], "solana"), /doesn't list/, "Solana mints are case-sensitive");
  assert.throws(() => resolveUsdc([{ ...cat[0], decimals: 18 }], "base"), /18 decimals/);
});

test("leg quotes must echo the request exactly and never deliver more than they take", () => {
  const r = { network: "base" as const, from: BASE, to: "alice.near", amountRaw: "100000000", originAsset: "nep141:base-usdc", destinationAsset: "nep141:near-usdc" };
  const sent = legQuoteBody(r, false, Date.parse(at));
  const body = (q: Record<string, unknown>, echo: Record<string, unknown> = {}) => ({ quote: { amountIn: "100000000", amountOut: "99800000", minAmountOut: "99300000", depositAddress: "0x9999999999999999999999999999999999999999", timeEstimate: 60, ...q }, quoteRequest: { ...sent, ...echo } });
  const ok = checkLegQuote(r, sent, body({}));
  assert.equal(ok.minAmountOutRaw, "99300000");
  assert.throws(() => checkLegQuote(r, sent, body({}, { recipient: "mallory.near" })), /different NEAR account/);
  assert.throws(() => checkLegQuote(r, sent, body({}, { refundTo: ARB })), /refunds a different/);
  assert.throws(() => checkLegQuote(r, sent, body({ amountOut: "100000001", minAmountOut: "99000000" })), /more USDC than it takes/);
  assert.throws(() => checkLegQuote(r, sent, body({ depositAddress: SOL })), /no valid deposit address/);
  assert.throws(() => checkLegQuote(r, legQuoteBody(r, true), { quote: { amountIn: "100000000", amountOut: "1", minAmountOut: "1", depositAddress: "0x9999999999999999999999999999999999999999" }, quoteRequest: legQuoteBody(r, true) }), /preview quote/);
});

test("provider status is read defensively", () => {
  assert.deepEqual(readStatus({ status: "SUCCESS", swapDetails: { amountOut: "99700000", destinationChainTxHashes: [{ hash: "DestHash1111" }] } }), { status: "SUCCESS", deliveredRaw: "99700000", refundedRaw: null, destinationHashes: ["DestHash1111"], originHashes: [] });
  assert.equal(readStatus({ status: "WEIRD" }).status, "UNKNOWN");
  assert.equal(readStatus({ status: "SUCCESS", swapDetails: { amountOut: "1.5" } }).deliveredRaw, null);
});
