// "Ask FlowVault" intent extraction on Claude (Anthropic API). Same contract as the NEAR AI path in
// assistant-provider.ts: only the question and today's date are sent; Claude returns one structured intent that
// FlowVault validates with validateModelIntent before the engine evaluates it. Claude never sees balances,
// addresses or policy, never answers with figures, and can't authorize anything. Any error, refusal or invalid
// output falls back to the deterministic parser.
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parseIntent, validateModelIntent } from "./assistant.ts";
import { SYSTEM } from "./assistant-provider.ts";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** The structured shape Claude must return; FlowVault's own validator re-checks every field afterwards. */
const IntentOutput = z.object({
  kind: z.enum(["pay", "allocate_surplus", "stress", "explain_block", "clarify", "borrow", "repay", "respond_to_change", "convert"]),
  amount: z.string().nullable(),
  recipientLabel: z.string().nullable(),
  asset: z.enum(["USDC", "USDT", "ETH", "NEAR", "LiNEAR", "rNEAR"]).nullable(),
  chain: z.enum(["near", "base", "arb", "bnb", "eth"]).nullable(),
  dueDate: z.string().nullable(),
  drawdownBps: z.number().int().nullable(),
  action: z.enum(["supply", "withdraw", "pay", "stake"]).nullable(),
  sources: z.array(z.enum(["wallet-usdc", "rhea-usdc", "ETH", "LiNEAR", "rNEAR"])),
  reasons: z.array(z.enum(["USER_CASH_REQUEST", "SURPLUS_ALLOCATION", "STRESS_SCENARIO", "POLICY_EXPLANATION", "MISSING_DETAILS", "BORROW_REQUEST", "REPAY_REQUEST", "SCHEDULE_CHANGE", "CONVERT_REQUEST"])),
});

export async function anthropicIntent(question: string, config: { key: string; model?: string }, now = Date.now()) {
  const model = config.model || ANTHROPIC_DEFAULT_MODEL;
  const dataSent = {
    sent: true,
    fields: ["question", "current UTC date", "fixed intent schema and extraction instructions"],
    request: { url: "https://api.anthropic.com/v1/messages", method: "POST", body: { model, question } },
    excluded: ["workspace balances", "portfolio positions", "saved account addresses", "recipient allowlists", "obligation labels", "policy amounts", "API key"],
    note: "Raw question may itself contain information you typed. The API key is never returned.",
  };
  const fallback = (warning: string) => ({
    proposal: parseIntent(question, now),
    provider: { name: "deterministic-fallback", usedModel: false, attemptedProvider: "anthropic", attestationVerified: false, signatureVerified: false },
    dataSent, warning,
  });
  try {
    const client = new Anthropic({ apiKey: config.key, timeout: 30_000, maxRetries: 1 });
    // Server-side fallbacks: if Opus 5.5 declines, the API re-runs the request on a fallback model in the same call.
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM + "\nToday UTC: " + new Date(now).toISOString().slice(0, 10),
      messages: [{ role: "user", content: question }],
      output_config: { effort: "low", format: zodOutputFormat(IntentOutput) },
    } as Parameters<typeof client.beta.messages.parse>[0]);
    if (response.stop_reason === "refusal") return fallback("Claude declined this question. Deterministic intent parser used.");
    const parsed = response.parsed_output;
    if (!parsed) return fallback("Claude's answer didn't match the intent schema. Deterministic intent parser used.");
    const proposal = validateModelIntent(parsed, question, now);
    return {
      proposal,
      provider: { name: "anthropic", usedModel: true, model: response.model, completionId: response.id.slice(0, 256), attestationVerified: false, signatureVerified: false },
      dataSent, warning: null,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fallback("The Anthropic API key was rejected. Deterministic intent parser used.");
    if (e instanceof Anthropic.RateLimitError) return fallback("Claude is rate limited right now. Deterministic intent parser used.");
    return fallback("Claude was unavailable. Deterministic intent parser used; no model prose or figures were accepted.");
  }
}
