import test from "node:test";
import assert from "node:assert/strict";
import { nearAiChatClient, toOpenAiMessages, chatCompletionsUrl, NearAiError } from "../lib/flowvault/nearai-chat.ts";
import { runChat, type ChatEvent } from "../lib/flowvault/chat-agent.ts";
import type { ChatReads, ToolContext } from "../lib/flowvault/chat-tools.ts";

const sse = (chunks: unknown[], split = 7) => {
  const raw = chunks.map((c) => "data: " + (typeof c === "string" ? c : JSON.stringify(c)) + "\n\n").join("");
  // Deliver in awkward slices so lines straddle reads.
  const parts: string[] = []; for (let i = 0; i < raw.length; i += split) parts.push(raw.slice(i, i + split));
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
};
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({ model: "anthropic/claude-haiku-5-5", choices: [{ index: 0, delta: d, finish_reason: finish }] });

test("NEAR AI base URL: default endpoint, no credentials, query strings or plain HTTP", () => {
  assert.equal(chatCompletionsUrl(), "https://cloud-api.near.ai/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://cloud-api.near.ai/v1"), "https://cloud-api.near.ai/v1/chat/completions");
  assert.throws(() => chatCompletionsUrl("https://u:p@example.com/v1"), /credentials/);
  assert.throws(() => chatCompletionsUrl("https://example.com/v1?x=1"), /credentials or query/);
  assert.throws(() => chatCompletionsUrl("http://example.com/v1"), /HTTPS/);
});

test("loop messages become Chat Completions messages (tool calls and tool results paired by id)", () => {
  const out = toOpenAiMessages("SYS", [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: [{ type: "text", text: "<app_context>{}</app_context>" }, { type: "text", text: "swap" }] },
    { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "c1", name: "get_holdings", input: { show: true } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "{\"ok\":1}" }] },
  ]);
  assert.deepEqual(out.map((m) => m.role), ["system", "user", "assistant", "user", "assistant", "tool"]);
  assert.equal((out[3] as { content: string }).content, "<app_context>{}</app_context>\n\nswap");
  const a = out[4] as { content: string; tool_calls: { id: string; function: { name: string; arguments: string } }[] };
  assert.equal(a.content, "Checking.");
  assert.deepEqual(a.tool_calls.map((c) => [c.id, c.function.name, JSON.parse(c.function.arguments).show]), [["c1", "get_holdings", true]]);
  assert.deepEqual(out[5], { role: "tool", tool_call_id: "c1", content: "{\"ok\":1}" });
});

test("streams text, assembles split tool-call arguments and maps finish reasons; the key never leaves the header", async () => {
  let req: { url: string; init: RequestInit } | null = null;
  const client = nearAiChatClient({ key: "TEST_KEY_NOT_REAL", fetcher: (async (url: string, init: RequestInit) => {
    req = { url, init };
    return sse([delta({ content: "Let me " }), delta({ content: "look." }),
      delta({ tool_calls: [{ index: 0, id: "call_a", function: { name: "draft_swap", arguments: "{\"from\":\"ETH\"," } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: "\"to\":\"NEAR\"}" } }] }, "tool_calls"), "[DONE]"]);
  }) as unknown as typeof fetch });
  const s = client.messages.stream({ model: "anthropic/claude-haiku-5-5", system: "S", max_tokens: 100, messages: [{ role: "user", content: "x" }], tools: [{ name: "draft_swap", description: "d", input_schema: { type: "object" } }] });
  const seen: string[] = []; s.on("text", (d) => seen.push(d));
  const m = await s.finalMessage();
  assert.deepEqual(seen, ["Let me ", "look."]);
  assert.equal(m.stop_reason, "tool_use");
  assert.equal(m.model, "anthropic/claude-haiku-5-5");
  assert.deepEqual(m.content, [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "call_a", name: "draft_swap", input: { from: "ETH", to: "NEAR" } }]);
  const body = JSON.parse(String(req!.init.body));
  assert.equal(req!.url, "https://cloud-api.near.ai/v1/chat/completions");
  assert.equal((req!.init.headers as Record<string, string>).Authorization, "Bearer TEST_KEY_NOT_REAL");
  assert.equal(body.stream, true);
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].function.name, "draft_swap");
  assert.ok(!JSON.stringify(body).includes("TEST_KEY_NOT_REAL"));
});

test("length and content filter map to max_tokens and refusal; unparseable tool arguments can't pass as empty input", async () => {
  const run = async (chunks: unknown[]) => nearAiChatClient({ key: "k", fetcher: (async () => sse(chunks)) as unknown as typeof fetch }).messages.stream({ model: "m", messages: [] }).finalMessage();
  assert.equal((await run([delta({ content: "a" }, "length")])).stop_reason, "max_tokens");
  assert.equal((await run([delta({}, "content_filter")])).stop_reason, "refusal");
  assert.equal((await run([delta({ content: "done" }, "stop")])).stop_reason, "end_turn");
  const bad = await run([delta({ tool_calls: [{ index: 0, id: "c", function: { name: "get_holdings", arguments: "{oops" } }] }, "tool_calls")]);
  assert.deepEqual((bad.content[0] as { input: unknown }).input, { _unparsedArguments: "{oops" });
});

test("HTTP failures surface as NearAiError with the status (401 key, 402 credits, 429 rate limit)", async () => {
  for (const status of [401, 402, 429, 503]) {
    const client = nearAiChatClient({ key: "k", fetcher: (async () => new Response("{\"error\":\"nope\"}", { status })) as unknown as typeof fetch });
    await assert.rejects(client.messages.stream({ model: "m", messages: [] }).finalMessage(), (e: unknown) => e instanceof NearAiError && e.status === status);
  }
});

test("the conversation loop runs end to end on the NEAR AI adapter: tool call, tool result sent back, final answer", async () => {
  const bodies: { messages: { role: string; tool_call_id?: string }[] }[] = [];
  let call = 0;
  const fetcher = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return call++ === 0
      ? sse([delta({ tool_calls: [{ index: 0, id: "call_h", function: { name: "get_holdings", arguments: "{\"show\":true}" } }] }, "tool_calls")])
      : sse([delta({ content: "You hold $152." }, "stop")]);
  }) as unknown as typeof fetch;
  const reads = {
    mode: "live", accountId: "owner.near", addresses: { near: "owner.near" },
    catalog: async () => [],
    holdings: async () => ({ capturedAt: "2026-11-13T00:00:00Z", rows: [], totalUsd: "152", unvalued: 0, coverage: [], covered: ["near"] }),
  } as unknown as ChatReads;
  const ctx: ToolContext = { reads, cards: new Map(), now: Date.parse("2026-11-13T00:00:00Z") };
  const events: ChatEvent[] = [];
  const r = await runChat({ client: nearAiChatClient({ key: "k", fetcher }), model: "anthropic/claude-haiku-5-5", history: [], userText: "What do I hold?", ctx, emit: (e) => events.push(e) });
  assert.equal(r.status, "complete");
  assert.equal(r.text, "You hold $152.");
  assert.equal(r.model, "anthropic/claude-haiku-5-5");
  assert.equal(bodies.length, 2);
  const tool = bodies[1].messages.find((m) => m.role === "tool");
  assert.equal(tool?.tool_call_id, "call_h");
});

test("intent parser asks NEAR AI for the strict intent schema on Claude Haiku 5.5 and accepts fenced JSON", async () => {
  const { assistantIntent } = await import("../lib/flowvault/assistant-provider.ts");
  const { parseIntent } = await import("../lib/flowvault/assistant.ts");
  const now = Date.parse("2026-11-13T00:00:00Z"), q = "What if ETH falls 50%?";
  let body: { model: string; response_format: { type: string; json_schema: { strict: boolean; schema: { properties: Record<string, unknown> } } } } | null = null;
  const r = await assistantIntent(q, { key: "k" }, now, (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return Response.json({ id: "x", choices: [{ message: { content: "```json\n" + JSON.stringify(parseIntent(q, now)) + "\n```" } }] });
  }) as unknown as typeof fetch);
  assert.equal(body!.model, "anthropic/claude-haiku-5-5");
  assert.equal(body!.response_format.type, "json_schema");
  assert.equal(body!.response_format.json_schema.strict, true);
  assert.ok("kind" in body!.response_format.json_schema.schema.properties);
  assert.equal(r.provider.usedModel, true);
  assert.equal(r.provider.name, "near-ai-cloud");
});

test("redirects are refused, never followed with the key (Workers has no redirect: \"error\")", async () => {
  let init: RequestInit | null = null;
  const client = nearAiChatClient({ key: "k", fetcher: (async (_u: string, i: RequestInit) => { init = i; return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }); }) as unknown as typeof fetch });
  await assert.rejects(client.messages.stream({ model: "m", messages: [] }).finalMessage(), (e: unknown) => e instanceof NearAiError && /redirect/.test(e.message));
  assert.equal(init!.redirect, "manual");
});
