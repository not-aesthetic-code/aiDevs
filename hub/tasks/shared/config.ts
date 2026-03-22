/**
 * common config
 * Tylko zmienne używane w więcej niż jednym zadaniu.
 */

const HUB_BASE_URL = process.env.HUB_BASE_URL ?? "";

export const config = {
  llm: {
    model: process.env.MODEL_OVERRIDE || "claude-haiku-4-5-20251001",
    max_tokens: 8192,
  },

  hub: {
    base_url: HUB_BASE_URL,
    verify_url: `${HUB_BASE_URL}/verify`,
  },
} as const;
