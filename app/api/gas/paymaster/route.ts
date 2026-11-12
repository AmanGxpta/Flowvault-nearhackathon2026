// ERC-7677 paymaster service (owner: Stream A). Called by the user's wallet (no cookies) while it builds the
// smart-account operation for wallet_sendCalls. Answers pm_getPaymasterStubData / pm_getPaymasterData with Circle
// Paymaster and the owner-signed bounded permit — only for the op named in `context` (id + secret token), on the
// right chain and a Circle EntryPoint, from the permit's owner, containing exactly the reviewed USDC transfer.
import { opGet, opSave } from "@/lib/flowvault/gas-abstraction-live";
import { PAYMASTER_POSTOP_GAS, PAYMASTER_VERIFICATION_GAS, checkSponsoredOp, paymasterData } from "@/lib/flowvault/gas-abstraction";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const reply = (id: unknown, body: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...body }), { headers: { "content-type": "application/json", ...CORS } });
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(r: Request) {
  let id: unknown = null;
  try {
    const req = (await r.json()) as { id?: unknown; method?: string; params?: unknown[] };
    id = req.id;
    if (req.method !== "pm_getPaymasterStubData" && req.method !== "pm_getPaymasterData") return reply(id, { error: { code: -32601, message: "Method not found" } });
    const [userOp, entryPoint, chainId, context] = (req.params ?? []) as [Record<string, unknown>, string, string, { opId?: string; token?: string }];
    const got = context?.opId ? await opGet(String(context.opId)) : null;
    if (!got || !same(String(context?.token ?? ""), got.op.token)) return reply(id, { error: { code: -32602, message: "Unknown or unauthorized operation." } });
    const { op, previous } = got;
    if (!["permitted", "sponsored"].includes(op.state) || !op.permit.signature) return reply(id, { error: { code: -32602, message: "This fee payment isn't open." } });
    if (Date.parse(op.expiresAt) <= Date.now()) return reply(id, { error: { code: -32602, message: "This fee payment expired. Start again." } });
    const pm = checkSponsoredOp({ network: op.network, owner: op.owner, depositAddress: op.depositAddress, amountRaw: op.amountRaw, userOp, entryPoint, chainId });
    if (pm.paymaster !== op.permit.spender) return reply(id, { error: { code: -32602, message: "The wallet uses an EntryPoint whose Circle paymaster this permit doesn't cover. Pay the fee in ETH." } });
    const data = paymasterData(op.network, op.permit.valueRaw, op.permit.signature);
    if (op.state === "permitted") {
      op.state = "sponsored";
      await opSave(op, previous).catch(() => undefined);
    }
    const result =
      req.method === "pm_getPaymasterStubData"
        ? { paymaster: pm.paymaster, paymasterData: data, paymasterVerificationGasLimit: "0x" + PAYMASTER_VERIFICATION_GAS.toString(16), paymasterPostOpGasLimit: "0x" + PAYMASTER_POSTOP_GAS.toString(16), isFinal: true, sponsor: { name: "Paid in your own USDC via Circle Paymaster" } }
        : { paymaster: pm.paymaster, paymasterData: data, paymasterVerificationGasLimit: "0x" + PAYMASTER_VERIFICATION_GAS.toString(16), paymasterPostOpGasLimit: "0x" + PAYMASTER_POSTOP_GAS.toString(16) };
    return reply(id, { result });
  } catch (e) {
    return reply(id, { error: { code: -32602, message: e instanceof Error ? e.message : "Invalid request." } });
  }
}
