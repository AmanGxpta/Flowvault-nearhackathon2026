import { session, json, failure } from "@/lib/flowvault/store";
import { stakingValidators } from "@/lib/flowvault/staking-options";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(await stakingValidators(s.workspace), s.cookie);
  } catch (e) {
    return failure(e);
  }
}
