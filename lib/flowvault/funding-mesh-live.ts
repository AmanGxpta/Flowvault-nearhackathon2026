/* eslint-disable @typescript-eslint/no-explicit-any -- 1Click and JSON-RPC bodies */
// Funding mesh, live side (owner: Stream A): token catalog, leg quotes, gas reads, source terms, and the leg
// journal's prepare/handoff/check. FlowVault never signs: it builds one exact transfer per leg for the source's
// own wallet and reconciles from the source chain's receipt and 1Click's delivery report.
import type { ActionPlan, ExecutionCapability, ExecutionNetwork, FundingLeg, MultiSourceFunding, PlanStep } from "./contracts";
import type { Workspace } from "./types";
import { EVM_CHAINS, evmRpc, hexQuantity } from "./evm";
import { transferTx } from "./evm-funding";
import { view } from "./near";
import { usdcValue } from "./valuation";
import type { PriceEvidence } from "./valuation-evidence";
import { EVM_NETWORK_CODE, NETWORK_NAME } from "./capabilities";
import { candidateSets, meshFunding, rateFromQuote, sendFor, type CandidateSet, type SourceTerms, type LegOutcome } from "./funding-mesh";
import { ONECLICK, checkLegQuote, legQuoteBody, legRequestError, readStatus, resolveUsdc, type CatalogToken, type LegQuote, type LegRequest, type ProviderReport } from "./funding-mesh-quote";
import { legGet, legInsert, legNote, legSave, type LegRecord } from "./funding-mesh-store";
import { keyedAttemptId } from "./preparation-key";
import { mayRead } from "./account-registry";

/* ───────────── 1Click ───────────── */

let catalog: { at: number; tokens: CatalogToken[] } | null = null;
export async function tokenCatalog(): Promise<CatalogToken[]> {
  if (catalog && Date.now() - catalog.at < 300_000) return catalog.tokens;
  const r = await fetch(ONECLICK + "/tokens", { signal: AbortSignal.timeout(10_000) });
  const body = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(body)) throw new Error("1Click token catalog unavailable (HTTP " + r.status + ").");
  catalog = { at: Date.now(), tokens: body };
  return body;
}

export async function legRequest(network: LegRequest["network"], from: string, to: string, amountRaw: string): Promise<LegRequest> {
  const tokens = await tokenCatalog();
  const req = { network, from, to, amountRaw, originAsset: resolveUsdc(tokens, network).assetId, destinationAsset: resolveUsdc(tokens, "near").assetId };
  const err = legRequestError(req);
  if (err) throw new Error(err);
  return req;
}

export async function legQuote(r: LegRequest, dry: boolean): Promise<LegQuote> {
  const sent = legQuoteBody(r, dry);
  const res = await fetch(ONECLICK + "/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent), signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("1Click returned an unreadable quote (HTTP " + res.status + ").");
  }
  if (!res.ok) throw new Error("1Click: " + (body?.message ?? "HTTP " + res.status));
  return checkLegQuote(r, sent, body);
}

export async function providerStatus(depositAddress: string, memo: string | null): Promise<ProviderReport> {
  const q = "depositAddress=" + encodeURIComponent(depositAddress) + (memo ? "&depositMemo=" + encodeURIComponent(memo) : "");
  const res = await fetch(ONECLICK + "/status?" + q, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error("1Click status unavailable (HTTP " + res.status + ").");
  return readStatus(body);
}

/** Optional hint so 1Click picks the deposit up sooner; failures are ignored (status polling still works). */
export async function submitLegDeposit(depositAddress: string, txHash: string, memo: string | null) {
  await fetch(ONECLICK + "/deposit/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash, depositAddress, ...(memo ? { memo } : {}) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/* ───────────── gas ───────────── */

/** An ERC-20 transfer to a fresh address uses ~35–60k gas; 80k is the bound, doubled for fee movement. */
export const EVM_TRANSFER_GAS = 80_000n;
export async function evmGasNeed(network: "ethereum" | "base" | "arbitrum"): Promise<bigint> {
  const price = hexQuantity(await evmRpc(EVM_NETWORK_CODE[network], "eth_gasPrice", []));
  if (price <= 0n) throw new Error("No gas price on " + NETWORK_NAME[network] + ".");
  return price * EVM_TRANSFER_GAS * 2n;
}
export async function gasObservations(networks: ExecutionNetwork[]) {
  const out: Partial<Record<ExecutionNetwork, { needRaw: string | null; basis: string }>> = {};
  await Promise.all(
    [...new Set(networks)].filter((n): n is "ethereum" | "base" | "arbitrum" => n in EVM_NETWORK_CODE).map(async (n) => {
      try {
        out[n] = { needRaw: (await evmGasNeed(n)).toString(), basis: `eth_gasPrice × ${EVM_TRANSFER_GAS} gas × 2` };
      } catch (e) {
        out[n] = { needRaw: null, basis: "Gas price unavailable: " + (e as Error).message };
      }
    }),
  );
  return out;
}
function gasUsdc(asset: "ETH" | "SOL" | "NEAR", raw: bigint, prices: PriceEvidence | null): bigint | null {
  if (!prices) return null;
  try {
    return usdcValue(raw, asset === "ETH" ? 18 : asset === "SOL" ? 9 : 24, asset, prices, "liability");
  } catch {
    return null;
  }
}

/* ───────────── source terms and mesh alternatives ───────────── */

/** The plan's NEAR account must be registered on native USDC, or 1Click can't deliver to it. */
export async function nearUsdcRegistered(account: string) {
  const r = await view<unknown>("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "storage_balance_of", { account_id: account });
  return !!r.data;
}

/** One live dry quote per usable source, sized at what it would send, gives its route rate. */
export async function sourceTerms(caps: ExecutionCapability[], needRaw: bigint, to: string, prices: PriceEvidence | null): Promise<SourceTerms[]> {
  const usable = caps.filter((c) => c.operations.includes("oneclick_deposit"));
  return Promise.all(
    usable.map(async (c): Promise<SourceTerms> => {
      const available = BigInt(c.assets.find((a) => a.asset === "USDC")?.availableRaw ?? "0");
      const gasRaw = c.gas.needRaw === null ? null : BigInt(c.gas.needRaw);
      const base: SourceTerms = {
        accountId: c.accountId, network: c.network, address: c.address, label: c.label, signing: c.signing, availableRaw: available,
        rateBps: null, gasAsset: c.gas.asset, gasRaw, gasUsdcRaw: gasRaw === null ? null : gasUsdc(c.gas.asset, gasRaw, prices), reasons: [], basis: "",
      };
      if (base.gasUsdcRaw === null) base.reasons.push("GAS_VALUE_UNKNOWN: no " + c.gas.asset + " price evidence");
      try {
        const size = available < needRaw + needRaw / 50n ? available : needRaw + needRaw / 50n;
        const q = await legQuote(await legRequest(c.network as LegRequest["network"], c.address, to, (size > 1_000000n ? size : 1_000000n).toString()), true);
        base.rateBps = rateFromQuote(BigInt(q.amountInRaw), BigInt(q.minAmountOutRaw));
        base.basis = `1Click dry quote ${q.capturedAt}: ${q.amountInRaw} in, at least ${q.minAmountOutRaw} out`;
      } catch (e) {
        base.reasons.push("ROUTE_QUOTE_UNAVAILABLE: " + (e as Error).message);
      }
      return base;
    }),
  );
}

/** Re-quotes each leg of a set at its exact size; the leg's minimum becomes the quote's minimum (one bump if short). */
async function confirmSet(set: CandidateSet, to: string, terms: SourceTerms[]): Promise<CandidateSet> {
  const legs = await Promise.all(
    set.legs.map(async (leg) => {
      const t = terms.find((x) => x.accountId === leg.accountId && x.network === leg.network)!;
      let amount = BigInt(leg.amountRaw);
      for (let tries = 0; tries < 2; tries++) {
        const q = await legQuote(await legRequest(leg.network as LegRequest["network"], leg.address, to, amount.toString()), true);
        const min = BigInt(q.minAmountOutRaw);
        if (min >= BigInt(leg.minNetRaw)) {
          const cost = amount - BigInt(leg.minNetRaw) + (t.gasUsdcRaw ?? 0n);
          return { ...leg, amountRaw: amount.toString(), costsUsdcRaw: cost.toString() };
        }
        amount += sendFor(BigInt(leg.minNetRaw) - min, t.rateBps ?? 100n) + 1n;
        if (amount > t.availableRaw) break;
      }
      return { ...leg, eligible: false, reasons: ["ROUTE_MOVED: the exact-size quote delivers less than planned"] };
    }),
  );
  const bad = legs.flatMap((l) => l.reasons);
  const cost = legs.reduce((n, l) => n + BigInt(l.costsUsdcRaw ?? "0"), 0n);
  return { ...set, legs, eligible: set.eligible && !bad.length, reasons: [...set.reasons, ...bad], costsUsdcRaw: bad.length ? null : cost };
}

export interface MeshEvaluation {
  sets: CandidateSet[];
  funding: Record<string, MultiSourceFunding>;
  /** Choice ids worth offering: the cheapest single source and the mixed set when it is cheaper (or the only way). */
  offered: string[];
  reasons: string[];
}

/** Multi-source alternatives for a plan that needs `requiredRaw` USDC in its NEAR account. */
export async function evaluateMesh(i: { to: string; requiredRaw: bigint; idleRaw: bigint; capabilities: ExecutionCapability[]; prices: PriceEvidence | null }): Promise<MeshEvaluation> {
  const need = i.requiredRaw > i.idleRaw ? i.requiredRaw - i.idleRaw : 0n;
  const empty: MeshEvaluation = { sets: [], funding: {}, offered: [], reasons: [] };
  if (need === 0n) return { ...empty, reasons: ["NOT_NEEDED_IDLE_CASH_COVERS"] };
  const external = i.capabilities.filter((c) => !c.primary && c.chain !== "near");
  if (!external.length) return { ...empty, reasons: ["NO_OTHER_ACCOUNTS: connect another wallet that holds USDC"] };
  if (!(await nearUsdcRegistered(i.to).catch(() => false))) return { ...empty, reasons: ["NEAR_USDC_NOT_REGISTERED: " + i.to + " has no USDC storage yet"] };
  const terms = await sourceTerms(external, need, i.to, i.prices);
  let sets = candidateSets(terms, need);
  const ranked = sets.filter((s) => s.eligible).sort((a, b) => Number(a.costsUsdcRaw! - b.costsUsdcRaw!) || a.legs.length - b.legs.length);
  const single = ranked.find((s) => s.mode === "single");
  const mixed = ranked.find((s) => s.mode === "mixed" && (!single || s.costsUsdcRaw! < single.costsUsdcRaw!));
  const offeredSets = [single, mixed].filter((x): x is CandidateSet => !!x);
  const confirmed = await Promise.all(offeredSets.map((s) => confirmSet(s, i.to, terms).catch((e) => ({ ...s, eligible: false, legs: [], costsUsdcRaw: null, reasons: ["ROUTE_QUOTE_UNAVAILABLE: " + (e as Error).message] }))));
  sets = sets.map((s) => confirmed.find((c) => c.choiceId === s.choiceId) ?? s);
  // Rebuild explanations from the confirmed figures; only offered sets become plan alternatives.
  const shaped = meshFunding({ target: i.to, requiredRaw: i.requiredRaw, idleRaw: i.idleRaw, sources: terms, unusable: external.filter((c) => !c.operations.includes("oneclick_deposit")), capturedAt: new Date().toISOString() });
  const funding: Record<string, MultiSourceFunding> = {};
  for (const c of confirmed.filter((x) => x.eligible)) {
    const f = shaped.funding[c.choiceId];
    if (!f) continue;
    const hold = f.legs.filter((l) => l.operation === "hold");
    const legs = [...hold, ...c.legs];
    funding[c.choiceId] = { ...f, legs, costsUsdcRaw: c.costsUsdcRaw!.toString(), netToTargetRaw: legs.reduce((n, l) => n + BigInt(l.minNetRaw), 0n).toString(), comparison: f.comparison.map((x) => (x.choiceId === c.choiceId ? { ...x, costsUsdcRaw: c.costsUsdcRaw!.toString() } : x)) };
  }
  return { sets, funding, offered: confirmed.map((c) => c.choiceId), reasons: [] };
}

/* ───────────── leg journal: prepare, handoff, check ───────────── */

const HANDOFF_MARGIN_MS = 5 * 60_000;

/** Prepares (or returns) the journal record for one reviewed leg. Every check fails closed. */
export async function prepareLeg(i: { sessionId: string; workspace: Workspace; plan: ActionPlan; step: PlanStep; leg: FundingLeg; generation: number; otherHeldRaw: bigint }): Promise<LegRecord> {
  const { plan, step, leg, workspace: w } = i;
  if (!plan.accountId || plan.accountId !== w.accountId) throw new Error("This plan belongs to a different NEAR account. Nothing was prepared.");
  if (leg.operation !== "oneclick_deposit" || leg.network === "near") throw new Error("Only transfers from another account need a wallet step.");
  const network = leg.network as LegRecord["network"];
  const chain = leg.accountId.split(":")[0] as "evm" | "solana";
  if (!mayRead(w, chain, leg.address)) throw new Error(`${leg.label} is no longer a proven account in this workspace. Nothing was prepared.`);
  const id = "leg:" + (await keyedAttemptId(plan.id, `leg:${step.id}:${i.generation}`));
  const existing = await legGet(i.sessionId, id);
  if (existing) return existing.leg;
  const amount = BigInt(leg.amountRaw);
  // Live balance minus what other plans' unfinished legs hold on this account.
  const balance = await sourceUsdc(network, leg.address);
  if (balance - i.otherHeldRaw < amount)
    throw new Error(`${leg.label} on ${NETWORK_NAME[network]} now has ${fmt(balance)} USDC${i.otherHeldRaw ? ` (${fmt(i.otherHeldRaw)} held by other plans)` : ""}; this leg needs ${fmt(amount)}. Ask again for fresh sources.`);
  await assertGas(network, leg.address);
  if (!(await nearUsdcRegistered(plan.accountId))) throw new Error(plan.accountId + " has no USDC storage, so 1Click can't deliver to it.");
  const quote = await legQuote(await legRequest(network, leg.address, plan.accountId, leg.amountRaw), false);
  if (BigInt(quote.minAmountOutRaw) < BigInt(leg.minNetRaw))
    throw new Error(`The route now guarantees ${fmt(BigInt(quote.minAmountOutRaw))} USDC, below the ${fmt(BigInt(leg.minNetRaw))} you reviewed. Nothing was prepared; ask again for fresh figures.`);
  const tx = await legTransaction(network, leg.address, quote);
  const now = new Date().toISOString();
  const record: LegRecord = {
    id, sessionId: i.sessionId, planId: plan.id, stepId: step.id, legId: leg.id, accountId: leg.accountId, network, from: leg.address, to: plan.accountId,
    amountRaw: leg.amountRaw, reviewedMinNetRaw: leg.minNetRaw, quote, tx, state: "prepared", txHash: null, provider: null, deliveredRaw: null, refundedRaw: null,
    destinationHashes: [], gasRaw: null, gasUsdcRaw: null, timeline: [], createdAt: now, updatedAt: now,
    expiresAt: new Date(Math.min(Date.parse(quote.deadline) - HANDOFF_MARGIN_MS, Date.now() + 25 * 60_000)).toISOString(),
  };
  legNote(record, "prepared", `Live quote: send exactly ${fmt(amount)} USDC from ${NETWORK_NAME[network]} to 1Click's deposit address before ${new Date(quote.deadline).toISOString()}; at least ${fmt(BigInt(quote.minAmountOutRaw))} USDC arrives in ${plan.accountId}.`, now);
  return legInsert(record);
}

const fmt = (raw: bigint) => (Number(raw) / 1e6).toFixed(2);

/** Live USDC on the source (finalized where the chain offers it). Solana is added by its own module. */
export async function sourceUsdc(network: LegRecord["network"], address: string): Promise<bigint> {
  if (network === "solana") return (await import("./solana-funding")).solanaUsdcBalance(address);
  const code = EVM_NETWORK_CODE[network];
  const c = EVM_CHAINS[code];
  if (hexQuantity(await evmRpc(code, "eth_chainId", [])) !== c.chainId) throw new Error("EVM RPC returned the wrong chain.");
  return hexQuantity(await evmRpc(code, "eth_call", [{ to: c.usdc, data: "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0") }, "latest"]));
}

async function assertGas(network: LegRecord["network"], address: string) {
  if (network === "solana") return (await import("./solana-funding")).assertSolFee(address);
  const need = await evmGasNeed(network);
  const have = hexQuantity(await evmRpc(EVM_NETWORK_CODE[network], "eth_getBalance", [address.toLowerCase(), "latest"]));
  if (have < need) throw new Error(`${address} needs about ${(Number(need) / 1e18).toFixed(6)} ETH on ${NETWORK_NAME[network]} for the network fee and holds ${(Number(have) / 1e18).toFixed(6)}. Nothing was prepared.`);
}

async function legTransaction(network: LegRecord["network"], from: string, q: LegQuote): Promise<LegRecord["tx"]> {
  if (network === "solana") return (await import("./solana-funding")).solanaLegTransaction(from, q);
  const tx = transferTx(EVM_NETWORK_CODE[network], from, q.depositAddress!, q.amountInRaw);
  return { kind: "evm", ...tx };
}

/** Single-use: a prepared, unexpired leg moves to awaiting_wallet once and returns the exact request to sign. */
export async function handoffLeg(sessionId: string, id: string): Promise<LegRecord> {
  const got = await legGet(sessionId, id);
  if (!got) throw new Error("That funding leg isn't in your workspace.");
  const { leg, previous } = got;
  if (leg.state !== "prepared") throw new Error(leg.state === "awaiting_wallet" ? "This leg was already handed to your wallet. Check its status instead of sending it again." : `This leg is ${leg.state}; it can't be sent.`);
  if (Date.parse(leg.expiresAt) <= Date.now()) throw new Error("This leg's quote expired before it reached your wallet. Prepare it again for a fresh quote.");
  // A Solana blockhash lives ~60–90 s: the same transfer gets a fresh lifetime at the moment it is handed over.
  if (leg.tx.kind === "solana") leg.tx = await (await import("./solana-funding")).withBlockhash(leg.tx);
  legNote(leg, "awaiting_wallet", "Handed to your wallet for approval.");
  await legSave(leg, previous);
  return leg;
}

export async function attachLeg(sessionId: string, id: string, txHash: string | null): Promise<LegRecord> {
  const got = await legGet(sessionId, id);
  if (!got) throw new Error("That funding leg isn't in your workspace.");
  const { leg, previous } = got;
  if (!["awaiting_wallet", "unknown"].includes(leg.state)) throw new Error(`This leg is ${leg.state}.`);
  if (txHash) {
    const ok = leg.network === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(txHash) : /^0x[0-9a-fA-F]{64}$/.test(txHash);
    if (!ok) throw new Error("Invalid transaction id for " + NETWORK_NAME[leg.network] + ".");
    leg.txHash = txHash;
    legNote(leg, "submitted", "Your wallet sent it. Waiting for 1Click to deliver.");
    await legSave(leg, previous);
    await submitLegDeposit(leg.quote.depositAddress!, txHash, leg.quote.depositMemo);
  } else {
    legNote(leg, "unknown", "Your wallet didn't say whether it sent. FlowVault checks the deposit address with 1Click.");
    await legSave(leg, previous);
  }
  return leg;
}

async function evmReceipt(network: "ethereum" | "base" | "arbitrum", hash: string) {
  const code = EVM_NETWORK_CODE[network];
  const r = await evmRpc(code, "eth_getTransactionReceipt", [hash]);
  if (!r) return null;
  const fin = await evmRpc(code, "eth_getBlockByNumber", ["finalized", false]).catch(() => null);
  const final = !!fin?.number && hexQuantity(fin.number) >= hexQuantity(r.blockNumber);
  return { ok: r.status === "0x1", final, gasRaw: hexQuantity(r.gasUsed) * hexQuantity(r.effectiveGasPrice ?? "0x0") };
}

/** Reconciles a leg from the source receipt and 1Click's report. Returns the outcome for ledger + location. */
export async function checkLeg(sessionId: string, id: string, prices: PriceEvidence | null): Promise<LegRecord> {
  const got = await legGet(sessionId, id);
  if (!got) throw new Error("That funding leg isn't in your workspace.");
  const { leg, previous } = got;
  if (["prepared", "confirmed", "refunded", "failed"].includes(leg.state)) return leg;
  const now = Date.now();
  if (leg.txHash && leg.network !== "solana") {
    const rc = await evmReceipt(leg.network, leg.txHash).catch(() => null);
    if (rc && !rc.ok) {
      leg.gasRaw = rc.gasRaw.toString();
      legNote(leg, "failed", `The transfer reverted on ${NETWORK_NAME[leg.network]}. The USDC stayed in ${leg.from}; only the network fee was spent.`);
      await legSave(leg, previous);
      return leg;
    }
    if (rc) {
      leg.gasRaw = rc.gasRaw.toString();
      const g = gasUsdc("ETH", rc.gasRaw, prices);
      leg.gasUsdcRaw = g === null ? null : g.toString();
    }
  } else if (leg.txHash && leg.network === "solana") {
    const s = await (await import("./solana-funding")).solanaTxOutcome(leg.txHash).catch(() => null);
    if (s?.failed) {
      leg.gasRaw = s.feeRaw;
      legNote(leg, "failed", "The Solana transfer failed. The USDC stayed in " + leg.from + "; only the fee was spent.");
      await legSave(leg, previous);
      return leg;
    }
    if (s) {
      leg.gasRaw = s.feeRaw;
      const g = s.feeRaw ? gasUsdc("SOL", BigInt(s.feeRaw), prices) : null;
      leg.gasUsdcRaw = g === null ? null : g.toString();
    }
  }
  const st = await providerStatus(leg.quote.depositAddress!, leg.quote.depositMemo);
  leg.provider = st.status;
  leg.destinationHashes = st.destinationHashes;
  if (st.status === "SUCCESS" && st.deliveredRaw) {
    leg.deliveredRaw = st.deliveredRaw;
    const short = BigInt(st.deliveredRaw) < BigInt(leg.quote.minAmountOutRaw);
    legNote(leg, "confirmed", `${fmt(BigInt(st.deliveredRaw))} USDC delivered to ${leg.to}${short ? ` — below the quoted minimum ${fmt(BigInt(leg.quote.minAmountOutRaw))}; the plan uses what actually arrived` : ""}.`);
  } else if (st.status === "REFUNDED" || (st.status === "FAILED" && st.refundedRaw)) {
    leg.refundedRaw = st.refundedRaw;
    legNote(leg, "refunded", `1Click refunded ${st.refundedRaw ? fmt(BigInt(st.refundedRaw)) + " " : ""}USDC to ${leg.from}. Nothing was converted.`);
  } else if (st.status === "FAILED" || st.status === "INCOMPLETE_DEPOSIT") {
    legNote(leg, "unknown", st.status === "FAILED" ? "1Click reports the conversion failed; a refund to your source address is pending." : "The deposit arrived smaller than quoted; 1Click refunds it to your source address.");
  } else if (st.status === "PENDING_DEPOSIT" && !leg.txHash && leg.tx.kind === "solana" && leg.state !== "awaiting_wallet" && (await (await import("./solana-funding")).blockhashExpired(leg.tx.lastValidBlockHeight).catch(() => false))) {
    legNote(leg, "failed", "Your wallet never sent it and its transaction expired, so it can't land any more. The USDC is still in " + leg.from + ".");
  } else if (st.status === "PENDING_DEPOSIT" && !leg.txHash && Date.parse(leg.quote.deadline) < now) {
    legNote(leg, "failed", "Nothing arrived at the deposit address before its deadline, so nothing was sent. The USDC is still in " + leg.from + ".");
  } else if (st.status === "KNOWN_DEPOSIT_TX" || st.status === "PROCESSING" || (st.status === "PENDING_DEPOSIT" && leg.txHash)) {
    legNote(leg, "submitted", st.status === "PROCESSING" ? "1Click is converting and delivering it." : "1Click sees the transfer; waiting for confirmations.");
  }
  await legSave(leg, previous);
  return leg;
}

export function outcomeOf(leg: LegRecord): LegOutcome {
  return {
    state: leg.state, amountInRaw: leg.amountRaw, depositAddress: leg.quote.depositAddress, deadline: leg.quote.deadline, txHash: leg.txHash, provider: leg.provider,
    deliveredRaw: leg.deliveredRaw, refundedRaw: leg.refundedRaw, destinationHashes: leg.destinationHashes, gasRaw: leg.gasRaw, gasUsdcRaw: leg.gasUsdcRaw, at: leg.updatedAt,
  };
}

/** What the browser needs to hand one prepared leg to the source's wallet (no secrets; the request is exact). */
export async function legPreparation(sessionId: string, id: string, planAccount: string | null) {
  const got = await legGet(sessionId, id);
  if (!got) throw new Error("That funding leg isn't in your workspace.");
  const l = got.leg;
  return {
    kind: "fund_transfer" as const,
    attemptId: l.id,
    accountId: planAccount ?? l.to,
    signer: l.accountId,
    network: l.network,
    from: l.from,
    to: l.to,
    tx: l.tx,
    depositAddress: l.quote.depositAddress,
    amountRaw: l.amountRaw,
    minOutRaw: l.quote.minAmountOutRaw,
    deadline: l.quote.deadline,
    expiresAt: l.expiresAt,
  };
}

/** The wallet refused (user rejection: nothing was broadcast), so the leg may be offered again until it expires. */
export async function declineLeg(sessionId: string, id: string): Promise<LegRecord> {
  const got = await legGet(sessionId, id);
  if (!got) throw new Error("That funding leg isn't in your workspace.");
  const { leg, previous } = got;
  if (leg.state !== "awaiting_wallet") throw new Error(`This leg is ${leg.state}.`);
  legNote(leg, "prepared", "You declined in your wallet. Nothing was sent; you can approve it again before it expires.");
  await legSave(leg, previous);
  return leg;
}
