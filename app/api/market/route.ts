import { session, json, failure } from "@/lib/flowvault/store";
import { liveMarket } from "@/lib/flowvault/near";
import { demoMarket } from "@/lib/flowvault/seed";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    return json(
      s.workspace.mode === "demo" ? demoMarket() : await liveMarket(),
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
