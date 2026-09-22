/**
 * `ai.ask` — put a question to a frontier Claude model.
 *
 * This is deliberately NOT a classifier. The needle pool decides what a visitor meant, under a hard
 * millisecond budget, and that stays exactly where it is (`rules.classify.budgetMs`; past it the pour is
 * `ask`, never a slower brain). This call is for the other thing: composing an answer that needs more
 * capability than a 3B on-device model has — summarising a long policy, drafting a reply, reading a
 * document a visitor pasted in.
 *
 * It is a plain compute call, so it composes like any other: the planner passes it rows from `calls/` as
 * `context`, and the result pours into a vessel. Nothing here evaluates a rule or decides a write.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface AskInput {
  question: string;
  context?: string | null;
  model: string;
  effort: string;
  maxTokens: number;
  system: string;
}

export interface AskOutput {
  answer: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** One client for the process. The SDK resolves credentials itself (ANTHROPIC_API_KEY, or an `ant` profile). */
let client: Anthropic | undefined;

export default async function ask(input: AskInput): Promise<AskOutput> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    // A missing key is a setup problem, not a runtime surprise: say so in the words the operator needs.
    throw new Error(
      "the anthropic plugin has no credentials — set ANTHROPIC_API_KEY in this application's .env, " +
      "or run `ant auth login`. `fishtea doctor` reports this too.",
    );
  }
  client ??= new Anthropic();

  const question = String(input.question ?? "").trim();
  if (!question) throw new Error("ai.ask: question is empty");

  const content = input.context
    ? `${question}\n\nHere is what this business knows that may be relevant:\n\n${input.context}`
    : question;

  // Streaming, because max_tokens can be large enough to outlive a non-streaming HTTP timeout; the helper
  // hands back the assembled message so the call stays a simple request/response from the engine's side.
  const stream = client.messages.stream({
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    thinking: { type: "adaptive" },
    output_config: { effort: input.effort as "low" | "medium" | "high" | "xhigh" | "max" },
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();

  // A policy decline is an HTTP 200, so it has to be checked before the content is read.
  if (message.stop_reason === "refusal") {
    throw new Error(`ai.ask: the model declined this request (${message.stop_details?.category ?? "unspecified"})`);
  }

  const answer = message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    answer,
    model: message.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
