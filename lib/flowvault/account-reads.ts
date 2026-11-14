/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC response bodies */
// Reads for every account you have proven is yours (owner: Interface, multi-wallet A2). One section per account
// and network, each independently observed or unavailable, never zero-filled. Positions carry their own
// accountId, so the capital engine never counts another account's USDC as spendable from the main NEAR account.
import { decimal } from "./money.ts";
import { EVM_CHAINS, evmRpc, hexQuantity } from "./evm.ts";
import { readPortfolio } from "./near.ts";
import { proven, shortAddress } from "./account-registry.ts";
import { base58Decode, base58Encode } from "./account-proof.ts";
import { sha256 } from "@noble/hashes/sha2";
import { ed25519 } from "@noble/curves/ed25519";
import { readZerionWallet, zerionKey, type ZerionRead } from "./zerion.ts";
import type { LinkedAccount, NftHolding, Portfolio, PortfolioSection, Position, Workspace } from "./types.ts";

type Section = PortfolioSection;
export interface AccountReads {
  positions: Position[];
  sections: Section[];
  nfts: NftHolding[];
}
/** Without a Zerion key only FlowVault's own reads run, so the EVM total is said to be partial, never complete. */
export const EVM_COVERAGE_GAP =
  "Only ETH and USDC on Ethereum, Base and Arbitrum are read. Other tokens, chains, DeFi positions and NFTs need the Zerion API (server setting ZERION_API_KEY).";
const NET = ["netWorth"] as Section["affects"];
const EVM_NETS = [
  ["ethereum", "eth", "Ethereum"],
  ["base", "base", "Base"],
  ["arbitrum", "arb", "Arbitrum"],
] as const;

/* ───────────── EVM ───────────── */

/** ETH and USDC on one network at a finalized block. `skipUsdc` when an older reader already covers it. */
export async function readEvmNetwork(chain: "eth" | "base" | "arb", address: string, skipUsdc: boolean, rpc = evmRpc): Promise<Position[]> {
  const c = EVM_CHAINS[chain];
  if (hexQuantity(await rpc(chain, "eth_chainId", [])) !== c.chainId) throw new Error("EVM RPC returned the wrong chain.");
  const block = await rpc(chain, "eth_getBlockByNumber", ["finalized", false]);
  if (!block?.number || !block.hash) throw new Error("Finalized EVM block unavailable.");
  const addr = address.toLowerCase();
  const name = chain === "eth" ? "Ethereum" : chain === "base" ? "Base" : "Arbitrum";
  const common = {
    kind: "wallet" as const,
    chain,
    venue: "wallet",
    accountId: addr,
    source: "live" as const,
    capturedAt: new Date().toISOString(),
    availableAt: new Date().toISOString(),
    blockHeight: hexQuantity(block.number).toString(),
    blockHash: block.hash,
  };
  const [eth, usdc, precision] = await Promise.all([
    rpc(chain, "eth_getBalance", [addr, block.number]),
    skipUsdc ? null : rpc(chain, "eth_call", [{ to: c.usdc, data: "0x70a08231" + addr.slice(2).padStart(64, "0") }, block.number]),
    skipUsdc ? null : rpc(chain, "eth_call", [{ to: c.usdc, data: "0x313ce567" }, block.number]),
  ]);
  const out: Position[] = [];
  const wei = hexQuantity(eth);
  out.push({ ...common, id: `${chain}-eth-${addr}`, label: `${name} ETH`, asset: "ETH", amount: decimal(wei, 18), rawAmount: wei.toString(), decimals: 18 } as Position);
  if (!skipUsdc) {
    if (hexQuantity(precision) !== 6n) throw new Error("USDC precision does not match this adapter.");
    const raw = hexQuantity(usdc);
    out.push({ ...common, id: `${chain}-usdc-${addr}`, label: `${name} wallet USDC`, asset: "USDC", amount: decimal(raw), rawAmount: raw.toString(), decimals: 6 } as Position);
  }
  return out;
}

/* ───────────── Solana ───────────── */

export const SOLANA = {
  // Keyless public endpoint for plain account reads. Solana Foundation's api.mainnet-beta blocks Cloudflare
  // Workers, and keyless endpoints refuse indexed calls (getTokenAccountsByOwner) without a token.
  rpc: "https://solana-rpc.publicnode.com",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ataProgram: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

/** Server setting SOLANA_RPC_URL (a keyed provider): enables the full token-account scan. */
async function solanaRpcUrl(): Promise<string | null> {
  try {
    const { env } = (await import("cloudflare:workers")) as unknown as { env: Record<string, unknown> };
    const v = env?.SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL;
    return typeof v === "string" && /^https:\/\//.test(v) ? v : null;
  } catch {
    return typeof process !== "undefined" && /^https:\/\//.test(process.env.SOLANA_RPC_URL ?? "") ? process.env.SOLANA_RPC_URL! : null;
  }
}

export async function solanaRpc(method: string, params: unknown[], url?: string) {
  const target = url ?? (await solanaRpcUrl()) ?? SOLANA.rpc;
  const r = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "flowvault", method, params }),
    signal: AbortSignal.timeout(7000),
  });
  const body = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || body.error || !("result" in body)) throw new Error("Solana RPC read unavailable: " + (body.error?.message ?? "HTTP " + r.status));
  return body.result;
}

/** Program-derived address (Solana's findProgramAddress): the first bump whose hash is off the ed25519 curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: string) {
  const program = base58Decode(programId);
  const tag = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(Uint8Array.from([...seeds.flatMap((x) => [...x]), bump, ...program, ...tag]));
    try {
      ed25519.ExtendedPoint.fromHex(h);
    } catch {
      return base58Encode(h);
    }
  }
  throw new Error("No program address found.");
}
/** The owner's associated USDC token account: where wallets keep USDC. */
export const usdcTokenAccount = (owner: string) =>
  findProgramAddress([base58Decode(owner), base58Decode(SOLANA.tokenProgram), base58Decode(SOLANA.usdcMint)], SOLANA.ataProgram);

/**
 * SOL and USDC at finalized commitment, on mainnet only. USDC is read from the associated token account (no
 * account yet = 0 USDC, which is a fact). With SOLANA_RPC_URL set, every USDC token account is summed instead.
 */
export async function readSolana(address: string, rpc: (method: string, params: unknown[]) => Promise<any> = solanaRpc, fullScan?: boolean): Promise<Position[]> {
  if ((await rpc("getGenesisHash", [])) !== SOLANA.genesis) throw new Error("Solana RPC is not mainnet.");
  const cfg = { commitment: "finalized" };
  const scan = fullScan ?? !!(await solanaRpcUrl());
  const ata = usdcTokenAccount(address);
  const [bal, tokens] = await Promise.all([
    rpc("getBalance", [address, cfg]),
    scan
      ? rpc("getTokenAccountsByOwner", [address, { mint: SOLANA.usdcMint }, { ...cfg, encoding: "jsonParsed" }]).then((r: any) => r?.value ?? [])
      : rpc("getAccountInfo", [ata, { ...cfg, encoding: "jsonParsed" }]).then((r: any) => (r?.value ? [{ account: r.value }] : [])),
  ]);
  const lamports = BigInt(bal?.value ?? NaN);
  let usdc = 0n;
  for (const t of tokens) {
    const info = t.account?.data?.parsed?.info;
    if (info?.mint !== SOLANA.usdcMint || info?.owner !== address || info?.tokenAmount?.decimals !== 6) throw new Error("USDC token account unverified.");
    usdc += BigInt(info.tokenAmount.amount);
  }
  const common = {
    kind: "wallet" as const,
    chain: "solana" as const,
    venue: "wallet",
    accountId: address,
    source: "live" as const,
    capturedAt: new Date().toISOString(),
    availableAt: new Date().toISOString(),
    blockHeight: String(bal?.context?.slot ?? ""),
  };
  return [
    { ...common, id: `solana-sol-${address}`, label: "Solana SOL", asset: "SOL", amount: decimal(lamports, 9), rawAmount: lamports.toString(), decimals: 9 } as Position,
    {
      ...common,
      id: `solana-usdc-${address}`,
      label: scan ? "Solana wallet USDC" : "Solana wallet USDC (main token account)",
      asset: "USDC",
      amount: decimal(usdc),
      rawAmount: usdc.toString(),
      decimals: 6,
    } as Position,
  ];
}

/* ───────────── every proven account ───────────── */

export interface Readers {
  evm: typeof readEvmNetwork;
  solana: typeof readSolana;
  near: (account: string) => Promise<Portfolio>;
  /** Stream C: Hyperliquid margin account of a proven EVM address (collateral; positive uPnL excluded). */
  hyperliquid?: (address: string, accountId: string) => Promise<Position[]>;
  /** Whole-wallet read (every chain, token, DeFi position, NFT). null = not configured. */
  zerion?: (address: string, opts: { hyperliquid: boolean }) => Promise<ZerionRead | null>;
}
async function readHyperliquid(address: string, accountId: string): Promise<Position[]> {
  const { parseClearinghouse, perpPortfolioPositions, HL_API } = await import("./hyperliquid.ts");
  const r = await fetch(HL_API + "/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "clearinghouseState", user: address.toLowerCase() }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Hyperliquid read failed: " + r.status);
  return perpPortfolioPositions(parseClearinghouse(address, await r.json()), accountId);
}
async function readZerion(address: string, opts: { hyperliquid: boolean }) {
  const key = await zerionKey();
  return key ? readZerionWallet(address, { key, hyperliquid: opts.hyperliquid, budgetMs: 7500 }) : null;
}
const DEFAULT: Readers = { evm: readEvmNetwork, solana: readSolana, near: readPortfolio, hyperliquid: readHyperliquid, zerion: readZerion };

/**
 * Everything the older readers don't cover: the main NEAR account and the first EVM account's Base/Arbitrum
 * USDC are read by portfolio-service; this reads the rest of every proven account. A failed read becomes an
 * "unavailable" section (net worth then says what is missing); it is never shown as zero.
 */
export async function readProvenAccounts(w: Workspace, readers: Readers = DEFAULT): Promise<AccountReads> {
  const out: AccountReads = { positions: [], sections: [], nfts: [] };
  const now = () => new Date().toISOString();
  const jobs: Promise<void>[] = [];
  const run = (id: string, label: string, work: () => Promise<Position[]>) =>
    jobs.push(
      work().then(
        (rows) => {
          out.positions.push(...rows);
          out.sections.push({ id, status: "observed", capturedAt: now(), reasons: [], positionIds: rows.map((r) => r.id), affects: NET });
        },
        (e) => {
          out.sections.push({ id, status: "unavailable", capturedAt: now(), reasons: [label + ": " + (e instanceof Error ? e.message : String(e))], positionIds: [], affects: NET });
        },
      ),
    );
  for (const a of (w.accounts ?? []).filter(proven) as LinkedAccount[]) {
    if (a.chain === "evm")
      for (const [net, chain, name] of EVM_NETS) {
        if (!a.networks.includes(net)) continue;
        const legacyUsdc = (chain === "base" && w.evmAddresses?.base === a.address) || (chain === "arb" && w.evmAddresses?.arb === a.address);
        run(`acct:${a.id}:${chain}`, `${shortAddress(a.label)} on ${name}`, () => readers.evm(chain, a.address, legacyUsdc));
      }
    if (a.chain === "evm") {
      const id = `acct:${a.id}:all`, label = `${shortAddress(a.label)} on every chain`;
      if (!readers.zerion)
        out.sections.push({ id, status: "partial", capturedAt: now(), reasons: [EVM_COVERAGE_GAP], positionIds: [], affects: NET });
      else {
        const z = readers.zerion, hl = !!readers.hyperliquid;
        jobs.push(
          z(a.address, { hyperliquid: hl }).then(
            (r) => {
              if (!r) {
                out.sections.push({ id, status: "partial", capturedAt: now(), reasons: [EVM_COVERAGE_GAP], positionIds: [], affects: NET });
                return;
              }
              out.positions.push(...r.positions);
              out.nfts.push(...r.nfts);
              out.sections.push({ id, status: "observed", capturedAt: now(), reasons: r.notes, positionIds: r.positions.map((p) => p.id), affects: NET });
            },
            (e) => {
              out.sections.push({ id, status: "unavailable", capturedAt: now(), reasons: [label + ": " + (e instanceof Error ? e.message : String(e))], positionIds: [], affects: NET });
            },
          ),
        );
      }
    }
    if (a.chain === "evm" && readers.hyperliquid) {
      const hl = readers.hyperliquid;
      run(`acct:${a.id}:hyperliquid`, `${shortAddress(a.label)} on Hyperliquid`, () => hl(a.address, a.id));
    }
    else if (a.chain === "solana") run(`acct:${a.id}`, `${shortAddress(a.label)} on Solana`, () => readers.solana(a.address));
    else if (a.chain === "near" && !a.primary)
      run(`acct:${a.id}`, a.label, async () => {
        const p = await readers.near(a.address);
        // Prefixed ids and an explicit accountId: another NEAR account's funds are never the main account's.
        return p.positions.map((x) => ({ ...x, id: `acct:${a.address}:${x.id}`, accountId: a.address, label: a.label + " · " + x.label }));
      });
  }
  await Promise.all(jobs);
  out.sections.sort((x, y) => x.id.localeCompare(y.id));
  return out;
}
