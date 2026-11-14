// NEAR AI Cloud client for the Ask FlowVault conversation loop. NEAR AI Cloud speaks the OpenAI Chat Completions
// format (https://cloud-api.near.ai/v1/chat/completions, Bearer key, SSE streaming, function tools); the loop in
// chat-agent.ts is written against a small message/tool-block surface. This adapter translates both ways so the
// loop, its bounds and its tool fencing stay exactly as they are. It never adds tools, never retries a spend and
// never sees anything the loop didn't pass it.
import type { ChatClient } from "./chat-agent.ts";

export const NEARAI_BASE_URL = "https://cloud-api.near.ai/v1/";

/** A failed NEAR AI Cloud call, with the HTTP status when there was one (0 = network, -1 = timeout). */
export class NearAiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = "NearAiError"; this.status = status; }
}

type Block = { type: string; [k: string]: unknown };
type LoopMessage = { role: "user" | "assistant"; content: unknown };
type ToolDef = { name: string; description?: string; input_schema: Record<string, unknown> };
type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** The provider endpoint, refusing credentials, query strings and plain HTTP (same rules as the intent parser). */
export function chatCompletionsUrl(baseUrl?: string) {
  const root = new URL(baseUrl || NEARAI_BASE_URL);
  if (root.username || root.password || root.search || root.hash) throw new Error("NEAR AI base URL must not contain credentials or query parameters.");
  if (root.protocol !== "https:") throw new Error("NEAR AI base URL must use HTTPS.");
  root.pathname = root.pathname.replace(/\/?$/, "/");
  return new URL("chat/completions", root).toString();
}

const textOf = (content: unknown) => typeof content === "string" ? content
  : Array.isArray(content) ? (content as Block[]).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n\n") : "";

/** The loop's messages (text, tool_use and tool_result blocks) as Chat Completions messages. */
export function toOpenAiMessages(system: string, messages: LoopMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? (m.content as Block[]) : null;
    if (m.role === "assistant") {
      const calls = (blocks ?? []).filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), type: "function" as const, function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      const text = textOf(m.content);
      out.push(calls.length ? { role: "assistant", content: text || null, tool_calls: calls } : { role: "assistant", content: text });
      continue;
    }
    const results = (blocks ?? []).filter((b) => b.type === "tool_result");
    for (const r of results) out.push({ role: "tool", tool_call_id: String(r.tool_use_id), content: typeof r.content === "string" ? r.content : JSON.stringify(r.content ?? "") });
    const text = textOf(m.content);
    if (text || !results.length) out.push({ role: "user", content: text });
  }
  return out;
}

export const toOpenAiTools = (tools: ToolDef[]) => tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));

/** Arguments the model streamed; unparseable JSON becomes an object the strict tool schemas reject (nothing runs). */
function parseArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return { _unparsedArguments: raw.slice(0, 500) }; }
}

/** A ChatClient backed by NEAR AI Cloud. `fetcher` is injectable for tests. */
export function nearAiChatClient(o: { key: string; baseUrl?: string; timeoutMs?: number; fetcher?: typeof fetch }): ChatClient {
  const url = chatCompletionsUrl(o.baseUrl);
  const fetcher = o.fetcher ?? fetch;
  return {
    messages: {
      stream(body, options) {
        const handlers: ((d: string) => void)[] = [];
        const run = async () => {
          const timeout = AbortSignal.timeout(o.timeoutMs ?? 60_000);
          const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
          const request = {
            model: body.model,
            messages: toOpenAiMessages(String(body.system ?? ""), (body.messages ?? []) as LoopMessage[]),
            ...(Array.isArray(body.tools) && body.tools.length ? { tools: toOpenAiTools(body.tools as ToolDef[]), tool_choice: "auto" } : {}),
            max_tokens: body.max_tokens,
            stream: true,
          };
          let res: Response;
          try {
            res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer " + o.key }, body: JSON.stringify(request), signal, redirect: "manual" });
          } catch (e) {
            if (options?.signal?.aborted) throw e;
            if (timeout.aborted) throw new NearAiError(-1, "NEAR AI Cloud took too long to answer.");
            throw new NearAiError(0, "Couldn't reach NEAR AI Cloud: " + String((e as Error)?.message ?? e).slice(0, 120));
          }
          // Workers' fetch has no redirect: "error"; a redirect is refused here instead of followed with the key.
          if (res.status >= 300 && res.status < 400 || res.type === "opaqueredirect") throw new NearAiError(502, "NEAR AI Cloud answered with a redirect; refused.");
          if (!res.ok) {
            const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
            throw new NearAiError(res.status, `NEAR AI Cloud HTTP ${res.status}${detail ? ": " + detail : ""}`);
          }
          let text = "", model = String(body.model ?? ""), finish: string | null = null;
          const calls: { id: string; name: string; args: string }[] = [];
          const onData = (data: string) => {
            if (data === "[DONE]") return;
            let chunk: { model?: string; error?: { message?: string }; choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
            try { chunk = JSON.parse(data); } catch { return; }
            if (chunk.error) throw new NearAiError(502, "NEAR AI Cloud stream error: " + String(chunk.error.message ?? "unknown").slice(0, 160));
            if (chunk.model) model = chunk.model;
            const choice = chunk.choices?.[0];
            if (!choice) return;
            const d = choice.delta ?? {};
            if (typeof d.content === "string" && d.content) { text += d.content; for (const h of handlers) h(d.content); }
            for (const tc of d.tool_calls ?? []) {
              const i = tc.index ?? calls.length;
              const c = (calls[i] ??= { id: "", name: "", args: "" });
              if (tc.id) c.id = tc.id;
              if (tc.function?.name) c.name += tc.function.name;
              if (tc.function?.arguments) c.args += tc.function.arguments;
            }
            if (choice.finish_reason) finish = choice.finish_reason;
          };
          if (!res.body) throw new NearAiError(502, "NEAR AI Cloud returned no stream.");
          const reader = res.body.getReader(), decoder = new TextDecoder();
          let buf = "";
          try {
            for (;;) {
              const { done, value } = await reader.read();
              buf += decoder.decode(value, { stream: !done });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
                if (line.startsWith("data:")) onData(line.slice(5).trim());
              }
              if (done) break;
            }
            if (buf.startsWith("data:")) onData(buf.slice(5).trim());
          } catch (e) {
            if (options?.signal?.aborted || e instanceof NearAiError) throw e;
            if (timeout.aborted) throw new NearAiError(-1, "NEAR AI Cloud took too long to answer.");
            throw e;
          }
          const used = calls.filter((c) => c.name);
          const content: Block[] = [];
          if (text) content.push({ type: "text", text });
          used.forEach((c, i) => content.push({ type: "tool_use", id: c.id || `call_${i}`, name: c.name, input: parseArgs(c.args) }));
          const stop_reason = used.length ? "tool_use" : finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : "end_turn";
          return { content: content as never, stop_reason, model };
        };
        let pending: ReturnType<typeof run> | null = null;
        return {
          on(_event: "text", cb: (delta: string) => void) { handlers.push(cb); return this; },
          finalMessage() { return (pending ??= run()); },
        };
      },
    },
  };
}
