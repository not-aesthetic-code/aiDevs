/**
 * Unified LLM client.
 *
 * Reads routing config from env vars injected by the hub server:
 *   USE_OPENROUTER=1        → call OpenRouter
 *   OPENROUTER_MODEL=...    → which model on OpenRouter
 *   MODEL_OVERRIDE=...      → Anthropic model (when not using OpenRouter)
 *
 * Usage:
 *   import { chat } from "../shared/llm.js";
 *   const reply = await chat([{ role: "user", content: "Hello" }]);
 */

import Anthropic from "@anthropic-ai/sdk";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  max_tokens?: number;
  system?: string;
}

/** Returns the text from the first content block. */
export async function chat(messages: Message[], opts: ChatOptions = {}): Promise<string> {
  const useOpenRouter = process.env.USE_OPENROUTER === "1";

  if (useOpenRouter) {
    return chatOpenRouter(messages, opts);
  }
  return chatAnthropic(messages, opts);
}

async function chatAnthropic(messages: Message[], opts: ChatOptions): Promise<string> {
  const client = new Anthropic();
  const model = opts.model ?? process.env.MODEL_OVERRIDE ?? "claude-haiku-4-5-20251001";

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: opts.max_tokens ?? 8192,
    messages,
  };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

async function chatOpenRouter(messages: Message[], opts: ChatOptions): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const model = opts.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku";

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.max_tokens ?? 8192,
    messages: opts.system
      ? [{ role: "system", content: opts.system }, ...messages]
      : messages,
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/aidevs",
      "X-Title": "aiDevs Hub",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? "";
}
