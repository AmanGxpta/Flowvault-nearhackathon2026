import { session, json, failure } from "@/lib/flowvault/store";
import { stakingOptions } from "@/lib/flowvault/staking-options";
import { nearAddress } from "@/lib/flowvault/accounts";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const pool = new URL(r.url).searchParams.get("pool") ?? undefined;
    if (pool) nearAddress.parse(pool);
    return json(await stakingOptions(s.workspace, pool), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
