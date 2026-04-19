/**
 * Shared agentic loop with function/tool calling.
 *
 * Supports two backends selected by the USE_OPENROUTER env var:
 *   USE_OPENROUTER=1  →  OpenRouter API (OpenAI-compatible format)
 *   USE_OPENROUTER=0  →  Anthropic SDK (native tool-use format)
 *
 * Consumers define tools once in the ToolDef interface and the runner
 * translates them to the appropriate wire format.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  getOpenRouterChatCompletionsUrl,
  getOpenRouterHeaders,
} from "./openrouter.js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Return a string result for a given tool call. */
export type ToolHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<string>;

export interface AgentOptions {
  model: string;
  system: string;
  tools: ToolDef[];
  maxIterations?: number;
  /** Called for every text block the model emits. */
  onText?: (text: string) => void;
  /** Called just before a tool is executed. */
  onToolCall?: (name: string, args: unknown) => void;
  /** Called with the tool's return value. */
  onToolResult?: (name: string, result: string) => void;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runAgent(
  initialMessage: string,
  opts: AgentOptions,
  handleTool: ToolHandler
): Promise<void> {
  if (process.env.USE_OPENROUTER === "1") {
    return runAgentOpenRouter(initialMessage, opts, handleTool);
  }
  return runAgentAnthropic(initialMessage, opts, handleTool);
}

// ── Anthropic SDK path ────────────────────────────────────────────────────────

async function runAgentAnthropic(
  initialMessage: string,
  opts: AgentOptions,
  handleTool: ToolHandler
): Promise<void> {
  const client = new Anthropic();

  const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters.properties,
      required: t.parameters.required ?? [],
    },
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialMessage },
  ];

  for (let i = 0; i < (opts.maxIterations ?? 30); i++) {
    // Retry on 429 / 529 overload with exponential backoff
    let response: Anthropic.Message | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        response = await client.messages.create({
          model: opts.model,
          max_tokens: 4096,
          system: opts.system,
          tools,
          messages,
        });
        break;
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if ((status === 429 || status === 529) && attempt < 5) {
          const wait = Math.min(2 ** attempt * 5000, 60000);
          console.warn(`[Agent] Rate limit / overloaded (${status}), retrying in ${wait / 1000}s…`);
          await new Promise((r) => setTimeout(r, wait));
        } else {
          throw err;
        }
      }
    }
    if (!response) throw new Error("Failed to get response after retries");

    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        opts.onText?.(block.text.trim());
      }
    }

    if (response.stop_reason === "end_turn") break;
    if (response.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      opts.onToolCall?.(block.name, block.input);
      const result = await handleTool(
        block.name,
        block.input as Record<string, unknown>
      );
      opts.onToolResult?.(block.name, result);
      results.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: results });
  }
}

// ── OpenRouter / OpenAI-compatible path ───────────────────────────────────────

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIResponse {
  choices: [{ message: OAIMessage; finish_reason: string }];
}

async function runAgentOpenRouter(
  initialMessage: string,
  opts: AgentOptions,
  handleTool: ToolHandler
): Promise<void> {
  const oaiTools = opts.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: { type: "object", ...t.parameters },
    },
  }));

  const messages: OAIMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: initialMessage },
  ];

  for (let i = 0; i < (opts.maxIterations ?? 30); i++) {
    const res = await fetch(getOpenRouterChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenRouterHeaders(),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 4096,
        messages,
        tools: oaiTools,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OAIResponse;
    const { message, finish_reason } = data.choices[0];

    messages.push(message);

    if (message.content?.trim()) {
      opts.onText?.(message.content.trim());
    }

    // "stop" = done, "end_turn" = Anthropic models via OR, anything else without
    // tool_calls also means done
    if (
      finish_reason === "stop" ||
      finish_reason === "end_turn" ||
      !message.tool_calls?.length
    ) {
      break;
    }

    for (const call of message.tool_calls!) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch { /* malformed JSON from model — proceed with empty args */ }

      opts.onToolCall?.(call.function.name, args);
      const result = await handleTool(call.function.name, args);
      opts.onToolResult?.(call.function.name, result);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }
}
