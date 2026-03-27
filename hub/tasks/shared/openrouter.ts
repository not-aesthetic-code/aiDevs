/**
 * OpenRouter env helpers — base URL, headers, and model resolution for task scripts.
 *
 * Env:
 *   OPENROUTER_API_URL          — chat completions endpoint (default: official OpenRouter URL)
 *   OPENROUTER_HTTP_REFERER     — optional; your app or repo URL (e.g. https://github.com/you/project).
 *                                 OpenRouter uses this for attribution / rankings only — not required to call the API.
 *   OPENROUTER_X_TITLE          — optional; short name shown alongside referer in OpenRouter analytics.
 *   OPENROUTER_API_KEY          — bearer token
 *   STEP_ANALYZE_MODEL          — optional override for vision / step analysis (electricity task)
 *   OPENROUTER_MODEL            — preferred model when STEP_ANALYZE_MODEL unset
 *   OPENROUTER_DEFAULT_MODEL    — fallback when OPENROUTER_MODEL unset
 */

const DEFAULT_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4-5-20251001";

/** Full URL for POST .../chat/completions */
export function getOpenRouterChatCompletionsUrl(): string {
  const u = process.env.OPENROUTER_API_URL?.trim();
  return u && u.length > 0 ? u : DEFAULT_CHAT_COMPLETIONS_URL;
}

/** Core headers for chat completion requests; attribution headers only if you set the env vars. */
export function getOpenRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) headers["HTTP-Referer"] = referer;
  const title = process.env.OPENROUTER_X_TITLE?.trim();
  if (title) headers["X-Title"] = title;
  return headers;
}

/**
 * Model id for OpenRouter, using the same precedence as the electricity vision+agent flow:
 * task-specific vision override → global OpenRouter model → default model env → built-in default.
 */
export function resolveOpenRouterModel(): string {
  return (
    process.env.STEP_ANALYZE_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    process.env.OPENROUTER_DEFAULT_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}
