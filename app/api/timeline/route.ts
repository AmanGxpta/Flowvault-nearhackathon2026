import { session, json, failure } from "@/lib/flowvault/store";
import { listAttempts, readAttempt } from "@/lib/flowvault/attempts";
import { syncTimeline } from "@/lib/flowvault/timeline";
export async function GET(r: Request) {
  try {
    const s = await session(r);
    const id = new URL(r.url).searchParams.get("attemptId");
    const attempts = id
      ? [(await readAttempt(s.id, id)).attempt]
      : await listAttempts(s.id);
    return json(
      {
        source: s.workspace.mode,
        fictional: s.workspace.mode === "demo",
        attempts: attempts.map((a) => {
          syncTimeline(a, a);
          return {
            id: a.id,
            kind: a.kind,
            accountId: a.accountId,
            state: a.state,
            timeline: a.timeline,
            retainedSignedQuote: a.retainedSignedQuote ?? null,
            verificationEvidence: a.verificationEvidence ?? [],
          };
        }),
      },
      s.cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
