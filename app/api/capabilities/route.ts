// Execution capabilities (owner: Stream A; engine in lib/flowvault/capabilities.ts).
//   GET → one ExecutionCapability per proven account × network (assets, what is free after other plans'
//         reservations, signing method, gas need, supported operations, and why anything is unavailable),
//         plus the reservations themselves. "connected" is null here: only the browser knows which wallet can sign.
import { session, json, failure } from "@/lib/flowvault/store";
import { capabilitySnapshot } from "@/lib/flowvault/funding-mesh-plans";

export async function GET(r: Request) {
  try {
    const s = await session(r);
    if (s.workspace.mode !== "live") return json({ source: "demo", capabilities: [], reservations: [], note: "The example workspace's accounts are fictional; nothing can be moved." }, s.cookie);
    const { capabilities, reservations } = await capabilitySnapshot(s);
    return json({ source: "live", capabilities, reservations, capturedAt: new Date().toISOString() }, s.cookie);
  } catch (e) {
    return failure(e);
  }
}
