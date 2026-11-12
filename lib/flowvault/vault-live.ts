// Vault contract reads over NEAR RPC (owner: Stream A). Final-finality views only; nothing is signed or sent.
// Each view is a separate RPC call, so values can come from adjacent blocks; the adapter's reconciliation names any
// inconsistency instead of hiding it.
import { rpc, view } from "./near";
import { snapshotFrom, wasmExports, type AccountView, type ConfigView, type NavView, type OperatorView, type RequestView, type VaultSnapshot } from "./vault-contract";

const PAGE = 100;
const MAX_PAGES = 5;

export async function vaultConfig(contractId: string): Promise<ConfigView> {
  let c: ConfigView;
  try {
    c = (await view<ConfigView>(contractId, "get_config")).data;
  } catch (e) {
    const why = String((e as Error).message ?? e);
    // A transport failure is not evidence about the account; anything else means it isn't a vault.
    if (/fetch|network|timeout|timed out|abort|unavailable|429|5\d\d/i.test(why)) throw new Error(`Couldn't reach NEAR to read ${contractId}. Try again.`);
    throw new Error(`${contractId} doesn't answer as a FlowVault vault (get_config).`);
  }
  if (!c || typeof c !== "object" || !c.owner_id || c.virtual_shares_raw === undefined || c.share_decimals === undefined) throw new Error(`${contractId} doesn't answer as a FlowVault vault (get_config).`);
  return c;
}

async function allRequests(contractId: string): Promise<RequestView[]> {
  const out: RequestView[] = [];
  let from = "0";
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = (await view<RequestView[]>(contractId, "get_requests", { from_index: from, limit: PAGE })).data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
    from = (BigInt(page[page.length - 1].id) + 1n).toString();
  }
  return out;
}

/** The account's full-access keys at a final block (who can replace the code), or null when the read fails. */
export async function fullAccessKeys(accountId: string): Promise<string[] | null> {
  try {
    const r = await rpc({ request_type: "view_access_key_list", account_id: accountId });
    return ((r?.keys ?? []) as { public_key: string; access_key: { permission: unknown } }[]).filter((k) => k.access_key?.permission === "FullAccess").map((k) => k.public_key);
  } catch {
    return null;
  }
}

/** Function names the deployed wasm exports. */
export async function codeExports(accountId: string): Promise<string[]> {
  const r = await rpc({ request_type: "view_code", account_id: accountId });
  if (!r?.code_base64) throw new Error(`${accountId} has no contract code.`);
  return wasmExports(Uint8Array.from(atob(r.code_base64), (c) => c.charCodeAt(0)));
}

/** Everything publish verification reads from the chain (never from the client). */
export async function deploymentEvidence(contractId: string) {
  const [configView, exports, keys] = await Promise.all([vaultConfig(contractId), codeExports(contractId), fullAccessKeys(contractId)]);
  if (keys === null) throw new Error("Couldn't read the vault account's access keys; publishing waits until they can be checked.");
  return { contractId, configView: configView as unknown as Record<string, unknown>, exports, fullAccessKeys: keys };
}

export async function readVault(contractId: string, mine: string[], now = Date.now()): Promise<VaultSnapshot> {
  const [config, nav, requests, operator, keys] = await Promise.all([
    vaultConfig(contractId),
    view<NavView>(contractId, "get_nav").then((r) => r.data),
    allRequests(contractId),
    view<OperatorView>(contractId, "get_operator").then((r) => r.data).catch(() => null),
    fullAccessKeys(contractId),
  ]);
  const ids = [...new Set([...mine, config.owner_id, config.curator_id, config.platform_id])];
  const accounts = await Promise.all(ids.map((a) => view<AccountView>(contractId, "get_account", { account_id: a }).then((r) => r.data)));
  return snapshotFrom({ contractId, source: "live", config, nav, requests, accounts, mine, operator, fullAccessKeys: keys, now });
}
